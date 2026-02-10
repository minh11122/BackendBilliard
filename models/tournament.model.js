const mongoose = require("mongoose");

const tournamentSchema = new mongoose.Schema(
  {
    club_id: mongoose.Schema.Types.ObjectId,
    name: String,
    image_url: String,
    start_time: Date,
    end_time: Date,
    registration_deadline: Date,
    max_players: Number,
    fee: Number,
    rules: String,
    status: String,
    rounds: [
      {
        round_number: Number,
        matches: [
          {
            player1_id: mongoose.Schema.Types.ObjectId,
            player2_id: mongoose.Schema.Types.ObjectId,
            winner_id: mongoose.Schema.Types.ObjectId,
            result: String,
            status: String
          }
        ]
      }
    ],
    prizes: {
      first: Number,
      second: Number,
      third: Number
    },
    created_at: Date,
    created_by: mongoose.Schema.Types.ObjectId
  },
  {
    collection: "tournaments",
    versionKey: false
  }
);

module.exports = mongoose.model("Tournament", tournamentSchema);
