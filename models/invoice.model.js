const mongoose = require("mongoose");

const invoiceSchema = new mongoose.Schema(
  {
    booking_id: mongoose.Schema.Types.ObjectId,
    table_cost: Number,
    services: [
      {
        service_id: mongoose.Schema.Types.ObjectId,
        unit_price: Number,
        quantity: Number
      }
    ],
    total_service: Number,
    payment_method: String,
    status: String,
    note: String,
    created_at: Date,
    created_by: mongoose.Schema.Types.ObjectId
  },
  {
    collection: "invoices",
    versionKey: false
  }
);

module.exports = mongoose.model("Invoice", invoiceSchema);
