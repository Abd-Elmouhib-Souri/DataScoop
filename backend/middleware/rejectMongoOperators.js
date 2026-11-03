// Blocks NoSQL injection: any request whose body/query/params contains a key starting with "$"
// or containing "." (e.g. {"password": {"$ne": null}}) is rejected with 400.
// Why not mongoose's global `sanitizeFilter`? It would also break the server's OWN legitimate
// operators ($regex, $exists, $or...) used in our queries. Rejecting at the boundary is safer.
function hasOperatorKey(value, depth = 0) {
  if (depth > 20 || value === null || typeof value !== "object") return false;
  return Object.keys(value).some(
    (key) => key.startsWith("$") || key.includes(".") || hasOperatorKey(value[key], depth + 1)
  );
}

module.exports = function rejectMongoOperators(req, res, next) {
  if (hasOperatorKey(req.body) || hasOperatorKey(req.query) || hasOperatorKey(req.params)) {
    return res.status(400).json({ message: "Requête invalide" });
  }
  next();
};
module.exports.hasOperatorKey = hasOperatorKey;
