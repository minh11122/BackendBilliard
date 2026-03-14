const express = require("express");
const router = express.Router();

// 🔥 THAY ĐỔI Ở ĐÂY: Sử dụng middleware của bạn
const authenticate = require("../middleware/authenticate.middleware");
const authorizeRole = require("../middleware/authorizeRole.middleware");

const {
    getActiveStaffClub,
    getBannedStaffClub,
    createStaffClub,
    banStaffClub,
    unbanStaffClub,
    deleteStaffClub,
    getStaffClubById,
    updateStaffClub
} = require("../controller/staff_club.controller");

router.use(authenticate);
router.use(authorizeRole("OWNER"));

router.get("/", getActiveStaffClub);
router.get("/banned", getBannedStaffClub);
router.post("/", createStaffClub);
router.put("/:id/ban", banStaffClub);
router.put("/:id/unban", unbanStaffClub);
router.delete("/:id", deleteStaffClub);
router.get("/:id", getStaffClubById);
router.put("/:id", updateStaffClub);
module.exports = router;