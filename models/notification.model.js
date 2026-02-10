const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    account_id: mongoose.Schema.Types.ObjectId,
    title: String,
    message: String,
    is_read: Boolean,
    created_at: Date
  },
  {
    collection: "notifications",
    versionKey: false
  }
);

module.exports = mongoose.model("Notification", notificationSchema);
