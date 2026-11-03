const express = require("express");
const router = express.Router();
const { authenticateToken, requireRole } = require("../middleware/auth");
const { register, login, getPatientCount, getPatientUsers } = require("../controllers/userController");

router.post("/register", register);   // public
router.post("/login", login);         // public
// Patient lists: doctors only (they were public before)
router.get("/patient-count", authenticateToken, requireRole("doctor"), getPatientCount);
router.get("/patient-users", authenticateToken, requireRole("doctor"), getPatientUsers);
// POST /repair-links removed: it linked/deleted medical records with NAME heuristics, without any login.

module.exports = router;
