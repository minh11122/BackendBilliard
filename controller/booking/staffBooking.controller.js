const Booking = require("../../models/booking.model");
const BilliardTable = require("../../models/billiard_table.model");
const Club = require("../../models/club.model");
const BookingService = require("../../models/booking_service.model");
const {
  notifyStaff,
  timeToMinutes,
} = require("./booking.helpers");

const checkInBooking = async (req, res) => {
  try {
    const { code_number } = req.body;
    const accountId = req.user.accountId; // ID của STAFF_CLUB
    const clubId = req.user.club_id; // ID quán của nhân viên

    if (!code_number) {
      return res
        .status(400)
        .json({ success: false, message: "Vui lòng nhập mã code_number" });
    }

    // Tìm booking
    const booking = await Booking.findOne({ code_number }).populate("table_id");

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn đặt bàn với mã này",
      });
    }

    // Chỉ cho phép check in trong quán của nhân viên đó
    if (booking.table_id.club_id.toString() !== clubId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Đơn đặt bàn này không thuộc quán của bạn",
      });
    }

    // Kiểm tra trạng thái booking
    if (booking.status !== "Booked" && booking.status !== "Pending") {
      return res.status(400).json({
        success: false,
        message: `Không thể check-in đơn đang ở trạng thái: ${booking.status}`,
      });
    }

    // Cập nhật trạng thái
    booking.status = "Playing";
    await booking.save();

    if (booking.account_id) {
      await require("../../models/notification.model").create({
        account_id: booking.account_id,
        title: "Bắt đầu giờ chơi",
        message: `Bàn ${booking.table_id?.table_number || ""} của bạn đã được check-in. Giờ chơi đã bắt đầu!`,
        link: `/my-bookings?bookingId=${booking._id}`,
        is_read: false,
      });
    }

    res.status(200).json({
      success: true,
      message: "Check-in thành công. Trạng thái đã chuyển sang Playing.",
      data: booking,
    });
  } catch (error) {
    console.error("Lỗi checkInBooking:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};


const getClubBookings = async (req, res) => {
  try {
    const clubId = req.user.club_id;
    if (!clubId) {
      return res
        .status(400)
        .json({ success: false, message: "Không xác định được club" });
    }

    const { status, date, search } = req.query;

    // Tìm tất cả bàn thuộc club
    const clubTables = await BilliardTable.find({ club_id: clubId })
      .select("_id")
      .lean();
    const tableIds = clubTables.map((t) => t._id);

    if (tableIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        statusCounts: {
          total: 0,
          Pending: 0,
          Booked: 0,
          Playing: 0,
          Completed: 0,
          Cancelled: 0,
        },
      });
    }

    // Build query
    const query = { table_id: { $in: tableIds } };

    if (status && status !== "all") {
      query.status = status;
    }

    if (date) {
      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(targetDate);
      nextDay.setDate(nextDay.getDate() + 1);
      query.play_date = { $gte: targetDate, $lt: nextDay };
    } else if (req.query.startDate && req.query.endDate) {
      query.play_date = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate),
      };
    }

    // Fetch bookings
    let bookings = await Booking.find(query)
      .populate({ path: "account_id", select: "fullname phone" })
      .populate({
        path: "table_id",
        select: "table_number table_type_id",
        populate: { path: "table_type_id", select: "name" },
      })
      .sort({ created_at: -1 })
      .lean();

    // Search filter (client-side vì populate)
    if (search && search.trim()) {
      const s = search.trim().toLowerCase();
      bookings = bookings.filter(
        (b) =>
          (b.account_id?.fullname || "").toLowerCase().includes(s) ||
          (b.account_id?.phone || "").includes(s) ||
          (b.code_number || "").toLowerCase().includes(s) ||
          (b.guest_name || "").toLowerCase().includes(s),
      );
    }

    // Đếm status counts (trên toàn bộ bookings của club, không filter statuss)
    let countQuery = { table_id: { $in: tableIds } };
    if (query.play_date) {
      countQuery.play_date = query.play_date;
    }
    const allBookingsForCounts = await Booking.find(countQuery).lean();

    const statusCounts = {
      total: allBookingsForCounts.length,
      Pending: allBookingsForCounts.filter((b) => b.status === "Pending")
        .length,
      Booked: allBookingsForCounts.filter((b) => b.status === "Booked").length,
      Playing: allBookingsForCounts.filter((b) => b.status === "Playing")
        .length,
      Completed: allBookingsForCounts.filter((b) => b.status === "Completed")
        .length,
      Cancelled: allBookingsForCounts.filter((b) => b.status === "Cancelled")
        .length,
    };

    res.status(200).json({ success: true, data: bookings, statusCounts });
  } catch (error) {
    console.error("Lỗi getClubBookings:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};



const createWalkInBooking = async (req, res) => {
  try {
    const { guest_name, table_number, play_date, start_time, end_time } =
      req.body;
    const staffId = req.user.accountId;
    const clubId = req.user.club_id;

    if (
      !guest_name ||
      !table_number ||
      !play_date ||
      !start_time ||
      !end_time
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Vui lòng nhập đầy đủ: tên khách, số bàn, ngày chơi, giờ bắt đầu, giờ kết thúc",
      });
    }

    if (!clubId) {
      return res.status(400).json({
        success: false,
        message: "Không xác định được quán của nhân viên",
      });
    }

    // Tìm bàn theo table_number trong club
    const table = await BilliardTable.findOne({
      club_id: clubId,
      table_number: table_number.trim(),
    });
    if (!table) {
      return res.status(404).json({
        success: false,
        message: `Không tìm thấy bàn số "${table_number}" trong quán`,
      });
    }

    if (table.status === "Maintenance") {
      return res.status(400).json({
        success: false,
        message: "Bàn đang bảo trì, không thể nhận khách",
      });
    }

    // Kiểm tra xem bàn có đang được đặt trong khung giờ này không
    const targetDate = new Date(play_date);
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const conflictBooking = await Booking.findOne({
      table_id: table._id,
      play_date: { $gte: targetDate, $lt: nextDay },
      status: { $in: ["Booked", "Playing"] },
    });

    if (conflictBooking) {
      return res.status(409).json({
        success: false,
        message: `Bàn số ${table_number} đã có lịch chơi trong ngày này`,
      });
    }

    // Tạo mã đơn đặt
    const codeNumber = "WI" + Date.now().toString().slice(-8);

    // Tạo booking với trạng thái Playing ngay lập tức
    const booking = await Booking.create({
      account_id: staffId, // Nhân viên tạo booking
      guest_name: guest_name.trim(),
      table_id: table._id,
      play_date: new Date(play_date),
      start_time,
      end_time,
      code_number: codeNumber,
      deposit: 0,
      hour_price: table.price || 0,
      total_bill: 0,
      note: "Walk-in - Khách đến trực tiếp",
      status: "Playing",
    });

    notifyStaff(
      clubId,
      "Khách mới",
      `Bàn ${table_number} vừa được mở cho khách ${guest_name}`,
    );

    res.status(201).json({
      success: true,
      message: `Tạo đặt bàn thành công! Bàn ${table_number} đang chơi.`,
      data: {
        ...booking.toObject(),
        table_number: table.table_number,
      },
    });
  } catch (error) {
    console.error("Lỗi createWalkInBooking:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const clubId = req.user?.club_id;

    if (!clubId) {
      return res.status(400).json({
        success: false,
        message: "Không xác định được quán của nhân viên",
      });
    }

    const booking = await Booking.findOne({ _id: id }).populate({
      path: "table_id",
      match: { club_id: clubId },
    });
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn đặt bàn",
      });
    }

    if (!booking.table_id) {
      return res.status(404).json({
        success: false,
        message: "Đơn này không thuộc quán của bạn",
      });
    }

    return res.status(200).json({ success: true, data: booking });
  } catch (error) {
    console.error("Error getBookingById:", error);
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
};


const extendBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { minutes } = req.body; // Số phút muốn cộng thêm
    const clubId = req.user.club_id;

    if (!minutes || minutes <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Số phút gia hạn không hợp lệ" });
    }

    const booking = await Booking.findOne({ _id: id }).populate({
      path: "table_id",
      match: { club_id: clubId },
    });
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy đơn đặt bàn" });
    }

    // Kiểm tra quyền hạn
    if (!booking.table_id) {
      return res
        .status(404)
        .json({ success: false, message: "Đơn này không thuộc quán của bạn" });
    }

    if (booking.status !== "Playing") {
      return res.status(400).json({
        success: false,
        message: "Chỉ có thể gia hạn cho đơn đang chơi",
      });
    }

    // Tính toán end_time mới
    let startA = timeToMinutes(booking.start_time);
    let currentEndA = timeToMinutes(booking.end_time);
    if (currentEndA <= startA) currentEndA += 24 * 60;
    
    let endA = currentEndA + parseInt(minutes);

    // Kiểm tra trùng lịch với các đơn đặt bàn khác
    const targetDate = new Date(booking.play_date);
    targetDate.setHours(0, 0, 0, 0);

    const prevDay = new Date(targetDate);
    prevDay.setDate(prevDay.getDate() - 1);

    const nextTwoDays = new Date(targetDate);
    nextTwoDays.setDate(nextTwoDays.getDate() + 2);

    const otherBookings = await Booking.find({
      table_id: booking.table_id._id || booking.table_id,
      _id: { $ne: booking._id },
      play_date: { $gte: prevDay, $lt: nextTwoDays },
      status: { $in: ["Pending", "Booked", "Playing"] },
    }).lean();

    for (const b of otherBookings) {
      const bDate = new Date(b.play_date);
      bDate.setHours(0, 0, 0, 0);

      let startB = timeToMinutes(b.start_time);
      let endB = timeToMinutes(b.end_time);

      if (bDate.getTime() < targetDate.getTime()) {
        // yesterday
        startB -= 24 * 60;
        endB -= 24 * 60;
        if (endB <= startB) endB += 24 * 60;
      } else if (bDate.getTime() > targetDate.getTime()) {
        // tomorrow
        startB += 24 * 60;
        endB += 24 * 60;
        if (endB <= startB) endB += 24 * 60;
      } else {
        // today
        if (endB <= startB) endB += 24 * 60;
      }

      // Check overlap
      if (startA < endB && endA > startB) {
        return res.status(409).json({
          success: false,
          message: `Không thể gia hạn vì bị trùng với đơn đặt bàn lúc ${b.start_time}. Khách sau sắp tới.`,
        });
      }
    }

    const checkClub = await Club.findById(clubId).select("opening_time closing_time").lean();
    if (checkClub && checkClub.closing_time) {
      const is24h = checkClub.opening_time === "00:00" && checkClub.closing_time === "00:00";
      if (!is24h) {
        let cParts = checkClub.closing_time.split(":");
        let closeMin = parseInt(cParts[0]) * 60 + parseInt(cParts[1]);
        let oParts = (checkClub.opening_time || "08:00").split(":");
        let openMin = parseInt(oParts[0]) * 60 + parseInt(oParts[1]);
        
        let durationSinceOpen = (currentEndA - openMin + 24 * 60) % (24 * 60);
        let newDurationSinceOpen = durationSinceOpen + parseInt(minutes);
        let validDuration = (closeMin - openMin + 24 * 60) % (24 * 60);
        
        if (validDuration === 0) validDuration = 24 * 60;
        
        if (newDurationSinceOpen > validDuration) {
          return res.status(400).json({
            success: false,
            message: `Không thể gia hạn. Giờ đóng cửa của quán là ${checkClub.closing_time}`
          });
        }
      }
    }

    // Format lại HH:mm (xử lý qua ngày nếu cần, nhưng booking model lưu String HH:mm)
    const newH = Math.floor(endA / 60) % 24;
    const newM = endA % 60;
    const newEndTime = `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;

    // Cập nhật tổng tiền (tính thêm tiền cho phần gia hạn)
    const extraHours = minutes / 60;
    const extraCost = Math.round(extraHours * booking.hour_price);

    const nowStr = new Date().toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    booking.end_time = newEndTime;
    booking.total_bill = (booking.total_bill || 0) + extraCost;
    booking.note =
      (booking.note || "") + ` [Gia hạn +${minutes}ph lúc ${nowStr}]`;

    await booking.save();

    notifyStaff(
      clubId,
      "Gia hạn bàn",
      `Bàn ${booking.table_id.table_number} đã gia hạn thêm ${minutes} phút`,
    );

    res.status(200).json({
      success: true,
      message: `Gia hạn thành công thêm ${minutes} phút`,
      data: {
        end_time: booking.end_time,
        total_bill: booking.total_bill,
      },
    });
  } catch (error) {
    console.error("Lỗi extendBooking:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};


const changeTable = async (req, res) => {
  try {
    const { id } = req.params;
    const { new_table_id } = req.body;
    const clubId = req.user.club_id;
    const staffId = req.user.accountId;

    if (!new_table_id) {
      return res
        .status(400)
        .json({ success: false, message: "Vui lòng chọn bàn mới" });
    }

    const oldBooking = await Booking.findOne({ _id: id }).populate({
      path: "table_id",
      match: { club_id: clubId },
    });
    if (!oldBooking)
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy đơn" });

    if (!oldBooking.table_id) {
      return res
        .status(404)
        .json({ success: false, message: "Đơn này không thuộc quán của bạn" });
    }

    if (oldBooking.status !== "Playing") {
      return res
        .status(400)
        .json({ success: false, message: "Chỉ có thể đổi bàn khi đang chơi" });
    }

    const newTable = await BilliardTable.findOne({ _id: new_table_id, club_id: clubId });
    if (!newTable) {
      return res
        .status(404)
        .json({ success: false, message: "Bàn mới không khả dụng" });
    }
    if (newTable.status !== "Available") {
      return res
        .status(400)
        .json({ success: false, message: "Bàn mới đang không trống" });
    }

    const oldTableId = oldBooking.table_id._id;
    const oldTableNumber = oldBooking.table_id.table_number;

    if (oldBooking.table_id.table_type_id.toString() !== newTable.table_type_id.toString()) {
      return res
        .status(400)
        .json({ success: false, message: "Chỉ được phép đổi sang bàn cùng loại" });
    }

    // 1. Chốt đơn bàn cũ tại thời điểm hiện tại
    const now = new Date();
    const endH = now.getHours();
    const endM = now.getMinutes();
    const realEndTimeStr = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
    const scheduledEndStr = oldBooking.end_time;

    // KIỂM TRA TRÙNG LỊCH BÀN MỚI
    const targetDate = new Date(now);
    targetDate.setHours(0, 0, 0, 0);

    const prevDay = new Date(targetDate);
    prevDay.setDate(prevDay.getDate() - 1);

    const nextTwoDays = new Date(targetDate);
    nextTwoDays.setDate(nextTwoDays.getDate() + 2);

    const otherBookings = await Booking.find({
      table_id: new_table_id,
      play_date: { $gte: prevDay, $lt: nextTwoDays },
      status: { $in: ["Pending", "Booked", "Playing"] },
    }).lean();

    let startA = timeToMinutes(realEndTimeStr);
    let endA = timeToMinutes(scheduledEndStr);
    if (endA <= startA) endA += 24 * 60;

    for (const b of otherBookings) {
      const bDate = new Date(b.play_date);
      bDate.setHours(0, 0, 0, 0);

      let startB = timeToMinutes(b.start_time);
      let endB = timeToMinutes(b.end_time);

      if (bDate.getTime() < targetDate.getTime()) {
        startB -= 24 * 60;
        endB -= 24 * 60;
        if (endB <= startB) endB += 24 * 60;
      } else if (bDate.getTime() > targetDate.getTime()) {
        startB += 24 * 60;
        endB += 24 * 60;
        if (endB <= startB) endB += 24 * 60;
      } else {
        if (endB <= startB) endB += 24 * 60;
      }

      if (startA < endB && endA > startB) {
        return res.status(409).json({
          success: false,
          message: `Không thể đổi sang bàn ${newTable.table_number} do trùng lịch với đơn khác bắt đầu lúc ${b.start_time}.`,
        });
      }
    }

    let endMin = timeToMinutes(realEndTimeStr); // Tính tiền bàn cũ theo giờ thực tế chuyển
    const startMin = timeToMinutes(oldBooking.start_time);
    
    const playDate = new Date(oldBooking.play_date);
    playDate.setHours(0, 0, 0, 0);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    if (today.getTime() > playDate.getTime()) {
      endMin += 24 * 60;
    } else if (endMin < startMin) {
      endMin = startMin;
    }

    const durationHours = (endMin - startMin) / 60;
    const playCost = Math.round(durationHours * (oldBooking.hour_price || 0));

    // Tính tổng dịch vụ
    const BookingService = require("../../models/booking_service.model");
    const oldServices = await BookingService.find({
      booking_id: oldBooking._id,
    });
    const serviceTotal = oldServices.reduce(
      (sum, s) => sum + s.unit_price * s.quantity,
      0,
    );

    oldBooking.actual_end_time = realEndTimeStr;
    const computedTotalOld = playCost + serviceTotal;
    const oldCarryOver = Number(oldBooking.carry_over_amount || 0);
    const totalToTransfer = computedTotalOld + oldCarryOver;
    const depositToTransfer = Number(oldBooking.deposit || 0);

    oldBooking.total_bill = 0; // Để tránh tính doanh thu 2 lần
    oldBooking.deposit = 0;
    oldBooking.status = "Completed";
    oldBooking.note =
      (oldBooking.note || "") +
      ` [Chuyển bàn: Đã chuyển ${totalToTransfer}đ và cọc ${depositToTransfer}đ sang bàn ${newTable.table_number}]`;
    await oldBooking.save();

    await BilliardTable.findByIdAndUpdate(oldTableId, {
      status: "Available",
    });

    // 2. Tạo đơn bàn mới
    const codeNumber = "WI" + Date.now().toString().slice(-8);

    const newBooking = await Booking.create({
      account_id: oldBooking.account_id,
      guest_name: oldBooking.guest_name,
      table_id: newTable._id,
      play_date: now,
      start_time: realEndTimeStr, // Bắt đầu từ giờ chuyển bàn
      end_time: scheduledEndStr, // Kết thúc bằng đúng giờ kết thúc ban đầu
      code_number: codeNumber,
      deposit: depositToTransfer,
      hour_price: newTable.price || 0, // <-- Lấy giá của bàn mới
      total_bill: 0,
      carry_over_amount: totalToTransfer,
      note: `Đổi đến từ bàn ${oldTableNumber}. Mang theo ${totalToTransfer}đ từ bàn cũ.`,
      status: "Playing",
    });

    notifyStaff(
      clubId,
      "Đổi bàn",
      `Bàn ${oldTableNumber} đã chuyển sang Bàn ${newTable.table_number}`,
    );

    res.status(200).json({
      success: true,
      message: "Đổi bàn thành công",
      data: newBooking,
    });
  } catch (error) {
    console.error("Lỗi changeTable:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

module.exports = {
  checkInBooking,
  getClubBookings,
  createWalkInBooking,
  getBookingById,
  extendBooking,
  changeTable,
};
