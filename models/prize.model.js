const mongoose = require("mongoose");

const tournamentPlayerSchema = new mongoose.Schema(
  {
    tournament_id:{ type: mongoose.Schema.Types.ObjectId, ref: "Tournament", required: true },
    first_player:{ type: mongoose.Schema.Types.ObjectId, ref: "TournamentPlayer" },
    second_player:{ type: mongoose.Schema.Types.ObjectId, ref: "TournamentPlayer" },
    third_player:{ type: mongoose.Schema.Types.ObjectId, ref: "TournamentPlayer" },
    first_prize:Number,
    second_prize:Number,
    third_prize:Number
    
  },
  {
    collection: "tournament_players",
    versionKey: false
  }
);

module.exports = mongoose.model("TournamentPlayer", tournamentPlayerSchema);
