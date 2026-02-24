const mongoose = require("mongoose");

const bookingServiceSchema = new mongoose.Schema(
    {
        booking_id: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },
        service_id: { type: mongoose.Schema.Types.ObjectId, ref: "Service", required: true },
        quantity: { type: Number, required: true },
        unit_price: { type: Number, required: true }
    },
    {
        collection: "booking_services",
        versionKey: false,
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" }
    }
);

module.exports = mongoose.model("BookingService", bookingServiceSchema);