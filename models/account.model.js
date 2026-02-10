const mongoose = require("mongoose");

const accountSchema = new mongoose.Schema(
  {
    email: String,
    password: String,
    phone: String,
    avatar: String,
    status: String,
    role: {
      name: String
    },
    created_at: Date,
    updated_at: Date
  },
  {
    collection: "accounts",
    versionKey: false
  }
);

module.exports = mongoose.model("Account", accountSchema);
