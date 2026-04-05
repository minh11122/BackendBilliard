const express = require("express");
const router = express.Router();

const {
  getLatestTournaments,getFeaturedClubs,getTopFeedbacks,getLatestPosts
} = require("../controller/auth/home.controller");

router.get("/tournaments/latest", getLatestTournaments);
router.get("/clubs/featured", getFeaturedClubs);
router.get("/feedbacks/top", getTopFeedbacks);
router.get("/posts/latest", getLatestPosts);

module.exports = router;