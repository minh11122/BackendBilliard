const clubAnalyticsController = require("../../controller/club/clubAnalytics.controller");
const Invoice = require("../../models/invoice.model");
const Booking = require("../../models/booking.model");
const BilliardTable = require("../../models/billiard_table.model");
const TableType = require("../../models/table_type.model");
const Service = require("../../models/service.model");
const BookingService = require("../../models/booking_service.model");
const Feedback = require("../../models/feedback.model");
const Club = require("../../models/club.model");
const Tournament = require("../../models/tournament.model");
const TransactionHistory = require("../../models/transiction_history.model");

jest.mock("../../models/invoice.model");
jest.mock("../../models/booking.model");
jest.mock("../../models/billiard_table.model");
jest.mock("../../models/table_type.model");
jest.mock("../../models/service.model");
jest.mock("../../models/booking_service.model");
jest.mock("../../models/feedback.model");
jest.mock("../../models/club.model");
jest.mock("../../models/tournament.model");
jest.mock("../../models/transiction_history.model");
jest.mock("../../controller/club/club.helpers", () => ({
  canAccessClub: jest.fn().mockResolvedValue(true)
}));

const createRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("Club Analytics Controller - Unit Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getClubAnalytics", () => {
    it("should return full analytics data for a pro club", async () => {
      const validClubId = "65d1a1111111111111111111";
      const validTableId = "65d1a2222222222222222222";
      const validBookingId = "65d1a3333333333333333333";
      const validTypeId = "65d1a4444444444444444444";
      const validServiceId = "65d1a5555555555555555555";

      const req = {
        params: { id: validClubId },
        query: { startDate: "2026-04-01", endDate: "2026-04-30" }
      };
      const res = createRes();

      // 1. Mock Club access check
      Club.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: validClubId, plan_type: "pro" }) });

      // 2. Mock Tables aggregation
      BilliardTable.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ _id: validTableId, table_number: "01", table_type_id: validTypeId }])
        })
      });

      // 3. Mock Bookings (Call 1: For IDs)
      const mockQuery1 = {
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{ _id: validBookingId }])
      };
      Booking.find.mockReturnValueOnce(mockQuery1);

      // 4. Mock TransactionHistory (New Source of Truth for Revenue)
      TransactionHistory.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([{
          booking_id: validBookingId,
          amount: 150000,
          transaction_time: "2026-04-10",
          transaction_type: "BOOKING_FINAL_PAYMENT_CASH"
        }])
      });

      // 5. Mock Bookings in range (Call 2: For Performance)
      const mockQuery2 = {
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{
           _id: validBookingId,
           table_id: { _id: validTableId, table_number: "01", table_type_id: validTypeId },
           total_bill: 150000,
           start_time: "10:00",
           end_time: "12:00"
        }])
      };
      Booking.find.mockReturnValueOnce(mockQuery2);

      // 6. Mock Table Types
      TableType.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: validTypeId, name: "Pool" }]) });

      // 7. Mock Services (2 calls: first .lean() then .populate().lean())
      BookingService.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{
             service_id: { _id: validServiceId, name: "Pepsi" },
             booking_id: validBookingId,
             quantity: 2,
             unit_price: 15000
          }])
        })
      });
      Service.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: validServiceId, name: "Pepsi", status: "Active" }]) });

      // 8. Mock Feedback
      Feedback.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ rating: 5 }, { rating: 4 }]) });
      Invoice.countDocuments.mockResolvedValue(1); // Unpaid debt
      Tournament.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([])
      });

      await clubAnalyticsController.getClubAnalytics(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const data = res.json.mock.calls[0][0].data;
      expect(data.kpi.totalRevenue).toBe(150000);
      expect(data.feedback.average).toBe(4.5);
    });

    it("should return 403 if club is on free plan", async () => {
      const validClubId = "65d1a1111111111111111111";
      const req = { params: { id: validClubId }, query: {} };
      const res = createRes();
      Club.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: validClubId, plan_type: "free" }) });
      await clubAnalyticsController.getClubAnalytics(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("should return 404 if club not found", async () => {
      const req = { params: { id: "c_none" }, query: {} };
      const res = createRes();
      Club.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      await clubAnalyticsController.getClubAnalytics(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});
