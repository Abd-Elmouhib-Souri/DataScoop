const Patient = require("../models/Patient");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const { canAccessPatient } = require("../utils/patientLink");
const { patientRecordForPatient, patientForDoctorList, REVIEWED } = require("../utils/patientView");

const CLASSES = ["Mild Demented", "Moderate Demented", "Non Demented", "Very Mild Demented"];
// Lists never carry MRI images (base64, heavy): they are fetched one by one via /:id/irm
const NO_IMAGES = "-irmImage -medicalHistory.irmImage";

// Mass-assignment protection: only these fields can be written from a request body
// (assignedDoctor is NOT editable here: a patient chooses his doctor himself, see messageRoutes)
const EDITABLE_FIELDS = ["name", "age", "email", "phone", "symptoms"];
const pickEditable = (body = {}) =>
  Object.fromEntries(EDITABLE_FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));

// Create a record (doctor only): the creating doctor becomes the assigned doctor
exports.createPatient = async (req, res) => {
  const patient = await Patient.create({ ...pickEditable(req.body), assignedDoctor: req.userId });
  res.status(201).json(patient);
};

// The doctor's OWN patients only (it used to return every patient of every doctor)
exports.getPatients = async (req, res) => {
  const patients = await Patient.find({ assignedDoctor: req.userId })
    .select(NO_IMAGES)
    .populate("assignedDoctor", "username email")
    .sort({ createdAt: -1 });
  res.json(patients.map(patientForDoctorList));   // prediction = validated diagnosis, aiPrediction = AI
};

exports.getPatientById = async (req, res) => {
  const patient = await Patient.findById(req.params.id)
    .select(NO_IMAGES)
    .populate("assignedDoctor", "username email");
  if (!patient) return res.status(404).json({ message: "Patient not found" });
  if (!canAccessPatient(req.user, patient)) return res.status(403).json({ message: "Accès refusé" });
  // A patient never receives the raw AI output, only diagnoses reviewed by his doctor
  res.json(req.user.role === "doctor" ? patient : patientRecordForPatient(patient));
};

// Update administrative fields (the patient's own doctor only)
exports.updatePatient = async (req, res) => {
  const existing = await Patient.findById(req.params.id).select("assignedDoctor userId");
  if (!existing) return res.status(404).json({ message: "Patient not found" });
  if (!canAccessPatient(req.user, existing)) return res.status(403).json({ message: "Accès refusé" });
  const patient = await Patient.findByIdAndUpdate(
    req.params.id, { $set: pickEditable(req.body) }, { returnDocument: "after", runValidators: true }
  ).select(NO_IMAGES).populate("assignedDoctor", "username email");
  res.json(patient);
};

// Hand a patient over to a colleague: only the CURRENT doctor of this patient can do it
exports.assignDoctor = async (req, res) => {
  const existing = await Patient.findById(req.params.id).select("assignedDoctor userId");
  if (!existing) return res.status(404).json({ message: "Patient not found" });
  if (!canAccessPatient(req.user, existing)) return res.status(403).json({ message: "Accès refusé" });
  const patient = await Patient.findByIdAndUpdate(
    req.params.id, { assignedDoctor: String(req.body?.doctorId ?? "") }, { returnDocument: "after" }
  ).select(NO_IMAGES).populate("assignedDoctor", "username email");
  res.json(patient);
};

