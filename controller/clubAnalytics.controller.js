const mongoose = require("mongoose");
const Invoice = require("../models/invoice.model");
const Booking = require("../models/booking.model");
const BilliardTable = require("../models/billiard_table.model");
const TableType = require("../models/table_type.model");
const Service = require("../models/service.model");
const BookingService = require("../models/booking_service.model");
const Feedback = require("../models/feedback.model");
const Tournament = require("../models/tournament.model");

const getClubAnalytics = async (req, res) => {
  try {
    const { id: club_id } = req.params;
    const { startDate, endDate } = req.query;

    if (!club_id) {
      return res.status(400).json({ success: false, message: "Thiếu club_id" });
    }

    const currentClub = await require("../models/club.model").findById(club_id).lean();
    if (!currentClub) {
        return res.status(404).json({ success: false, message: "Không tìm thấy quán" });
    }

    if (currentClub.plan_type === "free") {
        return res.status(403).json({ success: false, message: "Tính năng Báo cáo doanh thu chỉ dành cho gói Basic hoặc Pro." });
    }

    // Prepare Date Range Filter
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.$gte = startDate.includes("T") ? new Date(startDate) : new Date(`${startDate}T00:00:00.000+07:00`);
      dateFilter.$lte = endDate.includes("T") ? new Date(endDate) : new Date(`${endDate}T23:59:59.999+07:00`);
    } else {
      // Default to last 30 days if no range provided
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);
      dateFilter.$gte = start;
      dateFilter.$lte = end;
    }

    const clubObjectId = new mongoose.Types.ObjectId(club_id);

    // --- 1. REVENUE & TRANSACTIONS ---
    const clubTables = await BilliardTable.find({ club_id: clubObjectId }).select("_id").lean();
    const tableIds = clubTables.map(t => t._id);

    const clubBookings = await Booking.find({ table_id: { $in: tableIds } }).select("_id").lean();
    const bookingIds = clubBookings.map(b => b._id);

    const TransactionHistory = require("../models/transiction_history.model");

    const successfulTransactions = await TransactionHistory.find({
      booking_id: { $in: bookingIds },
      status: "SUCCESS",
      transaction_time: dateFilter
    }).lean();

    const revenueByDateMap = {};
    let totalRevenue = 0;
    const paymentMixMap = { cash: 0, bank: 0 };
    const validBookingIds = new Set();

    successfulTransactions.forEach(tx => {
      const dateStr = new Date(tx.transaction_time).toISOString().split('T')[0];
      const amount = tx.amount || 0;
      
      if (!revenueByDateMap[dateStr]) {
        revenueByDateMap[dateStr] = { date: dateStr, total: 0 };
      }
      
      revenueByDateMap[dateStr].total += amount;
      totalRevenue += amount;
      
      if (tx.transaction_type === "BOOKING_FINAL_PAYMENT_CASH") {
         paymentMixMap.cash += amount;
      } else {
         paymentMixMap.bank += amount;
      }

      if (tx.booking_id) {
         validBookingIds.add(tx.booking_id.toString());
      }
    });

    const revenueTimeline = Object.values(revenueByDateMap).sort((a, b) => a.date.localeCompare(b.date));
    const validInvoiceCount = validBookingIds.size;
    let totalBookingsCount = validBookingIds.size; // Chỉ tính những đơn có giao dịch thành công là đơn hợp lệ

    // Tính tổng tiền dịch vụ từ các đơn hợp lệ
    const validBookingIdsArray = Array.from(validBookingIds);
    const validBookingServices = await BookingService.find({
      booking_id: { $in: validBookingIdsArray }
    }).lean();

    let totalServiceRevenue = 0;
    validBookingServices.forEach(s => {
      totalServiceRevenue += (s.unit_price * s.quantity);
    });
    let totalTableRevenue = totalRevenue - totalServiceRevenue;
    if (totalTableRevenue < 0) totalTableRevenue = 0;

    // --- 2. TABLE PERFORMANCE (Bàn đắt khách) ---
    // Analyze bookings within date range (Only valid bookings)
    const bookingsInRange = await Booking.find({
      _id: { $in: validBookingIdsArray }
    }).populate('table_id').lean();

    const tableStatsMap = {};
    const tableTypeStatsMap = {};
    let totalPlayMinutes = 0;

    bookingsInRange.forEach(b => {
       if (!b.table_id) return;
       const tId = b.table_id._id.toString();
       const tName = b.table_id.table_number || "Bàn ẩn";
       const tType = b.table_id.table_type_id?.toString() || "Khác";

       if (!tableStatsMap[tId]) {
         tableStatsMap[tId] = { id: tId, name: tName, revenue: 0, playMinutes: 0, typeId: tType };
       }
       if (!tableTypeStatsMap[tType]) {
         tableTypeStatsMap[tType] = { id: tType, revenue: 0, playMinutes: 0 };
       }

       const rev = b.status === "Cancelled" ? (b.deposit || 0) : (b.total_bill || 0);
       tableStatsMap[tId].revenue += rev;
       tableTypeStatsMap[tType].revenue += rev;

       // Calculate play duration in minutes
       if (b.start_time && b.end_time && b.status !== "Cancelled") {
         const toMins = (timeStr) => {
           const [h, m] = timeStr.split(':').map(Number);
           return h * 60 + m;
         };
         let mins = toMins(b.end_time) - toMins(b.start_time);
         if (mins < 0) mins += 24 * 60; // Cross midnight
         tableStatsMap[tId].playMinutes += mins;
         tableTypeStatsMap[tType].playMinutes += mins;
         totalPlayMinutes += mins;
       }
    });

    const topTables = Object.values(tableStatsMap).sort((a, b) => b.revenue - a.revenue);
    
    // Resolve Table Types names
    const typeIds = Object.keys(tableTypeStatsMap);
    const typesDocs = await TableType.find({ _id: { $in: typeIds } }).lean();
    const typeNameMap = {};
    typesDocs.forEach(t => typeNameMap[t._id.toString()] = t.name);

    const tableTypeDistribution = Object.values(tableTypeStatsMap).map(t => ({
       name: typeNameMap[t.id] || "Không xác định",
       revenue: t.revenue,
       playMinutes: t.playMinutes
    }));

    // --- 3. SERVICE PERFORMANCE (Dịch vụ bán chạy / ế) ---
    // Lấy tất cả BookingService trong các booking
    const bookingServices = await BookingService.find({
       booking_id: { $in: bookingIds },
       created_at: dateFilter
    }).populate('service_id').lean();

    const serviceStatsMap = {};
    
    // Khởi tạo map với tất cả service của quán để tìm rathành phần "ế"
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

    const serviceStatsArray = Object.values(serviceStatsMap).sort((a, b) => b.quantity - a.quantity);
    
    // Lấy top 5 bán chạy (có lượt gọi > 0)
    const topServices = serviceStatsArray.slice(0, 5).filter(s => s.quantity > 0);
    
    // Lấy danh sách ế: Lọc những món không nằm trong topServices, và lượt gọi = 0 hoặc DThu < 50k
    const topServiceIds = new Set(topServices.map(s => s.id));
    const bottomServices = [...serviceStatsArray]
       .reverse()
       .filter(s => !topServiceIds.has(s.id))
       .filter(s => s.quantity === 0 || s.revenue < 50000)
       .slice(0, 5);

    // --- 4. FEEDBACK (Đánh giá) ---
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

    // --- 5. UNPAID / DEBT (Công nợ) ---
    const unpaidInvoices = await Invoice.countDocuments({
      booking_id: { $in: bookingIds },
      status: "Unpaid"
    });

    // --- 6. TOURNAMENT STATS ---
    const tournaments = await Tournament.find({
        club_id: clubObjectId,
        created_at: dateFilter
    }).lean();

    let totalTournaments = tournaments.length;
    let totalTournamentRevenue = 0;
    let totalTournamentPlayers = 0;
    
    tournaments.forEach(t => {
       // Only count revenue for some statuses or maybe all, but let's just use what's generated.
       const fee = t.fee || 0;
       const players = t.registered_player || 0;
       totalTournamentRevenue += (fee * players);
       totalTournamentPlayers += players;
    });

    const tournamentStats = {
       totalTournaments,
       totalRevenue: totalTournamentRevenue,
       totalPlayers: totalTournamentPlayers,
       tournamentsList: tournaments.map(t => ({
           id: t._id,
           name: t.name,
           fee: t.fee,
           players: t.registered_player,
           status: t.status,
           revenue: (t.fee || 0) * (t.registered_player || 0)
       })).sort((a,b) => b.revenue - a.revenue).slice(0, 5)
    };

    // XONG TẤT CẢ DATA - TRẢ VỀ
    return res.status(200).json({
      success: true,
      data: {
        kpi: {
          totalRevenue: totalRevenue,
          totalBookings: totalBookingsCount,
          averageOrderValue: validInvoiceCount > 0
            ? Math.round(totalRevenue / validInvoiceCount)
            : 0,
          averagePlayMinutes: totalBookingsCount > 0 ? Math.round(totalPlayMinutes / totalBookingsCount) : 0,
          unpaidCount: unpaidInvoices
        },
        revenue: {
          timeline: revenueTimeline,
          breakdown: { table: totalTableRevenue, service: totalServiceRevenue },
          paymentMix: paymentMixMap
        },
        tables: {
          topList: topTables.slice(0, 10),
          typeDistribution: tableTypeDistribution
        },
        services: {
          topList: topServices,
          bottomList: bottomServices
        },
        feedback: {
          average: Number(averageRating),
          total: feedbacks.length,
          distribution: feedbackList
        },
        tournaments: tournamentStats
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
