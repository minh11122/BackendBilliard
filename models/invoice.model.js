const mongoose = require("mongoose");

const invoiceSchema = new mongoose.Schema(
  {
    booking_id: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },
    table_cost: { type: Number, required: true },
    total_service: { type: Number, required: true },
    invoice_number: { type: String, required: true, unique: true },
    invoice_date: { type: Date, required: true },
    payment_method: { type: String, enum: ["payOS", "Cash"], required: true },
    status: {
      type: String,
      enum: ["Unpaid", "Paid"],
      required: true
    },
    note: { type: String },
    created_at: { type: Date, default: Date.now, required: true }
  },
  {
    collection: "invoices",
    versionKey: false
  }
);

module.exports = mongoose.model("Invoice", invoiceSchema);