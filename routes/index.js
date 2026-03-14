const express = require('express');
const router = express.Router();
const authRoutes = require('./auth.routes');
const clubRoutes = require('./club.routes');
const staffRoutes = require('./staff.routes');
const subscriptionRoutes = require('./subscription.routes')
const tableRoutes = require('./billiardTable.routes');
const staffClubRoutes = require('./staff_club.routes');

router.use(authRoutes);
router.use("/services", require("./service.routes"));
router.use("/clubs", clubRoutes);
router.use("/staff", staffRoutes);
router.use("/staff-club", staffClubRoutes);
router.use("/subscriptions", subscriptionRoutes);
router.use("/tables", tableRoutes);
module.exports = router;