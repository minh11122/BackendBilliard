const mongoose = require("mongoose");

const billiardTableSchema = new mongoose.Schema(
    {
        club_id: { type: mongoose.Schema.Types.ObjectId, ref: "Club", required: true },
        table_type_id: { type: mongoose.Schema.Types.ObjectId, ref: "TableType", required: true },
        table_number: { type: String, required: true, unique: true },
        image_url: { type: String },
        description: { type: String },
        price: { type: Number, required: true },
        status: {
            type: String,
            enum: ["Available", "Maintenance"],
            required: true
        },
        created_at: { type: Date, default: Date.now, required: true }
    },
    {
        collection: "billiard_tables",
        versionKey: false
    }
);

module.exports = mongoose.model("BilliardTable", billiardTableSchema);