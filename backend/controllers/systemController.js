const Patient = require("../models/Patient");
const User = require("../models/User");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const { findOrCreatePatientForUser, findPatientForUser, canAccessPatient } = require("../utils/patientLink");

// URL du service Python ML
// 127.0.0.1, not "localhost": Node >= 17 may resolve localhost to IPv6 (::1) while Flask listens on IPv4
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://127.0.0.1:5001";

const stageRecommendations = {
  "Non Demented": {
    title: "Non Demented",
    summary: "prevention, memoire legere, hygiene de vie, marche, lecture",
    lifestyle: ["prevention", "hygiene de vie", "marche", "lecture"],
    cognitiveExercises: ["memoire legere"],
    sleep: [],
    nutrition: [],
    physicalActivity: ["marche"],
    mentalStimulation: ["memoire legere", "lecture"],
    dailyRoutine: [],
    homeSupport: [],
  },
  "Very Mild Demented": {
    title: "Very Mild Demented",
    summary: "rappels, exercices memoire courts, sommeil regulier, organisation quotidienne",
    lifestyle: ["rappels", "organisation quotidienne"],
    cognitiveExercises: ["exercices memoire courts"],
    sleep: ["sommeil regulier"],
    nutrition: [],
    physicalActivity: [],
    mentalStimulation: ["exercices memoire courts"],
    dailyRoutine: ["organisation quotidienne"],
    homeSupport: ["rappels"],
  },
  "Mild Demented": {
    title: "Mild Demented",
    summary: "routines fixes, aide legere, activite cognitive guidee, suivi nutrition",
    lifestyle: ["routines fixes", "aide legere"],
    cognitiveExercises: ["activite cognitive guidee"],
    sleep: [],
    nutrition: ["suivi nutrition"],
    physicalActivity: [],
    mentalStimulation: ["activite cognitive guidee"],
    dailyRoutine: ["routines fixes"],
    homeSupport: ["aide legere"],
  },
  "Moderate Demented": {
    title: "Moderate Demented",
    summary: "exercices simples, securite maison, aide familiale, reperes visuels",
    lifestyle: ["securite maison"],
    cognitiveExercises: ["exercices simples"],
    sleep: [],
    nutrition: [],
    physicalActivity: [],
    mentalStimulation: ["reperes visuels"],
    dailyRoutine: ["reperes visuels"],
    homeSupport: ["securite maison", "aide familiale"],
  },
  "Severe Demented": {
    title: "Severe Demented",
    summary: "confort, surveillance, stimulation douce, environnement calme",
    lifestyle: ["confort", "environnement calme"],
    cognitiveExercises: ["stimulation douce"],
    sleep: [],
    nutrition: [],
    physicalActivity: [],
    mentalStimulation: ["stimulation douce"],
    dailyRoutine: ["environnement calme"],
    homeSupport: ["surveillance", "confort"],
  },
};

function buildRecommendations(prediction) {
  return (
    stageRecommendations[prediction] || {
      title: prediction || "Soutien personnalise",
      summary: "Adaptation selon l'evolution clinique du patient.",
      lifestyle: [],
      cognitiveExercises: [],
      sleep: [],
      nutrition: [],
      physicalActivity: [],
      mentalStimulation: [],
      dailyRoutine: [],
      homeSupport: [],
    }
  );
}

/**
 * Error raised when NO trustworthy AI answer exists. The caller must answer with `status`
 * and must NOT write anything to the patient record.
 */
class MLUnavailableError extends Error {
  constructor(message, status = 503, details = null) {
    super(message);
    this.name = "MLUnavailableError";
    this.status = status;   // 503 = service down / no model, 400/413 = bad image from the client
    this.details = details; // e.g. which models were excluded and why
  }
}

/**
 * Calls the Python ML service. NO simulated fallback: if it fails, it throws MLUnavailableError.
 * Uses native FormData/Blob (Node >= 18) instead of a hand-built multipart body.
 */
async function callMLService(fileBuffer, mimeType, originalName) {
  const form = new FormData();
  form.append("file", new Blob([fileBuffer], { type: mimeType || "application/octet-stream" }), originalName || "mri.jpg");

  let response;
  try {
    response = await fetch(`${ML_SERVICE_URL}/predict`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000), // never hang the request forever
    });
  } catch (err) {
    throw new MLUnavailableError("Analyse indisponible : le service IA ne répond pas.", 503, err.message);
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // non-JSON answer -> handled below as an invalid response
  }

  if (!response.ok) {
    // 400/413 = the image itself is the problem (client error); anything else = service unavailable
    const status = [400, 413].includes(response.status) ? response.status : 503;
    throw new MLUnavailableError(body?.error || `Service IA en erreur (${response.status}).`, status, body?.excluded_models || null);
  }
  if (!body || typeof body.prediction !== "string") {
    throw new MLUnavailableError("Réponse du service IA invalide.", 503);
  }
  return body;
}

