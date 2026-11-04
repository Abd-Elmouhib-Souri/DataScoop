// What a PATIENT is allowed to see of his own record (human-in-the-loop, "option A"):
//  - an AI result is NEVER shown to the patient;
//  - a scan shows a diagnosis only after the assigned doctor VALIDATED or CORRECTED it,
//    and what is shown is the DOCTOR's diagnosis + comment.
// Doctors (assigned to the patient) see everything, including the AI suggestion.

const AI_FIELDS = ["prediction", "probabilities", "bestModel", "allModels", "rankedModels",
                   "totalModels", "explanation", "recommendations"];
const REVIEWED = ["validated", "corrected"];
const PENDING_LABEL = "En attente de validation";

const plain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : { ...(doc || {}) });

/** One history entry as the PATIENT may see it. */
function historyItemForPatient(item, patientId, index) {
  const review = item.review || {};
  const reviewed = REVIEWED.includes(review.status);
  return {
    id: item._id ? String(item._id) : `${patientId}-history-${index}`,
    patientId,
    date: item.date,
    createdAt: item.date,
    status: reviewed ? "reviewed" : "pending_review",
    // The diagnosis shown is the doctor's, never the raw AI output
    prediction: reviewed ? review.finalDiagnosis : PENDING_LABEL,
    explanation: reviewed ? (review.comment || "") : "Votre médecin n'a pas encore examiné cette IRM.",
    reviewedAt: reviewed ? review.reviewedAt : null,
    probabilities: {}, allModels: {}, rankedModels: [], bestModel: null, totalModels: 0,
    heatmap_url: "", recommendations: null, source: "medicalHistory",
  };
}

/** Full history for the patient, newest first. Old records without history: one pending entry. */
function historyForPatient(patient) {
  const p = plain(patient);
  const id = String(p._id);
  const items = (p.medicalHistory || []).map((item, i) => historyItemForPatient(item, id, i));
  if (items.length === 0 && (p.prediction || p.lastScanDate)) {
    items.push(historyItemForPatient({ date: p.lastScanDate || p.createdAt, review: null }, id, 0));
  }
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/** The patient's own record without any AI output (the latest REVIEWED diagnosis replaces it). */
function patientRecordForPatient(patient) {
  const p = plain(patient);
  for (const f of AI_FIELDS) delete p[f];
  const history = historyForPatient(patient);
  const latestReviewed = history.find((h) => h.status === "reviewed");
  p.prediction = latestReviewed ? latestReviewed.prediction : null;
  p.medicalHistory = history;
  return p;
}

/**
 * A patient in the DOCTOR's lists (dashboard, patients, reports, AI insights):
 *  - prediction  = the latest diagnosis VALIDATED/CORRECTED by a doctor (null if none);
 *  - aiPrediction = the raw AI suggestion (kept, labelled as such);
 *  - reviewStatus = "reviewed" | "pending" (scans waiting for review) | "none" (no scan);
 *  - pendingReviews = number of scans waiting for review.
 * So the doctor's charts and priority list count HIS decisions, not unvalidated AI output.
 */
function patientForDoctorList(patient) {
  const p = plain(patient);
  const history = [...(p.medicalHistory || [])]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const latestReviewed = history.find((h) => REVIEWED.includes(h.review?.status));
  const pending = history.filter((h) => !REVIEWED.includes(h.review?.status)).length;
  p.aiPrediction = p.prediction ?? null;
  p.prediction = latestReviewed ? latestReviewed.review.finalDiagnosis : null;
  p.pendingReviews = pending;
  p.reviewStatus = pending > 0 ? "pending" : latestReviewed ? "reviewed" : "none";
  return p;
}

/** Doctor of this patient? (doctors only see the patients who chose them) */
function isAssignedDoctor(user, patient) {
  return Boolean(user && patient && user.role === "doctor" && patient.assignedDoctor
    && String(patient.assignedDoctor._id || patient.assignedDoctor) === String(user._id));
}

module.exports = { historyForPatient, patientRecordForPatient, patientForDoctorList, isAssignedDoctor, PENDING_LABEL, REVIEWED };
