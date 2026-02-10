const mongoose = require("mongoose");

const clubSchema = new mongoose.Schema(
  {
    account_id: mongoose.Schema.Types.ObjectId,
    name: String,
    address: String,
    phone: String,
    tax_code: String,
    description: String,
    status: String,
    tables: [
      {
        table_number: String,
        type: String,
        price: Number,
        status: String
      }
    ],
    created_at: Date,
    created_by: mongoose.Schema.Types.ObjectId
  },
  {
    collection: "clubs",
    versionKey: false
  }
);

module.exports = mongoose.model("Club", clubSchema);
