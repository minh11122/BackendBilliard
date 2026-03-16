const Booking = require("../models/booking.model");
const BilliardTable = require("../models/billiard_table.model");
const Club = require("../models/club.model");
const Parameter = require("../models/parameter.model");
const ClubBank = require("../models/club_bank.model");
const payosService = require("../services/payos.service");

const HOLD_MINUTES = 10;
const PAYOS_EXPIRE_MINUTES = 5;

// Helper to compare times "HH:mm"
const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
};

// Tạo booking + giữ chỗ bàn
const createBooking = async (req, res) => {
  try {
    const { table_id, club_id, play_date, start_time, end_time, duration } = req.body;
    const accountId = req.user.accountId;

    if (!table_id || !play_date || !start_time || !end_time) {
      return res.status(400).json({ success: false, message: "Thiếu thông tin đặt bàn" });
    }

    // Kiểm tra bàn có tồn tại không
    const table = await BilliardTable.findById(table_id).populate("table_type_id");
    if (!table) {
      return res.status(404).json({ success: false, message: "Không tìm thấy bàn" });
    }

    if (table.status === "Maintenance") {
      return res.status(400).json({ success: false, message: "Bàn đang bảo trì" });
    }

    // --- Slot-aware availability check (Spill-over logic) ---
    const reqStartMin = timeToMinutes(start_time);
    const reqDuration = parseInt(duration) || 2;
    const reqEndMin = reqStartMin + reqDuration * 60;
    
    const targetDate = new Date(play_date);
    targetDate.setHours(0, 0, 0, 0);

    const prevDay = new Date(targetDate);
    prevDay.setDate(prevDay.getDate() - 1);

    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Fetch bookings from target date AND previous day
    const bookings = await Booking.find({
      table_id,
      play_date: { $gte: prevDay, $lt: nextDay },
      status: { $in: ["Pending", "Booked", "Playing"] }
    }).lean();

    for (const b of bookings) {
      const bDate = new Date(b.play_date);
      bDate.setHours(0, 0, 0, 0);
      
      let bStart = timeToMinutes(b.start_time);
      let bEnd = timeToMinutes(b.end_time);

      let conflict = false;

      if (bDate < targetDate) {
        // Yesterday's booking: check if it ends today
        if (bEnd <= bStart && reqStartMin < bEnd) {
          conflict = true;
        }
      } else {
        // Today's booking
        if (bEnd <= bStart) bEnd += 24 * 60;
        if (bStart < reqEndMin && bEnd > reqStartMin) {
          conflict = true;
        }
      }

      if (conflict) {
        // Nếu là đơn đã thanh toán hoặc đang chơi -> Chắn chắn bận
        if (b.status === "Booked" || b.status === "Playing") {
          return res.status(409).json({ success: false, message: "Khung giờ này đã có người đặt" });
        }
        
        // Nếu là đơn Pending -> Kiểm tra xem còn hiệu lực giữ chỗ không
        if (b.status === "Pending") {
          if (table.status === "Holding" && table.held_until && new Date(table.held_until) > new Date()) {
             // Chỉ chặn nếu người đang giữ KHÔNG phải là user hiện tại
             if (String(b.account_id) !== String(accountId)) {
               return res.status(409).json({ success: false, message: "Bàn đang được giữ chỗ bởi người khác trong khung giờ này" });
             }
          }
        }
      }
    }

    // Lấy tỷ lệ cọc từ Parameter (mặc định 30%)
    let depositPercent = 30;
    try {
      const param = await Parameter.findOne();
      if (param && param.booking_percent) {
        depositPercent = param.booking_percent;
      }
    } catch (e) {
      console.warn("Không lấy được booking_percent, dùng mặc định 30%");
    }

    const hourPrice = table.price;
    const totalHours = duration || 2;
    const totalBill = hourPrice * totalHours;

    // depositPercent có thể là 0.3 (tức 30%) hoặc 30 — chuẩn hoá
    const depositRate = depositPercent > 1 ? depositPercent / 100 : depositPercent;
    const deposit = Math.round(totalBill * depositRate);
    const displayPercent = Math.round(depositRate * 100); // Hiển thị: 30

    // Tạo mã đơn đặt
    const codeNumber = "BK" + Date.now().toString().slice(-8);

    // Tạo booking
    const booking = await Booking.create({
      account_id: accountId,
      table_id,
      play_date: new Date(play_date),
      start_time,
      end_time,
      code_number: codeNumber,
      deposit,
      hour_price: hourPrice,
      total_bill: totalBill,
      status: "Pending"
    });

    // Cập nhật trạng thái bàn sang Holding
    const heldUntil = new Date(Date.now() + HOLD_MINUTES * 60 * 1000);
    await BilliardTable.findByIdAndUpdate(table_id, {
      status: "Holding",
      held_by: accountId,
      held_until: heldUntil
    });

    // Lấy thông tin club
    const club = club_id ? await Club.findById(club_id).lean() : null;

    res.status(201).json({
      success: true,
      message: "Đặt bàn thành công, vui lòng thanh toán tiền cọc",
      data: {
        booking: {
          ...booking.toObject(),
          depositPercent: displayPercent,
          totalBill,
          deposit
        },
        table: {
          _id: table._id,
          table_number: table.table_number,
          table_type: table.table_type_id?.name || "Pool",
          price: table.price
        },
        club: club ? {
          _id: club._id,
          name: club.name,
          address: club.address
        } : null,
        holdMinutes: HOLD_MINUTES,
        heldUntil
      }
    });
  } catch (error) {
    console.error("Lỗi createBooking:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// Huỷ giữ chỗ (khi người dùng xác nhận rời trang)
const cancelHold = async (req, res) => {
  try {
    const { id } = req.params;
    const accountId = req.user.accountId;

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Không tìm thấy đơn đặt bàn" });
    }

    // Chỉ cho phép người tạo booking hủy
    if (String(booking.account_id) !== String(accountId)) {
      return res.status(403).json({ success: false, message: "Bạn không có quyền hủy đơn này" });
    }

    // Chuyển bàn về Available (vẫn giữ booking ở trạng thái Pending để có thể quay lại thanh toán)
    await BilliardTable.findByIdAndUpdate(booking.table_id, {
      status: "Available",
      held_by: null,
      held_until: null
    });

    // Cập nhật booking
    booking.status = "Cancelled";
    await booking.save();

    res.status(200).json({
      success: true,
      message: "Đã hủy giữ chỗ, bàn đã được trả về trạng thái trống"
    });
  } catch (error) {
    console.error("Lỗi cancelHold:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// Lấy danh sách booking của user hiện tại
const getMyBookings = async (req, res) => {
  try {
    const accountId = req.user.accountId;

    const bookings = await Booking.find({ account_id: accountId })
      .populate({
        path: "table_id",
        populate: { path: "table_type_id" }
      })
      .sort({ created_at: -1 })
      .lean();

    // Enrich với thông tin club + auto-cancel expired
    const Image = require("../models/image.model");
    const enriched = await Promise.all(bookings.map(async (b) => {
      const table = b.table_id;
      if (table) {
        // Auto-cancel nếu Pending và bàn đã hết hạn giữ chỗ
        if (b.status === "Pending" && table.held_until && new Date(table.held_until) <= new Date()) {
          await Booking.findByIdAndUpdate(b._id, { status: "Cancelled" });
          await BilliardTable.findByIdAndUpdate(table._id, {
            status: "Available", held_by: null, held_until: null
          });
          b.status = "Cancelled";
        }

        const club = await Club.findById(table.club_id).lean();
        const banner = await Image.findOne({ club_id: table.club_id, image_type: "Banner" }).lean();
        b.club = club ? {
          _id: club._id,
          name: club.name,
          address: club.address,
          avatar: banner?.image_url || null
        } : null;
        b.table_info = {
          table_number: table.table_number,
          table_type: table.table_type_id?.name || "Pool",
          price: table.price
        };
        // Truyền held_until cho frontend
        b.held_until = table.held_until || null;
      }
      return b;
    }));

    res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    console.error("Lỗi getMyBookings:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// Nhân viên check-in booking bằng mã code_number
const checkInBooking = async (req, res) => {
  try {
    const { code_number } = req.body;
    const accountId = req.user.accountId; // ID của STAFF_CLUB
    const clubId = req.user.club_id; // ID quán của nhân viên

    if (!code_number) {
      return res.status(400).json({ success: false, message: "Vui lòng nhập mã code_number" });
    }

    // Tìm booking
    const booking = await Booking.findOne({ code_number })
      .populate("table_id");

    if (!booking) {
      return res.status(404).json({ success: false, message: "Không tìm thấy đơn đặt bàn với mã này" });
    }

    // Chỉ cho phép check in trong quán của nhân viên đó
    if (booking.table_id.club_id.toString() !== clubId.toString()) {
      return res.status(403).json({ success: false, message: "Đơn đặt bàn này không thuộc quán của bạn" });
    }

    // Kiểm tra trạng thái booking
    if (booking.status !== "Booked" && booking.status !== "Pending") {
      return res.status(400).json({ success: false, message: `Không thể check-in đơn đang ở trạng thái: ${booking.status}` });
    }

    // Cập nhật trạng thái
    booking.status = "Playing";
    await booking.save();

    res.status(200).json({
      success: true,
      message: "Check-in thành công. Trạng thái đã chuyển sang Playing.",
      data: booking
    });
  } catch (error) {
    console.error("Lỗi checkInBooking:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// Lấy danh sách bookings của club (dành cho staff / owner)
const getClubBookings = async (req, res) => {
  try {
    const clubId = req.user.club_id;
    if (!clubId) {
      return res.status(400).json({ success: false, message: "Không xác định được club" });
    }

    const { status, date, search } = req.query;

    // Tìm tất cả bàn thuộc club
    const clubTables = await BilliardTable.find({ club_id: clubId }).select("_id").lean();
    const tableIds = clubTables.map(t => t._id);

    if (tableIds.length === 0) {
      return res.status(200).json({ success: true, data: [], statusCounts: { total: 0, Pending: 0, Booked: 0, Playing: 0, Completed: 0, Cancelled: 0 } });
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
    }

    // Fetch bookings
    let bookings = await Booking.find(query)
      .populate({ path: "account_id", select: "fullname phone" })
      .populate({ path: "table_id", select: "table_number table_type_id", populate: { path: "table_type_id", select: "name" } })
      .sort({ created_at: -1 })
      .lean();

    // Search filter (client-side vì populate)
    if (search && search.trim()) {
      const s = search.trim().toLowerCase();
      bookings = bookings.filter(b =>
        (b.account_id?.fullname || "").toLowerCase().includes(s) ||
        (b.account_id?.phone || "").includes(s) ||
        (b.code_number || "").toLowerCase().includes(s)
      );
    }

    // Đếm status counts (trên toàn bộ bookings của club, không filter)
    const allBookingsForCounts = date
      ? await Booking.find({ table_id: { $in: tableIds }, play_date: query.play_date }).lean()
      : await Booking.find({ table_id: { $in: tableIds } }).lean();

    const statusCounts = {
      total: allBookingsForCounts.length,
      Pending: allBookingsForCounts.filter(b => b.status === "Pending").length,
      Booked: allBookingsForCounts.filter(b => b.status === "Booked").length,
      Playing: allBookingsForCounts.filter(b => b.status === "Playing").length,
      Completed: allBookingsForCounts.filter(b => b.status === "Completed").length,
      Cancelled: allBookingsForCounts.filter(b => b.status === "Cancelled").length,
    };

    res.status(200).json({ success: true, data: bookings, statusCounts });
  } catch (error) {
    console.error("Lỗi getClubBookings:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// Xác nhận thanh toán đặt bàn (chuyển từ Pending -> Booked)
const confirmPayment = async (req, res) => {
  try {
    const { id } = req.params;
    
    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Không tìm thấy đơn đặt bàn" });
    }

    if (booking.status !== "Pending") {
      return res.status(400).json({ 
        success: false, 
        message: `Không thể xác nhận thanh toán đơn đang ở trạng thái: ${booking.status}` 
      });
    }

    // Cập nhật trạng thái booking
    booking.status = "Booked";
    await booking.save();

    // Cập nhật trạng thái bàn về Available (giải phóng Holding)
    await BilliardTable.findByIdAndUpdate(booking.table_id, {
      status: "Available",
      held_by: null,
      held_until: null
    });

    res.status(200).json({
      success: true,
      message: "Xác nhận thanh toán thành công",
      data: booking
    });
  } catch (error) {
    console.error("Lỗi confirmPayment:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// Create PayOS payment link for booking deposit (Pending -> payment link, webhook will set Booked)
const createBookingPayOSPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const accountId = req.user?.accountId;

    const booking = await Booking.findById(id).populate("table_id");
    if (!booking) {
      return res.status(404).json({ success: false, message: "Không tìm thấy đơn đặt bàn" });
    }

    if (!accountId || String(booking.account_id) !== String(accountId)) {
      return res.status(403).json({ success: false, message: "Bạn không có quyền thanh toán đơn này" });
    }

    if (booking.status !== "Pending") {
      return res.status(400).json({ success: false, message: `Đơn đang ở trạng thái: ${booking.status}` });
    }

    const table = booking.table_id;
    if (!table) {
      return res.status(400).json({ success: false, message: "Đơn đặt thiếu thông tin bàn" });
    }

    const clubId = table.club_id;
    const bank = await ClubBank.findOne({ club_id: clubId }).lean();
    if (!bank || !bank.payos_client_id || !bank.payos_api_key || !bank.payos_checksum_key) {
      return res.status(400).json({
        success: false,
        message: "CLB chưa thiết lập PayOS (Client ID / API Key / Checksum Key)"
      });
    }

    const orderCode = Date.now();
    const expiredAt = Math.floor((Date.now() + PAYOS_EXPIRE_MINUTES * 60 * 1000) / 1000);

    const description = `Coc booking ${booking.code_number}`;

    // Lưu transaction history cho booking
    await require("../models/transiction_history.model").create({
      account_id: booking.account_id,
      booking_id: booking._id,
      order_code: orderCode,
      amount: booking.deposit,
      description,
      transaction_type: "BOOKING_DEPOSIT",
      transaction_time: new Date(),
      status: "PENDING"
    });

    const paymentData = {
      orderCode,
      amount: booking.deposit,
      description,
      returnUrl: "http://localhost:5173/my-bookings",
      cancelUrl: "http://localhost:5173/my-bookings",
      expiredAt
    };

    const paymentLink = await payosService.createPaymentLink(paymentData, {
      clientId: bank.payos_client_id,
      apiKey: bank.payos_api_key,
      checksumKey: bank.payos_checksum_key
    });

    return res.status(200).json({
      success: true,
      message: "Tạo mã PayOS thành công",
      data: {
        orderCode,
        checkoutUrl: paymentLink.checkoutUrl,
        qrCode: paymentLink.qrCode || null,
        paymentLinkId: paymentLink.paymentLinkId || paymentLink.id || null,
        expiredAt: paymentLink.expiredAt || expiredAt
      }
    });
  } catch (error) {
    console.error("Lỗi createBookingPayOSPayment:", error);
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// PayOS webhook: verify signature (by club checksumKey) then set booking Booked
const payosWebhook = async (req, res) => {
  try {
    const payload = req.body;
    const orderCode = payload?.data?.orderCode;
    if (!orderCode) {
      return res.status(400).json({ success: false, message: "Thiếu orderCode" });
    }

    const TransactionHistory = require("../models/transiction_history.model");
    const tx = await TransactionHistory.findOne({ order_code: orderCode }).lean();
    if (!tx || !tx.booking_id) {
      return res.status(404).json({ success: false, message: "Không tìm thấy booking theo orderCode" });
    }

    const booking = await Booking.findById(tx.booking_id).populate("table_id");
    if (!booking) {
      return res.status(404).json({ success: false, message: "Không tìm thấy booking" });
    }

    const table = booking.table_id;
    const clubId = table?.club_id;
    const bank = await ClubBank.findOne({ club_id: clubId }).lean();
    if (!bank || !bank.payos_client_id || !bank.payos_api_key || !bank.payos_checksum_key) {
      return res.status(400).json({ success: false, message: "CLB thiếu cấu hình PayOS" });
    }

    // Verify webhook signature
    let webhookData;
    try {
      webhookData = await payosService.verifyWebhook(payload, {
        clientId: bank.payos_client_id,
        apiKey: bank.payos_api_key,
        checksumKey: bank.payos_checksum_key
      });
    } catch (e) {
      console.error("PayOS webhook verify failed:", e?.message || e);
      return res.status(400).json({ success: false, message: "Webhook không hợp lệ" });
    }

    // Only handle paid events
    const status = webhookData?.data?.code || webhookData?.data?.status || webhookData?.data?.paymentStatus;
    // PayOS typically returns data.code === '00' for success in webhook payload.
    const isPaid = webhookData?.data?.code === "00" || payload?.data?.code === "00" || payload?.success === true;

    if (!isPaid) {
      return res.status(200).json({ success: true, message: "Webhook received (not paid)" });
    }

    if (booking.status === "Booked") {
      return res.status(200).json({ success: true, message: "Already booked" });
    }

    booking.status = "Booked";
    await booking.save();

    await TransactionHistory.findOneAndUpdate(
      { order_code: orderCode },
      { status: "SUCCESS" }
    );

    // Release holding
    await BilliardTable.findByIdAndUpdate(booking.table_id._id || booking.table_id, {
      status: "Available",
      held_by: null,
      held_until: null
    });

    return res.status(200).json({ success: true, message: "Updated booking to Booked" });
  } catch (error) {
    console.error("Lỗi payosWebhook:", error);
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// Xác thực thanh toán PayOS cho booking (dùng khi redirect về frontend)
const verifyBookingPayOSPayment = async (req, res) => {
  try {
    const { orderCode } = req.body;
    if (!orderCode) {
      return res.status(400).json({ success: false, message: "Thiếu orderCode" });
    }

    const TransactionHistory = require("../models/transiction_history.model");
    const tx = await TransactionHistory.findOne({ order_code: orderCode }).lean();
    if (!tx || !tx.booking_id) {
      return res.status(404).json({ success: false, message: "Không tìm thấy đơn đặt bàn với orderCode này" });
    }

    const booking = await Booking.findById(tx.booking_id).populate("table_id");
    if (!booking) {
      return res.status(404).json({ success: false, message: "Không tìm thấy đơn đặt bàn" });
    }

    if (booking.status === "Booked") {
      return res.status(200).json({ success: true, message: "Đơn đã được xác nhận trước đó", data: booking });
    }

    const table = booking.table_id;
    const clubId = table?.club_id;
    const bank = await ClubBank.findOne({ club_id: clubId }).lean();
    if (!bank || !bank.payos_client_id || !bank.payos_api_key || !bank.payos_checksum_key) {
      return res.status(400).json({ success: false, message: "CLB chưa cấu hình PayOS" });
    }

    const paymentInfo = await payosService.getPaymentInfo(orderCode, {
      clientId: bank.payos_client_id,
      apiKey: bank.payos_api_key,
      checksumKey: bank.payos_checksum_key
    });

    if (paymentInfo.status !== "PAID") {
      return res.status(400).json({ success: false, message: "Thanh toán chưa hoàn tất" });
    }

    booking.status = "Booked";
    await booking.save();

    await TransactionHistory.findOneAndUpdate(
      { order_code: orderCode },
      { status: "SUCCESS" }
    );

    await BilliardTable.findByIdAndUpdate(table._id, {
      status: "Available",
      held_by: null,
      held_until: null
    });

    return res.status(200).json({
      success: true,
      message: "Xác thực thanh toán thành công",
      data: booking
    });
  } catch (error) {
    console.error("Lỗi verifyBookingPayOSPayment:", error);
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

module.exports = {
  createBooking,
  cancelHold,
  getMyBookings,
  checkInBooking,
  getClubBookings,
  confirmPayment,
  createBookingPayOSPayment,
  payosWebhook,
  verifyBookingPayOSPayment
};
