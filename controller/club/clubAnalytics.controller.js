const mongoose = require("mongoose");
const Booking = require("../../models/booking.model");
const BilliardTable = require("../../models/billiard_table.model");
const Service = require("../../models/service.model");
const BookingService = require("../../models/booking_service.model");
const Feedback = require("../../models/feedback.model");
const { canAccessClub } = require("./club.helpers");

const getClubAnalytics = async (req, res) => {
  try {
    const { id: club_id } = req.params || {};
    const { startDate, endDate } = req.query || {};

    if (!club_id) {
      return res.status(400).json({ success: false, message: "Thiếu club_id" });
    }

    const currentClub = await require("../../models/club.model").findById(club_id).lean();
    if (!currentClub) {
        return res.status(404).json({ success: false, message: "Không tìm thấy quán" });
    }

    if (!(await canAccessClub(req, club_id))) {
        return res.status(403).json({ success: false, message: "Bạn không có quyền xem thống kê của quán này" });
    }

    if (currentClub.plan_type === "free") {
        return res.status(403).json({ success: false, message: "Tính năng Báo cáo doanh thu chỉ dành cho gói Basic hoặc Pro." });
    }

    // Lọc ngày tháng: Định dạng múi giờ VN (+07:00) từ 00:00:00 đến 23:59:59.
    // -> Dùng chung cho: Bộ lọc thời gian (Hôm nay, 7 ngày, 30 ngày...) ở cả FE Dashboard và FE Reports.
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.$gte = startDate.includes("T") ? new Date(startDate) : new Date(`${startDate}T00:00:00.000+07:00`);
      dateFilter.$lte = endDate.includes("T") ? new Date(endDate) : new Date(`${endDate}T23:59:59.999+07:00`);
    } else {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);
      dateFilter.$gte = start;
      dateFilter.$lte = end;
    }
    
    const clubObjectId = new mongoose.Types.ObjectId(club_id);

    // --- 1. DOANH THU & GIAO DỊCH ---
    // -> Tính tổng doanh thu và xu hướng cho Dashboard/Reports.
    const clubTables = await BilliardTable.find({ club_id: clubObjectId }).select("_id").lean();
    const tableIds = clubTables.map(t => t._id);

    const clubBookings = await Booking.find({ table_id: { $in: tableIds } }).select("_id").lean();
    const bookingIds = clubBookings.map(b => b._id);

    const TransactionHistory = require("../../models/transiction_history.model");

    // Lấy các giao dịch (cọc, thanh toán) có trạng thái "SUCCESS" của các bàn trên.
    const successfulTransactions = await TransactionHistory.find({
      booking_id: { $in: bookingIds },
      status: "SUCCESS",
      transaction_time: dateFilter,
      transaction_type: { 
        $in: [
          "BOOKING_DEPOSIT", 
          "BOOKING_FINAL_PAYMENT_CASH", 
          "BOOKING_FINAL_PAYMENT_TRANSFER"
        ] 
      }
    }).lean();

    const revenueByDateMap = {};
    let totalRevenue = 0;
    const validBookingIds = new Set();

    successfulTransactions.forEach(tx => {
      // Tách lấy phần ngày (YYYY-MM-DD) để gom nhóm doanh thu theo từng ngày.
      // -> Dùng cho: Biểu đồ đường (LineChart) "Xu hướng doanh thu" ở FE Reports.
      const dateStr = new Date(tx.transaction_time).toISOString().split('T')[0];
      const amount = tx.amount || 0;
      
      if (!revenueByDateMap[dateStr]) {
        revenueByDateMap[dateStr] = { date: dateStr, total: 0 };
      }
      
      revenueByDateMap[dateStr].total += amount;
      totalRevenue += amount;
      
      if (tx.booking_id) {
         // Dùng Set() lọc ID đơn hàng (chống tính trùng 1 đơn thanh toán nhiều lần).
         // -> Dùng tính "Trung bình / hóa đơn" ở FE Reports (averageOrderValue = totalRevenue / validInvoiceCount).
         validBookingIds.add(tx.booking_id.toString());
      }
    });

    const revenueTimeline = Object.values(revenueByDateMap).sort((a, b) => a.date.localeCompare(b.date));
    const validInvoiceCount = validBookingIds.size;
    const validBookingIdsArray = Array.from(validBookingIds);

    // --- 2. THỜI GIAN CHƠI ---
    // -> Dùng cho: Tính "Giờ chơi TB" (averagePlayMinutes) hiển thị ở FE Dashboard.
    const bookingsInRange = await Booking.find({
      _id: { $in: validBookingIdsArray }
    }).populate('table_id').lean();

    let totalPlayMinutes = 0;

    bookingsInRange.forEach(b => {
       if (b.start_time && b.end_time && b.status !== "Cancelled") {
         const toMins = (timeStr) => {
           // Đổi "HH:mm" sang phút
           const [h, m] = timeStr.split(':').map(Number);
           return h * 60 + m;
         };
         let mins = toMins(b.end_time) - toMins(b.start_time);
         // Nếu chơi qua đêm (âm phút), cộng thêm 24h
         if (mins < 0) mins += 24 * 60; 
         totalPlayMinutes += mins;
       }
    });

    // --- 3. HIỆU SUẤT DỊCH VỤ ---
    // -> Dùng cho: Bảng "Dịch vụ Gọi nhiều nhất" và "Ít gọi / Cần chú ý" ở FE Dashboard.
    const bookingServices = await BookingService.find({
       booking_id: { $in: bookingIds },
       created_at: dateFilter
    }).populate('service_id').lean();

    const serviceStatsMap = {};
    
    // Lấy toàn bộ dịch vụ của quán (để tìm ra những món bán được 0 lượt).
    const allServices = await Service.find({ club_id: clubObjectId, status: 'Active' }).lean();
    allServices.forEach(s => {
       serviceStatsMap[s._id.toString()] = { id: s._id, name: s.name, quantity: 0, revenue: 0 };
    });

    bookingServices.forEach(bs => {
       if (!bs.service_id) return;
       const sId = bs.service_id._id.toString();
       if (!serviceStatsMap[sId]) {
         serviceStatsMap[sId] = { id: sId, name: bs.service_id.name, quantity: 0, revenue: 0 };
       }
       const qty = bs.quantity || 1;
       const price = bs.unit_price || 0;
       serviceStatsMap[sId].quantity += qty;
       serviceStatsMap[sId].revenue += (qty * price);
    });

    const serviceStatsArray = Object.values(serviceStatsMap).sort((a, b) => {
       if (b.quantity !== a.quantity) return b.quantity - a.quantity;
       return b.revenue - a.revenue;
    });
    
    // Top 5 món bán chạy nhất (lượt gọi > 0)
    // "Gọi nhiều nhất" (FE Dashboard).
    const topServices = serviceStatsArray.filter(s => s.quantity > 0).slice(0, 5);
    
    // Top 5 món ế nhất (lượt gọi thấp nhất)
    // "Ít gọi / Cần chú ý" (FE Dashboard).
    const topServiceIds = new Set(topServices.map(s => s.id));
    const bottomServices = [...serviceStatsArray]
       .reverse()
       .filter(s => !topServiceIds.has(s.id)) 
       .slice(0, 5);

    // --- 4. ĐÁNH GIÁ (FEEDBACK) ---
    // Bảng điểm sao đánh giá (Rating) ở FE Dashboard.
    const feedbacks = await Feedback.find({ club_id: clubObjectId, created_at: dateFilter }).lean();
    const feedbackDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let totalRating = 0;
    
    feedbacks.forEach(f => {
       const star = Math.floor(f.rating || 5);
       if (feedbackDistribution[star] !== undefined) {
         feedbackDistribution[star]++;
       }
       totalRating += (f.rating || 5);
    });

    const averageRating = feedbacks.length > 0 ? (totalRating / feedbacks.length).toFixed(1) : 0;
    const feedbackList = Object.keys(feedbackDistribution).sort((a,b) => b-a).map(k => ({
       stars: Number(k),
       count: feedbackDistribution[k]
    }));

    // --- 5. TỔNG HỢP & TRẢ VỀ ---
    // FE nhận cục data này qua biến analyticsData (Dashboard) hoặc bookingData (Reports).
    return res.status(200).json({
      success: true,
      data: {
        kpi: {
          totalRevenue: totalRevenue, // Tổng doanh thu -> FE hiện: "Tạm tính doanh thu"
          averageOrderValue: validInvoiceCount > 0
            ? Math.round(totalRevenue / validInvoiceCount) // (Tổng tiền / Số đơn) 
            : 0, // -> FE hiện: "Trung bình / hóa đơn" (trang Reports)
          averagePlayMinutes: validInvoiceCount > 0 
            ? Math.round(totalPlayMinutes / validInvoiceCount) // (Tổng số phút / Số đơn)
            : 0 // -> FE hiện: "Giờ chơi TB" (trang Dashboard)
        },
        revenue: {
          timeline: revenueTimeline // Mảng gom doanh thu theo từng ngày -> FE vẽ biểu đồ đường LineChart
        },
        services: {
          topList: topServices, // Top 5 món bán chạy -> FE hiện danh sách " Gọi nhiều nhất"
          bottomList: bottomServices // Top 5 món bán ế -> FE hiện danh sách " Ít gọi / Cần chú ý"
        },
        feedback: {
          average: Number(averageRating), // Điểm đánh giá TB (VD: 4.8 sao) -> FE hiện ở khung to
          total: feedbacks.length, // Tổng số lượt đánh giá -> FE hiện chữ "xx lượt"
          distribution: feedbackList // Mảng đếm số người chấm 5 sao, 4 sao... -> FE dùng vẽ 5 thanh ngang (Progress bar)
        }
      }
    });

  } catch (error) {
    console.error("Lỗi lấy Analytics CLB:", error);
    return res.status(500).json({ success: false, message: "Lỗi Server", error: error.message });
  }
};

module.exports = {
  getClubAnalytics
};
