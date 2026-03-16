const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    account_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
    booking_id: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },
    order_code:String,
    amount: Number,
    description: String,
    transaction_type: String,
    transaction_time: Date,
    status: String
  },
  {
    collection: "transaction_history",
    versionKey: false
  }
);

module.exports = mongoose.model("TransactionHistory", transactionSchema);
