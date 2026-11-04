// HTTP security tests: the REAL Express app is started on a random port and attacked with real
// requests. MongoDB is replaced by a small in-memory fake, so no database is needed.
// Run from backend/:  npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

process.env.JWT_SECRET = "test-secret-that-is-long-enough-1234567890";
process.env.DOCTOR_SECRET_KEY = ""; // obsolete variable: defined but empty so backend/.env cannot leak into tests

// ---------- 1) In-memory fake database ----------
const oid = (n) => n.toString(16).padStart(24, "0");                  // valid-looking ObjectId strings
const HASH = bcrypt.hashSync("correct-password", 4);                   // low cost: tests stay fast
const { hashInviteCode } = require("../utils/invites");
const VALID_INVITE = "ABCD-EFGH-1234-5678";

// A minimal "Mongoose-like" history array: supports .id(historyId)
const history = (...items) => Object.assign(items, { id: (hid) => items.find((h) => String(h._id) === String(hid)) || null });
const withSave = (doc) => Object.assign(doc, { save: async () => doc });

const db = {
  users: [
    { _id: oid(1), username: "Dr House", email: "doctor@demo.com", password: HASH, role: "doctor" },
    { _id: oid(2), username: "Ali", email: "ali@demo.com", password: HASH, role: "user" },
    { _id: oid(3), username: "Alia Ben Salah", email: "alia@demo.com", password: HASH, role: "user" },
    { _id: oid(4), username: "Dr Other", email: "other@demo.com", password: HASH, role: "doctor" },
  ],
  patients: [
    // Ali CHOSE Dr House; his scan has an AI suggestion that is still pending review
    withSave({ _id: oid(10), name: "Ali", email: "ali@demo.com", userId: oid(2), assignedDoctor: oid(1),
      prediction: "Mild Demented", probabilities: { "Mild Demented": 0.99 },
      medicalHistory: history({ _id: oid(50), date: new Date("2026-11-01"), diagnosis: "Mild Demented",
        probabilities: { "Mild Demented": 0.99 }, review: { status: "pending" } }) }),
    // Alia chose nobody
    withSave({ _id: oid(11), name: "Alia Ben Salah", email: "alia@demo.com", userId: oid(3), assignedDoctor: null,
      medicalHistory: history() }),
  ],
  invites: [{ _id: oid(90), codeHash: hashInviteCode(VALID_INVITE), usedAt: null, expiresAt: new Date(Date.now() + 86400000) }],
};

// Chainable, awaitable query: .select().populate().sort() then `await`
// Like MongoDB, a projection cannot mix inclusion ("name") and exclusion ("-irmImage"), _id aside.
// (This real bug reached the browser: "Total Scans 0" on the doctor dashboard.)
const checkProjection = (spec) => {
  if (typeof spec !== "string") return;
  const fields = spec.split(/\s+/).filter((f) => f && f !== "_id" && f !== "-_id");
  const exc = fields.filter((f) => f.startsWith("-")).length;
  if (exc && exc !== fields.length) throw new Error(`Projection cannot mix inclusion and exclusion: "${spec}"`);
};
const query = (value) => {
  const q = { select: (spec) => (checkProjection(spec), q), populate: () => q, sort: () => q,
              then: (ok, ko) => Promise.resolve(value).then(ok, ko) };
  return q;
};
// Filter support: plain equality, null, {$gt}, {$ne}, {$in}, {$or} - enough for these routes
const test1 = (val, cond) => {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    if ("$gt" in cond) return val > cond.$gt;
    if ("$ne" in cond) return String(val) !== String(cond.$ne);
    if ("$in" in cond) return cond.$in.map(String).includes(String(val));
    if ("$exists" in cond) return (val !== undefined) === cond.$exists;
    return true;
  }
  return cond === null ? val == null : String(val) === String(cond);
};
const matches = (doc, filter = {}) => Object.entries(filter).every(([k, v]) =>
  k === "$or" ? v.some((f) => matches(doc, f)) : test1(doc[k], v));
