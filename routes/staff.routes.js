const express = require("express");
const router = express.Router();
const staff = require("../controller/staff.controller");
const authenticate = require("../middleware/authenticate.middleware");

router.get("/dashboard", authenticate, staff.getDashboard);
router.patch("/clubs/:id/approve", authenticate, staff.approveClub);
router.patch("/clubs/:id/reject", authenticate, staff.rejectClub);
router.patch("/posts/:id/approve", authenticate, staff.approvePost);
router.patch("/posts/:id/reject", authenticate, staff.rejectPost);

module.exports = router;
