const Booking = require("../../models/booking.model");
const BookingService = require("../../models/booking_service.model");
const Service = require("../../models/service.model");
const {
  notifyStaff,
} = require("./booking.helpers");

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

    const booking = await Booking.findOne({ _id: id }).populate({
      path: "table_id",
      match: { club_id: clubId },
    });
    if (!booking)
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy đơn đặt bàn" });

    // Kiểm tra quyền hạn
    if (!booking.table_id) {
      return res
        .status(404)
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

    const booking = await Booking.findOne({ _id: id }).populate({
      path: "table_id",
      match: { club_id: clubId },
    });
    if (!booking)
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy đơn đặt bàn" });

    // Kiểm tra quyền hạn
    if (!booking.table_id) {
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

    const booking = await Booking.findOne({ _id: id }).populate({
      path: "table_id",
      match: { club_id: clubId },
    });
    if (!booking)
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy đơn đặt bàn" });

    // Kiểm tra quyền
    if (!booking.table_id) {
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
    const clubId = req.user.club_id;
    const booking = await Booking.findOne({ _id: id }).populate({
      path: "table_id",
      match: { club_id: clubId },
    });
    if (!booking || !booking.table_id) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn đặt bàn thuộc quán của bạn",
      });
    }
    const services = await BookingService.find({ booking_id: id }).populate(
      "service_id",
    );
    res.status(200).json({ success: true, data: services });
  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};


module.exports = {
  addBookingService,
  updateBookingServiceQuantity,
  deleteBookingService,
  getBookingServices,
};
