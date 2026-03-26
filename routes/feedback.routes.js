const express = require("express");
const router = express.Router();
const feedbackController = require("../controller/feedback.controller");
const authenticate = require("../middleware/authenticate.middleware");

// Customer creating a new feedback (Must be logged in)
router.post("/", authenticate, feedbackController.createFeedback);

// Fetching feedback by booking ID (Any authenticated user can fetch, or maybe public, but let's keep it authenticated)
router.get("/booking/:bookingId", authenticate, feedbackController.getFeedbackByBooking);

module.exports = router;
