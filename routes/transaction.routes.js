const express = require("express");
const router = express.Router();

const authenticate = require("../middleware/authenticate.middleware");
const authorizeRole = require("../middleware/authorizeRole.middleware");
const transactionController = require("../controller/transaction.controller");

// Customer: lịch sử giao dịch của chính tài khoản
router.get(
  "/my",
  authenticate,
  authorizeRole("CUSTOMER"),
  transactionController.getMyTransferHistory
);

// Owner / Staff-club: lịch sử giao dịch liên quan booking của club
router.get(
  "/club",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  transactionController.getClubTransferHistory
);

module.exports = router;

