const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    account_id: mongoose.Schema.Types.ObjectId,
    club_id: mongoose.Schema.Types.ObjectId,
    table_number: String,
    play_date: Date,
    start_time: String,
    end_time: String,
    services: [
      {
        service_id: mongoose.Schema.Types.ObjectId,
        name: String,
        price: Number,
        quantity: Number
      }
    ],
    deposit: Number,
    total_bill: Number,
    status: String,
    created_at: Date,
    created_by: mongoose.Schema.Types.ObjectId
  },
  {
    collection: "bookings",
    versionKey: false
  }
);

module.exports = mongoose.model("Booking", bookingSchema);
