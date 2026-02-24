const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema(
    {
        club_id: { type: mongoose.Schema.Types.ObjectId, ref: "Club", required: true },
        image_url: { type: String, required: true },
        image_type: {
            type: String,
            enum: ["Banner", "Avatar", "Background"],
            required: true
        }
    },
    {
        collection: "images",
        versionKey: false,
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" }
    }
);

module.exports = mongoose.model("Image", imageSchema);