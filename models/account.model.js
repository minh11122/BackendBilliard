const mongoose = require("mongoose");

const accountSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },

    password: {
      type: String,
      default: null   
    },

    phone: {
      type: String,
      default: null
    },

    avatar: {
      type: String,
      default: null
    },

    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "BANNED"],
      default: "ACTIVE"
    },

    role: {
      name: {
        type: String,
        enum: ["ADMIN", "USER", "CUSTOMER"],
        default: "USER"
      }
    }
  },
  {
    collection: "accounts",
    versionKey: false,
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at"
    }
  }
);

module.exports = mongoose.model("Account", accountSchema);
