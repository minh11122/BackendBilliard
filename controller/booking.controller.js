const Booking = require("../models/booking.model");
const BilliardTable = require("../models/billiard_table.model");
const Club = require("../models/club.model");
const Parameter = require("../models/parameter.model");
const ClubBank = require("../models/club_bank.model");
const BookingService = require("../models/booking_service.model");
const Service = require("../models/service.model");
const payosService = require("../services/payos.service");
const Notification = require("../models/notification.model");

// Cấu hình thời gian giữ chỗ (phút) - Bạn có thể chỉnh ở đây để test nhanh
const HOLD_MINUTES_OVERRIDE = 2;
const PAYOS_EXPIRE_MINUTES = 5;

// Helper to push notifications to all specific club staff
const notifyStaff = async (club_id, title, message) => {
  try {
    const StaffClub = require("../models/staff_club.model");
    const Notification = require("../models/notification.model");
    const staffs = await StaffClub.find({ club_id, status: "Active" });
    if (staffs.length > 0) {
      const notifs = staffs.map((s) => ({
        account_id: s.account_id,
        title,
        message,
        is_read: false,
      }));
      await Notification.insertMany(notifs);
    }
  } catch (err) {
    console.error("Notify error:", err);
  }
};

// Create invoice (idempotent) when a booking is finalized
const ensureInvoiceForBooking = async ({
  booking,
  bookingServices = [],
  tableCost,
  totalService,
  paymentMethod,
}) => {
  const Invoice = require("../models/invoice.model");
  const InvoiceDetail = require("../models/invoice_detail.model");

  if (!booking?._id) return null;

  const existing = await Invoice.findOne({ booking_id: booking._id }).lean();
  if (existing) return existing;

  const invoice_number = `INV-${String(booking._id).slice(-6)}-${Date.now()}`;
  const invoice_date = new Date();

  const invoice = await Invoice.create({
    booking_id: booking._id,
    table_cost: Number(tableCost || 0),
    total_service: Number(totalService || 0),
    invoice_number,
    invoice_date,
    payment_method: paymentMethod, // "payOS" | "Cash"
    status: "Paid",
    note: "",
  });

  if (Array.isArray(bookingServices) && bookingServices.length > 0) {
    const details = bookingServices.map((bs) => ({
      invoice_id: invoice._id,
      booking_service_id: bs._id,
      unit_price: Number(bs.unit_price || 0),
      quantity: Number(bs.quantity || 0),
    }));
    await InvoiceDetail.insertMany(details);
  }

  return invoice;
};

// Helper to compare times "HH:mm"
const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
};

