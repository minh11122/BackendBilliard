const mongoose = require("mongoose");

const tableTypeSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        description: { type: String },
        status: { type: String, default: "Active" },
        created_at: { type: Date, default: Date.now }
    },
    {
        collection: "table_types",
        versionKey: false
    }
);

module.exports = mongoose.model("TableType", tableTypeSchema);
