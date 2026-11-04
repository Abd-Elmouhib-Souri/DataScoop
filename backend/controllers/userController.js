const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Patient = require("../models/Patient");
const { signToken } = require("../middleware/auth");
const { findOrCreatePatientForUser } = require("../utils/patientLink");
const { consumeInvite } = require("../utils/invites");

const BCRYPT_ROUNDS = 12;                 // ~250 ms per hash: slow on purpose against brute force
const ALLOWED_ROLES = ["user", "doctor"]; // whitelist: any other role is refused
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The response never contains the password; the token is a signed JWT (not the Mongo _id any more)
const buildAuthResponse = (user) => ({
  id: user._id.toString(),
  name: user.username,
  email: user.email,
  role: user.role,
  token: signToken(user),
});

// Register
exports.register = async (req, res) => {
  // Cast to strings: objects like {"$ne": null} can never reach a query
  const name = String(req.body?.name ?? "").trim();
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const role = String(req.body?.role ?? "user");

  if (!name || !EMAIL_RX.test(email)) return res.status(400).json({ message: "Nom ou email invalide" });
  if (password.length < 8) return res.status(400).json({ message: "Mot de passe : 8 caractères minimum" });
  if (!ALLOWED_ROLES.includes(role)) return res.status(400).json({ message: "Rôle invalide" });

  // Doctors need a ONE-TIME invitation code (created with scripts/create-doctor-invite.js).
  // The old shared key (same for everyone, and published in the code as "NEURO2026") is gone.
  const inviteCode = String(req.body?.doctorKey ?? "").trim();
  if (role === "doctor" && !inviteCode) {
    return res.status(401).json({ message: "Code d'invitation médecin requis." });
  }

  if (await User.findOne({ email })) return res.status(400).json({ message: "Email already in use" });

  const user = await User.create({ username: name, email, password: await bcrypt.hash(password, BCRYPT_ROUNDS), role });

  if (role === "doctor") {
    // Consume the code AFTER creating the account (we need its id), atomically: if the code is invalid,
    // expired or was just used by someone else, the account is removed again.
    const invite = await consumeInvite(inviteCode, user._id);
    if (!invite) {
      await User.deleteOne({ _id: user._id });
      return res.status(401).json({ message: "Code d'invitation invalide, expiré ou déjà utilisé." });
    }
  }

  // Patient record: linked by account id / exact email only (never by name)
  if (role === "user") await findOrCreatePatientForUser(user);

  res.status(201).json(buildAuthResponse(user));
};

// Login
exports.login = async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  if (!email || !password) return res.status(400).json({ message: "Email et mot de passe requis" });

  // Look up by email ONLY, then compare the hash: the password is never part of the query
  const user = await User.findOne({ email });
  const ok = user && typeof user.password === "string" && user.password.startsWith("$2")
    && (await bcrypt.compare(password, user.password));
  if (!ok) return res.status(401).json({ message: "Invalid credentials" }); // same message: no account enumeration

  res.json(buildAuthResponse(user));
};

// The doctor's OWN patients (accounts linked to records whose assignedDoctor is me)
const myPatientUserIds = async (doctorId) =>
  (await Patient.find({ assignedDoctor: doctorId, userId: { $ne: null } }).select("userId")).map((p) => p.userId);

exports.getPatientCount = async (req, res) => {
  res.json({ count: (await myPatientUserIds(req.userId)).length });
};

exports.getPatientUsers = async (req, res) => {
  const users = await User.find({ _id: { $in: await myPatientUserIds(req.userId) }, role: "user" }, "username email _id");
  res.json(users);
};