/** GET /api/patients/:id/irm - the latest MRI image (+ AI fields for the doctor only). */
exports.getPatientIrmImage = async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id).select(
      "name email userId assignedDoctor irmImage lastScanDate probabilities prediction bestModel allModels rankedModels totalModels explanation createdAt"
    );
    if (!patient) return res.status(404).json({ message: "Patient introuvable" });
    if (!canAccessPatient(req.user, patient)) return res.status(403).json({ message: "Accès refusé" });

    const isDoctor = req.user.role === "doctor";
    // (The old code COPIED MRIs and diagnoses from other records with a similar name - removed.)
    return res.json({
      _id: patient._id,
      name: patient.name,
      irmImage: patient.irmImage ?? null,
      lastScanDate: patient.lastScanDate ?? null,
      createdAt: patient.createdAt,
      // AI suggestion: doctor only
      probabilities: isDoctor ? patient.probabilities ?? {} : {},
      prediction: isDoctor ? patient.prediction ?? null : null,
      bestModel: isDoctor ? patient.bestModel ?? null : null,
      allModels: isDoctor ? patient.allModels ?? {} : {},
      rankedModels: isDoctor ? patient.rankedModels ?? [] : [],
      totalModels: isDoctor ? patient.totalModels ?? 0 : 0,
      explanation: isDoctor ? patient.explanation ?? "" : "",
    });
  } catch (error) {
    console.error("getPatientIrmImage error:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

// A doctor can only list HIS OWN patients (Reports used to browse every doctor's patients)
exports.getPatientsByDoctor = async (req, res) => {
  if (String(req.params.doctorId) !== req.userId) {
    return res.status(403).json({ message: "Accès refusé" });
  }
  const patients = await Patient.find({ assignedDoctor: req.userId })
    .select(NO_IMAGES)
    .populate("assignedDoctor", "username email")
    .sort({ createdAt: -1 });
  res.json(patients.map(patientForDoctorList));
};

/** GET /api/patients/reviews/pending - scans of MY patients waiting for my review (with the AI suggestion). */
exports.getPendingReviews = async (req, res) => {
  const patients = await Patient.find({ assignedDoctor: req.userId }).select("name email medicalHistory");
  const pending = [];
  for (const p of patients) {
    for (const h of p.medicalHistory || []) {
      if (!REVIEWED.includes(h.review?.status)) {
        pending.push({
          patientId: p._id, patientName: p.name, historyId: h._id, date: h.date,
          aiPrediction: h.diagnosis, probabilities: h.probabilities || {},
          allModels: h.allModels || {}, bestModel: h.bestModel, irmImage: h.irmImage || null,
        });
      }
    }
  }
  pending.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  res.json(pending);
};

/**
 * POST /api/patients/:id/reviews/:historyId  { decision: "validated" | "corrected", finalDiagnosis?, comment? }
 * The assigned doctor validates the AI suggestion or replaces it. Only then does the patient see a diagnosis.
 */
exports.reviewScan = async (req, res) => {
  const decision = String(req.body?.decision ?? "");
  const comment = String(req.body?.comment ?? "").trim().slice(0, 2000);
  if (!["validated", "corrected"].includes(decision)) {
    return res.status(400).json({ message: "Décision invalide (validated | corrected)" });
  }

  const patient = await Patient.findById(req.params.id).select("userId assignedDoctor medicalHistory");
  if (!patient) return res.status(404).json({ message: "Patient introuvable" });
  if (!canAccessPatient(req.user, patient)) return res.status(403).json({ message: "Accès refusé" });
  const entry = patient.medicalHistory.id(req.params.historyId);
  if (!entry) return res.status(404).json({ message: "Scan introuvable" });

  // validated = the doctor confirms the AI class; corrected = the doctor sets another class
  const finalDiagnosis = decision === "validated" ? entry.diagnosis : String(req.body?.finalDiagnosis ?? "");
  if (!CLASSES.includes(finalDiagnosis)) {
    return res.status(400).json({ message: `Diagnostic invalide (attendu : ${CLASSES.join(", ")})` });
  }

  if (decision === "corrected" && finalDiagnosis === entry.diagnosis) {
    return res.status(400).json({ message: "Cette classe est déjà la suggestion de l'IA : utilisez « Valider »." });
  }

  entry.review = { status: decision, finalDiagnosis, comment, reviewedBy: req.user._id, reviewedAt: new Date() };
  await patient.save();

  // Tell the patient (no diagnosis in the message: he reads it in his history, with the doctor's comment)
  const conversation = await Conversation.findOneAndUpdate(
    { patient: patient._id, doctor: req.user._id },
    { $setOnInsert: { participants: [patient._id, req.user._id], patient: patient._id, doctor: req.user._id } },
    { upsert: true, returnDocument: "after" }
  );
  if (patient.userId) {
    const content = "Votre médecin a examiné votre IRM. Le résultat et son commentaire sont dans votre historique.";
    await Message.create({ conversationId: String(conversation._id), sender: req.user._id, receiver: patient.userId, content });
    await Conversation.updateOne({ _id: conversation._id }, { lastMessage: { content, sender: req.user._id, createdAt: new Date() }, updatedAt: new Date() });
  }

  res.json({ patientId: patient._id, historyId: entry._id, review: entry.review });
};
