const express = require("express");
const router = express.Router();
const subscriptionController = require("../controller/subscription");

const authenticate = require("../middleware/authenticate.middleware");
const authorizeRole = require("../middleware/authorizeRole.middleware");

router.get("/", authenticate, subscriptionController.getSubscriptions);

router.get(
  "/current",
  authenticate,
  subscriptionController.getCurrentSubscription,
);

router.post(
  "/payos/create-payment",
  authenticate,
  authorizeRole("OWNER"),
  subscriptionController.createSubscriptionPayment,
);

router.post(
  "/payos/verify",
  authenticate,
  authorizeRole("OWNER"),
  subscriptionController.verifySubscriptionPayment,
);

router.post("/payos/webhook", subscriptionController.subscriptionPayOSWebhook);

module.exports = router;
