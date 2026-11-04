const Patient = require("../models/Patient");
const User = require("../models/User");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const { findOrCreatePatientForUser, findPatientForUser, canAccessPatient } = require("../utils/patientLink");
const { historyForPatient, patientRecordForPatient } = require("../utils/patientView");

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
    const status = [400, 413, 422].includes(response.status) ? response.status : 503;  // 422 = image rejected by the input check
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

  // No AI result in this message: the patient is a participant of the conversation and must not see it.
  void mlResult;
  const content = `Nouvelle IRM reçue le ${new Date().toLocaleDateString("fr-FR")}. ` +
    "Elle attend votre examen dans le dossier du patient (Scans à valider).";

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

  // A DOCTOR analysing an image (Advanced Analysis) is not a patient: return the result WITHOUT
  // creating or updating any patient record (the old code created a "patient" record named after the doctor).
  if (user.role === "doctor") {
    return res.json({
      prediction, probabilities, heatmap_url: "", explanation, best_model, all_models, ranked_models,
      excluded_models: mlResult.excluded_models || {},
      total_models: mlResult.total_models || Object.keys(all_models || {}).length || 1,
      total_time_ms, saved: false, sentToDoctor: false,
    });
  }
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

  // Human-in-the-loop: the PATIENT never receives the AI output. The scan waits for his doctor's review.
  const hasDoctor = Boolean(patient && patient.assignedDoctor);
  res.status(202).json({
    status: "pending_review",
    scanDate,
    sentToDoctor: hasDoctor,
    message: hasDoctor
      ? "IRM reçue. Votre médecin va l'examiner ; le résultat apparaîtra dans votre historique après sa validation."
      : "IRM reçue. Choisissez votre médecin dans Conversations pour qu'il puisse l'examiner.",
  });
};

exports.reanalyzePatientScan = async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id);
    if (!patient) {
      return res.status(404).json({ message: "Patient introuvable" });
    }
    if (!canAccessPatient(req.user, patient)) {
      return res.status(403).json({ message: "Accès refusé" });   // not one of my patients
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
    return res.status(500).json({ message: "Echec de la reanalyse" });
  }
};

exports.getHistory = async (req, res) => {
  const user = req.user;
  if (user.role === "doctor") {
    // Doctor: every scan of the patients who chose him (fixes "Total scans: 0" on the dashboard)
    const patients = await Patient.find({ assignedDoctor: user._id }).select("-irmImage -medicalHistory.irmImage"); // exclusion only: MongoDB refuses a mix of include + exclude
    const items = patients.flatMap((p) => (p.medicalHistory || []).map((h) => ({
      id: String(h._id), patientId: p._id, patientName: p.name, date: h.date, createdAt: h.date,
      prediction: h.diagnosis, probabilities: h.probabilities || {}, bestModel: h.bestModel,
      allModels: h.allModels || {}, rankedModels: h.rankedModels || [], totalModels: h.totalModels || 0,
      explanation: h.notes || "", review: h.review || { status: "pending" }, heatmap_url: "",
    })));
    return res.json(items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
  }
  // Patient: own record only, and only diagnoses reviewed by the doctor (pending scans are listed as such)
  const patient = await findPatientForUser(user);
  return res.json(patient ? historyForPatient(patient) : []);
};

exports.getPatientById = async (req, res) => {
  const patient = await Patient.findById(req.params.id);
  if (!patient) return res.status(404).json({ message: "Patient not found" });
  if (!canAccessPatient(req.user, patient)) return res.status(403).json({ message: "Accès refusé" });
  res.json(req.user.role === "doctor" ? patient : patientRecordForPatient(patient));
};

// Exposed for unit tests only
exports._internal = { callMLService, MLUnavailableError };
