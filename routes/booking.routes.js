const express = require("express");
const router = express.Router();
const bookingController = require("../controller/booking.controller");
const authenticate = require("../middleware/authenticate.middleware");

// Tạo booking mới (cần đăng nhập)
router.post("/", authenticate, bookingController.createBooking);

// Lấy danh sách booking của tôi (cần đăng nhập)
router.get("/my", authenticate, bookingController.getMyBookings);

// Hủy giữ chỗ (cần đăng nhập)
router.post("/:id/cancel-hold", authenticate, bookingController.cancelHold);

// Lấy danh sách booking của club (staff / owner)
const authorizeRole = require("../middleware/authorizeRole.middleware");
router.get(
  "/club",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  bookingController.getClubBookings,
);

// Nhân viên check-in booking bằng code_number
router.post(
  "/checkin",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  bookingController.checkInBooking,
);
// Create PayOS payment link for booking deposit
router.post(
  "/:id/payos/create-payment",
  authenticate,
  bookingController.createBookingPayOSPayment,
);

// Chủ quán / Nhân viên xác nhận thanh toán (chuyển Pending -> Booked)
router.post(
  "/:id/confirm-payment",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  bookingController.confirmPayment,
);

// PayOS webhook (no auth, signature verified in controller)
router.post("/payos/webhook", bookingController.payosWebhook);

// Frontend verify PayOS payment when returning from PayOS (by orderCode)
router.post(
  "/payos/verify",
  authenticate,
  bookingController.verifyBookingPayOSPayment,
);

module.exports = router;
