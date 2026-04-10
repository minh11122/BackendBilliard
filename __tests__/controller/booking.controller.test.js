jest.mock("../../models/booking.model", () => ({
  find: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
}));

jest.mock("../../models/billiard_table.model", () => ({
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
}));

jest.mock("../../models/club.model", () => ({
  findById: jest.fn(),
}));

jest.mock("../../models/parameter.model", () => ({
  findOne: jest.fn(),
}));

jest.mock("../../models/club_bank.model", () => ({
  findOne: jest.fn(),
}));

jest.mock("../../models/booking_service.model", () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  findByIdAndDelete: jest.fn(),
  create: jest.fn(),
}));

jest.mock("../../models/service.model", () => ({
  findOne: jest.fn(),
}));

jest.mock("../../models/notification.model", () => ({
  create: jest.fn(),
  insertMany: jest.fn(),
}));

jest.mock("../../models/transiction_history.model", () => ({
  create: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

jest.mock("../../models/invoice.model", () => ({
  findOne: jest.fn(),
  create: jest.fn(),
}));

jest.mock("../../models/invoice_detail.model", () => ({
  insertMany: jest.fn(),
}));

jest.mock("../../models/image.model", () => ({
  findOne: jest.fn(),
}));

jest.mock("../../models/feedback.model", () => ({
  findOne: jest.fn(),
}));

jest.mock(
  "../../models/staff_club.model",
  () => ({
    find: jest.fn(),
  }),
  { virtual: true },
);

jest.mock("../../services/payos.service", () => ({
  createPaymentLink: jest.fn(),
  getPaymentInfo: jest.fn(),
  verifyWebhook: jest.fn(),
}));

const Booking = require("../../models/booking.model");
const BilliardTable = require("../../models/billiard_table.model");
const Club = require("../../models/club.model");
const Parameter = require("../../models/parameter.model");
const BookingService = require("../../models/booking_service.model");
const Service = require("../../models/service.model");
const ClubBank = require("../../models/club_bank.model");
const Notification = require("../../models/notification.model");
const TransactionHistory = require("../../models/transiction_history.model");
const Invoice = require("../../models/invoice.model");
const InvoiceDetail = require("../../models/invoice_detail.model");
const Image = require("../../models/image.model");
const Feedback = require("../../models/feedback.model");
const StaffClub = require("../../models/staff_club.model");
const payosService = require("../../services/payos.service");
const bookingController = require("../../controller/booking.controller");

const createRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("Booking Controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    StaffClub.find.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("createBooking", () => {
    it("should create booking successfully", async () => {
      const req = {
        user: { accountId: "acc-book-01" },
        body: {
          table_id: "table-001",
          club_id: "club-001",
          play_date: "2026-04-15",
          start_time: "18:00",
          end_time: "20:00",
          duration: 2,
        },
      };
      const res = createRes();
      const table = {
        _id: "table-001",
        status: "Available",
        price: 120000,
        club_id: "club-001",
        table_number: "B01",
        table_type_id: { name: "Pool 9" },
      };
      const bookingDoc = {
        _id: "booking-001",
        account_id: "acc-book-01",
        table_id: "table-001",
        status: "Pending",
        deposit: 72000,
        total_bill: 240000,
        toObject: () => ({
          _id: "booking-001",
          account_id: "acc-book-01",
          table_id: "table-001",
          status: "Pending",
          deposit: 72000,
          total_bill: 240000,
        }),
      };

      BilliardTable.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(table),
      });
      Booking.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      Parameter.findOne.mockResolvedValue(null);
      Club.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: "club-001",
          name: "CLB Bi-a Sài Gòn Xanh",
          address: "135 Nguyễn Tri Phương, Quận 10, TP.HCM",
          deposit_percentage: 30,
        }),
      });
      Booking.create.mockResolvedValue(bookingDoc);
      BilliardTable.findByIdAndUpdate.mockResolvedValue({});

      await bookingController.createBooking(req, res);

      expect(Booking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          account_id: "acc-book-01",
          table_id: "table-001",
          status: "Pending",
        }),
      );
      expect(BilliardTable.findByIdAndUpdate).toHaveBeenCalledWith(
        "table-001",
        expect.objectContaining({
          status: "Holding",
          held_by: "acc-book-01",
        }),
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "Đặt bàn thành công, vui lòng thanh toán tiền cọc",
        }),
      );
    });

    it("should return 400 when required fields are missing", async () => {
      const req = {
        user: { accountId: "acc-book-02" },
        body: {
          table_id: "table-002",
          play_date: "2026-04-15",
          start_time: "18:00",
        },
      };
      const res = createRes();

      await bookingController.createBooking(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Thiếu thông tin đặt bàn",
      });
    });

    it("should return 400 when table is in maintenance", async () => {
      const req = {
        user: { accountId: "acc-book-03" },
        body: {
          table_id: "table-003",
          play_date: "2026-04-15",
          start_time: "19:00",
          end_time: "21:00",
          duration: 2,
        },
      };
      const res = createRes();

      BilliardTable.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          _id: "table-003",
          status: "Maintenance",
        }),
      });

      await bookingController.createBooking(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Bàn đang bảo trì",
      });
    });
  });

  describe("cancelHold", () => {
    it("should return 403 when booking belongs to another user", async () => {
      const req = {
        params: { id: "booking-010" },
        user: { accountId: "acc-owner-02" },
      };
      const res = createRes();

      Booking.findById.mockResolvedValue({
        _id: "booking-010",
        account_id: "acc-owner-01",
      });

      await bookingController.cancelHold(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Bạn không có quyền hủy đơn này",
      });
    });
  });

  describe("checkInBooking", () => {
    it("should check in booking successfully", async () => {
      const req = {
        user: { accountId: "staff-001", club_id: "club-001" },
        body: { code_number: "BK12345678" },
      };
      const res = createRes();
      const booking = {
        _id: "booking-011",
        status: "Booked",
        table_id: { club_id: "club-001" },
        save: jest.fn(),
      };

      Booking.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue(booking),
      });

      await bookingController.checkInBooking(req, res);

      expect(booking.status).toBe("Playing");
      expect(booking.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "Check-in thành công. Trạng thái đã chuyển sang Playing.",
        }),
      );
    });

    it("should return 400 when code_number is missing", async () => {
      const req = {
        user: { accountId: "staff-002", club_id: "club-001" },
        body: {},
      };
      const res = createRes();

      await bookingController.checkInBooking(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Vui lòng nhập mã code_number",
      });
    });
  });

  describe("confirmPayment", () => {
    it("should return 400 when booking status is not pending", async () => {
      const req = {
        params: { id: "booking-012" },
      };
      const res = createRes();

      Booking.findById.mockResolvedValue({
        _id: "booking-012",
        status: "Booked",
      });

      await bookingController.confirmPayment(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Không thể xác nhận thanh toán đơn đang ở trạng thái: Booked",
      });
    });
  });

  describe("createWalkInBooking", () => {
    it("should create walk-in booking successfully", async () => {
      const req = {
        user: { accountId: "staff-003", club_id: "club-001", role: "STAFF_CLUB" },
        body: {
          guest_name: "Nguyễn Văn Hào",
          table_number: "A05",
          play_date: "2026-04-16",
          start_time: "20:00",
          end_time: "22:00",
        },
      };
      const res = createRes();
      const bookingDoc = {
        _id: "booking-013",
        table_id: "table-a05",
        status: "Playing",
        toObject: () => ({
          _id: "booking-013",
          table_id: "table-a05",
          status: "Playing",
          guest_name: "Nguyễn Văn Hào",
        }),
      };

      BilliardTable.findOne.mockResolvedValue({
        _id: "table-a05",
        club_id: "club-001",
        table_number: "A05",
        price: 150000,
        status: "Available",
      });
      Booking.findOne.mockResolvedValue(null);
      Booking.create.mockResolvedValue(bookingDoc);

      await bookingController.createWalkInBooking(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "Tạo đặt bàn thành công! Bàn A05 đang chơi.",
        }),
      );
    });
  });

  describe("addBookingService", () => {
    it("should append quantity to existing booking service", async () => {
      const req = {
        params: { id: "booking-014" },
        user: { club_id: "club-001" },
        body: {
          service_id: "service-001",
          quantity: 2,
        },
      };
      const res = createRes();
      const booking = {
        _id: "booking-014",
        total_bill: 180000,
        table_id: { club_id: "club-001", table_number: "B02" },
        save: jest.fn(),
      };
      const bookingService = {
        _id: "bs-001",
        quantity: 1,
        unit_price: 30000,
        save: jest.fn(),
      };

      Booking.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(booking),
      });
      Service.findOne.mockResolvedValue({
        _id: "service-001",
        club_id: "club-001",
        name: "Nước suối Aquafina",
        price: 30000,
      });
      BookingService.findOne.mockResolvedValue(bookingService);

      await bookingController.addBookingService(req, res);

      expect(bookingService.quantity).toBe(3);
      expect(bookingService.save).toHaveBeenCalled();
      expect(booking.total_bill).toBe(240000);
      expect(booking.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "Thêm dịch vụ thành công",
          data: bookingService,
        }),
      );
    });

    it("should return 400 when quantity is invalid", async () => {
      const req = {
        params: { id: "booking-015" },
        user: { club_id: "club-001" },
        body: {
          service_id: "service-002",
          quantity: 0,
        },
      };
      const res = createRes();

      await bookingController.addBookingService(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Thông tin dịch vụ không hợp lệ",
      });
    });
  });

  describe("updateBookingServiceQuantity", () => {
    it("should update booking service quantity successfully", async () => {
      const req = {
        params: {
          id: "booking-016",
          bookingServiceId: "bs-002",
        },
        user: { club_id: "club-001" },
        body: {
          quantity: 4,
        },
      };
      const res = createRes();
      const bookingService = {
        _id: "bs-002",
        quantity: 2,
        unit_price: 25000,
        save: jest.fn(),
      };
      const booking = {
        _id: "booking-016",
        total_bill: 200000,
        table_id: { club_id: "club-001" },
        save: jest.fn(),
      };

      BookingService.findById.mockResolvedValue(bookingService);
      Booking.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(booking),
      });

      await bookingController.updateBookingServiceQuantity(req, res);

      expect(bookingService.quantity).toBe(4);
      expect(booking.total_bill).toBe(250000);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: "Cập nhật số lượng thành công",
          data: bookingService,
        }),
      );
    });

    it("should return 400 when quantity is less than 1", async () => {
      const req = {
        params: {
          id: "booking-017",
          bookingServiceId: "bs-003",
        },
        user: { club_id: "club-001" },
        body: {
          quantity: 0,
        },
      };
      const res = createRes();

      await bookingController.updateBookingServiceQuantity(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Số lượng không hợp lệ (tối thiểu 1)",
      });
    });
  });

  describe("deleteBookingService", () => {
    it("should return 404 when booking service does not exist", async () => {
      const req = {
        params: {
          id: "booking-018",
          bookingServiceId: "bs-404",
        },
        user: { club_id: "club-001" },
      };
      const res = createRes();

      BookingService.findById.mockResolvedValue(null);

      await bookingController.deleteBookingService(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Không tìm thấy thông tin dịch vụ trong đơn",
      });
    });
  });

  describe("extendBooking", () => {
    it("should extend booking successfully", async () => {
      const req = {
        params: { id: "booking-019" },
        user: { club_id: "club-001" },
        body: { minutes: 30 },
      };
      const res = createRes();
      const booking = {
        _id: "booking-019",
        start_time: "18:00",
        end_time: "20:00",
        hour_price: 120000,
        total_bill: 240000,
        status: "Playing",
        note: "",
        table_id: { club_id: "club-001", table_number: "C03" },
        save: jest.fn(),
      };

      Booking.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(booking),
      });

      await bookingController.extendBooking(req, res);

      expect(booking.end_time).toBe("20:30");
      expect(booking.total_bill).toBe(300000);
      expect(booking.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Gia hạn thành công thêm 30 phút",
        data: {
          end_time: "20:30",
          total_bill: 300000,
        },
      });
    });
  });

  describe("changeTable", () => {
    it("should return 400 when new table is not available", async () => {
      const req = {
        params: { id: "booking-020" },
        user: { accountId: "staff-004", club_id: "club-001" },
        body: { new_table_id: "table-new-01" },
      };
      const res = createRes();

      Booking.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue({
          _id: "booking-020",
          status: "Playing",
          table_id: { _id: "table-old-01", club_id: "club-001", table_number: "D01" },
        }),
      });
      BilliardTable.findById.mockResolvedValue({
        _id: "table-new-01",
        club_id: "club-001",
        table_number: "D02",
        status: "Holding",
      });

      await bookingController.changeTable(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Bàn mới đang không trống",
      });
    });
  });
});
