const mongoose = require("mongoose");

const clubSchema = new mongoose.Schema(
  {
    account_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
    name: { type: String, required: true },
    address: { type: String, required: true },
    phone: { type: String, required: true },
    tax_code: { type: String, required: true, unique: true },
    description: { type: String },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Locked"],
      required: true
    },
    created_at: { type: Date, default: Date.now, required: true }
  },
  {
    collection: "clubs",
    versionKey: false
  }
);

module.exports = mongoose.model("Club", clubSchema);