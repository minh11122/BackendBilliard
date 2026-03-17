const express = require("express");
const router = express.Router();
const clubController = require("../controller/club.controller");
const clubBankController = require("../controller/clubBank.controller");
const authenticate = require("../middleware/authenticate.middleware");

// Chủ quán đăng ký thông tin CLB
router.post("/register-owner-account", authenticate, clubController.registerClub);
router.get("/", clubController.getAllClubs);
router.get("/owner/clubs", authenticate, clubController.getClubsByAccount);
router.put("/:id", authenticate, clubController.updateClub);

const authorizeRole = require("../middleware/authorizeRole.middleware");
router.get("/staff/statistics", authenticate, authorizeRole("OWNER", "STAFF_CLUB"), clubController.getClubStatistics);

router.get("/:id", clubController.getClubById);

// Thông tin tài khoản ngân hàng của CLB
router.get("/:id/bank", authenticate, clubBankController.getBankByClub);
router.put("/:id/bank", authenticate, clubBankController.upsertBankByClub);

module.exports = router;
