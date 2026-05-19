const Club = require("../../models/club.model");
const BilliardTable = require("../../models/billiard_table.model");
const Feedback = require("../../models/feedback.model");
const Booking = require("../../models/booking.model");
const Tournament = require("../../models/tournament.model");

const getClubStatistics = async (req, res) => {
  try {
    const { month, year } = req.query;

    let club_id;
    if (req.user.role === "STAFF_CLUB") {
      club_id = req.user.club_id;
    } else if (req.user.role === "OWNER") {
      const club = await Club.findOne({ account_id: req.user.accountId }).lean();
      if (!club) {
        return res.status(404).json({
          success: false,
          message: "Chủ quán chưa có câu lạc bộ",
        });
      }
      club_id = club._id;
    } else {
      return res
        .status(403)
        .json({ success: false, message: "Không có quyền truy cập" });
    }

    const currentClub = await Club.findById(club_id).lean();
    if (!currentClub) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy câu lạc bộ" });
    }

    if (currentClub.plan_type === "free") {
      return res.status(403).json({
        success: false,
        message: "Tính năng thống kê chỉ dành cho gói Basic hoặc Pro.",
      });
    }

    let dateFilter = {};
    if (month && year) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59, 999);
      dateFilter = { $gte: startDate, $lte: endDate };
    }

    const tables = await BilliardTable.find({ club_id }).lean();
    const tableIds = tables.map((t) => t._id);

    const bookingQuery = { table_id: { $in: tableIds } };
    if (dateFilter.$gte) bookingQuery.created_at = dateFilter;

    const bookings = await Booking.find(bookingQuery).lean();

    const totalBookings = bookings.length;
    const completedBookings = bookings.filter((b) => b.status === "Completed");
    const totalRevenue = completedBookings.reduce(
      (sum, b) => sum + (b.total_bill || 0),
      0,
    );

    const feedbackQuery = { club_id };
    if (dateFilter.$gte) feedbackQuery.created_at = dateFilter;

    const feedbacks = await Feedback.find(feedbackQuery)
      .populate("account_id", "fullname username avatar")
      .sort({ created_at: -1 })
      .lean();

    const tourQuery = { club_id };
    if (dateFilter.$gte) tourQuery.play_date = dateFilter;
    const tournaments = await Tournament.find(tourQuery).lean();

    return res.status(200).json({
      success: true,
      data: {
        clubName: currentClub.name,
        totalBookings,
        totalRevenue,
        feedbacks: feedbacks.map((f) => ({
          id: f._id,
          rating: f.rating,
          comment: f.comment,
          reply: f.reply_content,
          created_at: f.created_at,
          user: f.account_id
            ? {
                name: f.account_id.fullname || f.account_id.username,
                avatar: f.account_id.avatar,
              }
            : { name: "Ẩn danh" },
        })),
        tournaments: tournaments.map((t) => ({
          id: t._id,
          name: t.name,
          start_time: t.play_date || t.start_time || t.created_at,
          status: t.status,
          fee: t.fee,
          max_players: t.max_players,
        })),
      },
    });
  } catch (error) {
    console.error("Lỗi lấy thống kê CLB:", error);
    return res.status(500).json({ success: false, message: "Lỗi Server" });
  }
};

module.exports = {
  getClubStatistics,
};
