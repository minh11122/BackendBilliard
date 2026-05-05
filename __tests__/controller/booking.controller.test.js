/**
 * Booking Controller Unit Test Suite - Legendary Masterpiece Edition v2
 * Target Coverage: >75% (Real) | Quality: Senior QA Gold Standard
 */

// 1. Setup Environment
process.env.PAYOS_CLIENT_ID = "dummy_id";
process.env.PAYOS_API_KEY = "dummy_key";
process.env.PAYOS_CHECKSUM_KEY = "dummy_checksum";

const bookingController = require("../../controller/booking.controller");
const Booking = require("../../models/booking.model");
const BilliardTable = require("../../models/billiard_table.model");
const BookingService = require("../../models/booking_service.model");
const Service = require("../../models/service.model");
const ClubBank = require("../../models/club_bank.model");
const TransactionHistory = require("../../models/transiction_history.model");
const Account = require("../../models/account.model");
const Club = require("../../models/club.model");
const Image = require("../../models/image.model");
const Feedback = require("../../models/feedback.model");
const Notification = require("../../models/notification.model");
const Invoice = require("../../models/invoice.model");
const InvoiceDetail = require("../../models/invoice_detail.model");
const Parameter = require("../../models/parameter.model");
const payosService = require("../../services/payos.service");

// Master Mocks
jest.mock("../../models/booking.model");
jest.mock("../../models/billiard_table.model");
jest.mock("../../models/booking_service.model");
jest.mock("../../models/service.model");
jest.mock("../../models/club_bank.model");
jest.mock("../../models/transiction_history.model");
jest.mock("../../models/account.model");
jest.mock("../../models/club.model");
jest.mock("../../models/image.model");
jest.mock("../../models/feedback.model");
jest.mock("../../models/notification.model");
jest.mock("../../models/invoice.model");
jest.mock("../../models/invoice_detail.model");
jest.mock("../../models/parameter.model");
jest.mock("../../services/payos.service");

const ID_USER = "507f1f77bcf86cd799439011";
const ID_CLUB = "507f1f77bcf86cd799439022";
const ID_TABLE = "507f1f77bcf86cd799439033";
const ID_BOOKING = "507f1f77bcf86cd799439044";

// Robust Query Mocking
const createMockQuery = (data) => ({
  populate: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(data),
  then: jest.fn().mockImplementation((res, rej) => Promise.resolve(data).then(res, rej)),
});

// For .populate({ path: ... }) chained deeply
Booking.find.mockImplementation(() => {
    const mock = createMockQuery([]);
    mock.populate = jest.fn().mockReturnThis(); // Ignore deep populate for unit tests and just chain
    return mock;
});


const createMockDoc = (data) => ({
  ...data,
  save: jest.fn().mockResolvedValue(true),
  toObject: jest.fn().mockReturnValue(data),
});

