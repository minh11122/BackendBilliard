const mongoose = require("mongoose");

const subscriptionAccountSchema = new mongoose.Schema(
  {
    subscription_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      required: true
    },

    account_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true
    },

    club_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
      required: true
    },

    purchase_date: {
      type: Date,
      default: Date.now
    },

    start_date: {
      type: Date,
      default: Date.now
    },

    expire_date: {
      type: Date,
      required: true
    },

    purchase_price: Number,

    status: {
      type: String,
      enum: ["active", "expired", "cancelled"],
      default: "active"
    },

    posts_used: {
      type: Number,
      default: 0
    },

    post_limit: {
      type: Number,
      required: true
    }
    // 👆 copy từ Subscription để tránh query lại
  },
  {
    collection: "subscription_accounts",
    versionKey: false
  }
);

module.exports = mongoose.model("SubscriptionAccount", subscriptionAccountSchema);