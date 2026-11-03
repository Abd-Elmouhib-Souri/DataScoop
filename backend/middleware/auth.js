// Authentication + authorization middleware (single source of truth: the old copies in
// messageRoutes.js / systemRoutes.js accepted a Mongo _id or an EMAIL as "token" - removed).
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const TOKEN_TTL = process.env.JWT_EXPIRES_IN || "8h"; // a stolen token stops working after 8 hours

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    // Fail closed: without a strong secret, nobody can sign or verify tokens
    throw new Error("JWT_SECRET is missing or shorter than 32 characters (see backend/.env.example)");
  }
  return secret;
}

/** Signs a JWT containing only the user id and role (never the password or email). */
function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, getSecret(), {
    expiresIn: TOKEN_TTL,
    algorithm: "HS256",
  });
}

/** Requires "Authorization: Bearer <valid JWT>". Sets req.user / req.userId. */
const authenticateToken = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ message: "Token manquant" });
  }

  let payload;
  try {
    // algorithms pinned: refuses "alg: none" and algorithm-confusion tricks
    payload = jwt.verify(token, getSecret(), { algorithms: ["HS256"] });
  } catch {
    return res.status(401).json({ message: "Token invalide ou expiré" });
  }

  const user = await User.findById(payload.sub).select("-password");
  if (!user) {
    return res.status(401).json({ message: "Utilisateur introuvable" });
  }
  req.user = user;
  req.userId = user._id.toString();
  next();
};

/** Role guard, used AFTER authenticateToken: requireRole("doctor"). */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: "Accès refusé" });
  }
  next();
};

module.exports = { authenticateToken, requireRole, signToken, getSecret };