/** Sends the ML error to the client (the database has not been touched). */
function sendMlError(res, err) {
  return res.status(err.status).json({ message: err.message, details: err.details });
}

function parseDataUrlImage(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    throw new Error("Image IRM introuvable ou invalide");
  }

  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) {
    throw new Error("Format image base64 invalide");
  }

  return {
    mimeType: match[1] || "image/jpeg",
    buffer: Buffer.from(match[2], "base64"),
  };
}

async function appendMedicalHistory(patient, mlResult, scanDate, irmImageB64, recommendations) {
  if (!patient) return;

  try {
    await Patient.findByIdAndUpdate(patient._id, {
      $push: {
        medicalHistory: {
          date: scanDate,
          diagnosis: mlResult.prediction,
          notes: mlResult.explanation,
          recommendations: recommendations || null,
          probabilities: mlResult.probabilities,
          bestModel: mlResult.best_model || null,
          allModels: mlResult.all_models || {},
          rankedModels: mlResult.ranked_models || [],
          totalModels: mlResult.total_models || Object.keys(mlResult.all_models || {}).length || 1,
          irmImage: irmImageB64,
          doctor: patient.assignedDoctor || null,
        },
      },
    });
  } catch (histErr) {
    console.warn("⚠️  Historique non sauvegardé (document trop grand ?):", histErr.message);
  }
}

async function notifyAssignedDoctor(patient, mlResult, senderId) {
  if (!patient?.assignedDoctor) return;

  const doctor = await User.findById(patient.assignedDoctor);
  if (!doctor) return;

  let conversation = await Conversation.findOne({
    patient: patient._id,
    doctor: doctor._id,
  });

  if (!conversation) {
    conversation = new Conversation({
      participants: [patient._id, doctor._id],
      patient: patient._id,
      doctor: doctor._id,
    });
    await conversation.save();
  }

  const content = (
    `[${mlResult.total_models || Object.keys(mlResult.all_models || {}).length || 1} modèles IA] Nouveau scan IRM analysé.\n` +
    `Meilleur résultat : ${mlResult.best_model} → ${mlResult.prediction} (${((mlResult.confidence || 0) * 100).toFixed(1)}% confiance).\n` +
    `${mlResult.explanation}`
  );

  const message = new Message({
    conversationId: conversation._id.toString(),
    sender: senderId,
    receiver: doctor._id,
    content,
    messageType: "text",
  });
  await message.save();

  await Conversation.findByIdAndUpdate(
    conversation._id,
    { lastMessage: { content, sender: senderId, createdAt: new Date() }, updatedAt: new Date() },
    { new: true }
  );
}

exports.predict = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const user = req.user;
  if (!user) {
    return res.status(401).json({ message: "Utilisateur non authentifié" });
  }

  // 1) AI first. If it fails, stop HERE: no patient update, no history entry, no message to the doctor.
  let mlResult;
  try {
    mlResult = await callMLService(req.file.buffer, req.file.mimetype, req.file.originalname);
  } catch (err) {
    if (err instanceof MLUnavailableError) return sendMlError(res, err);
    throw err; // unexpected bug -> Express 5 turns it into a 500
  }
  console.log(`ML Service -> ${mlResult.best_model} -> ${mlResult.prediction} (${(mlResult.confidence * 100).toFixed(1)}%)`);

  const { prediction, probabilities, best_model, all_models, ranked_models, explanation, total_time_ms } = mlResult;
  const recommendations = buildRecommendations(prediction);

  const mimeType = req.file.mimetype || "image/jpeg";
  const irmImageB64 = `data:${mimeType};base64,${req.file.buffer.toString("base64")}`;
  const scanDate = new Date();

  const irmUpdate = {
    $set: {
      prediction,
      probabilities,
      bestModel: best_model || null,
      allModels: all_models || {},
      rankedModels: ranked_models || [],
      totalModels: mlResult.total_models || Object.keys(all_models || {}).length || 1,
      explanation: explanation || "",
      recommendations,
      irmImage: irmImageB64,
      lastScanDate: scanDate,
    },
  };

  // 2) The record is found by account id / exact email ONLY. The old 5-step chain matched records by
  //    NAME with an unanchored regex ("Ali" -> "Alia Ben Salah") and could overwrite another patient.
  let patient = await findOrCreatePatientForUser(user);
  patient = await Patient.findByIdAndUpdate(patient._id, irmUpdate, { returnDocument: "after" });

  await appendMedicalHistory(patient, mlResult, scanDate, irmImageB64, recommendations);
  await notifyAssignedDoctor(patient, mlResult, user._id);

  res.json({
    prediction,
    probabilities,
    heatmap_url: "",
    explanation,
    recommendations,
    best_model,
    all_models,
    ranked_models,
    total_models: mlResult.total_models || Object.keys(all_models || {}).length || 1,
    total_time_ms,
    sentToDoctor: !!(patient && patient.assignedDoctor),
  });
};

