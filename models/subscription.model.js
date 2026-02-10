const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema(
  {
    name: String,
    price: Number,
    description: String,
    discount_percent: Number,
    created_at: Date,
    created_by: mongoose.Schema.Types.ObjectId
  },
  {
    collection: "subscriptions",
    versionKey: false
  }
);

module.exports = mongoose.model("Subscription", subscriptionSchema);
