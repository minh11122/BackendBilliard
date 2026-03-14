const mongoose = require("mongoose");

const subscriptionAccountSchema = new mongoose.Schema(
  {
    subscription_id: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription" },
    account_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
    club_id: { type: mongoose.Schema.Types.ObjectId, ref: "Club", required: true },
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
