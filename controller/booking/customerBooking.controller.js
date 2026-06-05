const Booking = require("../../models/booking.model");
const BilliardTable = require("../../models/billiard_table.model");
const Club = require("../../models/club.model");
const Parameter = require("../../models/parameter.model");
const { HOLD_MINUTES_OVERRIDE, timeToMinutes } = require("./booking.helpers");

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

    // Tạo booking Khi khách đặt bàn hệ thống tạo booking với: status: "Pending"
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
    // bàn được giữ chỗ
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
    const Image = require("../../models/image.model");
    const Feedback = require("../../models/feedback.model");
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

    // Lọc bỏ các đơn 0đ do đã chuyển sang bàn khác (tránh hiển thị rác trong lịch sử của khách)
    const finalBookings = enriched.filter((b) => {
      if (b.status === "Completed" && b.total_bill === 0 && b.note && b.note.includes("[Chuyển bàn")) {
        return false;
      }
      return true;
    });

    res.status(200).json({ success: true, data: finalBookings });
  } catch (error) {
    console.error("Lỗi getMyBookings:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

module.exports = {
  createBooking,
  cancelHold,
  getMyBookings,
};
