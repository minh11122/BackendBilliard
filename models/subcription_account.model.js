const mongoose = require("mongoose");

const subscriptionAccountSchema = new mongoose.Schema(
  {
    subscription_id: mongoose.Schema.Types.ObjectId,
    account_id: mongoose.Schema.Types.ObjectId,
    purchase_date: Date,
    expire_date: Date,
    purchase_price: Number,
    status: String
  },
  {
    collection: "subscription_accounts",
    versionKey: false
  }
);

module.exports = mongoose.model("SubscriptionAccount", subscriptionAccountSchema);
