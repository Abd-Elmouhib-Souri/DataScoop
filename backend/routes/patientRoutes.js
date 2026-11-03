const express = require("express");
const router = express.Router();
const { authenticateToken, requireRole } = require("../middleware/auth");
const {
  createPatient,
  getPatients,
  getPatientById,
  updatePatient,
  assignDoctor,
  getPatientsByDoctor,
  getPatientIrmImage,
} = require("../controllers/patientController");

// Every route needs a valid JWT (none did before: anyone could read or rewrite medical records)
router.use(authenticateToken);

router.post("/", requireRole("doctor"), createPatient);
router.get("/", requireRole("doctor"), getPatients);
router.get("/doctor/:doctorId", requireRole("doctor"), getPatientsByDoctor);
// Dedicated MRI route BEFORE /:id; ownership is checked in the controller (doctor or the patient himself)
router.get("/:id/irm", getPatientIrmImage);
router.get("/:id", getPatientById);
router.put("/:id", requireRole("doctor"), updatePatient);
router.put("/:id/assign-doctor", requireRole("doctor"), assignDoctor);

module.exports = router;
