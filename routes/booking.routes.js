const express = require("express");
const router = express.Router();

const {
  createBooking,
  cancelHold,
  getMyBookings,
  checkInBooking,
  checkOutBooking,
  getBookingById,
  getClubBookings,
  createWalkInBooking,
  confirmPayment,
  createBookingPayOSPayment,
  payosWebhook,
  verifyBookingPayOSPayment,
  createBookingCheckoutPayOSPayment,
  verifyBookingCheckoutPayOSPayment,
  addBookingService,
  getBookingServices,
  updateBookingServiceQuantity,
  deleteBookingService,
  extendBooking,
  changeTable,
} = require("../controller/booking.controller");

const authenticate = require("../middleware/authenticate.middleware");
const authorizeRole = require("../middleware/authorizeRole.middleware");

// Customer booking flows
router.post("/", authenticate, authorizeRole("CUSTOMER"), createBooking);
router.get("/my", authenticate, authorizeRole("CUSTOMER"), getMyBookings);
router.post("/:id/cancel-hold", authenticate, authorizeRole("CUSTOMER"), cancelHold);
router.post(
  "/:id/payos/create-payment",
  authenticate,
  authorizeRole("CUSTOMER"),
  createBookingPayOSPayment
);
router.post(
  "/payos/verify",
  authenticate,
  authorizeRole("CUSTOMER"),
  verifyBookingPayOSPayment
);
router.post("/payos/webhook", payosWebhook);

// Staff/owner booking management
router.post(
  "/checkin",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  checkInBooking
);
router.get(
  "/club",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  getClubBookings
);
router.post(
  "/walk-in",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  createWalkInBooking
);
router.post(
  "/checkout/payos/verify",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  verifyBookingCheckoutPayOSPayment
);

router.get(
  "/:id",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  getBookingById
);
router.post(
  "/:id/confirm-payment",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  confirmPayment
);
router.post(
  "/:id/checkout",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  checkOutBooking
);
router.post(
  "/:id/checkout/payos/create-payment",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  createBookingCheckoutPayOSPayment
);
router.get(
  "/:id/services",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  getBookingServices
);
router.post(
  "/:id/services",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  addBookingService
);
router.put(
  "/:id/services/:bookingServiceId",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  updateBookingServiceQuantity
);
router.delete(
  "/:id/services/:bookingServiceId",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  deleteBookingService
);
router.post(
  "/:id/extend",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  extendBooking
);
router.post(
  "/:id/change-table",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  changeTable
);

module.exports = router;