// Tạo booking + giữ chỗ bàn
const createBooking = async (req, res) => {
  try {
    const { table_id, club_id, play_date, start_time, end_time, duration } =
      req.body;
    const accountId = req.user.accountId;

    if (!table_id || !play_date || !start_time || !end_time) {
      return res
        .status(400)
        .json({ success: false, message: "Thiếu thông tin đặt bàn" });
    }

    // Kiểm tra bàn có tồn tại không
    const table =
      await BilliardTable.findById(table_id).populate("table_type_id");
    if (!table) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy bàn" });
    }

    if (table.status === "Maintenance") {
      return res
        .status(400)
        .json({ success: false, message: "Bàn đang bảo trì" });
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
      status: { $in: ["Pending", "Booked", "Playing"] },
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
          return res
            .status(409)
            .json({ success: false, message: "Khung giờ này đã có người đặt" });
        }

        // Nếu là đơn Pending -> Kiểm tra xem còn hiệu lực giữ chỗ không
        if (b.status === "Pending") {
          if (
            table.status === "Holding" &&
            table.held_until &&
            new Date(table.held_until) > new Date()
          ) {
            // Chỉ chặn nếu người đang giữ KHÔNG phải là user hiện tại
            if (String(b.account_id) !== String(accountId)) {
              return res.status(409).json({
                success: false,
                message:
                  "Bàn đang được giữ chỗ bởi người khác trong khung giờ này",
              });
            }
          }
        }
      }
    }

    // Lấy cấu hình từ Parameter
    let depositPercent = 30;
    try {
      const param = await Parameter.findOne();
      if (param) {
        if (param.booking_percent) depositPercent = param.booking_percent;
        if (param.hold_minutes) HOLD_MINUTES = param.hold_minutes;
      }
    } catch (e) {
      console.warn("Không lấy được Parameter, dùng mặc định");
    }

    // Override bằng cấu hình riêng của Club (nếu có)
    const clubInfo = await Club.findById(table.club_id).lean();
    if (
      clubInfo &&
      clubInfo.deposit_percentage !== undefined &&
      clubInfo.deposit_percentage !== null
    ) {
      depositPercent = clubInfo.deposit_percentage;
    }

    const hourPrice = table.price;
    const totalHours = duration || 2;
    const totalBill = hourPrice * totalHours;

    // depositPercent có thể là 0.3 (tức 30%) hoặc 30 — chuẩn hoá
    const depositRate =
      depositPercent > 1 ? depositPercent / 100 : depositPercent;
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
      status: "Pending",
    });

    // Tính toán thời gian giữ chỗ
    let finalHoldMinutes = HOLD_MINUTES_OVERRIDE || 5;

    // Nếu không có override ở code, mới lấy từ DB
    if (!HOLD_MINUTES_OVERRIDE) {
      try {
        const param = await Parameter.findOne();
        if (param && param.hold_minutes) finalHoldMinutes = param.hold_minutes;
      } catch (e) {
        console.warn("Không lấy được Parameter, dùng mặc định 5 phút");
      }
    }

    const heldUntil = new Date(Date.now() + finalHoldMinutes * 60 * 1000);
    await BilliardTable.findByIdAndUpdate(table_id, {
      status: "Holding",
      held_by: accountId,
      held_until: heldUntil,
    });

    // Lấy thông tin club
    const club =
      clubInfo || (club_id ? await Club.findById(club_id).lean() : null);

    res.status(201).json({
      success: true,
      message: "Đặt bàn thành công, vui lòng thanh toán tiền cọc",
      data: {
        booking: {
          ...booking.toObject(),
          depositPercent: displayPercent,
          totalBill,
          deposit,
        },
        table: {
          _id: table._id,
          table_number: table.table_number,
          table_type: table.table_type_id?.name || "Pool",
          price: table.price,
        },
        club: club
          ? {
              _id: club._id,
              name: club.name,
              address: club.address,
            }
          : null,
        holdMinutes: finalHoldMinutes,
        heldUntil,
      },
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
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy đơn đặt bàn" });
    }

    // Chỉ cho phép người tạo booking hủy
    if (String(booking.account_id) !== String(accountId)) {
      return res
        .status(403)
        .json({ success: false, message: "Bạn không có quyền hủy đơn này" });
    }

    // Chuyển bàn về Available (vẫn giữ booking ở trạng thái Pending để có thể quay lại thanh toán)
    await BilliardTable.findByIdAndUpdate(booking.table_id, {
      status: "Available",
      held_by: null,
      held_until: null,
    });

    // Cập nhật booking
    booking.status = "Cancelled";
    await booking.save();

    res.status(200).json({
      success: true,
      message: "Đã hủy giữ chỗ, bàn đã được trả về trạng thái trống",
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
        populate: { path: "table_type_id" },
      })
      .sort({ created_at: -1 })
      .lean();

    // Enrich với thông tin club + auto-cancel expired + feedback status
    const Image = require("../models/image.model");
    const Feedback = require("../models/feedback.model");
    const enriched = await Promise.all(
      bookings.map(async (b) => {
        const table = b.table_id;
        if (table) {
          // Auto-cancel nếu Pending và bàn đã hết hạn giữ chỗ
          if (
            b.status === "Pending" &&
            table.held_until &&
            new Date(table.held_until) <= new Date()
          ) {
            await Booking.findByIdAndUpdate(b._id, { status: "Cancelled" });
            await BilliardTable.findByIdAndUpdate(table._id, {
              status: "Available",
              held_by: null,
              held_until: null,
            });
            b.status = "Cancelled";
          }

          const club = await Club.findById(table.club_id).lean();
          const banner = await Image.findOne({
            club_id: table.club_id,
            image_type: "Banner",
          }).lean();
          b.club = club
            ? {
                _id: club._id,
                name: club.name,
                address: club.address,
                avatar: banner?.image_url || null,
              }
            : null;
          b.table_info = {
            table_number: table.table_number,
            table_type: table.table_type_id?.name || "Pool",
            price: table.price,
          };
          // Truyền held_until cho frontend
          b.held_until = table.held_until || null;
        }

        // Attach feedback status for Completed bookings
        if (b.status === "Completed") {
          const fb = await Feedback.findOne({ booking_id: b._id })
            .select("rating reply_content")
            .lean();
          if (fb) {
            b.feedback_status = {
              rated: true,
              rating: fb.rating,
              has_reply: !!fb.reply_content,
            };
          } else {
            b.feedback_status = {
              rated: false,
              rating: null,
              has_reply: false,
            };
          }
        }

        return b;
      }),
    );

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

// Lấy danh sách bookings của club (dành cho staff / owner)
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

// Xác nhận thanh toán đặt bàn (chuyển từ Pending -> Booked)
const confirmPayment = async (req, res) => {
  try {
    const { id } = req.params;

    const booking = await Booking.findById(id);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy đơn đặt bàn" });
    }

    if (booking.status !== "Pending") {
      return res.status(400).json({
        success: false,
        message: `Không thể xác nhận thanh toán đơn đang ở trạng thái: ${booking.status}`,
      });
    }

    // Cập nhật trạng thái booking
    booking.status = "Booked";
    await booking.save();

    // Cập nhật trạng thái bàn về Available (giải phóng Holding)
    await BilliardTable.findByIdAndUpdate(booking.table_id, {
      status: "Available",
      held_by: null,
      held_until: null,
    });

    res.status(200).json({
      success: true,
      message: "Xác nhận thanh toán thành công",
      data: booking,
    });
  } catch (error) {
    console.error("Lỗi confirmPayment:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// Nhân viên tạo đặt bàn trực tiếp (walk-in) cho khách đến quán
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
// Create PayOS payment link for booking deposit (Pending -> payment link, webhook will set Booked)
const createBookingPayOSPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const accountId = req.user?.accountId;

    const booking = await Booking.findById(id).populate("table_id");
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy đơn đặt bàn" });
    }

    if (!accountId || String(booking.account_id) !== String(accountId)) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền thanh toán đơn này",
      });
    }

    if (booking.status !== "Pending") {
      return res.status(400).json({
        success: false,
        message: `Đơn đang ở trạng thái: ${booking.status}`,
      });
    }

    const table = booking.table_id;
    if (!table) {
      return res
        .status(400)
        .json({ success: false, message: "Đơn đặt thiếu thông tin bàn" });
    }

    const clubId = table.club_id;
    const bank = await ClubBank.findOne({ club_id: clubId }).lean();
    if (
      !bank ||
      !bank.payos_client_id ||
      !bank.payos_api_key ||
      !bank.payos_checksum_key
    ) {
      return res.status(400).json({
        success: false,
        message:
          "CLB chưa thiết lập PayOS (Client ID / API Key / Checksum Key)",
      });
    }

    const orderCode = Date.now();
    const expiredAt = Math.floor(
      (Date.now() + PAYOS_EXPIRE_MINUTES * 60 * 1000) / 1000,
    );

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
      status: "PENDING",
    });

    const paymentData = {
      orderCode,
      amount: booking.deposit,
      description,
      returnUrl: "http://localhost:5173/my-bookings",
      cancelUrl: "http://localhost:5173/my-bookings",
      expiredAt,
    };

    const paymentLink = await payosService.createPaymentLink(paymentData, {
      clientId: bank.payos_client_id,
      apiKey: bank.payos_api_key,
      checksumKey: bank.payos_checksum_key,
    });

    return res.status(200).json({
      success: true,
      message: "Tạo mã PayOS thành công",
      data: {
        orderCode,
        checkoutUrl: paymentLink.checkoutUrl,
        qrCode: paymentLink.qrCode || null,
        paymentLinkId: paymentLink.paymentLinkId || paymentLink.id || null,
        expiredAt: paymentLink.expiredAt || expiredAt,
      },
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
      return res
        .status(400)
        .json({ success: false, message: "Thiếu orderCode" });
    }

    const TransactionHistory = require("../models/transiction_history.model");
    const tx = await TransactionHistory.findOne({
      order_code: orderCode,
    }).lean();
    if (!tx || !tx.booking_id) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy booking theo orderCode",
      });
    }

    const booking = await Booking.findById(tx.booking_id).populate("table_id");
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy booking" });
    }

    const table = booking.table_id;
    const clubId = table?.club_id;
    const bank = await ClubBank.findOne({ club_id: clubId }).lean();
    if (
      !bank ||
      !bank.payos_client_id ||
      !bank.payos_api_key ||
      !bank.payos_checksum_key
    ) {
      return res
        .status(400)
        .json({ success: false, message: "CLB thiếu cấu hình PayOS" });
    }

    // Verify webhook signature
    let webhookData;
    try {
      webhookData = await payosService.verifyWebhook(payload, {
        clientId: bank.payos_client_id,
        apiKey: bank.payos_api_key,
        checksumKey: bank.payos_checksum_key,
      });
    } catch (e) {
      console.error("PayOS webhook verify failed:", e?.message || e);
      return res
        .status(400)
        .json({ success: false, message: "Webhook không hợp lệ" });
    }

    // Only handle paid events
    const status =
      webhookData?.data?.code ||
      webhookData?.data?.status ||
      webhookData?.data?.paymentStatus;
    // PayOS typically returns data.code === '00' for success in webhook payload.
    const isPaid =
      webhookData?.data?.code === "00" ||
      payload?.data?.code === "00" ||
      payload?.success === true;

    if (!isPaid) {
      return res
        .status(200)
        .json({ success: true, message: "Webhook received (not paid)" });
    }

    const txType = tx.transaction_type;

    // Deposit flow: Pending -> Booked
    if (txType !== "BOOKING_FINAL_PAYMENT_TRANSFER") {
      if (booking.status === "Booked") {
        return res.status(200).json({
          success: true,
          message: "Already booked",
        });
      }

      booking.status = "Booked";
      await booking.save();

      await Notification.create({
        account_id: booking.account_id,
        title: "Thanh toán thành công",
        message: `Bạn đã đặt bàn ${booking.table_id.table_number} thành công. Mã đơn: ${booking.code_number}`,
        is_read: false,
      });

      await TransactionHistory.findOneAndUpdate(
        { order_code: orderCode },
        { status: "SUCCESS" },
      );

      // Release holding
      await BilliardTable.findByIdAndUpdate(
        booking.table_id._id || booking.table_id,
        {
          status: "Available",
          held_by: null,
          held_until: null,
        },
      );

      return res.status(200).json({
        success: true,
        message: "Updated booking to Booked",
      });
    }

    // Final checkout flow: Playing -> Completed
    if (booking.status === "Completed") {
      await TransactionHistory.findOneAndUpdate(
        { order_code: orderCode },
        { status: "SUCCESS" },
      );
      return res.status(200).json({
        success: true,
        message: "Already completed",
      });
    }

    const bookingServices = await BookingService.find({
      booking_id: booking._id,
    });
    const serviceTotal = bookingServices.reduce(
      (sum, s) => sum + s.unit_price * s.quantity,
      0,
    );

    let endMin = timeToMinutes(booking.end_time);
    const startMin = timeToMinutes(booking.start_time);
    if (endMin <= startMin) endMin += 24 * 60;

    const durationHours = (endMin - startMin) / 60;
    const playCost = Math.round(durationHours * (booking.hour_price || 0));
    const totalBill = playCost + serviceTotal;

    if (booking.status !== "Completed") {
      booking.total_bill = totalBill;
      booking.status = "Completed";
      await booking.save();

      await Notification.create({
        account_id: booking.account_id,
        title: "Thanh toán hoàn tất",
        message: `Bạn đã thanh toán xong bàn ${booking.table_id.table_number}. Tổng tiền: ${booking.total_bill}đ`,
        is_read: false,
      });
    }

    await TransactionHistory.findOneAndUpdate(
      { order_code: orderCode },
      { status: "SUCCESS" },
    );

    // Release table
    await BilliardTable.findByIdAndUpdate(
      booking.table_id._id || booking.table_id,
      {
        status: "Available",
        held_by: null,
        held_until: null,
      },
    );

    notifyStaff(
      clubId,
      "Thanh toán",
      `Bàn ${booking.table_id.table_number} đã được thanh toán xong`,
    );

    await ensureInvoiceForBooking({
      booking,
      bookingServices,
      tableCost: playCost,
      totalService: serviceTotal,
      paymentMethod: "payOS",
    });

    return res.status(200).json({
      success: true,
      message: "Updated booking to Completed",
    });
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
      return res
        .status(400)
        .json({ success: false, message: "Thiếu orderCode" });
    }

    const TransactionHistory = require("../models/transiction_history.model");
    const tx = await TransactionHistory.findOne({
      order_code: orderCode,
    }).lean();
    if (!tx || !tx.booking_id) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn đặt bàn với orderCode này",
      });
    }

    const booking = await Booking.findById(tx.booking_id).populate("table_id");
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy đơn đặt bàn" });
    }

    if (booking.status === "Booked") {
      return res.status(200).json({
        success: true,
        message: "Đơn đã được xác nhận trước đó",
        data: booking,
      });
    }

    const table = booking.table_id;
    const clubId = table?.club_id;
    const bank = await ClubBank.findOne({ club_id: clubId }).lean();
    if (
      !bank ||
      !bank.payos_client_id ||
      !bank.payos_api_key ||
      !bank.payos_checksum_key
    ) {
      return res
        .status(400)
        .json({ success: false, message: "CLB chưa cấu hình PayOS" });
    }

    const paymentInfo = await payosService.getPaymentInfo(orderCode, {
      clientId: bank.payos_client_id,
      apiKey: bank.payos_api_key,
      checksumKey: bank.payos_checksum_key,
    });

    if (paymentInfo.status !== "PAID") {
      return res
        .status(400)
        .json({ success: false, message: "Thanh toán chưa hoàn tất" });
    }

    booking.status = "Booked";
    await booking.save();

    await TransactionHistory.findOneAndUpdate(
      { order_code: orderCode },
      { status: "SUCCESS" },
    );

    await BilliardTable.findByIdAndUpdate(table._id, {
      status: "Available",
      held_by: null,
      held_until: null,
    });

    return res.status(200).json({
      success: true,
      message: "Xác thực thanh toán thành công",
      data: booking,
    });
  } catch (error) {
    console.error("Lỗi verifyBookingPayOSPayment:", error);
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// Nhân viên / Chủ quán thanh toán đơn đặt bàn ("Playing" -> "Completed")
const checkOutBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const clubId = req.user.club_id;

    if (!clubId) {
      return res.status(400).json({
        success: false,
        message: "Không xác định được quán của nhân viên",
      });
    }

    const booking = await Booking.findById(id).populate("table_id");
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy đơn đặt bàn" });
    }

    // Kiểm tra bàn thuộc club của nhân viên
    if (booking.table_id.club_id.toString() !== clubId.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Đơn này không thuộc quán của bạn" });
    }

    if (booking.status !== "Playing") {
      return res.status(400).json({
        success: false,
        message: `Không thể thanh toán đơn đang ở trạng thái: ${booking.status}`,
      });
    }

    // Cập nhật trạng thái booking: Lấy giờ định trước để tính tiền, giờ thực tế để giải phóng bàn
    const now = new Date();
    const endH = now.getHours();
    const endM = now.getMinutes();
    const realEndTimeStr = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;

    const scheduledEndStr = booking.end_time; // Giữ nguyên giờ đặt gốc để tính tiền
    let endMin = timeToMinutes(scheduledEndStr);
    const startMin = timeToMinutes(booking.start_time);

    // Xử lý chơi qua đêm (nếu endMin <= startMin)
    if (endMin <= startMin) {
      endMin += 24 * 60;
    }

    const durationHours = (endMin - startMin) / 60;
    const playCost = Math.round(durationHours * (booking.hour_price || 0));

    // Lấy tiền dịch vụ
    const bookingServices = await BookingService.find({ booking_id: id });
    const serviceTotal = bookingServices.reduce(
      (sum, s) => sum + s.unit_price * s.quantity,
      0,
    );

    booking.actual_end_time = realEndTimeStr; // Lưu giờ khách về thực tế
    if (booking.status !== "Completed") {
      booking.total_bill = playCost + serviceTotal;
      booking.status = "Completed";
      await booking.save();

      await Notification.create({
        account_id: booking.account_id,
        title: "Thanh toán hoàn tất",
        message: `Bạn đã thanh toán xong bàn ${booking.table_id.table_number}. Tổng tiền: ${booking.total_bill}đ`,
        is_read: false,
      });
    }
    // Store final payment cash transaction
    const TransactionHistory = require("../models/transiction_history.model");
    if (!booking.account_id) {
      return res.status(400).json({
        success: false,
        message: "Booking thiếu account_id, không thể lưu transaction_history",
      });
    }

    const deposit = Number(booking.deposit || 0);
    const dueAmount = Math.max(0, Number(booking.total_bill || 0) - deposit);

    await TransactionHistory.create({
      account_id: booking.account_id,
      booking_id: booking._id,
      order_code: `CASH-${Date.now()}`,
      amount: dueAmount,
      description: `BookingFinalPaymentCash:${booking._id}`,
      transaction_type: "BOOKING_FINAL_PAYMENT_CASH",
      transaction_time: new Date(),
      status: "SUCCESS",
    });

    await ensureInvoiceForBooking({
      booking,
      bookingServices,
      tableCost: playCost,
      totalService: serviceTotal,
      paymentMethod: "Cash",
    });

    // Cập nhật trạng thái bàn về Available
    await BilliardTable.findByIdAndUpdate(booking.table_id._id, {
      status: "Available",
      held_by: null,
      held_until: null,
    });

    notifyStaff(
      clubId,
      "Thanh toán",
      `Bàn ${booking.table_id.table_number} đã được thanh toán xong`,
    );

    res.status(200).json({
      success: true,
      message: "Thanh toán thành công. Bàn đã chuyển về trạng thái hoạt động.",
      data: {
        _id: booking._id,
        status: booking.status,
        end_time: booking.end_time,
        total_bill: booking.total_bill,
        play_cost: playCost,
        service_total: serviceTotal,
        deposit,
        due_amount: dueAmount,
      },
    });
  } catch (error) {
    console.error("Lỗi checkOutBooking:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// Lấy booking theo id (dành cho STAFF/OWNER của cùng club)
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

    const booking = await Booking.findById(id).populate("table_id");
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn đặt bàn",
      });
    }

    if (booking.table_id?.club_id?.toString() !== clubId.toString()) {
      return res.status(403).json({
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

// Chuyển khoản thanh toán nốt (Playing -> Completed) qua PayOS
const createBookingCheckoutPayOSPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const clubId = req.user?.club_id;
    if (!clubId) {
      return res.status(400).json({
        success: false,
        message: "Không xác định được quán của nhân viên",
      });
    }

    const booking = await Booking.findById(id).populate("table_id");
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn đặt bàn",
      });
    }

    if (booking.table_id?.club_id?.toString() !== clubId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Đơn này không thuộc quán của bạn",
      });
    }

    if (booking.status !== "Playing") {
      return res.status(400).json({
        success: false,
        message: `Không thể thanh toán khi đơn đang ở trạng thái: ${booking.status}`,
      });
    }

    const bookingServices = await BookingService.find({ booking_id: id });
    const serviceTotal = bookingServices.reduce((sum, s) => {
      const unitPrice = Number(s.unit_price || 0);
      const qty = Number(s.quantity || 0);
      const line = unitPrice * qty;
      return sum + (Number.isFinite(line) ? line : 0);
    }, 0);

    // Calculate play cost (time-based) - Sử dụng giờ đặt gốc
    const now = new Date();
    const endH = now.getHours();
    const endM = now.getMinutes();
    const realEndTimeStr = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;

    const scheduledEndStr = booking.end_time;
    let endMin = timeToMinutes(scheduledEndStr);
    const startMin = timeToMinutes(booking.start_time);
    if (endMin <= startMin) endMin += 24 * 60;

    const durationHours = (endMin - startMin) / 60;
    const playCost = Math.round(durationHours * (booking.hour_price || 0));

    // Cập nhật actual_end_time vào DB ngay để timeline thu lại (nhưng giữ nguyên end_time)
    booking.actual_end_time = realEndTimeStr;
    await booking.save();

    const totalBill = Number(playCost || 0) + Number(serviceTotal || 0);
    const deposit = Number(booking.deposit || 0);
    const dueAmount = Math.max(0, Math.round(totalBill - deposit));

    if (!booking.account_id) {
      return res.status(400).json({
        success: false,
        message: "Booking thiếu account_id, không thể lưu transaction_history",
      });
    }

    const TransactionHistory = require("../models/transiction_history.model");

    const orderCode = Date.now();
    const expiredAt = Math.floor(
      (Date.now() + PAYOS_EXPIRE_MINUTES * 60 * 1000) / 1000,
    );

    // Create transaction record as PENDING before redirecting to PayOS
    await TransactionHistory.create({
      account_id: booking.account_id,
      booking_id: booking._id,
      order_code: orderCode,
      amount: dueAmount,
      description: `BookingFinalPayment:${booking._id}`,
      transaction_type: "BOOKING_FINAL_PAYMENT_TRANSFER",
      transaction_time: new Date(),
      status: "PENDING",
    });

    // No remaining amount -> finalize immediately
    if (dueAmount <= 0) {
      booking.total_bill = totalBill;
      booking.status = "Completed";
      await booking.save();

      await BilliardTable.findByIdAndUpdate(booking.table_id._id, {
        status: "Available",
        held_by: null,
        held_until: null,
      });

      notifyStaff(
        clubId,
        "Thanh toán",
        `Bàn ${booking.table_id.table_number} đã được thanh toán xong`,
      );

      await TransactionHistory.findOneAndUpdate(
        { order_code: orderCode },
        { status: "SUCCESS", transaction_time: new Date() },
      );

      await ensureInvoiceForBooking({
        booking,
        bookingServices,
        tableCost: playCost,
        totalService: serviceTotal,
        paymentMethod: "payOS",
      });

      return res.status(200).json({
        success: true,
        message: "Hoàn tất thanh toán (0đ còn lại)",
        data: {
          orderCode,
          checkoutUrl: null,
          qrCode: null,
          expiredAt,
          invoice: {
            playCost,
            serviceTotal,
            totalBill,
            deposit,
            dueAmount,
          },
        },
      });
    }

    const bank = await ClubBank.findOne({ club_id: clubId }).lean();
    if (
      !bank ||
      !bank.payos_client_id ||
      !bank.payos_api_key ||
      !bank.payos_checksum_key
    ) {
      return res.status(400).json({
        success: false,
        message:
          "CLB chưa thiết lập PayOS (Client ID / API Key / Checksum Key)",
      });
    }

    const rawDescription = `Thanh toán ${booking.code_number || ""}`.trim();
    const safeDescription = String(rawDescription).slice(0, 25);

    const paymentLink = await payosService.createPaymentLink(
      {
        orderCode,
        amount: dueAmount,
        description: safeDescription || "Thanh toán",
        returnUrl: `http://localhost:5173/staff/tables/checkout/${booking._id}?orderCode=${orderCode}`,
        cancelUrl: `http://localhost:5173/staff/tables/checkout/${booking._id}?orderCode=${orderCode}`,
        expiredAt,
      },
      {
        clientId: bank.payos_client_id,
        apiKey: bank.payos_api_key,
        checksumKey: bank.payos_checksum_key,
      },
    );

    return res.status(200).json({
      success: true,
      message: "Tạo mã PayOS thành công",
      data: {
        orderCode,
        checkoutUrl: paymentLink.checkoutUrl,
        qrCode: paymentLink.qrCode || null,
        expiredAt: paymentLink.expiredAt || expiredAt,
        invoice: {
          playCost,
          serviceTotal,
          totalBill,
          deposit,
          dueAmount,
        },
      },
    });
  } catch (error) {
    console.error("Error createBookingCheckoutPayOSPayment:", error);
    return res.status(500).json({
      success: false,
      message: error?.response?.data?.message || error?.message || "Lỗi server",
    });
  }
};

