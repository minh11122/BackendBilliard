const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema(
    {
        account_id: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
        booking_id: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },
        rating: { type: Number, required: true },
        comment: { type: String },
        reply_content: { type: String },
        replied_at: { type: Date }
    },
    {
        collection: "feedbacks",
        versionKey: false,
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" }
    }
);

module.exports = mongoose.model("Feedback", feedbackSchema);