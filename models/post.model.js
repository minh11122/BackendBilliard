const mongoose = require("mongoose");

const postSchema = new mongoose.Schema(
    {
        club_id: { type: mongoose.Schema.Types.ObjectId, ref: "Club", required: true },
        title: { type: String, required: true },
        content: { type: String, required: true },
        status: {
            type: String,
            enum: ["Pending", "Approved", "Rejected"],
            required: true
        },
        rejected_reason: { type: String },
        image_url: { type: String },
        published_at: { type: Date }
    },
    {
        collection: "posts",
        versionKey: false,
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" }
    }
);

module.exports = mongoose.model("Post", postSchema);