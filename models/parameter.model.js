const mongoose = require("mongoose");

const parameterSchema = new mongoose.Schema(
    {
        booking_percent: { type: Number, required: true },
        account_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true }
    },
    {
        collection: "parameters",
        versionKey: false
    }
);

module.exports = mongoose.model("Parameter", parameterSchema);