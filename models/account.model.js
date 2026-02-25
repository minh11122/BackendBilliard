const mongoose = require("mongoose");

const accountSchema = new mongoose.Schema(
  {
    fullname: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password_hash: {
      type: String,
      required: function () {
        return this.provider === "local";
      },
    },

    provider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },

    provider_id: {
      type: String,
      default: null,
    },

    role_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: true,
    },

    status: {
      type: String,
      enum: ["PENDING", "ACTIVE", "INACTIVE", "BANNED"],
      default: "PENDING",
    },
  },
  {
    collection: "accounts",
    versionKey: false,
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
);

module.exports = mongoose.model("Account", accountSchema);