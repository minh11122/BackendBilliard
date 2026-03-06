const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema(
  {
    club_id: { type: mongoose.Schema.Types.ObjectId, ref: "Club", required: true },
    name: { type: String, required: true },
    image_url: { type: String, default: null },
    price: { type: Number, required: true },
    discount_percent: { type: Number, default: 0 },
    description: { type: String },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE"
    },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "Account" }
  },
  {
    collection: "services",
    versionKey: false,
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" }
  }
);

module.exports = mongoose.model("Service", serviceSchema);
