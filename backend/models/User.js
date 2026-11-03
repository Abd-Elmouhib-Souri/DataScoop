const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true },
  // unique + lowercase: one account per email, case-insensitive
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true }, // bcrypt hash ("$2a$..."), never plain text
  role: {
    type: String,
    enum: ["doctor", "user"],
    default: "user",
  },
});

module.exports = mongoose.model("User", userSchema);
