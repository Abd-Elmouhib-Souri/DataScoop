// Creates a ONE-TIME doctor invitation code (valid 7 days by default) and prints it ONCE.
// Run from backend/:  node scripts/create-doctor-invite.js "Dr Ben Ali - CHU Monastir" [days]
// Send the code to the doctor through a trusted channel; it is unusable after one sign-up.
require("dotenv").config();
const crypto = require("crypto");
const mongoose = require("mongoose");
const DoctorInvite = require("../models/DoctorInvite");
const { hashInviteCode } = require("../utils/invites");

(async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI missing in backend/.env");
  const note = process.argv[2] || "";
  const days = Number(process.argv[3]) || 7;
  // 10 random bytes = 80 bits of entropy -> impossible to guess; shown as XXXX-XXXX-XXXX-XXXX
  const raw = crypto.randomBytes(10).toString("hex").toUpperCase().slice(0, 16);
  const code = raw.match(/.{4}/g).join("-");
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  await DoctorInvite.create({ codeHash: hashInviteCode(code), note, expiresAt: new Date(Date.now() + days * 86400000) });
  console.log(`Doctor invitation code (valid ${days} days, single use): ${code}`);
  await mongoose.disconnect();
})().catch((err) => { console.error(err.message); process.exit(1); });