const applyUpdate = (doc, update = {}) => Object.assign(doc, update.$set || (update.$setOnInsert ? {} : update));
const fakeModel = (rows) => ({
  findById: (id) => query(rows.find((r) => String(r._id) === String(id)) ?? null),
  findOne: (f) => query(rows.find((r) => matches(r, f)) ?? null),
  find: (f) => query(rows.filter((r) => matches(r, f))),
  countDocuments: async (f) => rows.filter((r) => matches(r, f)).length,
  create: async (doc) => { const d = withSave({ _id: oid(rows.length + 200), ...doc }); rows.push(d); return d; },
  deleteOne: async (f) => { const i = rows.findIndex((r) => matches(r, f)); if (i >= 0) rows.splice(i, 1); },
  updateOne: async () => ({}),
  findOneAndUpdate: (f, u, o = {}) => {
    let doc = rows.find((r) => matches(r, f));
    if (!doc && o.upsert) { doc = { _id: oid(rows.length + 300), ...(u.$setOnInsert || {}) }; rows.push(doc); }
    return query(doc ? applyUpdate(doc, u) : null);
  },
  findByIdAndUpdate: (id, u) => {
    const doc = rows.find((r) => String(r._id) === String(id));
    return query(doc ? applyUpdate(doc, u) : null);
  },
});
const stub = (name, value) => {
  const file = path.join(__dirname, "..", "models", `${name}.js`);
  require.cache[file] = { id: file, filename: file, loaded: true, exports: value };
};
const messages = [];
stub("User", fakeModel(db.users));
stub("Patient", fakeModel(db.patients));
stub("DoctorInvite", fakeModel(db.invites));
// An OLD conversation between Ali and Dr Other (Ali's former doctor): Dr Other is still a participant
const conversations = [{ _id: oid(70), patient: oid(10), doctor: oid(4), participants: [oid(10), oid(4)] }];
stub("Conversation", fakeModel(conversations));
// Message is used both as `new Message(doc).save()` and statically -> a constructor with static methods
function FakeMessage(doc) { Object.assign(this, { _id: oid(500 + messages.length) }, doc); }
FakeMessage.prototype.save = async function save() { messages.push(this); return this; };
Object.assign(FakeMessage, fakeModel(messages), { create: async (m) => { messages.push(m); return m; } });
stub("Message", FakeMessage);
stub("Appointment", fakeModel([]));

// utils/invites.js was required above BEFORE the stub: reload it so it uses the fake DoctorInvite
delete require.cache[require.resolve("../utils/invites")];
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
const doctorToken = () => signToken(db.users[0]);      // Dr House (Ali's doctor)
const otherDoctorToken = () => signToken(db.users[3]); // Dr Other (nobody chose him)
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

// ---------- 4) Separation: a doctor only sees the patients who chose him ----------
test("a patient cannot list patients (doctor only)", async () => {
  assert.equal((await call("GET", "/api/patients", { token: aliToken() })).status, 403);
});

test("a doctor lists ONLY his own patients", async () => {
  const mine = await (await call("GET", "/api/patients", { token: doctorToken() })).json();
  assert.deepEqual(mine.map((p) => p.name), ["Ali"]);
  const other = await (await call("GET", "/api/patients", { token: otherDoctorToken() })).json();
  assert.deepEqual(other, []);
});

test("doctor lists count VALIDATED diagnoses, not the raw AI output", async () => {
  // Ali's only scan is still pending: AI says "Mild Demented", no doctor decision yet
  const [ali] = await (await call("GET", "/api/patients", { token: doctorToken() })).json();
  assert.equal(ali.prediction, null);                 // no validated diagnosis -> nothing counted
  assert.equal(ali.aiPrediction, "Mild Demented");    // AI suggestion kept, labelled as AI
  assert.equal(ali.reviewStatus, "pending");
  assert.equal(ali.pendingReviews, 1);
});

