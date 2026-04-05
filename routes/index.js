const express = require('express');
const router = express.Router();
const authRoutes = require('./auth.routes');
const clubRoutes = require('./club.routes');
const staffRoutes = require('./staff.routes');
const subscriptionRoutes = require('./subscription.routes')
const bookingRoutes = require('./booking.routes');
const tableRoutes = require('./billiardTable.routes');
const staffClubRoutes = require('./staff_club.routes');
const adminRoutes = require('./admin.routes');
const homeRoutes = require('./home.routes');


router.use(authRoutes);
router.use(homeRoutes);
router.use(adminRoutes);
router.use("/services", require("./service.routes"));
router.use("/clubs", clubRoutes);
router.use("/staff", staffRoutes);
router.use("/staff-club", staffClubRoutes);
router.use("/bookings", bookingRoutes);

router.use("/subscriptions", subscriptionRoutes);
router.use("/tables", tableRoutes);
router.use("/locations", require("./location.routes"));
router.use("/tournaments", require("./tournament.routes"));
router.use("/feedbacks", require("./feedback.routes"));
router.use("/posts", require("./post.routes"));
router.use("/transactions", require("./transaction.routes"));
module.exports = router;