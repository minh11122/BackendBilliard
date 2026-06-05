const Booking = require("../../models/booking.model");
const BilliardTable = require("../../models/billiard_table.model");
const Club = require("../../models/club.model");
const ClubBank = require("../../models/club_bank.model");
const BookingService = require("../../models/booking_service.model");
const payosService = require("../../services/payos.service");
const {
  PAYOS_CONFIG_MSG,
  resolvePayosApiErrorMessage,
} = require("../../utils/payosError.util");
const Notification = require("../../models/notification.model");
const {
  PAYOS_EXPIRE_MINUTES,
  notifyStaff,
  ensureInvoiceForBooking,
  timeToMinutes,
} = require("./booking.helpers");

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
        message: PAYOS_CONFIG_MSG,
      });
    }

    const orderCode = Date.now();
    const nowMs = Date.now();
    const holdUntilMs = table?.held_until
      ? new Date(table.held_until).getTime()
      : null;

    if (holdUntilMs && holdUntilMs <= nowMs) {
      booking.status = "Cancelled";
      await booking.save();
      await BilliardTable.findByIdAndUpdate(booking.table_id, {
        status: "Available",
        held_by: null,
        held_until: null,
      });
      return res.status(400).json({
        success: false,
        message: "Đơn đặt đã hết thời gian giữ chỗ",
      });
    }

    const defaultPayOSExpiredAt = Math.floor(
      (nowMs + PAYOS_EXPIRE_MINUTES * 60 * 1000) / 1000,
    );
    const holdExpiredAt = holdUntilMs ? Math.floor(holdUntilMs / 1000) : null;
    const expiredAt = holdExpiredAt
      ? Math.min(defaultPayOSExpiredAt, holdExpiredAt)
      : defaultPayOSExpiredAt;

    const description = `Coc booking ${booking.code_number}`;

    // Lưu transaction history cho booking
    await require("../../models/transiction_history.model").create({
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
    return res.status(500).json({
      success: false,
      message: resolvePayosApiErrorMessage(error),
    });
  }
};

const verifyBookingPayOSPayment = async (req, res) => {
  try {
    const { orderCode } = req.body;
    if (!orderCode) {
      return res
        .status(400)
        .json({ success: false, message: "Thiếu orderCode" });
    }

    const TransactionHistory = require("../../models/transiction_history.model");
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
        .json({ success: false, message: PAYOS_CONFIG_MSG });
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

    const clubInfo3 = await Club.findById(table.club_id).lean();
    const clubName3 = clubInfo3 ? clubInfo3.name : "Quán Billiards";

    await Notification.create({
      account_id: booking.account_id,
      title: "Đặt bàn đã được xác nhận",
      message: `Thanh toán thành công, đơn đặt bàn ${booking.code_number} tại ${clubName3} đã được xác nhận.`,
      link: `/my-bookings?bookingId=${booking._id}`,
      is_read: false,
    });

    await TransactionHistory.findOneAndUpdate(
      { order_code: orderCode },
      { status: "SUCCESS" },
    );

    await BilliardTable.findByIdAndUpdate(table._id, {
      status: "Available",
      held_by: null,
      held_until: null,
    });

    notifyStaff(
      clubId,
      "Đơn đặt bàn online mới",
      `Bàn ${booking.table_id.table_number} vừa được thanh toán thành công. Mã đơn: ${booking.code_number}`,
      "/staff/bookings",
    );

    return res.status(200).json({
      success: true,
      message: "Xác thực thanh toán thành công",
      data: booking,
    });
  } catch (error) {
    console.error("Lỗi verifyBookingPayOSPayment:", error);
    return res.status(500).json({
      success: false,
      message: resolvePayosApiErrorMessage(error),
    });
  }
};

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

    const booking = await Booking.findOne({ _id: id }).populate({
      path: "table_id",
      match: { club_id: clubId },
    });
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy đơn đặt bàn" });
    }

    // Kiểm tra bàn thuộc club của nhân viên
    if (!booking.table_id) {
      return res
        .status(404)
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
      const carryOver = Number(booking.carry_over_amount || 0);
      booking.total_bill = playCost + serviceTotal + carryOver;
      booking.status = "Completed";
      await booking.save();

      const clubInfo4 = await Club.findById(clubId).lean();
      const clubName4 = clubInfo4 ? clubInfo4.name : "Quán Billiards";

      await Notification.create({
        account_id: booking.account_id,
        title: "Thanh toán hoàn tất",
        message: `Bạn đã thanh toán xong bàn ${booking.table_id.table_number} tại ${clubName4}. Tổng tiền: ${booking.total_bill}đ`,
        link: `/my-bookings?bookingId=${booking._id}`,
        is_read: false,
      });
    }
    // Store final payment cash transaction
    const TransactionHistory = require("../../models/transiction_history.model");
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

    const carryOver = Number(booking.carry_over_amount || 0);
    const totalBill =
      Number(playCost || 0) + Number(serviceTotal || 0) + carryOver;
    const deposit = Number(booking.deposit || 0);
    const dueAmount = Math.max(0, Math.round(totalBill - deposit));

    if (!booking.account_id) {
      return res.status(400).json({
        success: false,
        message: "Booking thiếu account_id, không thể lưu transaction_history",
      });
    }

    const TransactionHistory = require("../../models/transiction_history.model");

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
            carryOver,
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
        message: PAYOS_CONFIG_MSG,
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
          carryOver,
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
      message: resolvePayosApiErrorMessage(error),
    });
  }
};

