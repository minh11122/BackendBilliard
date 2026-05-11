const mongoose = require("mongoose");

const accountSchema = new mongoose.Schema(
  {
    fullname: {
      type: String,
      trim: true,
      default: null,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    phone: {
      type: String,
      trim: true,
      default: null,
      unique: true,
      sparse: true,
    },

    avatar_url: {
      type: String,
      default: null,
    },

    password_hash: {
      type: String,
      required: function () {
        return this.provider === "local";
      },
      select: false,
    },

    provider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },

    provider_id: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },

    role_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: true,
    },

    club_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
      default: null,
    },

    status: {
      type: String,
      enum: ["PENDING", "ACTIVE", "INACTIVE", "BANNED", "DELETED"],
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
