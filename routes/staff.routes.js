const express = require("express");
const router = express.Router();
const staff = require("../controller/staff.controller");
const authenticate = require("../middleware/authenticate.middleware");
const authorizeRole = require("../middleware/authorizeRole.middleware");

const staffSystemOnly = authorizeRole("STAFF_SYSTEM");
const staffNotifications = authorizeRole("STAFF_SYSTEM", "STAFF_CLUB");

router.get("/dashboard", authenticate, staffSystemOnly, staff.getDashboard);
router.get("/clubs", authenticate, staffSystemOnly, staff.getClubs);
router.patch("/clubs/:id/approve", authenticate, staffSystemOnly, staff.approveClub);
router.patch("/clubs/:id/reject", authenticate, staffSystemOnly, staff.rejectClub);
router.patch("/clubs/:id/lock", authenticate, staffSystemOnly, staff.lockClub);
router.patch("/clubs/:id/unlock", authenticate, staffSystemOnly, staff.unlockClub);
router.patch("/posts/:id/approve", authenticate, staffSystemOnly, staff.approvePost);
router.patch("/posts/:id/reject", authenticate, staffSystemOnly, staff.rejectPost);

router.get("/posts", authenticate, staffSystemOnly, staff.getPosts);

// Notifications
router.get("/notifications", authenticate, staffNotifications, staff.getNotifications);
router.post("/notifications/test", authenticate, staffSystemOnly, staff.createTestNotification);
router.patch("/notifications/read-all", authenticate, staffNotifications, staff.markAllNotificationsRead);
router.patch("/notifications/:id/read", authenticate, staffNotifications, staff.markNotificationRead);

module.exports = router;
