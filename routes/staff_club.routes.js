const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/authenticate.middleware");
const authorizeRole = require("../middleware/authorizeRole.middleware");

const {
    getActiveStaffClub,
    getBannedStaffClub,
    createStaffClub,
    banStaffClub,
    unbanStaffClub,
    getStaffClubById,
    updateStaffClub
} = require("../controller/club/staff_club.controller");

router.use(authenticate);
router.use(authorizeRole("OWNER"));

router.get("/", getActiveStaffClub);
router.get("/banned", getBannedStaffClub);
router.post("/", createStaffClub);
router.put("/:id/ban", banStaffClub);
router.put("/:id/unban", unbanStaffClub);
router.get("/:id", getStaffClubById);
router.put("/:id", updateStaffClub);
module.exports = router;