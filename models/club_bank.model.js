const mongoose = require("mongoose");

const clubBankSchema = new mongoose.Schema(
  {
    club_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
      required: true
    },
    bank_name: {
      type: String,
      required: true
    },
    account_number: {
      type: String,
      required: true
    },
    account_name: {
      type: String,
      required: true
    },
    // PayOS keys are configured per club (sensitive data).
    payos_client_id: {
      type: String,
      default: ""
    },
    payos_api_key: {
      type: String,
      default: ""
    },
    payos_checksum_key: {
      type: String,
      default: ""
    }
  },
  {
    timestamps: true,
    collection: "club_banks"
  }
);

module.exports = mongoose.model("ClubBank", clubBankSchema);