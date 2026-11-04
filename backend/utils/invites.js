const crypto = require("crypto");
const DoctorInvite = require("../models/DoctorInvite");

/** Normalises the code typed by the user (case, spaces, dashes) and hashes it with SHA-256.
 *  SHA-256 (not bcrypt) is fine here: the code has 64+ bits of random entropy and we need an exact lookup. */
function hashInviteCode(code) {
  const normalised = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return crypto.createHash("sha256").update(normalised).digest("hex");
}

/** Atomically marks a valid invitation as used. Returns the invite, or null if invalid/used/expired. */
async function consumeInvite(code, userId) {
  if (!code) return null;
  return DoctorInvite.findOneAndUpdate(
    { codeHash: hashInviteCode(code), usedAt: null, expiresAt: { $gt: new Date() } },  // unused AND not expired
    { $set: { usedAt: new Date(), usedBy: userId } },
    { returnDocument: "after" }
  );
}

module.exports = { hashInviteCode, consumeInvite };
