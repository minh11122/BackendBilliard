const mongoose = require("mongoose");

const postBlockSchema = new mongoose.Schema(
    {
        type: { type: String, enum: ["text", "image"], required: true },
        text: { type: String, default: "" },
        image_url: { type: String, default: "" },
        image_width: {
            type: String,
            enum: ["small", "normal", "wide", "full"],
            default: "wide"
        },
        image_align: {
            type: String,
            enum: ["left", "center", "right"],
            default: "center"
        }
    },
    { _id: false }
);

const postSchema = new mongoose.Schema(
    {
        club_id: { type: mongoose.Schema.Types.ObjectId, ref: "Club", required: true },
        title: { type: String, required: true },
        content: { type: String, required: true },
        content_blocks: { type: [postBlockSchema], default: [] },
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