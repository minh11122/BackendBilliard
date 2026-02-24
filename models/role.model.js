const mongoose = require("mongoose");

const roleSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, unique: true }
    },
    {
        collection: "roles",
        versionKey: false
    }
);

module.exports = mongoose.model("Role", roleSchema);