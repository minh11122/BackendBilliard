const mongoose = require("mongoose");

const invoiceDetailSchema = new mongoose.Schema(
    {
        invoice_id: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", required: true },
        booking_service_id: { type: mongoose.Schema.Types.ObjectId, ref: "BookingService", required: true },
        unit_price: { type: Number, required: true },
        quantity: { type: Number, required: true }
    },
    {
        collection: "invoice_details",
        versionKey: false
    }
);

module.exports = mongoose.model("InvoiceDetail", invoiceDetailSchema);