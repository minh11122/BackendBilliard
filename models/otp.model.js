const mongoose = require("mongoose");

const otpSchema = mongoose.Schema(
  {
    account_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      unique: true // 1 account chỉ có 1 OTP còn hiệu lực
    },
    otp_code: {
      type: String,
      required: true
    },
    attempts: {
      type: Number,
      default: 0, // Giới hạn 5 lần
      min: 0
    },
    expires_at: {
      type: Date,
      required: true
    }
  },
  { timestamps: true }
);

otpSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Otp", otpSchema);
