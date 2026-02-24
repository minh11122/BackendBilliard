const mongoose = require("mongoose");

const roundMatchSchema = new mongoose.Schema(
    {
        round_id: { type: mongoose.Schema.Types.ObjectId, ref: "TournamentRound", required: true },
        account1_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
        account2_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
        winner_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account" },
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