const mongoose = require("mongoose");

const accountSchema = new mongoose.Schema(
  {
    role_id: { type: mongoose.Schema.Types.ObjectId, ref: "Role", required: true },
    fullname: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    identity_number: { type: String, unique: true, sparse: true },
    otp: { type: String, unique: true, sparse: true },
    avatar: { type: String },
    status: {
      type: String,
      enum: ["Active", "Inactive", "Locked"],
      required: true
    }
  },
  {
    collection: "accounts",
    versionKey: false,
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" }
  }
);

module.exports = mongoose.model("Account", accountSchema);