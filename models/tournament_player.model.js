const mongoose = require("mongoose");

const tournamentPlayerSchema = new mongoose.Schema(
  {
    tournament_id:{ type: mongoose.Schema.Types.ObjectId, ref: "Tournament", required: true },
    account_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
    register_date: { type: Date, default: Date.now },
    fee_amount: { type: Number, default: 0 },
    // Legacy field kept for backward compatibility with old data.
    fee_ammount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Eliminated", "Champion"],
      default: "Pending"
    },
    elimination_round: { type: Number, default: null },
    final_rank: { type: Number, default: null }
  },
  {
    collection: "tournament_players",
    versionKey: false
  }
);

tournamentPlayerSchema.pre("save", function syncLegacyFee(next) {
  if (typeof this.fee_amount === "number") {
    this.fee_ammount = this.fee_amount;
  } else if (typeof this.fee_ammount === "number") {
    this.fee_amount = this.fee_ammount;
  }
  next();
});

tournamentPlayerSchema.index({ tournament_id: 1, account_id: 1 }, { unique: true });

module.exports = mongoose.model("TournamentPlayer", tournamentPlayerSchema);
