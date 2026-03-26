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

// Lấy booking theo id (cho STAFF/OWNER của cùng club)
router.get(
  "/:id",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  bookingController.getBookingById
);

// Nhân viên check-in booking bằng code_number
router.post(
  "/checkin",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  bookingController.checkInBooking,
);
// Nhân viên tạo đặt bàn trực tiếp cho khách walk-in
router.post(
  "/walk-in",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  bookingController.createWalkInBooking,
);

// Nhân viên / Chủ quán nhấn nút thanh toán đơn đặt bàn đang chơi
router.post(
  "/:id/checkout",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  bookingController.checkOutBooking,
);

// Tiền mặt: dùng luôn endpoint checkout hiện tại
// Chuyển khoản nốt (PayOS) cho Playing -> Completed
router.post(
  "/:id/checkout/payos/create-payment",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  bookingController.createBookingCheckoutPayOSPayment
);

// Xác thực booking PayOS (redirect về frontend)
router.post(
  "/payos/verify",
  authenticate,
  authorizeRole("CUSTOMER"),
  bookingController.verifyBookingPayOSPayment
);

// Xác thực checkout PayOS (redirect về frontend)
router.post(
  "/checkout/payos/verify",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  bookingController.verifyBookingCheckoutPayOSPayment
);
// Đánh dấu booking là Payment Pending sau khi khách đã chuyển khoản
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

// Quản lý dịch vụ thêm vào khi đang chơi
router.get(
  "/:id/services",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  bookingController.getBookingServices
);
router.post(
  "/:id/services",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  bookingController.addBookingService
);
router.put(
  "/:id/services/:bookingServiceId",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  bookingController.updateBookingServiceQuantity
);
router.delete(
  "/:id/services/:bookingServiceId",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  bookingController.deleteBookingService
);

router.post(
  "/:id/extend",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  bookingController.extendBooking
);

router.post(
  "/:id/change-table",
  authenticate,
  authorizeRole("OWNER", "STAFF_CLUB"),
  bookingController.changeTable
);

module.exports = router;
