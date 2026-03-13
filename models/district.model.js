const mongoose = require("mongoose");

const districtSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true }, // e.g., "267"
    name: { type: String, required: true }, // e.g., "Minh Châu"
    slug: { type: String }, // e.g., "minh-chau"
    name_with_type: { type: String }, // e.g., "Xã Minh Châu"
    type: { type: String }, // e.g., "xa"
    province_code: { type: String, ref: "Province", required: true } // Reference to Province.code
  },
  {
    collection: "districts",
    timestamps: true,
    versionKey: false
  }
);

module.exports = mongoose.model("District", districtSchema);