// Xác thực thanh toán PayOS (Playing -> Completed)
const verifyBookingCheckoutPayOSPayment = async (req, res) => {
  try {
    const { orderCode } = req.body;
    if (!orderCode) {
      return res
        .status(400)
        .json({ success: false, message: "Thiếu orderCode" });
    }

    const TransactionHistory = require("../models/transiction_history.model");
    const tx = await TransactionHistory.findOne({
      order_code: orderCode,
    }).lean();
    if (!tx || !tx.booking_id) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy giao dịch thanh toán checkout",
      });
    }

    if (tx.transaction_type !== "BOOKING_FINAL_PAYMENT_TRANSFER") {
      return res.status(400).json({
        success: false,
        message: "orderCode không thuộc loại checkout PayOS",
      });
    }

    const booking = await Booking.findById(tx.booking_id).populate("table_id");
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy booking",
      });
    }

    const clubId = req.user?.club_id;
    if (!clubId) {
      return res.status(400).json({
        success: false,
        message: "Không xác định được quán của nhân viên",
      });
    }

    if (booking.table_id?.club_id?.toString() !== clubId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Đơn này không thuộc quán của bạn",
      });
    }

    if (tx.status === "SUCCESS" || booking.status === "Completed") {
      await TransactionHistory.findOneAndUpdate(
        { order_code: orderCode },
        { status: "SUCCESS" },
      );
      return res.status(200).json({
        success: true,
        message: "Đã được hoàn tất trước đó",
      });
    }

    const bank = await ClubBank.findOne({ club_id: clubId }).lean();
    if (
      !bank ||
      !bank.payos_client_id ||
      !bank.payos_api_key ||
      !bank.payos_checksum_key
    ) {
      return res
        .status(400)
        .json({ success: false, message: "CLB chưa cấu hình PayOS" });
    }

    const paymentInfo = await payosService.getPaymentInfo(orderCode, {
      clientId: bank.payos_client_id,
      apiKey: bank.payos_api_key,
      checksumKey: bank.payos_checksum_key,
    });

    if (paymentInfo.status !== "PAID") {
      return res
        .status(400)
        .json({ success: false, message: "Thanh toán chưa hoàn tất" });
    }

    // Finalize booking
    const bookingServices = await BookingService.find({
      booking_id: booking._id,
    });
    const serviceTotal = bookingServices.reduce((sum, s) => {
      const unitPrice = Number(s.unit_price || 0);
      const qty = Number(s.quantity || 0);
      const line = unitPrice * qty;
      return sum + (Number.isFinite(line) ? line : 0);
    }, 0);

    let endMin = timeToMinutes(booking.end_time);
    const startMin = timeToMinutes(booking.start_time);
    if (endMin <= startMin) endMin += 24 * 60;

    const durationHours = (endMin - startMin) / 60;
    const playCost = Math.round(durationHours * (booking.hour_price || 0));
    const totalBill = Number(playCost || 0) + Number(serviceTotal || 0);

    if (booking.status !== "Completed") {
      booking.total_bill = totalBill;
      booking.status = "Completed";
      await booking.save();

      await Notification.create({
        account_id: booking.account_id,
        title: "Thanh toán hoàn tất",
        message: `Bạn đã thanh toán xong bàn ${booking.table_id.table_number}. Tổng tiền: ${booking.total_bill}đ`,
        is_read: false,
      });
    }

    await BilliardTable.findByIdAndUpdate(booking.table_id._id, {
      status: "Available",
      held_by: null,
      held_until: null,
    });

    notifyStaff(
      clubId,
      "Thanh toán",
      `Bàn ${booking.table_id.table_number} đã được thanh toán xong`,
    );

    await ensureInvoiceForBooking({
      booking,
      bookingServices,
      tableCost: playCost,
      totalService: serviceTotal,
      paymentMethod: "payOS",
    });

    await TransactionHistory.findOneAndUpdate(
      { order_code: orderCode },
      { status: "SUCCESS", transaction_time: new Date() },
    );

    return res
      .status(200)
      .json({ success: true, message: "Thanh toán checkout thành công" });
  } catch (error) {
    console.error("Error verifyBookingCheckoutPayOSPayment:", error);
    return res.status(500).json({
      success: false,
      message: error?.response?.data?.message || error?.message || "Lỗi server",
    });
  }
};

