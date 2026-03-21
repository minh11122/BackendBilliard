const mongoose = require("mongoose");

const tournamentSchema = new mongoose.Schema(
  {
    club_id: mongoose.Schema.Types.ObjectId,
    name: String,
    image_url: String,
    start_time: Date,
    end_time: Date,
    registration_deadline: Date,
    registered_player: Number,
    max_players: Number,
    fee: Number,
    rules: String,
    status: String,
    created_at: Date,
    created_by: mongoose.Schema.Types.ObjectId
  },
  {
    collection: "tournaments",
    versionKey: false
  }
);

module.exports = mongoose.model("Tournament", tournamentSchema);
