const express = require("express");
const router = express.Router();
const feedbackController = require("../controller/feedback.controller");
const authenticate = require("../middleware/authenticate.middleware");

// Customer creating a new feedback (Must be logged in)
router.post("/", authenticate, feedbackController.createFeedback);

// Customer editing a feedback
router.put("/:id", authenticate, feedbackController.updateFeedback);

// Fetching feedback by booking ID
router.get("/booking/:bookingId", authenticate, feedbackController.getFeedbackByBooking);

// Owner/Staff fetching all feedbacks for their club
const authorizeRole = require("../middleware/authorizeRole.middleware");
router.get("/club/:clubId", authenticate, authorizeRole("OWNER", "STAFF_CLUB"), feedbackController.getClubFeedbacks);

// Owner/Staff replying to a feedback
router.post("/:id/reply", authenticate, authorizeRole("STAFF_CLUB"), feedbackController.replyFeedback);

module.exports = router;
