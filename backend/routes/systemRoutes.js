const express = require("express");
const multer = require("multer");
const { authenticateToken, requireRole } = require("../middleware/auth");
const { predict, getHistory, getPatientById, reanalyzePatientScan } = require("../controllers/systemController");

// In-memory upload, 10 MB max, images only (was: no limit, any file type)
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(png|jpe?g|bmp|tiff?)$/i.test(file.mimetype)),
});

const router = express.Router();

router.post("/predict", authenticateToken, upload.single("file"), predict);
router.get("/history", authenticateToken, getHistory);
router.get("/patient/:id", authenticateToken, getPatientById);                       // ownership checked in controller
router.post("/patient/:id/reanalyze", authenticateToken, requireRole("doctor"), reanalyzePatientScan);

module.exports = router;
