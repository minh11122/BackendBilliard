const express = require("express");
const router = express.Router();
const subscriptionController = require("../controller/subscription.controller");

const authenticate = require("../middleware/authenticate.middleware");

router.get("/", authenticate, subscriptionController.getSubscriptions);

router.get("/current",authenticate,subscriptionController.getCurrentSubscription);

router.post("/payos/create-payment",authenticate,subscriptionController.createSubscriptionPayment);

router.post("/payos/verify",authenticate,subscriptionController.verifySubscriptionPayment);


module.exports = router;