const verifyBookingCheckoutPayOSPayment = async (req, res) => {
  try {
    const { orderCode } = req.body;
    if (!orderCode) {
      return res
        .status(400)
        .json({ success: false, message: "Thiếu orderCode" });
    }

    const TransactionHistory = require("../../models/transiction_history.model");
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

    const clubId = req.user?.club_id;
    if (!clubId) {
      return res.status(400).json({
        success: false,
        message: "Không xác định được quán của nhân viên",
      });
    }

    const booking = await Booking.findOne({ _id: tx.booking_id }).populate({
      path: "table_id",
      match: { club_id: clubId },
    });
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy booking",
      });
    }

    if (!booking.table_id) {
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
        .json({ success: false, message: PAYOS_CONFIG_MSG });
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
    const carryOver = Number(booking.carry_over_amount || 0);
    const totalBill =
      Number(playCost || 0) + Number(serviceTotal || 0) + carryOver;

    if (booking.status !== "Completed") {
      booking.total_bill = totalBill;
      booking.status = "Completed";
      await booking.save();

      const clubInfo5 = await Club.findById(clubId).lean();
      const clubName5 = clubInfo5 ? clubInfo5.name : "Quán Billiards";

      await Notification.create({
        account_id: booking.account_id,
        title: "Thanh toán hoàn tất",
        message: `Bạn đã thanh toán xong bàn ${booking.table_id.table_number} tại ${clubName5}. Tổng tiền: ${booking.total_bill}đ`,
        link: `/my-bookings?bookingId=${booking._id}`,
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
      message: resolvePayosApiErrorMessage(error),
    });
  }
};

// PayOS webhook: verify signature (by club checksumKey) then update booking status
const payosWebhook = async (req, res) => {
  try {
    const payload = req.body;
    const orderCode = payload?.data?.orderCode;
    if (!orderCode) {
      return res
        .status(400)
        .json({ success: false, message: "Thiếu orderCode" });
    }

    const TransactionHistory = require("../../models/transiction_history.model");
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
        .json({ success: false, message: PAYOS_CONFIG_MSG });
    }

    try {
      await payosService.verifyWebhook(payload, {
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

    const isPaid = payload?.data?.code === "00" || payload?.success === true;

    if (!isPaid) {
      return res
        .status(200)
        .json({ success: true, message: "Webhook received (not paid)" });
    }

    const txType = tx.transaction_type;

    // Deposit flow: Pending -> Booked Khi khách thanh toán cọc
    if (txType !== "BOOKING_FINAL_PAYMENT_TRANSFER") {
      if (booking.status === "Booked") {
        return res.status(200).json({
          success: true,
          message: "Already booked",
        });
      }

      booking.status = "Booked";
      await booking.save();

      const clubPopulated1 = await Club.findById(table.club_id).lean();
      const clubName1 = clubPopulated1 ? clubPopulated1.name : "Quán Billiards";

      await Notification.create({
        account_id: booking.account_id,
        title: "Thanh toán thành công",
        message: `Bạn đã đặt bàn ${booking.table_id.table_number} tại ${clubName1} thành công. Mã đơn: ${booking.code_number}`,
        link: `/my-bookings?bookingId=${booking._id}`,
        is_read: false,
      });

      await TransactionHistory.findOneAndUpdate(
        { order_code: orderCode },
        { status: "SUCCESS" },
      );

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
        "Đơn đặt bàn online mới",
        `Bàn ${booking.table_id.table_number} vừa được thanh toán thành công. Mã đơn: ${booking.code_number}`,
        "/staff/bookings",
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
    const carryOver = Number(booking.carry_over_amount || 0);
    const totalBill =
      Number(playCost || 0) + Number(serviceTotal || 0) + carryOver;

    if (booking.status !== "Completed") {
      booking.total_bill = totalBill;
      booking.status = "Completed";
      await booking.save();

      const clubPopulated2 = await Club.findById(table.club_id).lean();
      const clubName2 = clubPopulated2 ? clubPopulated2.name : "Quán Billiards";

      await Notification.create({
        account_id: booking.account_id,
        title: "Thanh toán hoàn tất",
        message: `Bạn đã thanh toán xong bàn ${booking.table_id.table_number} tại ${clubName2}. Tổng tiền: ${booking.total_bill}đ`,
        link: `/my-bookings?bookingId=${booking._id}`,
        is_read: false,
      });
    }

    await TransactionHistory.findOneAndUpdate(
      { order_code: orderCode },
      { status: "SUCCESS", transaction_time: new Date() },
    );

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

module.exports = {
  createBookingPayOSPayment,
  verifyBookingPayOSPayment,
  checkOutBooking,
  createBookingCheckoutPayOSPayment,
  verifyBookingCheckoutPayOSPayment,
  payosWebhook,
};
