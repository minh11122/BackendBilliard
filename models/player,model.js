const mongoose = require("mongoose");

const playerSchema = new mongoose.Schema(
  {
    account_id: mongoose.Schema.Types.ObjectId
  },
  {
    collection: "players",
    versionKey: false
  }
);

module.exports = mongoose.model("Player", playerSchema);
