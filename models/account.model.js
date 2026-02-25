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
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Invalid email format"],
    },

    password_hash: {
      type: String,
      required: function () {
        return this.provider === "local";
      },
      select: false, // không trả về khi query
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


// 📌 Index rõ ràng
accountSchema.index({ email: 1 });


// 📌 Tự động remove password khi trả JSON
accountSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password_hash;
  return obj;
};


module.exports = mongoose.model("Account", accountSchema);