test("another doctor cannot open, review or browse someone else's patient", async () => {
  assert.equal((await call("GET", `/api/patients/${oid(10)}`, { token: otherDoctorToken() })).status, 403);
  assert.equal((await call("GET", `/api/patients/doctor/${oid(1)}`, { token: otherDoctorToken() })).status, 403);
  const r = await call("POST", `/api/patients/${oid(10)}/reviews/${oid(50)}`, { token: otherDoctorToken(), body: { decision: "validated" } });
  assert.equal(r.status, 403);
});

test("a patient can read his own record but not another patient's", async () => {
  assert.equal((await call("GET", `/api/patients/${oid(10)}`, { token: aliToken() })).status, 200);
  assert.equal((await call("GET", `/api/patients/${oid(11)}`, { token: aliToken() })).status, 403);
  assert.equal((await call("GET", `/api/patients/${oid(11)}/irm`, { token: aliToken() })).status, 403);
});

test("a patient cannot rewrite a medical record", async () => {
  const r = await call("PUT", `/api/patients/${oid(11)}`, { token: aliToken(), body: { prediction: "Non Demented" } });
  assert.equal(r.status, 403);
});

// ---------- 5) Human-in-the-loop: the patient never sees the raw AI output ----------
test("before review: the patient sees 'pending', never the AI class or probabilities", async () => {
  const rec = await (await call("GET", `/api/patients/${oid(10)}`, { token: aliToken() })).json();
  assert.equal(rec.prediction, null);
  assert.equal(rec.probabilities, undefined);
  assert.equal(rec.medicalHistory[0].status, "pending_review");
  const hist = await (await call("GET", "/api/history", { token: aliToken() })).json();
  assert.equal(hist[0].prediction, "En attente de validation");
  assert.deepEqual(hist[0].probabilities, {});
  const irm = await (await call("GET", `/api/patients/${oid(10)}/irm`, { token: aliToken() })).json();
  assert.equal(irm.prediction, null);
});

test("the doctor sees the AI suggestion in his pending list", async () => {
  const pending = await (await call("GET", "/api/patients/reviews/pending", { token: doctorToken() })).json();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].aiPrediction, "Mild Demented");
});

test("doctor dashboard: GET /api/history returns his patients' scans (was a 500 -> 'Total Scans 0')", async () => {
  const r = await call("GET", "/api/history", { token: doctorToken() });
  assert.equal(r.status, 200);
  const scans = await r.json();
  assert.ok(scans.some((x) => x.patientName === "Ali"));                 // Ali chose Dr House
  const none = await (await call("GET", "/api/history", { token: otherDoctorToken() })).json();
  assert.equal(none.length, 0);                                           // nobody chose Dr Other
});

test("review: invalid decision or class -> 400", async () => {
  const bad = await call("POST", `/api/patients/${oid(10)}/reviews/${oid(50)}`, { token: doctorToken(), body: { decision: "maybe" } });
  assert.equal(bad.status, 400);
  const badClass = await call("POST", `/api/patients/${oid(10)}/reviews/${oid(50)}`,
    { token: doctorToken(), body: { decision: "corrected", finalDiagnosis: "Severe Demented" } });
  assert.equal(badClass.status, 400);
  // "corrected" to the SAME class as the AI is not a correction -> 400 (use "validated")
  const same = await call("POST", `/api/patients/${oid(10)}/reviews/${oid(50)}`,
    { token: doctorToken(), body: { decision: "corrected", finalDiagnosis: "Mild Demented" } });
  assert.equal(same.status, 400);
});

