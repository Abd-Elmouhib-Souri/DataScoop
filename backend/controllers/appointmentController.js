const Appointment = require("../models/Appointment");
const Patient = require("../models/Patient");
const User = require("../models/User");
const { findOrCreatePatientForUser } = require("../utils/patientLink");

const parseDurationToMinutes = (duration) => {
  const numeric = Number.parseInt(String(duration).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(numeric) ? numeric : 30;
};

const computeWindow = (scheduledDate, startTime, durationMinutes) => {
  const start = new Date(`${scheduledDate}T${startTime}:00`);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const endTime = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;

  return { start, end, endTime };
};

const windowsOverlap = (left, right) => left.start < right.end && right.start < left.end;

const serializeAppointment = (appointment) => ({
  _id: appointment._id.toString(),
  patient: appointment.patient,
  doctor: appointment.doctor,
  scheduledDate: appointment.scheduledDate,
  startTime: appointment.startTime,
  endTime: appointment.endTime,
  durationMinutes: appointment.durationMinutes,
  slotLabel: appointment.slotLabel,
  timingLabel: appointment.timingLabel,
  title: appointment.title,
  description: appointment.description,
  status: appointment.status,
  notes: appointment.notes,
  createdBy: appointment.createdBy,
  createdAt: appointment.createdAt,
  updatedAt: appointment.updatedAt,
});

const ensureDoctor = async (doctorId) => {
  const doctor = await User.findById(doctorId);
  if (!doctor || doctor.role !== "doctor") {
    throw new Error("Medecin introuvable");
  }
  return doctor;
};

// Linked by account id / exact email only (the old version also matched by NAME)
const ensurePatientForUser = async (user) => {
  if (!user) {
    throw new Error("Utilisateur patient introuvable");
  }
  return findOrCreatePatientForUser(user);
};

const ensurePatientByEmail = async (patientEmail) => {
  const patient = await Patient.findOne({ email: patientEmail });
  if (!patient) {
    const linkedUser = await User.findOne({ email: patientEmail, role: "user" });
    if (!linkedUser) {
      throw new Error("Patient introuvable");
    }
    return ensurePatientForUser(linkedUser);
  }
  return patient;
};

const findConflictingAppointment = async ({ doctorId, scheduledDate, startTime, durationMinutes, excludeId }) => {
  const requestedWindow = computeWindow(scheduledDate, startTime, durationMinutes);
  const existing = await Appointment.find({
    doctor: doctorId,
    scheduledDate,
    status: { $in: ["scheduled", "confirmed", "rescheduled"] },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });

  return existing.find((appointment) => {
    const appointmentWindow = computeWindow(
      appointment.scheduledDate,
      appointment.startTime,
      appointment.durationMinutes
    );
    return windowsOverlap(requestedWindow, appointmentWindow);
  });
};

exports.createAppointments = async (req, res) => {
  try {
    const doctor = await ensureDoctor(req.userId);
    const { patientEmail, appointments } = req.body;

    if (!Array.isArray(appointments) || appointments.length === 0) {
      return res.status(400).json({ message: "Aucun rendez-vous fourni" });
    }

    const patient = await ensurePatientByEmail(patientEmail);

    const draftWindows = [];
    for (const appointment of appointments.slice(0, 3)) {
      const durationMinutes = parseDurationToMinutes(appointment.duration);
      const window = computeWindow(appointment.date, appointment.time, durationMinutes);

      if (window.start < new Date()) {
        return res.status(400).json({ message: "Impossible de creer un rendez-vous dans le passe" });
      }

      const internalConflict = draftWindows.find((entry) => windowsOverlap(window, entry.window));
      if (internalConflict) {
        return res.status(400).json({
          message: `Conflit interne entre ${appointment.slot} et ${internalConflict.slotLabel}`,
        });
      }

      const externalConflict = await findConflictingAppointment({
        doctorId: doctor._id,
        scheduledDate: appointment.date,
        startTime: appointment.time,
        durationMinutes,
      });

      if (externalConflict) {
        return res.status(409).json({
          message: "Conflit d'agenda detecte pour ce medecin",
          conflict: serializeAppointment(await externalConflict.populate("patient", "name email")),
        });
      }

      draftWindows.push({
        ...appointment,
        durationMinutes,
        window,
        slotLabel: appointment.slot,
      });
    }

    const created = await Appointment.insertMany(
      draftWindows.map((appointment) => ({
        patient: patient._id,
        doctor: doctor._id,
        scheduledDate: appointment.date,
        startTime: appointment.time,
        endTime: appointment.window.endTime,
        durationMinutes: appointment.durationMinutes,
        slotLabel: appointment.slot,
        timingLabel: appointment.timing,
        title: appointment.title,
        description: appointment.desc,
        status: "scheduled",
        createdBy: doctor._id,
      }))
    );

    const populated = await Appointment.find({ _id: { $in: created.map((item) => item._id) } })
      .populate("patient", "name email prediction lastScanDate")
      .populate("doctor", "username email")
      .populate("createdBy", "username email");

    res.status(201).json(populated.map(serializeAppointment));
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

exports.getDoctorAppointments = async (req, res) => {
  try {
    const doctorId = req.params.doctorId || req.userId;
    const appointments = await Appointment.find({ doctor: doctorId })
      .populate("patient", "name email prediction lastScanDate")
      .populate("doctor", "username email")
      .populate("createdBy", "username email")
      .sort({ scheduledDate: 1, startTime: 1 });

    res.json(appointments.map(serializeAppointment));
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

exports.getPatientAppointments = async (req, res) => {
  try {
    const patient = await ensurePatientForUser(req.user);
    const appointments = await Appointment.find({ patient: patient._id })
      .populate("patient", "name email prediction lastScanDate")
      .populate("doctor", "username email")
      .populate("createdBy", "username email")
      .sort({ scheduledDate: 1, startTime: 1 });

    res.json(appointments.map(serializeAppointment));
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

exports.updateAppointmentStatus = async (req, res) => {
  try {
    const { status, notes = "" } = req.body;
    if (!["confirmed", "cancelled", "completed"].includes(status)) {
      return res.status(400).json({ message: "Statut non pris en charge" });
    }

    // Authorization: only the doctor of this appointment, or the patient who owns it
    const existing = await Appointment.findById(req.params.id).populate("patient", "userId");
    if (!existing) {
      return res.status(404).json({ message: "Rendez-vous introuvable" });
    }
    const isDoctor = existing.doctor?.toString() === req.userId;
    const isPatient = existing.patient?.userId?.toString() === req.userId;
    if (!isDoctor && !isPatient) {
      return res.status(403).json({ message: "Accès refusé" });
    }

    const appointment = await Appointment.findByIdAndUpdate(
      req.params.id,
      { status, notes: String(notes) },
      { new: true }
    )
      .populate("patient", "name email prediction lastScanDate")
      .populate("doctor", "username email")
      .populate("createdBy", "username email");

    if (!appointment) {
      return res.status(404).json({ message: "Rendez-vous introuvable" });
    }

    res.json(serializeAppointment(appointment));
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

exports.rescheduleAppointment = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({ message: "Rendez-vous introuvable" });
    }
    if (appointment.doctor?.toString() !== req.userId) {
      return res.status(403).json({ message: "Accès refusé" });   // another doctor's appointment
    }

    const durationMinutes = parseDurationToMinutes(req.body.duration ?? appointment.durationMinutes);
    const nextDate = req.body.date ?? appointment.scheduledDate;
    const nextTime = req.body.time ?? appointment.startTime;
    const nextWindow = computeWindow(nextDate, nextTime, durationMinutes);

    if (nextWindow.start < new Date()) {
      return res.status(400).json({ message: "Impossible de reporter un rendez-vous dans le passe" });
    }

    const conflict = await findConflictingAppointment({
      doctorId: appointment.doctor,
      scheduledDate: nextDate,
      startTime: nextTime,
      durationMinutes,
      excludeId: appointment._id,
    });

    if (conflict) {
      return res.status(409).json({ message: "Conflit d'agenda detecte lors du report" });
    }

    appointment.scheduledDate = nextDate;
    appointment.startTime = nextTime;
    appointment.endTime = nextWindow.endTime;
    appointment.durationMinutes = durationMinutes;
    appointment.status = "rescheduled";
    appointment.notes = req.body.notes ?? appointment.notes;
    await appointment.save();

    const populated = await Appointment.findById(appointment._id)
      .populate("patient", "name email prediction lastScanDate")
      .populate("doctor", "username email")
      .populate("createdBy", "username email");

    res.json(serializeAppointment(populated));
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};
