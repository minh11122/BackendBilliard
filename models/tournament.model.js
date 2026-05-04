const mongoose = require("mongoose");

const tournamentSchema = new mongoose.Schema(
  {
    club_id: { type: mongoose.Schema.Types.ObjectId, ref: "Club", required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    table_type_id: { type: mongoose.Schema.Types.ObjectId, ref: "TableType", default: null },
    format: {
      type: String,
      enum: ["Knockout", "Round Robin", "Double Elimination"],
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
    bracket_generated: { type: Boolean, default: false },
    bracket_generated_at: { type: Date, default: null },
    started_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    champion_account_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },
    generation_config: { type: mongoose.Schema.Types.Mixed, default: null },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "Account" },
    created_at: { type: Date, default: Date.now }
  },
  {
    collection: "tournaments",
    versionKey: false
  }
);

module.exports = mongoose.model("Tournament", tournamentSchema);
