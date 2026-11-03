const Patient = require("../models/Patient");
const { canAccessPatient } = require("../utils/patientLink");

// Mass-assignment protection: only these fields can be written from a request body
// (before, req.body went straight into the document: prediction, userId, irmImage... were all writable)
const EDITABLE_FIELDS = ["name", "age", "email", "phone", "symptoms", "assignedDoctor"];
const pickEditable = (body = {}) =>
  Object.fromEntries(EDITABLE_FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));

// Ajouter patient
exports.createPatient = async (req, res) => {
  const patient = new Patient(pickEditable(req.body));
  await patient.save();
  res.json(patient);
};

// Liste patients — irmImage exclu pour garder la réponse légère
exports.getPatients = async (req, res) => {
  const patients = await Patient.find()
    .select("-irmImage")
    .populate("assignedDoctor", "username email");
  res.json(patients);
};

exports.getPatientById = async (req, res) => {
  // Endpoint détail : inclut tout sauf irmImage (trop lourd)
  const patient = await Patient.findById(req.params.id)
    .select("-irmImage")
    .populate("assignedDoctor", "username email");
  if (!patient) return res.status(404).json({ message: "Patient not found" });
  if (!canAccessPatient(req.user, patient)) return res.status(403).json({ message: "Accès refusé" });
  res.json(patient);
};

// Mettre à jour un patient
exports.updatePatient = async (req, res) => {
  const patient = await Patient.findByIdAndUpdate(req.params.id, { $set: pickEditable(req.body) }, { returnDocument: "after", runValidators: true })
    .populate("assignedDoctor", "username email");
  if (!patient) return res.status(404).json({ message: "Patient not found" });
  res.json(patient);
};

// Assigner un médecin à un patient
exports.assignDoctor = async (req, res) => {
  const { doctorId } = req.body;
  const patient = await Patient.findByIdAndUpdate(
    req.params.id,
    { assignedDoctor: doctorId },
    { returnDocument: "after" }
  ).populate("assignedDoctor", "username email");

  if (!patient) return res.status(404).json({ message: "Patient not found" });
  res.json(patient);
};

/**
 * Retourne UNIQUEMENT l'image IRM, les probabilités et la date de scan.
 * Auto-réparateur : si le dossier principal n'a pas d'image, cherche dans
 * les dossiers doublons (même email ou même nom) et transfère l'image.
 * GET /api/patients/:id/irm
 */
exports.getPatientIrmImage = async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id)
      .select("name email userId irmImage lastScanDate probabilities prediction bestModel allModels rankedModels totalModels explanation createdAt");

    if (!patient) {
      return res.status(404).json({ message: "Patient introuvable" });
    }

    if (!canAccessPatient(req.user, patient)) {
      return res.status(403).json({ message: "Accès refusé" });
    }

    // The old code searched OTHER records with the same name (unanchored regex) and COPIED their MRI
    // and diagnosis into this one. Removed: a record only shows its own data.
    return res.json({
      _id:           patient._id,
      name:          patient.name,
      irmImage:      patient.irmImage ?? null,
      lastScanDate:  patient.lastScanDate ?? null,
      probabilities: patient.probabilities ?? {},
      prediction:    patient.prediction ?? null,
      bestModel:     patient.bestModel ?? null,
      allModels:     patient.allModels ?? {},
      rankedModels:  patient.rankedModels ?? [],
      totalModels:   patient.totalModels ?? 0,
      explanation:   patient.explanation ?? "",
      createdAt:     patient.createdAt,
    });
  } catch (error) {
    console.error("getPatientIrmImage error:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
};
// Récupérer les patients assignés à un médecin
exports.getPatientsByDoctor = async (req, res) => {
  try {
    const { doctorId } = req.params;
    // irmImage exclu de la liste — fetch via /:id/irm a la demande
    const patients = await Patient.find({ assignedDoctor: doctorId })
      .select("-irmImage")
      .populate("assignedDoctor", "username email")
      .sort({ createdAt: -1 });
    res.json(patients);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};
