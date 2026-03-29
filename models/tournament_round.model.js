const mongoose = require("mongoose");

const tournamentRoundSchema = new mongoose.Schema(
  {
    tournament_id:{ type: mongoose.Schema.Types.ObjectId, ref: "Tournament", required: true },
    round_number: { type: Number, required: true },
    round_type: {
      type: String,
      enum: ["Knockout", "RoundRobin"],
      required: true
    },
    group_key: { type: String, default: null },
    race_to: { type: Number, default: 7 },
    status: {
      type: String,
      enum: ["Pending", "InProgress", "Completed"],
      default: "Pending"
    },
    order: { type: Number, default: 0 }
  },
  {
    collection: "tournament_rounds",
    versionKey: false
  }
);

tournamentRoundSchema.index({ tournament_id: 1, round_number: 1, group_key: 1 }, { unique: true });

module.exports = mongoose.model("TournamentRound", tournamentRoundSchema);
