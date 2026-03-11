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

module.exports = router;
