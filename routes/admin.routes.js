const express = require("express");
const router = express.Router();

const {
  getAllAccountsForAdmin,getAllClubs,getAllSubscriptions
} = require("../controller/admin/admin.controller");

const authenticate = require("../middleware/authenticate.middleware");
const authorize = require("../middleware/authorize.middleware");

// ADMIN routes
router.get("/admin/accounts",authenticate,authorize("ADMIN"),getAllAccountsForAdmin);
router.get("/admin/clubs",authenticate,authorize("ADMIN"),getAllClubs);
router.get("/admin/subscriptions",authenticate,authorize("ADMIN"),getAllSubscriptions);



module.exports = router;
