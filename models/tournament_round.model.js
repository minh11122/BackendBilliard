const mongoose = require("mongoose");

const tournamentRoundSchema = new mongoose.Schema(
  {
    tournament_id:{ type: mongoose.Schema.Types.ObjectId, ref: "Tournament", required: true },
    round_number: { type: Number, required: true },
    round_type: {
      type: String,
      enum: ["Knockout", "DoubleElimination"],
      required: true
    },
    bracket_side: {
      type: String,
      enum: ["Winners", "Losers", "GrandFinal", null],
      default: null
    },
    race_to: { type: Number, default: 7 },
    status: {
      type: String,
      enum: ["Pending", "InProgress", "Completed"],
      default: "Pending"
    },
    order: { type: Number, default: 0 }
  },
  {
    collection: "tournament_rounds",
    versionKey: false
  }
);

tournamentRoundSchema.index(
  { tournament_id: 1, bracket_side: 1, round_number: 1 },
  { unique: true }
);

const TournamentRound =
  mongoose.models.TournamentRound || mongoose.model("TournamentRound", tournamentRoundSchema);


const CURRENT_INDEX_NAME = "tournament_id_1_bracket_side_1_round_number_1";

const ensureTournamentRoundIndexes = async () => {
  try {
    await TournamentRound.createCollection();
  } catch (error) {
    if (error?.codeName !== "NamespaceExists") {
      throw error;
    }
  }

  const indexes = await TournamentRound.collection.indexes();
 

  const refreshedIndexes = await TournamentRound.collection.indexes();
  const hasCurrentIndex = refreshedIndexes.some((index) => index.name === CURRENT_INDEX_NAME);

  if (!hasCurrentIndex) {
    console.log(`[TournamentRound] Creating index ${CURRENT_INDEX_NAME}`);
    await TournamentRound.collection.createIndex(
      { tournament_id: 1, bracket_side: 1, round_number: 1 },
      { unique: true, name: CURRENT_INDEX_NAME }
    );
  }

  console.log("[TournamentRound] Tournament round indexes are ready");
};

module.exports = TournamentRound;
module.exports.ensureTournamentRoundIndexes = ensureTournamentRoundIndexes;
