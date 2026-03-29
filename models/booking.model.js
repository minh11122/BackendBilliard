const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    account_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account" },
    guest_name: { type: String }, // Tên khách walk-in (không có tài khoản)
    table_id: { type: mongoose.Schema.Types.ObjectId, ref: "BilliardTable", required: true },
    play_date: { type: Date, required: true },
    start_time: { type: String, required: true },
    end_time: { type: String, required: true },
    actual_end_time: { type: String }, // Giờ kết thúc thực tế (để giải phóng bàn trên timeline)
    code_number: { type: String, required: true, unique: true },
    deposit: { type: Number, required: true },
    hour_price: { type: Number, required: true },
    total_bill: { type: Number },
    note: { type: String },
    status: {
      type: String,
      enum: ["Pending", "Booked", "Playing", "Cancelled", "Completed"],
      required: true
    },
    created_at: { type: Date, default: Date.now, required: true }
  },
  {
    collection: "bookings",
    versionKey: false
  }
);

module.exports = mongoose.model("Booking", bookingSchema);