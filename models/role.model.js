const mongoose = require("mongoose");

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true
    }
  },
  {
    collection: "roles",
    versionKey: false,
    timestamps: true
  }
);

module.exports = mongoose.model("Role", roleSchema);
