const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // tên gói
    price: { type: Number, required: true }, // giá

    description: String,

    post_limit: { type: Number, required: true },
    // tổng số bài được đăng trong mỗi chu kỳ (theo duration_months khi mua)

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