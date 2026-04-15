const mongoose = require("mongoose");

const tournamentPlayerSchema = new mongoose.Schema(
  {
    tournament_id:{ type: mongoose.Schema.Types.ObjectId, ref: "Tournament", required: true },
    account_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
    register_date: { type: Date, default: Date.now },
    fee_amount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Eliminated", "Champion", "Cancelled"],
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



tournamentPlayerSchema.index({ tournament_id: 1, account_id: 1 }, { unique: true });

module.exports = mongoose.model("TournamentPlayer", tournamentPlayerSchema);