exports.reanalyzePatientScan = async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) {
      return res.status(404).json({ message: "Patient introuvable" });
    }

    const { buffer, mimeType } = parseDataUrlImage(patient.irmImage);
    const mlResult = await callMLService(buffer, mimeType, `${patient.name || "patient"}-reanalyze.jpg`); // throws -> nothing saved
    const scanDate = new Date();
    const recommendations = buildRecommendations(mlResult.prediction);

    patient.prediction = mlResult.prediction;
    patient.probabilities = mlResult.probabilities;
    patient.bestModel = mlResult.best_model || null;
    patient.allModels = mlResult.all_models || {};
    patient.rankedModels = mlResult.ranked_models || [];
    patient.totalModels = mlResult.total_models || Object.keys(mlResult.all_models || {}).length || 1;
    patient.explanation = mlResult.explanation || "";
    patient.recommendations = recommendations;
    patient.lastScanDate = scanDate;
    await patient.save();

    await appendMedicalHistory(patient, mlResult, scanDate, patient.irmImage, recommendations);

    return res.json({
      message: "Reanalyse terminee",
      patientId: patient._id,
      prediction: mlResult.prediction,
      probabilities: mlResult.probabilities,
      best_model: mlResult.best_model,
      all_models: mlResult.all_models,
      ranked_models: mlResult.ranked_models,
      total_models: mlResult.total_models || Object.keys(mlResult.all_models || {}).length || 1,
      explanation: mlResult.explanation || "",
      recommendations,
      heatmap_url: "",
      reanalyzed_at: scanDate,
    });
  } catch (error) {
    if (error instanceof MLUnavailableError) return sendMlError(res, error); // previous diagnosis is kept unchanged
    console.error("reanalyzePatientScan error:", error);
    return res.status(500).json({ message: "Echec de la reanalyse", error: error.message });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Utilisateur non authentifie" });
    }

    const patient = await findPatientForUser(user); // own record only (no name matching)

    if (!patient) {
      return res.json([]);
    }

    const historyItems = (patient.medicalHistory || [])
      .map((item, index) => ({
        id: `${patient._id}-history-${index}`,
        patientId: patient._id,
        date: item.date || patient.lastScanDate || patient.createdAt,
        createdAt: item.date || patient.createdAt,
        prediction: item.diagnosis || patient.prediction || "N/A",
        probabilities: item.probabilities || {},
        heatmap_url: "",
        explanation: item.notes || patient.explanation || "",
        recommendations: item.recommendations || buildRecommendations(item.diagnosis || patient.prediction),
        bestModel: item.bestModel || null,
        allModels: item.allModels || {},
        rankedModels: item.rankedModels || [],
        totalModels: item.totalModels || Object.keys(item.allModels || {}).length || 0,
        source: "medicalHistory",
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const currentScan = patient.prediction || Object.keys(patient.probabilities || {}).length > 0
      ? {
          id: `${patient._id}-current`,
          patientId: patient._id,
          date: patient.lastScanDate || patient.createdAt,
          createdAt: patient.createdAt,
          prediction: patient.prediction || "N/A",
          probabilities: patient.probabilities || {},
          heatmap_url: "",
          explanation: patient.explanation || "",
          recommendations: patient.recommendations || buildRecommendations(patient.prediction),
          bestModel: patient.bestModel || null,
          allModels: patient.allModels || {},
          rankedModels: patient.rankedModels || [],
          totalModels: patient.totalModels || Object.keys(patient.allModels || {}).length || 0,
          source: "current",
        }
      : null;

    const latestHistoryTime = historyItems[0]?.date ? new Date(historyItems[0].date).getTime() : null;
    const currentTime = currentScan?.date ? new Date(currentScan.date).getTime() : null;
    const mergedHistory = currentScan && currentTime !== latestHistoryTime
      ? [currentScan, ...historyItems]
      : historyItems;

    res.json(mergedHistory);
  } catch (error) {
    console.error("getHistory error:", error);
    res.status(500).json({ message: "Erreur lors du chargement de l'historique", error: error.message });
  }
};

exports.getPatientById = async (req, res) => {
  const patient = await Patient.findById(req.params.id);
  if (!patient) return res.status(404).json({ message: "Patient not found" });
  if (!canAccessPatient(req.user, patient)) return res.status(403).json({ message: "Accès refusé" });
  res.json(patient);
};

// Exposed for unit tests only
exports._internal = { callMLService, MLUnavailableError };
