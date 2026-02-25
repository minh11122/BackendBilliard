const mongoose = require("mongoose");

const accountSchema = new mongoose.Schema(
  {
    fullname: {
      type: String,
      required: [true, "Fullname is required"],
      trim: true,
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Invalid email format"],
    },

    phone: {
      type: String,
      trim: true,
      match: [/^[0-9]{9,11}$/, "Invalid phone number"],
      set: v => v === "" ? null : v
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

    role_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: [true, "Role is required"],
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
  }
);


accountSchema.index({ email: 1 }, { unique: true });


accountSchema.index({ phone: 1 }, { unique: true, sparse: true });

accountSchema.index({ provider_id: 1 }, { unique: true, sparse: true });

accountSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password_hash;
  return obj;
};

module.exports = mongoose.model("Account", accountSchema);