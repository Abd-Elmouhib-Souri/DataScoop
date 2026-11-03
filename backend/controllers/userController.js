const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { signToken } = require("../middleware/auth");
const { findOrCreatePatientForUser } = require("../utils/patientLink");

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

/** Constant-time comparison, so the doctor key cannot be guessed character by character from timing. */
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

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

  if (role === "doctor") {
    const validKey = process.env.DOCTOR_SECRET_KEY;          // NO default key in public code any more
    if (!validKey) return res.status(403).json({ message: "Inscription médecin désactivée sur ce serveur." });
    if (!safeEqual(req.body?.doctorKey ?? "", validKey)) {
      return res.status(401).json({ message: "Clé secrète médecin invalide. Inscription refusée." });
    }
  }

  if (await User.findOne({ email })) return res.status(400).json({ message: "Email already in use" });

  const user = await User.create({ username: name, email, password: await bcrypt.hash(password, BCRYPT_ROUNDS), role });

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

// Get count of users with role 'user'
exports.getPatientCount = async (req, res) => {
  try {
    const count = await User.countDocuments({ role: "user" });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: "Error fetching patient count" });
  }
};

// Get all users with role 'user' (patients)
exports.getPatientUsers = async (req, res) => {
  try {
    const patients = await User.find({ role: "user" }, "username email _id");
    res.json(patients);
  } catch (error) {
    res.status(500).json({ message: "Error fetching patient users" });
  }
};
