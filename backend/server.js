const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const { getSecret } = require("./middleware/auth");
const rejectMongoOperators = require("./middleware/rejectMongoOperators");

dotenv.config();

const PORT = Number(process.env.PORT) || 5000;

// CORS: only the listed front-end origins (was `origin: true` = every website on the internet).
// Default = the Vite dev server. Add the Capacitor origin (e.g. http://localhost) for the Android app.
const ALLOWED_ORIGINS = (process.env.FRONTEND_ORIGIN || "http://localhost:8080")
  .split(",").map((o) => o.trim()).filter(Boolean);

function buildApp() {
  const app = express();
  app.disable("x-powered-by");                         // do not advertise the framework
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin)), // !origin = curl / server-to-server
    credentials: true,
  }));
  app.use(express.json({ limit: "1mb" }));             // JSON bodies only; images go through multer
  app.use(rejectMongoOperators);                       // {"$ne": null}-style payloads -> 400

  app.use("/api/users", require("./routes/userRoutes"));
  app.use("/api/patients", require("./routes/patientRoutes"));
  app.use("/api/assistant", require("./routes/assistantRoutes"));
  app.use("/api/articles", require("./routes/articleRoutes"));
  app.use("/api/messages", require("./routes/messageRoutes"));
  app.use("/api/appointments", require("./routes/appointmentRoutes"));
  app.use("/api", require("./routes/systemRoutes"));

  app.get("/api/test", (_req, res) => {
    res.json({ message: "API is accessible", timestamp: new Date().toISOString() });
  });

  // Central error handler: clear status codes, no internal details leaked to the client
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ message: "Fichier trop volumineux (max 10 Mo)" });
    if (err.type === "entity.parse.failed") return res.status(400).json({ message: "JSON invalide" });
    console.error(err);
    res.status(500).json({ message: "Erreur serveur" });
  });
  return app;
}

const startServer = async () => {
  getSecret();                                         // fail fast: no JWT_SECRET -> the server does not start
  await connectDB();
  const app = buildApp();
  const host = process.env.HOST || "127.0.0.1";       // local only by default; set HOST=0.0.0.0 to expose on the LAN
  app.listen(PORT, host, () => console.log(`Server running on http://${host}:${PORT}`));
};

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { buildApp }; // used by the tests (no MongoDB needed)
