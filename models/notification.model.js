const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    account_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: { type: String, default: null },
    is_read: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now, required: true },
  },
  {
    collection: "notifications",
    versionKey: false,
  },
);

notificationSchema.post("save", function (doc) {
  if (global.io && doc.account_id) {
    global.io.to(doc.account_id.toString()).emit("new_notification", doc);
  }
});

notificationSchema.post("insertMany", function (docs) {
  if (global.io && Array.isArray(docs)) {
    docs.forEach((doc) => {
      if (doc.account_id) {
        global.io.to(doc.account_id.toString()).emit("new_notification", doc);
      }
    });
  }
});

module.exports = mongoose.model("Notification", notificationSchema);
