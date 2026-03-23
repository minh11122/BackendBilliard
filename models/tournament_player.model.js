const mongoose = require("mongoose");

const tournamentPlayerSchema = new mongoose.Schema(
  {
    tournament_id:{ type: mongoose.Schema.Types.ObjectId, ref: "Tournament", required: true },
    account_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
    register_date:Date,
    fee_ammount:Number,
    status: String,
  },
  {
    collection: "tournament_players",
    versionKey: false
  }
);

module.exports = mongoose.model("TournamentPlayer", tournamentPlayerSchema);
