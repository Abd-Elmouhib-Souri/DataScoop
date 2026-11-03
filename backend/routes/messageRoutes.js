const express = require("express");
const router = express.Router();
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const Patient = require("../models/Patient");
const User = require("../models/User");

const { authenticateToken } = require("../middleware/auth");
const { findPatientForUser } = require("../utils/patientLink");

// The old local middleware accepted a Mongo _id or an EMAIL as token -> replaced by the shared JWT check.

/** Is this user one of the two participants of the conversation? (doctor, or the patient who owns the record) */
async function isParticipant(user, conversation) {
  if (!conversation) return false;
  if (conversation.doctor?.toString() === user._id.toString()) return true;
  if (user.role !== "user") return false;
  const patient = await Patient.findById(conversation.patient).select("userId");
  return patient?.userId?.toString() === user._id.toString();
}

// Créer ou obtenir une conversation
router.post("/conversations", authenticateToken, async (req, res) => {
  try {
    const { patientId, patientEmail, doctorId } = req.body;

    // Résoudre le patient par ID ou email
    let patient = null;
    if (patientId) {
      patient = await Patient.findById(patientId);
    }
    if (!patient && patientEmail) {
      patient = await Patient.findOne({ email: patientEmail });
      if (!patient) {
        // Créer automatiquement le patient si l'utilisateur existe mais n'a pas encore de profil Patient
        const user = await User.findOne({ email: patientEmail, role: "user" });
        if (user) {
          patient = new Patient({
            name: user.username,
            email: user.email,
            age: null,
            phone: "",
            symptoms: [],
            medicalHistory: [],
          });
          await patient.save();
        }
      }
    }
    if (!patient) {
      return res.status(404).json({ message: "Patient non trouvé" });
    }
    if (req.user.role === "user" && patient.email !== req.user.email && patient.userId?.toString() !== req.userId) {
      return res.status(403).json({ message: "Accès refusé" });
    }

    // Vérifier que le médecin existe
    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== "doctor") {
      return res.status(404).json({ message: "Médecin non trouvé" });
    }

    // Chercher une conversation existante
    let conversation = await Conversation.findOne({
      patient: patient._id,
      doctor: doctorId,
    });

    if (!conversation) {
      // Créer une nouvelle conversation
      conversation = new Conversation({
        participants: [patient._id, doctorId],
        patient: patient._id,
        doctor: doctorId,
      });
      await conversation.save();

      // Assigner automatiquement le médecin au patient lors de la création de la conversation
      await Patient.findByIdAndUpdate(
        patient._id,
        { assignedDoctor: doctorId },
        { new: true }
      );
    }

    // Retourner la conversation avec les champs doctor et patient peuplés
    conversation = await Conversation.findById(conversation._id)
      .populate("patient", "name email")
      .populate("doctor", "username email");

    res.json(conversation);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// Obtenir les conversations d'un utilisateur
router.get("/conversations", authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Utilisateur non trouvé" });
    }

    let conversations;
    if (user.role === "doctor") {
      conversations = await Conversation.find({ doctor: user._id })
        .populate("patient", "name email")
        .populate("doctor", "username email")
        .sort({ updatedAt: -1 });
    } else {
      // Pour les patients, trouver leurs conversations
      // Conversation.patient stores the PATIENT record id (not the user id) -> resolve it first
      const ownRecord = await findPatientForUser(user);
      conversations = await Conversation.find({ patient: ownRecord ? ownRecord._id : null })
        .populate("patient", "name email")
        .populate("doctor", "username email")
        .sort({ updatedAt: -1 });
    }

    res.json(conversations);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// Obtenir les messages d'une conversation
router.get("/conversations/:conversationId/messages", authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const conversation = await Conversation.findById(conversationId);
    if (!(await isParticipant(req.user, conversation))) {
      return res.status(403).json({ message: "Accès refusé" });
    }

    const messages = await Message.find({ conversationId })
      .populate("sender", "username email role")
      .populate("receiver", "username email role")
      .sort({ createdAt: 1 });

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// Envoyer un message
router.post("/messages", authenticateToken, async (req, res) => {
  try {
    const { conversationId, receiverId, content, messageType = "text" } = req.body;
    const senderId = req.userId;
    const targetConversation = await Conversation.findById(conversationId); // distinct name: `conversation` is declared later
    if (!(await isParticipant(req.user, targetConversation))) {
      return res.status(403).json({ message: "Accès refusé" });
    }
    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ message: "Message vide" });
    }

    const message = new Message({
      conversationId,
      sender: senderId,
      receiver: receiverId,
      content,
      messageType,
    });

    await message.save();

    // Mettre à jour la dernière activité de la conversation
    await Conversation.findOneAndUpdate(
      { _id: conversationId },
      {
        lastMessage: {
          content,
          sender: senderId,
          createdAt: new Date(),
        },
        updatedAt: new Date(),
      }
    );

    const conversation = await Conversation.findById(conversationId);
    if (conversation && conversation.patient && conversation.doctor) {
      await Patient.findByIdAndUpdate(
        conversation.patient,
        { assignedDoctor: conversation.doctor },
        { new: true }
      );
    }

    const populatedMessage = await Message.findById(message._id)
      .populate("sender", "username email role")
      .populate("receiver", "username email role");

    res.json(populatedMessage);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// Marquer les messages comme lus
router.put("/messages/:messageId/read", authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;

    const updated = await Message.findOneAndUpdate({ _id: messageId, receiver: req.userId }, { isRead: true });
    if (!updated) {
      return res.status(404).json({ message: "Message introuvable" });   // not yours, or does not exist
    }

    res.json({ message: "Message marqué comme lu" });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// Assigner un médecin à un patient
router.put("/patients/assign-doctor", authenticateToken, async (req, res) => {
  try {
    const { patientId, patientEmail, doctorId } = req.body;

    let patient = null;
    if (patientId) {
      patient = await Patient.findById(patientId);
    }
    if (!patient && patientEmail) {
      patient = await Patient.findOne({ email: patientEmail });
    }

    // Vérifier que le médecin existe et a le bon rôle
    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== "doctor") {
      return res.status(404).json({ message: "Médecin non trouvé" });
    }

    if (!patient) {
      return res.status(404).json({ message: "Patient non trouvé" });
    }
    if (req.user.role === "user" && patient.userId?.toString() !== req.userId && patient.email !== req.user.email) {
      return res.status(403).json({ message: "Accès refusé" });
    }

    const updatedPatient = await Patient.findByIdAndUpdate(
      patient._id,
      { assignedDoctor: doctorId },
      { new: true }
    ).populate("assignedDoctor", "username email");

    res.json(updatedPatient);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// Obtenir la liste des médecins disponibles
router.get("/doctors", authenticateToken, async (req, res) => {
  try {
    const doctors = await User.find({ role: "doctor" }, "username email _id");
    res.json(doctors);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur" });
  }
});

module.exports = router;