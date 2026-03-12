const express = require('express');
const router = express.Router();
const authRoutes = require('./auth.routes');
const clubRoutes = require('./club.routes');
const staffRoutes = require('./staff.routes');
const subscriptionRoutes = require('./subscription.routes')
const bookingRoutes = require('./booking.routes');
const tableRoutes = require('./billiardTable.routes');

router.use(authRoutes);
router.use("/services", require("./service.routes"));
router.use("/clubs", clubRoutes);
router.use("/staff", staffRoutes);
router.use("/bookings", bookingRoutes);

router.use("/subscriptions", subscriptionRoutes);
router.use("/tables", tableRoutes);
router.use("/locations", require("./location.routes"));
module.exports = router;