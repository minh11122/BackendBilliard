const mongoose = require("mongoose");

const tournamentRoundSchema = new mongoose.Schema(
  {
    tournament_id:{ type: mongoose.Schema.Types.ObjectId, ref: "Tournament", required: true },
    round_number:Number,
  },
  {
    collection: "tournament_rounds",
    versionKey: false
  }
);

module.exports = mongoose.model("TournamentRound", tournamentRoundSchema);
