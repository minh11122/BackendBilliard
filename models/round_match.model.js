const mongoose = require("mongoose");

const roundMatchSchema = new mongoose.Schema(
    {
        tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: "Tournament", required: true },
        round_id: { type: mongoose.Schema.Types.ObjectId, ref: "TournamentRound", required: true },
        match_no: { type: Number, default: 0 },
        player1_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },
        player2_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },
        winner_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },
        loser_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },
        player1_score: { type: Number, default: 0 },
        player2_score: { type: Number, default: 0 },
        match_name: { type: String, required: true },
        result: { type: String, default: "" },
        table_id: { type: mongoose.Schema.Types.ObjectId, ref: "BilliardTable", default: null },
        scheduled_at: { type: Date, default: null },
        started_at: { type: Date, default: null },
        finished_at: { type: Date, default: null },
        race_to: { type: Number, default: 7 },
        group_key: { type: String, default: null },
        next_match_id: { type: mongoose.Schema.Types.ObjectId, ref: "RoundMatch", default: null },
        next_slot: { type: Number, enum: [1, 2, null], default: null },
        match_format: {
            type: String,
            enum: ["Knockout", "RoundRobin"],
            required: true
        },
        status: {
            type: String,
            enum: ["Scheduled", "Ready", "Playing", "Finished", "Cancelled"],
            default: "Scheduled"
        },
        locked_by_owner: { type: Boolean, default: true }
    },
    {
        collection: "round_matches",
        versionKey: false
    }
);

roundMatchSchema.index({ tournament_id: 1, round_id: 1, match_no: 1 }, { unique: true });
roundMatchSchema.index({ tournament_id: 1, status: 1 });

module.exports = mongoose.model("RoundMatch", roundMatchSchema);
