const mongoose = require("mongoose");

const provinceSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true }, // e.g., "11"
    name: { type: String, required: true }, // e.g., "Hà Nội"
    slug: { type: String }, // e.g., "ha-noi"
    name_with_type: { type: String }, // e.g., "Thành phố Hà Nội"
    type: { type: String } // e.g., "thanh-pho"
  },
  {
    collection: "provinces",
    timestamps: true,
    versionKey: false
  }
);

module.exports = mongoose.model("Province", provinceSchema);
