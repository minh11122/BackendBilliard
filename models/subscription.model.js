const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // tên gói
    price: { type: Number, required: true }, // giá

    description: String,

    discount_percent: { type: Number, default: 0 },

    duration_days: { type: Number, required: true }, 
    // số ngày hiệu lực (VD: 30)

    post_limit: { type: Number, required: true }, 
    // tổng số bài được đăng trong gói

    features: {
      allow_priority_post: { type: Boolean, default: false },
      allow_highlight: { type: Boolean, default: false },
      allow_pin_post: { type: Boolean, default: false }
    },

    is_active: { type: Boolean, default: true },

    created_at: { type: Date, default: Date.now },
    created_by: { type: mongoose.Schema.Types.ObjectId }
  },
  {
    collection: "subscriptions",
    versionKey: false
  }
);

module.exports = mongoose.model("Subscription", subscriptionSchema);