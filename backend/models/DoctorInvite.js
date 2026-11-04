const mongoose = require("mongoose");

// One-time invitation code for doctor sign-up (replaces the single shared DOCTOR_SECRET_KEY).
// Only a SHA-256 hash of the code is stored: a database leak does not reveal usable codes.
const doctorInviteSchema = new mongoose.Schema({
  codeHash: { type: String, required: true, unique: true },
  note: { type: String, default: "" },                 // e.g. who the code was sent to
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
  usedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
});

module.exports = mongoose.model("DoctorInvite", doctorInviteSchema);