test("after the doctor CORRECTS: the patient sees the doctor's diagnosis and comment", async () => {
  const r = await call("POST", `/api/patients/${oid(10)}/reviews/${oid(50)}`, {
    token: doctorToken(), body: { decision: "corrected", finalDiagnosis: "Very Mild Demented", comment: "IRM à refaire dans 6 mois." },
  });
  assert.equal(r.status, 200);
  const hist = await (await call("GET", "/api/history", { token: aliToken() })).json();
  assert.equal(hist[0].status, "reviewed");
  assert.equal(hist[0].prediction, "Very Mild Demented");          // the DOCTOR's diagnosis, not the AI's "Mild"
  assert.equal(hist[0].explanation, "IRM à refaire dans 6 mois.");
  assert.ok(messages.some((m) => String(m.receiver) === oid(2)), "the patient is notified");
  assert.ok(!messages.some((m) => /Mild|Demented/.test(m.content)), "no diagnosis inside the message");
});

// ---------- 6) Login & NoSQL injection ----------
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

// ---------- 7) Doctor sign-up by ONE-TIME invitation ----------
const doctorSignup = (email, doctorKey) => call("POST", "/api/users/register",
  { body: { name: "Dr New", email, password: "12345678", role: "doctor", doctorKey } });

test("register: unknown role refused; doctor without code, with old key NEURO2026 -> refused", async () => {
  const admin = await call("POST", "/api/users/register", { body: { name: "Eve", email: "eve@x.com", password: "12345678", role: "admin" } });
  assert.equal(admin.status, 400);
  assert.equal((await doctorSignup("d1@x.com", "")).status, 401);
  assert.equal((await doctorSignup("d2@x.com", "NEURO2026")).status, 401);
  assert.ok(!db.users.some((u) => u.email === "d2@x.com"), "refused account is not kept");
});

test("a valid invitation creates ONE doctor account, then it cannot be reused", async () => {
  const first = await doctorSignup("newdoc@x.com", VALID_INVITE.toLowerCase().replace(/-/g, " ")); // case/spaces tolerated
  assert.equal(first.status, 201);
  assert.equal((await first.json()).role, "doctor");
  assert.equal((await doctorSignup("thief@x.com", VALID_INVITE)).status, 401);
  assert.ok(!db.users.some((u) => u.email === "thief@x.com"));
});

test("register stores a bcrypt hash, never the plain password", async () => {
  const r = await call("POST", "/api/users/register", { body: { name: "Sami", email: "sami@x.com", password: "my-password-1" } });
  assert.equal(r.status, 201);
  const saved = db.users.find((u) => u.email === "sami@x.com");
  assert.ok(saved.password.startsWith("$2") && saved.password !== "my-password-1");
});

// ---------- Choosing / changing doctor ----------
test("a FORMER doctor writing in an old conversation does NOT take the patient back", async () => {
  const r = await call("POST", "/api/messages/messages", { token: otherDoctorToken(),
    body: { conversationId: oid(70), receiverId: oid(2), content: "Bonjour, des nouvelles ?" } });
  assert.ok(r.status < 300, `send failed: ${r.status}`);              // he may still write...
  assert.equal(String(db.patients[0].assignedDoctor), oid(1));       // ...but Ali stays with Dr House
  assert.equal((await call("GET", `/api/patients/${oid(10)}`, { token: otherDoctorToken() })).status, 403);
});

test("the PATIENT can choose another doctor: access moves to the new doctor", async () => {
  const r = await call("POST", "/api/messages/conversations", { token: aliToken(), body: { patientId: oid(10), doctorId: oid(4) } });
  assert.ok(r.status < 300, `choose failed: ${r.status}`);
  assert.equal(String(db.patients[0].assignedDoctor), oid(4));                                     // Ali chose Dr Other
  assert.equal((await call("GET", `/api/patients/${oid(10)}`, { token: otherDoctorToken() })).status, 200);
  assert.equal((await call("GET", `/api/patients/${oid(10)}`, { token: doctorToken() })).status, 403);
  // and back to Dr House (existing conversation: the choice still applies)
  await call("POST", "/api/messages/conversations", { token: aliToken(), body: { patientId: oid(10), doctorId: oid(1) } });
  assert.equal(String(db.patients[0].assignedDoctor), oid(1));
});
