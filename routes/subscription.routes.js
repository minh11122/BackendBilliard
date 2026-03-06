const express = require("express");
const router = express.Router();
const subscriptionController = require("../controller/subscription.controller");
const authenticate = require("../middleware/authenticate.middleware");

router.get("/", authenticate, subscriptionController.getSubscriptions);

router.post(
  "/purchase",
  authenticate,
  subscriptionController.purchaseSubscription
);

router.get(
  "/current",
  authenticate,
  subscriptionController.getCurrentSubscription
);

module.exports = router;

