const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    account_id: mongoose.Schema.Types.ObjectId,
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
