const express = require("express");
const router = express.Router();
const { authenticateToken, requireRole } = require("../middleware/auth");
const {
  createAppointments,
  getDoctorAppointments,
  getPatientAppointments,
  updateAppointmentStatus,
  rescheduleAppointment,
} = require("../controllers/appointmentController");

router.post("/", authenticateToken, requireRole("doctor"), createAppointments);
router.get("/doctor/:doctorId", authenticateToken, requireRole("doctor"), getDoctorAppointments);
router.get("/patient/me", authenticateToken, getPatientAppointments);
router.patch("/:id/status", authenticateToken, updateAppointmentStatus); // doctor of the appointment OR its patient (checked in controller)
router.patch("/:id/reschedule", authenticateToken, requireRole("doctor"), rescheduleAppointment);

module.exports = router;
