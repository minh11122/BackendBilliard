const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema(
  {
    club_id: mongoose.Schema.Types.ObjectId,
    name: String,
    price: Number,
    discount_percent: Number,
    description: String,
    status: String,
    created_at: Date,
    created_by: mongoose.Schema.Types.ObjectId
  },
  {
    collection: "services",
    versionKey: false
  }
);

module.exports = mongoose.model("Service", serviceSchema);
