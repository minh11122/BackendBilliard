const express = require('express');
const router = express.Router();
const authRoutes = require('./auth.routes');
const clubRoutes = require('./club.routes');
const staffRoutes = require('./staff.routes');

router.use(authRoutes);
router.use("/services", require("./service.routes"));
router.use("/clubs", clubRoutes);
router.use("/staff", staffRoutes);

module.exports = router;