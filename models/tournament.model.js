const mongoose = require("mongoose");

const tournamentSchema = new mongoose.Schema(
  {
    club_id: { type: mongoose.Schema.Types.ObjectId, ref: "Club", required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    format: {
      type: String,
      enum: ["Knockout", "Round Robin"],
      default: "Knockout"
    },
    max_players: { type: Number, required: true },
    registered_player: { type: Number, default: 0 },
    fee: { type: Number, default: 0 },
    prize_pool: { type: String, default: "" },
    registration_open: { type: Date },
    registration_deadline: { type: Date },
    play_date: { type: Date },
    start_time: { type: Date },
    end_time: { type: Date },
    auto_bracket: { type: Boolean, default: true },
    banner: { type: String, default: "" },
    status: {
      type: String,
      enum: ["Draft", "Open", "Closed", "InProgress", "Completed", "Cancelled"],
      default: "Draft"
    },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "Account" },
    created_at: { type: Date, default: Date.now }
  },
  {
    collection: "tournaments",
    versionKey: false
  }
);

module.exports = mongoose.model("Tournament", tournamentSchema);
