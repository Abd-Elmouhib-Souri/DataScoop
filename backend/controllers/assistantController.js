const Patient = require("../models/Patient");
const { findOrCreatePatientForUser: linkPatient } = require("../utils/patientLink");

const defaultAssistantProfile = (user) => ({
  patientName: user?.username || "",
  age: "",
  diagnosis: "Suivi cognitif Alzheimer",
  emergencyContact: "",
  emergencyPhone: "",
  dailyNotes: "",
});

const serializeAssistant = (patient) => ({
  profile: {
    patientName: patient.assistant?.profile?.patientName || patient.name || "",
    age: patient.assistant?.profile?.age || (patient.age != null ? String(patient.age) : ""),
    diagnosis: patient.assistant?.profile?.diagnosis || patient.prediction || "Suivi cognitif Alzheimer",
    emergencyContact: patient.assistant?.profile?.emergencyContact || "",
    emergencyPhone: patient.assistant?.profile?.emergencyPhone || "",
    dailyNotes: patient.assistant?.profile?.dailyNotes || "",
  },
  familyMembers: (patient.assistant?.familyMembers || []).map((member) => ({
    id: member._id.toString(),
    name: member.name,
    relation: member.relation,
    phone: member.phone || "",
    notes: member.notes || "",
    imageUrl: member.imageUrl || "",
  })),
  reminders: (patient.assistant?.reminders || []).map((reminder) => ({
    id: reminder._id.toString(),
    title: reminder.title,
    time: reminder.time,
    details: reminder.details || "",
    done: Boolean(reminder.done),
    lastNotifiedOn: reminder.lastNotifiedOn || null,
  })),
});

const serializeJournalEntries = (patient) =>
  (patient.journalEntries || [])
    .slice()
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .map((entry) => ({
      id: entry._id.toString(),
      createdAt: entry.createdAt,
      scanPrediction: entry.scanPrediction || "Aucun scan",
      memory: entry.memory || "Faible",
      sleep: entry.sleep || "Bon",
      mood: entry.mood || "Stable",
      confusion: entry.confusion || "Aucune",
      autonomy: entry.autonomy || "Bonne",
      forgetfulness: entry.forgetfulness || "Faible",
      fatigue: entry.fatigue || "Faible",
      riskLevel: entry.riskLevel || "Medium",
      note: entry.note || "",
    }));

// Linked by account id / exact email only (the old version also matched by NAME)
const findOrCreatePatientForUser = async (user) => {
  const patient = await linkPatient(user, {
    assistant: { profile: defaultAssistantProfile(user), familyMembers: [], reminders: [] },
  });
  patient.assistant = patient.assistant || {};
  if (!patient.assistant.profile?.patientName) {
    patient.assistant.profile = {
      ...defaultAssistantProfile(user),
      ...(patient.assistant.profile?.toObject?.() || patient.assistant.profile || {}),
      patientName: patient.assistant?.profile?.patientName || patient.name || user.username,
    };
    await patient.save();
  }
  return patient;
};

exports.getAssistantData = async (req, res) => {
  try {
    const patient = await findOrCreatePatientForUser(req.user);
    res.json(serializeAssistant(patient));
  } catch (error) {
    res.status(500).json({ message: "Erreur lors du chargement de l'assistant patient", error: error.message });
  }
};

exports.updateAssistantProfile = async (req, res) => {
  try {
    const patient = await findOrCreatePatientForUser(req.user);
    const currentProfile = patient.assistant?.profile?.toObject?.() || patient.assistant?.profile || {};
    patient.assistant.profile = {
      ...defaultAssistantProfile(req.user),
      ...currentProfile,
      ...req.body,
    };
    await patient.save();
    res.json(serializeAssistant(patient));
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la mise a jour du profil assistant", error: error.message });
  }
};

exports.addFamilyMember = async (req, res) => {
  try {
    const { name, relation, phone = "", notes = "", imageUrl = "" } = req.body;
    if (!name || !relation) {
      return res.status(400).json({ message: "Nom et lien de famille requis" });
    }

    const patient = await findOrCreatePatientForUser(req.user);
    patient.assistant.familyMembers.push({ name, relation, phone, notes, imageUrl });
    await patient.save();
    res.json(serializeAssistant(patient));
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de l'ajout du proche", error: error.message });
  }
};

exports.deleteFamilyMember = async (req, res) => {
  try {
    const patient = await findOrCreatePatientForUser(req.user);
    patient.assistant.familyMembers = patient.assistant.familyMembers.filter(
      (member) => member._id.toString() !== req.params.memberId
    );
    await patient.save();
    res.json(serializeAssistant(patient));
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la suppression du proche", error: error.message });
  }
};

exports.addReminder = async (req, res) => {
  try {
    const { title, time, details = "" } = req.body;
    if (!title || !time) {
      return res.status(400).json({ message: "Titre et heure requis" });
    }

    const patient = await findOrCreatePatientForUser(req.user);
    patient.assistant.reminders.push({ title, time, details, done: false, lastNotifiedOn: null });
    patient.assistant.reminders.sort((left, right) => left.time.localeCompare(right.time));
    await patient.save();
    res.json(serializeAssistant(patient));
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de l'ajout du reminder", error: error.message });
  }
};

exports.updateReminder = async (req, res) => {
  try {
    const patient = await findOrCreatePatientForUser(req.user);
    const reminder = patient.assistant.reminders.id(req.params.reminderId);
    if (!reminder) {
      return res.status(404).json({ message: "Reminder introuvable" });
    }

    const allowedFields = ["title", "time", "details", "done", "lastNotifiedOn"];
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        reminder[field] = req.body[field];
      }
    }

    patient.assistant.reminders.sort((left, right) => left.time.localeCompare(right.time));
    await patient.save();
    res.json(serializeAssistant(patient));
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la mise a jour du reminder", error: error.message });
  }
};

exports.deleteReminder = async (req, res) => {
  try {
    const patient = await findOrCreatePatientForUser(req.user);
    patient.assistant.reminders = patient.assistant.reminders.filter(
      (reminder) => reminder._id.toString() !== req.params.reminderId
    );
    await patient.save();
    res.json(serializeAssistant(patient));
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la suppression du reminder", error: error.message });
  }
};

exports.getJournalEntries = async (req, res) => {
  try {
    const patient = await findOrCreatePatientForUser(req.user);
    res.json({ entries: serializeJournalEntries(patient) });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors du chargement du journal", error: error.message });
  }
};

exports.addJournalEntry = async (req, res) => {
  try {
    const patient = await findOrCreatePatientForUser(req.user);
    const {
      scanPrediction = patient.prediction || "Aucun scan",
      memory = "Faible",
      sleep = "Bon",
      mood = "Stable",
      confusion = "Aucune",
      autonomy = "Bonne",
      forgetfulness = "Faible",
      fatigue = "Faible",
      riskLevel = "Medium",
      note = "",
    } = req.body || {};

    patient.journalEntries.unshift({
      createdAt: new Date(),
      scanPrediction,
      memory,
      sleep,
      mood,
      confusion,
      autonomy,
      forgetfulness,
      fatigue,
      riskLevel,
      note,
    });
    patient.journalEntries = patient.journalEntries.slice(0, 30);
    await patient.save();

    res.json({ entries: serializeJournalEntries(patient) });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de l'enregistrement du journal", error: error.message });
  }
};
