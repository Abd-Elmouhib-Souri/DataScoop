// One-time migration: hashes every password still stored in PLAIN TEXT in MongoDB.
// Run once from backend/:  node scripts/migrate-passwords.js
// Safe to run twice: passwords that are already bcrypt hashes ("$2...") are skipped.
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

(async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI missing in backend/.env");
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  let migrated = 0, skipped = 0;
  for (const user of await User.find({})) {
    if (typeof user.password === "string" && user.password.startsWith("$2")) { skipped++; continue; }
    // updateOne: bypasses the schema `required`/`lowercase` checks on very old documents
    await User.updateOne({ _id: user._id }, { $set: { password: await bcrypt.hash(String(user.password ?? ""), 12) } });
    migrated++;
  }
  console.log(`Passwords hashed: ${migrated} | already hashed: ${skipped}`); // counts only, never the passwords
  await mongoose.disconnect();
})().catch((err) => { console.error(err.message); process.exit(1); });
