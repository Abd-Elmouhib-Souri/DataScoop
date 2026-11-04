// The ONLY way a user account is linked to a medical record.
// Old code matched records by NAME (sometimes with an unanchored regex: "Ali" matched "Alia Ben Salah"),
// which let one user overwrite another patient's diagnosis. Names are not identities.
const Patient = require("../models/Patient");

/**
 * 1) the record already linked to this account (userId), else
 * 2) a record created by a doctor with EXACTLY this email and not linked to anyone yet.
 * Known limit: emails are not verified, so (2) trusts the email typed at registration.
 */
async function findPatientForUser(user) {
  const linked = await Patient.findOne({ userId: user._id });
  if (linked) return linked;
  if (!user.email) return null;
  return Patient.findOneAndUpdate(
    { email: user.email, $or: [{ userId: null }, { userId: { $exists: false } }] },
    { $set: { userId: user._id } },
    { returnDocument: "after" }
  );
}

async function findOrCreatePatientForUser(user, extra = {}) {
  const existing = await findPatientForUser(user);
  if (existing) return existing;
  return Patient.create({
    userId: user._id, name: user.username, email: user.email,
    age: null, phone: "", symptoms: [], medicalHistory: [], ...extra,
  });
}

/** True if this user may read this patient record: the doctor the patient CHOSE (assignedDoctor),
 *  or the patient who owns it. Other doctors are refused (they used to see every patient). */
function canAccessPatient(user, patient) {
  if (!user || !patient) return false;
  if (user.role === "doctor") {
    return patient.assignedDoctor != null
      && String(patient.assignedDoctor._id || patient.assignedDoctor) === String(user._id);
  }
  return patient.userId != null && String(patient.userId._id || patient.userId) === String(user._id);
}

module.exports = { findPatientForUser, findOrCreatePatientForUser, canAccessPatient };
