const express = require("express");
const router = express.Router();

const {
  getAllAccountsForAdmin,getAllClubs,getAllSubscriptions,toggleBanAccount,deleteAccount,getSubscriptionById,createSubscription,
  updateSubscription,deleteSubscription,getRevenueWeb,getRevenueWebSummary
} = require("../controller/admin/admin.controller");

const authenticate = require("../middleware/authenticate.middleware");
const authorize = require("../middleware/authorize.middleware");

// ADMIN routes
router.get("/admin/accounts",authenticate,authorize("ADMIN"),getAllAccountsForAdmin);
router.get("/admin/clubs",authenticate,authorize("ADMIN"),getAllClubs);
router.get("/admin/subscriptions",authenticate,authorize("ADMIN"),getAllSubscriptions);
router.patch("/admin/accounts/:id/toggle-ban",authenticate,authorize("ADMIN"),toggleBanAccount);

router.patch("/admin/accounts/:id/delete",authenticate,authorize("ADMIN"),deleteAccount);

router.get("/admin/subscriptions/:id",authenticate,authorize("ADMIN"),getSubscriptionById);

router.post("/admin/subscriptions",authenticate,authorize("ADMIN"),createSubscription);

router.put("/admin/subscriptions/:id",authenticate,authorize("ADMIN"),updateSubscription);

router.delete("/admin/subscriptions/:id",authenticate,authorize("ADMIN"),deleteSubscription);

router.get( "/admin/revenue/web",authenticate,authorize("ADMIN"),getRevenueWeb);

router.get("/admin/revenue/web/summary",authenticate,authorize("ADMIN"),getRevenueWebSummary);



module.exports = router;
