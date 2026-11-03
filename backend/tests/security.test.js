// HTTP security tests: the REAL Express app is started on a random port and attacked with real
// requests. MongoDB is replaced by a tiny in-memory fake, so no database is needed.
// Run from backend/:  npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

process.env.JWT_SECRET = "test-secret-that-is-long-enough-1234567890";
process.env.DOCTOR_SECRET_KEY = ""; // defined but empty: dotenv never overrides it, so backend/.env cannot leak into the tests

// ---------- 1) In-memory fake database ----------
const oid = (n) => n.toString(16).padStart(24, "0");                // valid-looking ObjectId strings
const HASH = bcrypt.hashSync("correct-password", 4);                 // low cost: tests stay fast
const db = {
  users: [
    { _id: oid(1), username: "Dr House", email: "doctor@demo.com", password: HASH, role: "doctor" },
    { _id: oid(2), username: "Ali", email: "ali@demo.com", password: HASH, role: "user" },
    { _id: oid(3), username: "Alia Ben Salah", email: "alia@demo.com", password: HASH, role: "user" },
  ],
  patients: [
    { _id: oid(10), name: "Ali", email: "ali@demo.com", userId: oid(2) },
    { _id: oid(11), name: "Alia Ben Salah", email: "alia@demo.com", userId: oid(3) },
  ],
};
// Chainable, awaitable query: supports .select().populate().sort() then `await`
const query = (value) => {
  const q = { select: () => q, populate: () => q, sort: () => q, then: (ok, ko) => Promise.resolve(value).then(ok, ko) };
  return q;
};
const matches = (doc, filter) => Object.entries(filter).every(([k, v]) => typeof v !== "object" || v === null ? String(doc[k]) === String(v) : true);
const fakeModel = (rows) => ({
  findById: (id) => query(rows.find((r) => r._id === String(id)) ?? null),
  findOne: (filter) => query(rows.find((r) => matches(r, filter)) ?? null),
  find: (filter = {}) => query(rows.filter((r) => matches(r, filter))),
  countDocuments: async () => rows.length,
  create: async (doc) => { const d = { _id: oid(rows.length + 100), ...doc }; rows.push(d); return d; },
  findOneAndUpdate: () => query(null),
  findByIdAndUpdate: () => query(null),
});
const stub = (name, exportsValue) => {
  const file = path.join(__dirname, "..", "models", `${name}.js`);
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exportsValue };
};
stub("User", fakeModel(db.users));
stub("Patient", fakeModel(db.patients));
for (const name of ["Conversation", "Message", "Appointment"]) stub(name, fakeModel([]));

const { buildApp } = require("../server");
const { signToken } = require("../middleware/auth");

// ---------- 2) Start the real app ----------
let base, server;
test.before(async () => {
  server = buildApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = (method, url, { token, body } = {}) =>
  fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const doctorToken = () => signToken(db.users[0]);
const aliToken = () => signToken(db.users[1]);

// ---------- 3) Authentication ----------
test("patient records need a token (was public)", async () => {
  assert.equal((await call("GET", "/api/patients")).status, 401);
  assert.equal((await call("GET", `/api/patients/${oid(10)}/irm`)).status, 401);
});

test("old-style tokens (email or Mongo _id) are refused", async () => {
  assert.equal((await call("GET", "/api/patients", { token: "doctor@demo.com" })).status, 401);
  assert.equal((await call("GET", "/api/patients", { token: oid(1) })).status, 401);
});

test("forged JWTs are refused (wrong secret, alg=none, expired)", async () => {
  const wrongSecret = jwt.sign({ sub: oid(1), role: "doctor" }, "attacker-secret-attacker-secret-1234");
  const none = jwt.sign({ sub: oid(1), role: "doctor" }, "", { algorithm: "none" });
  const expired = jwt.sign({ sub: oid(1), role: "doctor" }, process.env.JWT_SECRET, { expiresIn: -10 });
  for (const t of [wrongSecret, none, expired]) {
    assert.equal((await call("GET", "/api/patients", { token: t })).status, 401);
  }
});

// ---------- 4) Authorization ----------
test("a patient cannot list all patients (doctor only)", async () => {
  assert.equal((await call("GET", "/api/patients", { token: aliToken() })).status, 403);
  assert.equal((await call("GET", "/api/patients", { token: doctorToken() })).status, 200);
});

test("a patient can read his own record but not another patient's", async () => {
  assert.equal((await call("GET", `/api/patients/${oid(10)}`, { token: aliToken() })).status, 200);   // Ali -> Ali
  assert.equal((await call("GET", `/api/patients/${oid(11)}`, { token: aliToken() })).status, 403);   // Ali -> Alia
  assert.equal((await call("GET", `/api/patients/${oid(11)}/irm`, { token: aliToken() })).status, 403);
});

test("a patient cannot rewrite a medical record", async () => {
  const r = await call("PUT", `/api/patients/${oid(11)}`, { token: aliToken(), body: { prediction: "Non Demented" } });
  assert.equal(r.status, 403);
});

// ---------- 5) Login & NoSQL injection ----------
test("NoSQL injection {$ne: null} is rejected", async () => {
  const r = await call("POST", "/api/users/login", { body: { email: "doctor@demo.com", password: { $ne: null } } });
  assert.equal(r.status, 400);
  const r2 = await call("POST", "/api/users/login", { body: { email: { $gt: "" }, password: { $gt: "" } } });
  assert.equal(r2.status, 400);
});

test("login: right password -> JWT, wrong password -> 401", async () => {
  const ok = await call("POST", "/api/users/login", { body: { email: "doctor@demo.com", password: "correct-password" } });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.token.split(".").length, 3);                  // a JWT, not the _id
  assert.equal(body.password, undefined);                        // hash never returned
  const bad = await call("POST", "/api/users/login", { body: { email: "doctor@demo.com", password: "wrong" } });
  assert.equal(bad.status, 401);
});

test("register: unknown role refused, doctor disabled without DOCTOR_SECRET_KEY, old key NEURO2026 useless", async () => {
  const admin = await call("POST", "/api/users/register", { body: { name: "Eve", email: "eve@x.com", password: "12345678", role: "admin" } });
  assert.equal(admin.status, 400);
  const doc = await call("POST", "/api/users/register", {
    body: { name: "Eve", email: "eve2@x.com", password: "12345678", role: "doctor", doctorKey: "NEURO2026" },
  });
  assert.equal(doc.status, 403);
});

test("register stores a bcrypt hash, never the plain password", async () => {
  const r = await call("POST", "/api/users/register", { body: { name: "Sami", email: "sami@x.com", password: "my-password-1" } });
  assert.equal(r.status, 201);
  const saved = db.users.find((u) => u.email === "sami@x.com");
  assert.ok(saved.password.startsWith("$2") && saved.password !== "my-password-1");
});
