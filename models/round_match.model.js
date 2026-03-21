const mongoose = require("mongoose");

const roundMatchSchema = new mongoose.Schema(
    {
        round_id: { type: mongoose.Schema.Types.ObjectId, ref: "TournamentRound", required: true },
        player1_id: { type: mongoose.Schema.Types.ObjectId, ref: "Player", required: true },
        player2_id: { type: mongoose.Schema.Types.ObjectId, ref: "Player", required: true },
        winner_id: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
        match_name: { type: String, required: true },
        result: { type: String },
        status: {
            type: String,
            enum: ["Scheduled", "Playing", "Completed"],
            required: true
        }
    },
    {
        collection: "round_matches",
        versionKey: false
    }
);

module.exports = mongoose.model("RoundMatch", roundMatchSchema);