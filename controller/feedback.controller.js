const Feedback = require("../models/feedback.model");
const Booking = require("../models/booking.model");
const BilliardTable = require("../models/billiard_table.model");
const Account = require("../models/account.model");
const Club = require("../models/club.model");
const Notification = require("../models/notification.model");

const notifyClubStaff = async (club_id, title, message, link = null) => {
  try {
    const staffs = await Account.find({ club_id, status: "ACTIVE" }).select("_id").lean();
    if (staffs.length === 0) return;

    await Notification.insertMany(
      staffs.map((staff) => ({
        account_id: staff._id,
        title,
        message,
        link,
        is_read: false,
      }))
    );
  } catch (error) {
    console.error("Notify club staff error:", error);
  }
};

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

    const club = await Club.findById(club_id).select("name").lean();
    await notifyClubStaff(
      club_id,
      "Có đánh giá mới",
      `Khách hàng vừa gửi đánh giá mới cho CLB ${club?.name || ""}.`,
      "/staff/reviews"
    );

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

// Lấy danh sách đánh giá của quán (dành cho OWNER / STAFF_CLUB)
exports.getClubFeedbacks = async (req, res) => {
  try {
    let clubId = req.params.clubId;
    if (clubId === "my" || clubId === "null" || clubId === "undefined") {
      clubId = req.user.club_id;
    } else {
      clubId = clubId || req.user.club_id;
    }

    if (!clubId) {
      return res.status(403).json({ success: false, message: "Bạn không thuộc quán nào hoặc chưa chọn quán" });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const query = { club_id: clubId };

    if (req.query.rating && req.query.rating !== "all") {
      query.rating = Number(req.query.rating);
    }

    if (req.query.isReplied && req.query.isReplied !== "all") {
      if (req.query.isReplied === "true") {
        query.reply_content = { $exists: true, $ne: "" };
      } else if (req.query.isReplied === "false") {
        query.$or = [
          { reply_content: { $exists: false } },
          { reply_content: "" }
        ];
      }
    }

    const feedbacks = await Feedback.find(query)
      .populate("account_id", "fullname avatar")
      .populate({ path: "booking_id", select: "code_number play_date table_id start_time end_time" })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Feedback.countDocuments(query);

    return res.status(200).json({
      success: true,
      message: "Lấy danh sách đánh giá thành công",
      data: feedbacks,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Lỗi getClubFeedbacks:", error);
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// Owner / Staff trả lời đánh giá
exports.replyFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const { reply_content, clubId } = req.body;
    const activeClubId = clubId || req.user.club_id;

    if (!reply_content || reply_content.trim() === "") {
      return res.status(400).json({ success: false, message: "Nội dung phản hồi không được để trống" });
    }

    if (!activeClubId) {
      return res.status(403).json({ success: false, message: "Vui lòng truyền lên clubId của quán đang thao tác" });
    }

    const feedback = await Feedback.findById(id);
    if (!feedback) {
      return res.status(404).json({ success: false, message: "Không tìm thấy đánh giá" });
    }

    if (String(feedback.club_id) !== String(activeClubId)) {
      return res.status(403).json({ success: false, message: "Đánh giá này không thuộc quán của bạn" });
    }

    if (feedback.reply_content) {
       return res.status(400).json({ success: false, message: "Đánh giá này đã được trả lời" });
    }

    feedback.reply_content = reply_content.trim();
    feedback.replied_at = new Date();
    await feedback.save();

    const club = await Club.findById(activeClubId).select("name").lean();
    const booking = await Booking.findById(feedback.booking_id).select("play_date start_time").lean();

    let playDateStr = "";
    if (booking && booking.play_date && booking.start_time) {
      const d = new Date(booking.play_date);
      const formattedDate = `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getFullYear()}`;
      playDateStr = ` (ca chơi lúc ${booking.start_time} ngày ${formattedDate})`;
    }

    const clubName = club?.name ? `${club.name}` : "Câu lạc bộ";

    await Notification.create({
      account_id: feedback.account_id,
      title: "Quán đã phản hồi đánh giá",
      message: `Quán ${clubName} vừa phản hồi đánh giá của bạn${playDateStr}.`,
      link: `/my-bookings?bookingId=${feedback.booking_id}`,
      is_read: false,
    });

    return res.status(200).json({
      success: true,
      message: "Phản hồi đánh giá thành công",
      data: feedback
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// Khách hàng sửa lại đánh giá (chỉ được sửa 1 lần và trong vòng 3 ngày)
exports.updateFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;
    const account_id = req.user.accountId;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: "Số sao đánh giá phải từ 1 đến 5" });
    }

    const feedback = await Feedback.findById(id);
    if (!feedback) {
      return res.status(404).json({ success: false, message: "Không tìm thấy đánh giá" });
    }

    if (String(feedback.account_id) !== String(account_id)) {
      return res.status(403).json({ success: false, message: "Bạn không có quyền sửa đánh giá này" });
    }

    if (feedback.is_edited) {
      return res.status(400).json({ success: false, message: "Bạn chỉ được phép chỉnh sửa đánh giá 1 lần duy nhất" });
    }

    const createdAt = new Date(feedback.created_at || feedback._id.getTimestamp()).getTime();
    const now = Date.now();
    const diffDays = (now - createdAt) / (1000 * 60 * 60 * 24);

    if (diffDays > 3) {
      return res.status(400).json({ success: false, message: "Đã quá thời hạn 3 ngày để sửa đánh giá" });
    }

    feedback.rating = Number(rating);
    feedback.comment = comment?.trim() || "";
    feedback.is_edited = true;
    
    await feedback.save();

    return res.status(200).json({
      success: true,
      message: "Cập nhật đánh giá thành công",
      data: feedback
    });

  } catch (error) {
    console.error("Lỗi updateFeedback:", error);
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
};
