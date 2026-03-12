const Booking = require("../models/booking.model");
const BilliardTable = require("../models/billiard_table.model");
const Club = require("../models/club.model");
const Parameter = require("../models/parameter.model");

const HOLD_MINUTES = 0.5;

// Tạo booking + giữ chỗ bàn
const createBooking = async (req, res) => {
  try {
    const { table_id, club_id, play_date, start_time, end_time, duration } = req.body;
    const accountId = req.user.accountId;

    if (!table_id || !play_date || !start_time || !end_time) {
      return res.status(400).json({ success: false, message: "Thiếu thông tin đặt bàn" });
    }

    // Kiểm tra bàn có khả dụng không
    const table = await BilliardTable.findById(table_id).populate("table_type_id");
    if (!table) {
      return res.status(404).json({ success: false, message: "Không tìm thấy bàn" });
    }

    // Nếu bàn đang Holding nhưng đã hết hạn → trả lại Available
    if (table.status === "Holding" && table.held_until && new Date(table.held_until) <= new Date()) {
      await BilliardTable.findByIdAndUpdate(table_id, {
        status: "Available", held_by: null, held_until: null
      });
      table.status = "Available";
    }

    // Kiểm tra nếu bàn đang Holding bởi người khác và chưa hết hạn
    if (table.status === "Holding") {
      if (String(table.held_by) !== String(accountId)) {
        return res.status(409).json({ success: false, message: "Bàn đang được giữ chỗ bởi người khác" });
      }
    }

    if (table.status === "Maintenance") {
      return res.status(400).json({ success: false, message: "Bàn đang bảo trì" });
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
    const club = await Club.findById(club_id).lean();

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

module.exports = {
  createBooking,
  cancelHold,
  getMyBookings
};
