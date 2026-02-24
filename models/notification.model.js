const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    account_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    is_read: { type: Boolean, required: true },
    created_at: { type: Date, default: Date.now, required: true }
  },
  {
    collection: "notifications",
    versionKey: false
  }
);

module.exports = mongoose.model("Notification", notificationSchema);