// Thêm dịch vụ vào đơn đặt bàn (STAFF_CLUB)
const addBookingService = async (req, res) => {
  try {
    const { id } = req.params; // booking_id
    const { service_id, quantity } = req.body;
    const clubId = req.user.club_id;

    if (!service_id || !quantity || quantity <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Thông tin dịch vụ không hợp lệ" });
    }

    const booking = await Booking.findById(id).populate("table_id");
    if (!booking)
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy đơn đặt bàn" });

    // Kiểm tra quyền hạn
    if (booking.table_id.club_id.toString() !== clubId.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Đơn này không thuộc quán của bạn" });
    }

    const service = await Service.findOne({ _id: service_id, club_id: clubId });
    if (!service)
      return res
        .status(404)
        .json({ success: false, message: "Dịch vụ không tồn tại trong quán" });

    // Kiểm tra xem dịch vụ này đã có trong booking chưa
    let bs = await BookingService.findOne({ booking_id: id, service_id });

    if (bs) {
      // Nếu đã có -> cộng thêm số lượng
      bs.quantity += quantity;
      await bs.save();
    } else {
      // Nếu chưa có -> tạo record mới
      bs = await BookingService.create({
        booking_id: id,
        service_id,
        quantity,
        unit_price: service.price,
      });
    }

    // Cập nhật tổng tiền đơn đặt (thêm tiền dịch vụ)
    const serviceTotal = service.price * quantity;
    booking.total_bill = (booking.total_bill || 0) + serviceTotal;
    await booking.save();

    notifyStaff(
      clubId,
      "Gọi dịch vụ",
      `Bàn ${booking.table_id.table_number} vừa gọi ${quantity} ${service.name}`,
    );

    res
      .status(201)
      .json({ success: true, message: "Thêm dịch vụ thành công", data: bs });
  } catch (error) {
    console.error("Lỗi addBookingService:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// Cập nhật số lượng dịch vụ đã gọi
const updateBookingServiceQuantity = async (req, res) => {
  try {
    const { id, bookingServiceId } = req.params; // id is booking_id
    const { quantity } = req.body; // New absolute quantity
    const clubId = req.user.club_id;

    if (quantity === undefined || quantity < 1) {
      return res.status(400).json({
        success: false,
        message: "Số lượng không hợp lệ (tối thiểu 1)",
      });
    }

    const bs = await BookingService.findById(bookingServiceId);
    if (!bs)
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thông tin dịch vụ trong đơn",
      });

    const booking = await Booking.findById(id).populate("table_id");
    if (!booking)
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy đơn đặt bàn" });

    // Kiểm tra quyền hạn
    if (booking.table_id.club_id.toString() !== clubId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền chỉnh sửa đơn này",
      });
    }

    // Tính toán chênh lệch tiền
    const oldTotal = bs.unit_price * bs.quantity;
    const newTotal = bs.unit_price * quantity;
    const diff = newTotal - oldTotal;

    // Cập nhật record
    bs.quantity = quantity;
    await bs.save();

    // Cập nhật tổng bill
    booking.total_bill = (booking.total_bill || 0) + diff;
    await booking.save();

    res.status(200).json({
      success: true,
      message: "Cập nhật số lượng thành công",
      data: bs,
    });
  } catch (error) {
    console.error("Lỗi updateBookingServiceQuantity:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// Xoá dịch vụ khỏi đơn đặt bàn
const deleteBookingService = async (req, res) => {
  try {
    const { id, bookingServiceId } = req.params;
    const clubId = req.user.club_id;

    const bs = await BookingService.findById(bookingServiceId);
    if (!bs)
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thông tin dịch vụ trong đơn",
      });

    const booking = await Booking.findById(id).populate("table_id");
    if (!booking)
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy đơn đặt bàn" });

    // Kiểm tra quyền
    if (booking.table_id.club_id.toString() !== clubId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền xoá dịch vụ trong đơn này",
      });
    }

    // Trừ tiền khỏi tổng bill
    const totalToSubtract = bs.unit_price * bs.quantity;
    booking.total_bill = Math.max(
      0,
      (booking.total_bill || 0) - totalToSubtract,
    );
    await booking.save();

    // Xoá record
    await BookingService.findByIdAndDelete(bookingServiceId);

    res.status(200).json({ success: true, message: "Đã xoá dịch vụ khỏi đơn" });
  } catch (error) {
    console.error("Lỗi deleteBookingService:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// Lấy danh sách dịch vụ của một booking
const getBookingServices = async (req, res) => {
  try {
    const { id } = req.params;
    const services = await BookingService.find({ booking_id: id }).populate(
      "service_id",
    );
    res.status(200).json({ success: true, data: services });
  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// Gia hạn thêm thời gian cho đơn đang chơi
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

    const booking = await Booking.findById(id).populate("table_id");
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy đơn đặt bàn" });
    }

    // Kiểm tra quyền hạn
    if (booking.table_id.club_id.toString() !== clubId.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Đơn này không thuộc quán của bạn" });
    }

    if (booking.status !== "Playing") {
      return res.status(400).json({
        success: false,
        message: "Chỉ có thể gia hạn cho đơn đang chơi",
      });
    }

    // Tính toán end_time mới
    const [h, m] = booking.end_time.split(":").map(Number);
    let totalMinutes = h * 60 + m + parseInt(minutes);

    // Format lại HH:mm (xử lý qua ngày nếu cần, nhưng booking model lưu String HH:mm)
    const newH = Math.floor(totalMinutes / 60) % 24;
    const newM = totalMinutes % 60;
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

// Đổi bàn cho đơn đặt bàn đang chơi (Walk-in hoặc khách đặt)
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

    const oldBooking = await Booking.findById(id).populate("table_id");
    if (!oldBooking)
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy đơn" });

    if (oldBooking.table_id.club_id.toString() !== clubId.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Đơn này không thuộc quán của bạn" });
    }

    if (oldBooking.status !== "Playing") {
      return res
        .status(400)
        .json({ success: false, message: "Chỉ có thể đổi bàn khi đang chơi" });
    }

    const newTable = await BilliardTable.findById(new_table_id);
    if (!newTable || newTable.club_id.toString() !== clubId.toString()) {
      return res
        .status(404)
        .json({ success: false, message: "Bàn mới không khả dụng" });
    }
    if (newTable.status !== "Available") {
      return res
        .status(400)
        .json({ success: false, message: "Bàn mới đang không trống" });
    }

    // 1. Chốt đơn bàn cũ
    const now = new Date();
    const endH = now.getHours();
    const endM = now.getMinutes();
    const realEndTimeStr = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;

    const startMin = timeToMinutes(oldBooking.start_time);
    let endMin = endH * 60 + endM;
    if (endMin <= startMin) endMin += 24 * 60;

    const durationHours = (endMin - startMin) / 60;
    const playCost = Math.round(durationHours * (oldBooking.hour_price || 0));

    // Tính tổng dịch vụ
    const BookingService = require("../models/booking_service.model");
    const oldServices = await BookingService.find({
      booking_id: oldBooking._id,
    });
    const serviceTotal = oldServices.reduce(
      (sum, s) => sum + s.unit_price * s.quantity,
      0,
    );

    oldBooking.end_time = realEndTimeStr;
    oldBooking.total_bill = playCost + serviceTotal;
    oldBooking.status = "Completed";
    oldBooking.note =
      (oldBooking.note || "") +
      ` [Đã chuyển sang bàn ${newTable.table_number}]`;
    await oldBooking.save();

    await BilliardTable.findByIdAndUpdate(oldBooking.table_id._id, {
      status: "Available",
    });

    // 2. Tạo đơn bàn mới
    const codeNumber = "WI" + Date.now().toString().slice(-8);
    const computedEndH = (endH + 1) % 24;
    const computedEndTime = `${String(computedEndH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;

    const newBooking = await Booking.create({
      account_id: oldBooking.account_id,
      guest_name: oldBooking.guest_name,
      table_id: newTable._id,
      play_date: now,
      start_time: realEndTimeStr,
      end_time: computedEndTime,
      code_number: codeNumber,
      deposit: 0,
      hour_price: newTable.price || 0,
      total_bill: 0,
      note: `Đổi đến từ bàn ${oldBooking.table_id.table_number}`,
      status: "Playing",
    });

    notifyStaff(
      clubId,
      "Đổi bàn",
      `Bàn ${oldBooking.table_id.table_number} đã chuyển sang Bàn ${newTable.table_number}`,
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

const notifyCustomer = async (account_id, title, message) => {
  try {
    await Notification.create({
      account_id,
      title,
      message,
      is_read: false,
    });
  } catch (err) {
    console.error("Notify customer error:", err);
  }
};

module.exports = {
  createBooking,
  cancelHold,
  getMyBookings,
  checkInBooking,
  checkOutBooking,
  getBookingById,
  getClubBookings,
  createWalkInBooking,
  confirmPayment,
  createBookingPayOSPayment,
  payosWebhook,
  verifyBookingPayOSPayment,
  createBookingCheckoutPayOSPayment,
  verifyBookingCheckoutPayOSPayment,
  addBookingService,
  getBookingServices,
  updateBookingServiceQuantity,
  deleteBookingService,
  extendBooking,
  changeTable,
};
