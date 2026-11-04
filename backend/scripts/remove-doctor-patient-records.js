// Removes "patient" records that were wrongly created for DOCTOR accounts (old predict code).
// SAFE by default: dry run (prints what would be deleted). Add --apply to really delete.
//   node scripts/remove-doctor-patient-records.js           -> dry run
//   node scripts/remove-doctor-patient-records.js --apply   -> delete
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const Patient = require("../models/Patient");

(async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI missing in backend/.env");
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  const doctors = await User.find({ role: "doctor" }).select("_id email");
  const ids = doctors.map((d) => d._id);
  const emails = doctors.map((d) => d.email);
  // A doctor's record is linked by userId, or (old code) by the doctor's email
  const filter = { $or: [{ userId: { $in: ids } }, { email: { $in: emails } }] };
  const found = await Patient.find(filter).select("name email");
  found.forEach((p) => console.log(`  - ${p.name} <${p.email}>`));      // names only, no medical data
  if (process.argv.includes("--apply")) {
    const { deletedCount } = await Patient.deleteMany(filter);
    console.log(`Deleted: ${deletedCount}`);
  } else {
    console.log(`Dry run: ${found.length} record(s) would be deleted. Re-run with --apply to delete.`);
  }
  await mongoose.disconnect();
})().catch((err) => { console.error(err.message); process.exit(1); });
