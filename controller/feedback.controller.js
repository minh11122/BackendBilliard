const Feedback = require("../models/feedback.model");
const Booking = require("../models/booking.model");
const BilliardTable = require("../models/billiard_table.model");

// Khách hàng tạo đánh giá cho một booking đã hoàn thành
exports.createFeedback = async (req, res) => {
  try {
    const { booking_id, rating, comment } = req.body;
    const account_id = req.user.accountId;

    if (!booking_id || !rating) {
      return res.status(400).json({ success: false, message: "Thiếu thông tin booking_id hoặc số sao rating" });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: "Số sao đánh giá phải từ 1 đến 5" });
    }

    // 1. Kiểm tra booking có tồn tại và thuộc về user không
    const booking = await Booking.findById(booking_id);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Không tìm thấy booking" });
    }

    if (String(booking.account_id) !== String(account_id)) {
      return res.status(403).json({ success: false, message: "Bạn không có quyền đánh giá booking này" });
    }

    if (booking.status !== "Completed") {
      return res.status(400).json({ success: false, message: "Chỉ có thể đánh giá những đơn đặt bàn đã hoàn thành" });
    }

    // 2. Kiểm tra xem booking này đã được đánh giá chưa
    const existingFeedback = await Feedback.findOne({ booking_id });
    if (existingFeedback) {
      return res.status(400).json({ success: false, message: "Đơn đặt bàn này đã được đánh giá" });
    }

    // 3. Tìm club_id từ booking.table_id với fallback dự phòng
    let club_id = null;

    // Bước 1: Thử populate table_id
    await booking.populate("table_id");
    club_id = booking.table_id?.club_id || null;

    // Bước 2: Nếu vẫn null, truy vấn thẳng vào BilliardTable
    if (!club_id && booking.table_id) {
      const tableId = typeof booking.table_id === 'object' ? booking.table_id._id : booking.table_id;
      const table = await BilliardTable.findById(tableId).select('club_id').lean();
      club_id = table?.club_id || null;
    }

    if (!club_id) {
       return res.status(400).json({ success: false, message: "Không xác định được Club của bàn này" });
    }

    // 4. Tạo feedback mới
    const feedback = await Feedback.create({
      account_id,
      booking_id,
      club_id,
      rating: Number(rating),
      comment: comment?.trim() || ""
    });

    res.status(201).json({
      success: true,
      message: "Gửi đánh giá thành công",
      data: feedback
    });

  } catch (error) {
    console.error("Lỗi createFeedback:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// Lấy thông tin feedback theo booking_id
exports.getFeedbackByBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    
    // Tìm feedback kèm thông tin người dùng (không bắt buộc nhưng tốt cho UI mở rộng)
    const feedback = await Feedback.findOne({ booking_id: bookingId })
      .populate("account_id", "fullname avatar")
      .lean();

    if (!feedback) {
      return res.status(200).json({
         success: true, 
         data: null, 
         message: "Chưa có đánh giá" 
      });
    }

    res.status(200).json({
      success: true,
      data: feedback
    });

  } catch (error) {
    console.error("Lỗi getFeedbackByBooking:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};
