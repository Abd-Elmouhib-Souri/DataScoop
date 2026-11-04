// Unit tests for the "no fake diagnosis" rule in controllers/systemController.js
// Run from backend/:  node --test tests/
// The Mongoose models are replaced by in-memory spies, so no MongoDB is needed.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// ---- 1) Replace the Mongoose models with spies BEFORE the controller is loaded ----
const calls = [];                                   // every database call is recorded here
const spyModel = (modelName) =>
  new Proxy(function () {}, {
    get: (_t, method) => async (...args) => {
      calls.push(`${modelName}.${String(method)}`);
      return method === "findOneAndUpdate" ? null : { _id: "p1", assignedDoctor: null };
    },
  });
for (const name of ["Patient", "User", "Conversation", "Message"]) {
  const file = path.join(__dirname, "..", "models", `${name}.js`);
  require.cache[file] = { id: file, filename: file, loaded: true, exports: spyModel(name) };
}
const controller = require("../controllers/systemController");

// ---- 2) Tiny fake Express req/res ----
const fakeReq = () => ({
  file: { buffer: Buffer.from("img"), mimetype: "image/png", originalname: "mri.png" },
  user: { _id: "u1", email: "user@demo.com", username: "Ahmed Hassan" },
});
const fakeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const realFetch = global.fetch;
test.afterEach(() => { global.fetch = realFetch; calls.length = 0; });

// ---- 3) Tests ----
test("ML service DOWN -> 503, no diagnosis, nothing written to the database", async () => {
  global.fetch = async () => { throw new Error("ECONNREFUSED"); };
  const res = fakeRes();
  await controller.predict(fakeReq(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.prediction, undefined);           // nothing invented
  assert.deepEqual(calls, []);                            // no Patient/Message write at all
});

test("ML service answers 503 (no model loaded) -> 503 forwarded, nothing written", async () => {
  global.fetch = async () => new Response(JSON.stringify({ error: "Analyse indisponible" }), { status: 503 });
  const res = fakeRes();
  await controller.predict(fakeReq(), res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(calls, []);
});

test("Invalid image (ML 400) -> 400 for the client, nothing written", async () => {
  global.fetch = async () => new Response(JSON.stringify({ error: "Format image invalide." }), { status: 400 });
  const res = fakeRes();
  await controller.predict(fakeReq(), res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(calls, []);
});

test("Real ML answer -> saved for the doctor, patient gets 'pending review' WITHOUT the AI output", async () => {
  const ml = { prediction: "Non Demented", confidence: 0.9, probabilities: { "Non Demented": 0.9 }, best_model: "ResNet50",
               all_models: {}, ranked_models: ["ResNet50"], explanation: "x", total_models: 1, total_time_ms: 5 };
  global.fetch = async () => new Response(JSON.stringify(ml), { status: 200 });
  const res = fakeRes();
  await controller.predict(fakeReq(), res);
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.status, "pending_review");
  assert.equal(res.body.prediction, undefined);          // human-in-the-loop: no AI result for the patient
  assert.equal(res.body.probabilities, undefined);
  assert.ok(calls.includes("Patient.findByIdAndUpdate"), "history entry should be written");
});

test("Image rejected by the ML input check (422) -> 422 for the client, nothing written", async () => {
  global.fetch = async () => new Response(JSON.stringify({ error: "Image en couleur" }), { status: 422 });
  const res = fakeRes();
  await controller.predict(fakeReq(), res);
  assert.equal(res.statusCode, 422);
  assert.deepEqual(calls, []);
});

test("No simulation code left in the controller", () => {
  const src = require("node:fs").readFileSync(path.join(__dirname, "..", "controllers", "systemController.js"), "utf8");
  assert.ok(!/mockMLResult|Math\.random/.test(src));
});

test("A doctor's analysis is returned but NOT saved as a patient record", async () => {
  const ml = { prediction: "Mild Demented", confidence: 0.8, probabilities: {}, best_model: "ResNet50",
               all_models: {}, ranked_models: ["ResNet50"], explanation: "x", total_models: 1, total_time_ms: 5 };
  global.fetch = async () => new Response(JSON.stringify(ml), { status: 200 });
  const req = fakeReq();
  req.user = { _id: "d1", email: "doctor@demo.com", username: "Dr House", role: "doctor" };
  const res = fakeRes();
  await controller.predict(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.prediction, "Mild Demented");
  assert.equal(res.body.saved, false);
  assert.deepEqual(calls, []);                           // no Patient / Message write
});
