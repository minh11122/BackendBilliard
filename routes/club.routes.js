const express = require("express");
const router = express.Router();
const clubController = require("../controller/club.controller");
const authenticate = require("../middleware/authenticate.middleware");
// Chủ quán đăng ký thông tin CLB
router.post("/register-owner-account", authenticate, clubController.registerClub);

// Public APIs
router.get("/", clubController.getAllClubs);
router.get("/:id", clubController.getClubById);

module.exports = router;