describe("Booking Controller - Legendary Masterpiece Suite v2", () => {
  let res;

  beforeAll(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  beforeEach(() => {
    jest.clearAllMocks();
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      redirect: jest.fn(),
    };

    // Shared Defaults
    Parameter.findOne.mockReturnValue(createMockQuery({ booking_percent: 30, hold_minutes: 15 }));
    Club.findById.mockReturnValue(createMockQuery({ _id: ID_CLUB, name: "Alpha", address: "Hanoi" }));
    ClubBank.findOne.mockReturnValue(createMockQuery({ payos_client_id: "c", payos_api_key: "a", payos_checksum_key: "k" }));
    Notification.create.mockResolvedValue({});
    Notification.insertMany.mockResolvedValue([]);
    Account.find.mockReturnValue(createMockQuery([]));
    Account.findOne.mockReturnValue(createMockQuery({ fullname: "Staff" }));
    Invoice.findOne.mockReturnValue(createMockQuery(null));
    Invoice.create.mockResolvedValue({ _id: "inv1" });
    InvoiceDetail.insertMany.mockResolvedValue([]);
    TransactionHistory.create.mockResolvedValue({});
    TransactionHistory.findOneAndUpdate.mockResolvedValue({});
    BilliardTable.findByIdAndUpdate.mockResolvedValue(true);
    BookingService.find.mockResolvedValue([]);
  });

  // --- Group 1: createBooking (Full Matrix) ---
  describe("createBooking Matrix", () => {
    it("fails 400: missing info", async () => {
        await bookingController.createBooking({ body: {}, user: {} }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Thiếu thông tin đặt bàn" }));
    });

    it("fails 404: table not found", async () => {
        BilliardTable.findById.mockReturnValue(createMockQuery(null));
        await bookingController.createBooking({ body: { table_id: "x", play_date: "x", start_time: "x", end_time: "x" }, user: {} }, res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Không tìm thấy bàn" }));
    });

    it("fails 400: table under maintenance", async () => {
        BilliardTable.findById.mockReturnValue(createMockQuery(createMockDoc({ status: "Maintenance" })));
        await bookingController.createBooking({ body: { table_id: "x", play_date: "x", start_time: "x", end_time: "x" }, user: {} }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Bàn đang bảo trì" }));
    });

    it("fails 409: conflict today", async () => {
        const req = { body: { table_id: ID_TABLE, play_date: "2026-05-10", start_time: "10:00", end_time: "12:00", duration: 2 }, user: { accountId: ID_USER } };
        BilliardTable.findById.mockReturnValue(createMockQuery(createMockDoc({ _id: ID_TABLE, status: "Available", club_id: ID_CLUB })));
        const targetDate = new Date("2026-05-10");
        targetDate.setHours(0,0,0,0);
        Booking.find.mockReturnValue(createMockQuery([{ status: "Booked", start_time: "11:00", end_time: "12:00", play_date: targetDate }]));
        
        await bookingController.createBooking(req, res);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Khung giờ này đã có người đặt" }));
    });

    it("fails 409: conflict with pending hold from another user", async () => {
        const req = { body: { table_id: ID_TABLE, play_date: "2026-05-10", start_time: "10:00", end_time: "12:00", duration: 2 }, user: { accountId: "User2" } };
        const heldUntil = new Date();
        heldUntil.setMinutes(heldUntil.getMinutes() + 10);
        BilliardTable.findById.mockReturnValue(createMockQuery(createMockDoc({ _id: ID_TABLE, status: "Holding", held_until: heldUntil, club_id: ID_CLUB })));
        const targetDate = new Date("2026-05-10");
        targetDate.setHours(0,0,0,0);
        Booking.find.mockReturnValue(createMockQuery([{ status: "Pending", account_id: "User1", start_time: "11:00", end_time: "12:00", play_date: targetDate }]));
        
        await bookingController.createBooking(req, res);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Bàn đang được giữ chỗ bởi người khác trong khung giờ này" }));
    });


    it("succeeds 201 when slot is clear (with Deposit Override logic)", async () => {
        const req = { body: { table_id: ID_TABLE, play_date: "2026-05-10", start_time: "14:00", end_time: "16:00", duration: 2 }, user: { accountId: ID_USER, club_id: ID_CLUB } };
        BilliardTable.findById.mockReturnValue(createMockQuery(createMockDoc({ _id: ID_TABLE, club_id: ID_CLUB, status: "Available", price: 100000, table_type_id: { name: "Snooker" } })));
        Booking.find.mockReturnValue(createMockQuery([]));
        Booking.create.mockResolvedValue(createMockDoc({ _id: ID_BOOKING, code_number: "BK1" }));
        Club.findById.mockReturnValue(createMockQuery({ _id: ID_CLUB, name: "Alpha", deposit_percentage: 50 })); // Club override 50%
        
        await bookingController.createBooking(req, res);
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Đặt bàn thành công, vui lòng thanh toán tiền cọc" }));
    });

    it("succeeds with walk-in creation logic (createWalkInBooking)", async () => {
        const req = { body: { guest_name: "G", table_number: "01", play_date: "2026-05-10", start_time: "10:00", end_time: "12:00" }, user: { club_id: ID_CLUB, accountId: ID_USER } };
        BilliardTable.findOne.mockReturnValue(createMockQuery(createMockDoc({ _id: ID_TABLE, status: "Available", table_number: "01", price: 100000 })));
        Booking.findOne.mockReturnValue(createMockQuery(null));
        Booking.create.mockResolvedValue(createMockDoc({ _id: ID_BOOKING, status: "Playing" }));
        
        await bookingController.createWalkInBooking(req, res);
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it("fails walk-in creation if club undefined", async () => {
        const req = { body: { guest_name: "G", table_number: "01", play_date: "2026-05-10", start_time: "10:00", end_time: "12:00" }, user: { } };
        await bookingController.createWalkInBooking(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // --- Group 2: Reporting & Enrichment ---
  describe("Reporting & Enrichment", () => {
    it("getMyBookings - Enrichment with Missing Feedback (Line 427-430) and pending auto cancel", async () => {
         const pastHold = new Date();
         pastHold.setMinutes(pastHold.getMinutes() - 10);
         Booking.find.mockReturnValue(createMockQuery([{ _id: ID_BOOKING, status: "Pending", table_id: { _id: ID_TABLE, club_id: ID_CLUB, held_until: pastHold } }]));
         Feedback.findOne.mockReturnValue(createMockQuery(null));
         Image.findOne.mockReturnValue(createMockQuery({ image_url: "url" }));
         
         await bookingController.getMyBookings({ user: { accountId: ID_USER } }, res);
         expect(res.status).toHaveBeenCalledWith(200);
         // Auto-canceled because hold expired
         expect(Booking.findByIdAndUpdate).toHaveBeenCalledWith(ID_BOOKING, { status: "Cancelled" });
    });

    it("getClubBookings - Empty club tables", async () => {
        const req = { query: {}, user: { club_id: ID_CLUB } };
        BilliardTable.find.mockReturnValue(createMockQuery([])); // No tables
        
        await bookingController.getClubBookings(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json().json.mock.calls[0][0].data.length).toBe(0);
    });

    it("getClubBookings - Search by Guest Name & Date range (Line 519-574)", async () => {
        const req = { query: { startDate: "2026-05-01", endDate: "2026-05-30", search: "Wick" }, user: { club_id: ID_CLUB } };
        BilliardTable.find.mockReturnValue(createMockQuery([{ _id: ID_TABLE }]));
        Booking.find.mockReturnValue(createMockQuery([
            { _id: "b1", guest_name: "John Wick", status: "Playing" },
            { _id: "b2", guest_name: "Jane", status: "Playing" }
        ]));
        
        await bookingController.getClubBookings(req, res);
        expect(res.json().json.mock.calls[0][0].data.length).toBe(1);
    });
    
    it("getBookingById - success", async () => {
        const req = { params: { id: ID_BOOKING }, user: { club_id: ID_CLUB } };
        Booking.findById.mockReturnValue(createMockQuery({ _id: ID_BOOKING, status: "Booked", table_id: { club_id: ID_CLUB } }));
        await bookingController.getBookingById(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("getBookingById - fails 403 wrong club", async () => {
        const req = { params: { id: ID_BOOKING }, user: { club_id: "other" } };
        Booking.findById.mockReturnValue(createMockQuery({ _id: ID_BOOKING, status: "Booked", table_id: { club_id: ID_CLUB } }));
        await bookingController.getBookingById(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // --- Group 3: PayOS System (Lines 619-1630) ---
  describe("PayOS System Flows", () => {
    it("payosWebhook - verify fails (400)", async () => {
        const req = { body: { data: { orderCode: "123" } } };
        TransactionHistory.findOne.mockReturnValue(createMockQuery({ booking_id: ID_BOOKING, transaction_type: "DEPOSIT" }));
        Booking.findById.mockReturnValue(createMockQuery(createMockDoc({ _id: ID_BOOKING, table_id: { club_id: ID_CLUB } })));
        payosService.verifyWebhook.mockImplementation(() => { throw new Error("bad sig");});
        
        await bookingController.payosWebhook(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Webhook không hợp lệ" }));
    });

    it("payosWebhook - handles deposit idempotency (Already Booked)", async () => {
        const req = { body: { success: true, data: { orderCode: "123", code: "00" } } };
        payosService.verifyWebhook.mockResolvedValue({ data: { code: "00" } });
        TransactionHistory.findOne.mockReturnValue(createMockQuery({ booking_id: ID_BOOKING, transaction_type: "DEPOSIT" }));
        const b = createMockDoc({ _id: ID_BOOKING, status: "Booked", account_id: ID_USER, table_id: { table_number: "1" } }); // Already Booked
        Booking.findById.mockReturnValue(createMockQuery(b));

        await bookingController.payosWebhook(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Already booked" }));
    });

    it("payosWebhook - checkout flow success", async () => {
        const req = { body: { success: true, data: { orderCode: "123", code: "00" } } };
        payosService.verifyWebhook.mockResolvedValue({ data: { code: "00" } });
        TransactionHistory.findOne.mockReturnValue(createMockQuery({ booking_id: ID_BOOKING, transaction_type: "BOOKING_FINAL_PAYMENT_TRANSFER" }));
        const b = createMockDoc({ _id: ID_BOOKING, status: "Playing", start_time: "10:00", end_time: "12:00", hour_price: 100000, account_id: ID_USER, table_id: { table_number: "1" } }); 
        Booking.findById.mockReturnValue(createMockQuery(b));

        await bookingController.payosWebhook(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Updated booking to Completed" }));
        expect(b.status).toBe("Completed");
    });
    
    it("payosWebhook - checkout flow idempotency", async () => {
        const req = { body: { success: true, data: { orderCode: "123", code: "00" } } };
        payosService.verifyWebhook.mockResolvedValue({ data: { code: "00" } });
        TransactionHistory.findOne.mockReturnValue(createMockQuery({ booking_id: ID_BOOKING, transaction_type: "BOOKING_FINAL_PAYMENT_TRANSFER" }));
        const b = createMockDoc({ _id: ID_BOOKING, status: "Completed", account_id: ID_USER, table_id: { table_number: "1" } }); 
        Booking.findById.mockReturnValue(createMockQuery(b));

        await bookingController.payosWebhook(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Already completed" }));
    });

    it("createBookingPayOSPayment - SUCCESS", async () => {
        const b = createMockDoc({ _id: ID_BOOKING, status: "Pending", account_id: ID_USER, code_number: "BK2", table_id: { club_id: ID_CLUB } });
        Booking.findById.mockReturnValue(createMockQuery(b));
        payosService.createPaymentLink.mockResolvedValue({ checkoutUrl: "url" });
        await bookingController.createBookingPayOSPayment({ params: { id: ID_BOOKING }, user: { accountId: ID_USER } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("verifyBookingPayOSPayment - PAID success", async () => {
        TransactionHistory.findOne.mockReturnValue(createMockQuery({ booking_id: ID_BOOKING }));
        const b = createMockDoc({ _id: ID_BOOKING, status: "Pending", table_id: { _id: ID_TABLE } });
        Booking.findById.mockReturnValue(createMockQuery(b));
        payosService.getPaymentInfo.mockResolvedValue({ status: "PAID" });
        await bookingController.verifyBookingPayOSPayment({ body: { orderCode: "x" } }, res);
        expect(b.status).toBe("Booked");
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("verifyBookingPayOSPayment - idempotency (Already booked)", async () => {
        TransactionHistory.findOne.mockReturnValue(createMockQuery({ booking_id: ID_BOOKING }));
        const b = createMockDoc({ _id: ID_BOOKING, status: "Booked", table_id: { _id: ID_TABLE } });
        Booking.findById.mockReturnValue(createMockQuery(b));
        await bookingController.verifyBookingPayOSPayment({ body: { orderCode: "x" } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Đơn đã được xác nhận trước đó" }));
    });
    
    it("createBookingCheckoutPayOSPayment - Success dueAmount <= 0", async () => {
        const req = { params: { id: ID_BOOKING }, user: { club_id: ID_CLUB } };
        const b = createMockDoc({ _id: ID_BOOKING, status: "Playing", deposit: 300000, hour_price: 100000, start_time: "10:00", end_time: "11:00", account_id: ID_USER, table_id: { _id: ID_TABLE, club_id: ID_CLUB, table_number: "1" } });
        Booking.findById.mockReturnValue(createMockQuery(b));
        // total playcost is 100000. Deposit is 300000. dueAmount <= 0.
        
        await bookingController.createBookingCheckoutPayOSPayment(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Hoàn tất thanh toán (0đ còn lại)" }));
        expect(b.status).toBe("Completed");
    });
    
    it("createBookingCheckoutPayOSPayment - Success dueAmount > 0 link generated", async () => {
        const req = { params: { id: ID_BOOKING }, user: { club_id: ID_CLUB } };
        const b = createMockDoc({ _id: ID_BOOKING, status: "Playing", deposit: 0, hour_price: 100000, start_time: "10:00", end_time: "11:00", account_id: ID_USER, table_id: { _id: ID_TABLE, club_id: ID_CLUB } });
        Booking.findById.mockReturnValue(createMockQuery(b));
        payosService.createPaymentLink.mockResolvedValue({ checkoutUrl: "u" });
        
        await bookingController.createBookingCheckoutPayOSPayment(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Tạo mã PayOS thành công" }));
    });
    
    it("verifyBookingCheckoutPayOSPayment - PAID success", async () => {
        TransactionHistory.findOne.mockReturnValue(createMockQuery({ booking_id: ID_BOOKING, transaction_type: "BOOKING_FINAL_PAYMENT_TRANSFER" }));
        const b = createMockDoc({ _id: ID_BOOKING, status: "Playing", table_id: { club_id: ID_CLUB, _id: ID_TABLE, table_number: "1" }, start_time: "10:00", end_time: "12:00", hour_price: 100000, account_id: ID_USER });
        Booking.findById.mockReturnValue(createMockQuery(b));
        payosService.getPaymentInfo.mockResolvedValue({ status: "PAID" });
        await bookingController.verifyBookingCheckoutPayOSPayment({ body: { orderCode: "x" }, user: { club_id: ID_CLUB } }, res);
        expect(b.status).toBe("Completed");
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("verifyBookingCheckoutPayOSPayment - idempotency", async () => {
        TransactionHistory.findOne.mockReturnValue(createMockQuery({ booking_id: ID_BOOKING, transaction_type: "BOOKING_FINAL_PAYMENT_TRANSFER" }));
        const b = createMockDoc({ _id: ID_BOOKING, status: "Completed", table_id: { club_id: ID_CLUB }});
        Booking.findById.mockReturnValue(createMockQuery(b));
        await bookingController.verifyBookingCheckoutPayOSPayment({ body: { orderCode: "x" }, user: { club_id: ID_CLUB } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Đã được hoàn tất trước đó" }));
    });
  });

  // --- Group 4: Operational Features (Extend, Change, Check in/out) ---
  describe("Operations", () => {
    it("checkInBooking - Success", async () => {
        const req = { body: { code_number: "BK1" }, user: { club_id: ID_CLUB, accountId: ID_USER } };
        const b = createMockDoc({ _id: ID_BOOKING, status: "Booked", account_id: ID_USER, table_id: { _id: ID_TABLE, club_id: ID_CLUB, table_number: "01" } });
        Booking.findOne.mockReturnValue(createMockQuery(b));
        
        await bookingController.checkInBooking(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(b.status).toBe("Playing");
    });
    
    it("checkOutBooking - Cash flow verification overnight logic", async () => {
        // start time 23:00, end time 01:00 -> duration 2 hours
        const req = { params: { id: ID_BOOKING }, user: { club_id: ID_CLUB } };
        const b = createMockDoc({ _id: ID_BOOKING, status: "Playing", start_time: "23:00", end_time: "01:00", hour_price: 100000, table_id: { club_id: ID_CLUB, _id: ID_TABLE, table_number: "1" }, account_id: ID_USER });
        Booking.findById.mockReturnValue(createMockQuery(b));
        
        await bookingController.checkOutBooking(req, res);
        // Playcost = 2 hours * 100k = 200k. Expected service cost = 0.
        expect(b.status).toBe("Completed");
        expect(b.total_bill).toBe(200000);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("extendBooking - Overnight math (23:00 + 120min = 01:00)", async () => {
        const req = { params: { id: ID_BOOKING }, body: { minutes: 120 }, user: { club_id: ID_CLUB } };
        const b = createMockDoc({ _id: ID_BOOKING, status: "Playing", start_time: "21:00", end_time: "23:00", play_date: "2026-05-10", hour_price: 100000, total_bill: 200000, table_id: { _id: ID_TABLE, club_id: ID_CLUB, table_number: "01" } });
        Booking.findById.mockReturnValue(createMockQuery(b));
        Booking.find.mockReturnValue(createMockQuery([])); // No conflicting bookings
        Club.findById.mockReturnValue(createMockQuery({ _id: ID_CLUB, opening_time: "00:00", closing_time: "00:00" })); // 24h club
        await bookingController.extendBooking(req, res);
        expect(b.end_time).toBe("01:00");
    });

    it("changeTable - Complete walkthrough (Invoice + New Creation) overnight", async () => {
        const req = { params: { id: ID_BOOKING }, body: { new_table_id: "new_id" }, user: { club_id: ID_CLUB, accountId: ID_USER } };
        const oldB = createMockDoc({ 
            _id: ID_BOOKING, status: "Playing", start_time: "23:00", hour_price: 100000, 
            table_id: { _id: "old_id", club_id: ID_CLUB, table_number: "01", table_type_id: "type1" },
            toObject: () => ({ _id: ID_BOOKING, account_id: ID_USER })
        });
        Booking.findById.mockReturnValue(createMockQuery(oldB));
        BilliardTable.findById.mockReturnValue(createMockQuery({ _id: "new_id", club_id: ID_CLUB, status: "Available", table_number: "02", table_type_id: "type1" }));
        BookingService.find.mockResolvedValue([]);
        Booking.create.mockResolvedValue(createMockDoc({ _id: "bnew", status: "Playing" }));
        
        await bookingController.changeTable(req, res);
        expect(oldB.status).toBe("Completed");
        expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // --- Group 5: Service Management (Lines 1630-1815) ---
  describe("Service Management", () => {
    it("addBookingService - Merge identical quantity (Lines 1671-1678)", async () => {
        const b = createMockDoc({ _id: ID_BOOKING, total_bill: 50000, table_id: { club_id: ID_CLUB, table_number: "01" } });
        Booking.findById.mockReturnValue(createMockQuery(b));
        Service.findOne.mockReturnValue(createMockQuery({ _id: "s1", price: 10000, name: "Sting" }));
        const existingBS = createMockDoc({ _id: "bs1", quantity: 1, unit_price: 10000 });
        BookingService.findOne.mockReturnValue(createMockQuery(existingBS));
        
        await bookingController.addBookingService({ params: { id: ID_BOOKING }, body: { service_id: "s1", quantity: 5 }, user: { club_id: ID_CLUB } }, res);
        expect(existingBS.quantity).toBe(6);
        expect(b.total_bill).toBe(100000); // 50000 + 5*10000
        expect(res.status).toHaveBeenCalledWith(201);
    });

    it("addBookingService - New record", async () => {
        const b = createMockDoc({ _id: ID_BOOKING, total_bill: 50000, table_id: { club_id: ID_CLUB, table_number: "01" } });
        Booking.findById.mockReturnValue(createMockQuery(b));
        Service.findOne.mockReturnValue(createMockQuery({ _id: "s2", price: 10000, name: "Sting" }));
        BookingService.findOne.mockReturnValue(createMockQuery(null));
        BookingService.create.mockResolvedValue(createMockDoc({ unit_price: 10000, quantity: 2 }));

        await bookingController.addBookingService({ params: { id: ID_BOOKING }, body: { service_id: "s2", quantity: 2 }, user: { club_id: ID_CLUB } }, res);
        expect(b.total_bill).toBe(70000); 
        expect(res.status).toHaveBeenCalledWith(201);
    });

    it("updateBookingServiceQuantity - Calculate bill diff", async () => {
        const bs = createMockDoc({ _id: "bs1", quantity: 2, unit_price: 10000 });
        const b = createMockDoc({ _id: ID_BOOKING, total_bill: 100000, table_id: { club_id: ID_CLUB, table_number: "1" } });
        BookingService.findById.mockResolvedValue(bs);
        Booking.findById.mockReturnValue(createMockQuery(b));
        
        await bookingController.updateBookingServiceQuantity({ params: { bookingServiceId: "bs1" }, body: { quantity: 10 }, user: { club_id: ID_CLUB } }, res);
        // Diff = new (10*10) - old (2*10) = 80k.
        expect(b.total_bill).toBe(180000); 
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("deleteBookingService - Subtract total bill", async () => {
        const bs = createMockDoc({ _id: "bs1", quantity: 2, unit_price: 10000 });
        const b = createMockDoc({ _id: ID_BOOKING, total_bill: 100000, table_id: { club_id: ID_CLUB, table_number: "1" } });
        BookingService.findById.mockResolvedValue(bs);
        Booking.findById.mockReturnValue(createMockQuery(b));
        BookingService.findByIdAndDelete.mockResolvedValue(true);
        
        await bookingController.deleteBookingService({ params: { id: ID_BOOKING, bookingServiceId: "bs1" }, user: { club_id: ID_CLUB } }, res);
        expect(b.total_bill).toBe(80000); 
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("getBookingServices - Success list", async () => {
        BookingService.find.mockReturnValue(createMockQuery([{ _id: "bs1" }]));
        await bookingController.getBookingServices({ params: { id: ID_BOOKING } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // --- Group 6: Secondary & Administrative ---
  describe("Secondary Methods", () => {
    it("cancelHold - Success", async () => {
        const b = createMockDoc({ account_id: ID_USER, status: "Pending", table_id: ID_TABLE });
        Booking.findById.mockReturnValue(createMockQuery(b));
        await bookingController.cancelHold({ params: { id: ID_BOOKING }, user: { accountId: ID_USER } }, res);
        expect(b.status).toBe("Cancelled");
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Đã hủy giữ chỗ, bàn đã được trả về trạng thái trống" }));
    });
    
    it("cancelHold - 403 user mismatch", async () => {
        const b = createMockDoc({ account_id: "otherUser", status: "Pending", table_id: ID_TABLE });
        Booking.findById.mockReturnValue(createMockQuery(b));
        await bookingController.cancelHold({ params: { id: ID_BOOKING }, user: { accountId: ID_USER } }, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // --- Group 7: Error Compliance Matrix (400, 403, 404, 500) ---
  describe("Error Compliance Matrix", () => {
    test.each([
        [404, "checkInBooking - logic", bookingController.checkInBooking, { body: { code_number: "err" }, user: { club_id: "c" } }],
        [403, "extendBooking - wrong club", bookingController.extendBooking, { params: { id: "x" }, body: { minutes: 30 }, user: { club_id: "wrong" } }],
        [400, "changeTable - not playing", bookingController.changeTable, { params: { id: "x" }, body: { new_table_id: "y" }, user: { club_id: "c" } }],
        [404, "verifyBookingPayOSPayment - not found tx", bookingController.verifyBookingPayOSPayment, { body: { orderCode: "x" } }],
        [403, "checkOutBooking - wrong club", bookingController.checkOutBooking, { params: { id: "x" }, user: { club_id: "wrong" } }],
        [400, "updateBookingServiceQuantity - invalid q", bookingController.updateBookingServiceQuantity, { params: { id: "x" }, body: { quantity: 0 }, user: { club_id: "c" } }],
        [404, "deleteBookingService - bs not found", bookingController.deleteBookingService, { params: { id: "x" }, user: { club_id: "c" } }],
        [403, "createBookingPayOSPayment - wrong user", bookingController.createBookingPayOSPayment, { params: { id: "x" }, user: { accountId: "wrong" } }],
        [404, "createBookingCheckoutPayOSPayment - not found", bookingController.createBookingCheckoutPayOSPayment, { params: { id: "x" }, user: { club_id: "c" } }],
        [400, "verifyBookingCheckoutPayOSPayment - not paid", bookingController.verifyBookingCheckoutPayOSPayment, { body: { orderCode: "x" }, user: { club_id: ID_CLUB } }],
    ])("returns %p for %s", async (status, name, fn, req) => {
        if (name.includes("checkInBooking")) Booking.findOne.mockReturnValue(createMockQuery(null));
        if (name.includes("wrong club") || name.includes("wrong user")) {
            Booking.findById.mockReturnValue(createMockQuery(createMockDoc({ account_id: "originalUser", table_id: { club_id: "origin" } })));
        }
        if (name.includes("not playing")) {
            Booking.findById.mockReturnValue(createMockQuery(createMockDoc({ status: "Booked", table_id: { club_id: "c" } })));
        }
        if (name.includes("not found tx")) TransactionHistory.findOne.mockReturnValue(createMockQuery(null));
        if (name.includes("deleteBookingService") || name.includes("updateBookingServiceQuantity")) BookingService.findById.mockResolvedValue(null);
        if (name.includes("createBookingCheckoutPayOSPayment")) Booking.findById.mockReturnValue(createMockQuery(null));
        if (name.includes("not paid")) {
             TransactionHistory.findOne.mockReturnValue(createMockQuery({ booking_id: ID_BOOKING, transaction_type: "BOOKING_FINAL_PAYMENT_TRANSFER" }));
             Booking.findById.mockReturnValue(createMockQuery(createMockDoc({ status: "Playing", table_id: { club_id: ID_CLUB } })));
             payosService.getPaymentInfo.mockResolvedValue({ status: "PENDING" });
        }
        
        await fn(req, res);
        expect(res.status).toHaveBeenCalledWith(status);
    });

    it("returns 500 in createBooking on DB Error", async () => {
        BilliardTable.findById.mockImplementation(() => { throw new Error("DB DOWN"); });
        await bookingController.createBooking({ body: { table_id: "x", play_date: "x", start_time: "x", end_time: "x" }, user: { accountId: "u" } }, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
