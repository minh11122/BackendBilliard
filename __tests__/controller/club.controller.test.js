const mongoose = require("mongoose");
const Club = require("../../models/club.model");
const Image = require("../../models/image.model");
const BilliardTable = require("../../models/billiard_table.model");
const Feedback = require("../../models/feedback.model");
const Province = require("../../models/province.model");
const District = require("../../models/district.model");
const Booking = require("../../models/booking.model");
const Tournament = require("../../models/tournament.model");
const Notification = require("../../models/notification.model");
const Account = require("../../models/account.model");
const SubscriptionAccount = require("../../models/subcription_account.model");
const { geocodeAddress } = require("../../utils/geocoding");
const clubController = require("../../controller/club.controller");

jest.mock("../../models/club.model");
jest.mock("../../models/image.model");
jest.mock("../../models/billiard_table.model");
jest.mock("../../models/feedback.model");
jest.mock("../../models/table_type.model");
jest.mock("../../models/province.model");
jest.mock("../../models/district.model");
jest.mock("../../models/booking.model");
jest.mock("../../models/tournament.model");
jest.mock("../../models/notification.model");
jest.mock("../../models/account.model");
jest.mock("../../models/subcription_account.model");
jest.mock("../../utils/geocoding");
jest.mock("../../models/role.model");

const createRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const mockQuery = (val) => ({
  populate: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(val),
  then: jest.fn((resolve) => Promise.resolve(val).then(resolve)),
  catch: jest.fn((reject) => Promise.resolve(val).catch(reject)),
});

const Role = require("../../models/role.model");

describe("Club Controller - Unit Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    Province.findOne.mockReturnValue(mockQuery({ name: "Hà Nội", code: "01" }));
    District.findOne.mockReturnValue(mockQuery({ name: "Cầu Giấy", code: "01" }));
    // Prevent timeout on registerClub's inline Role require + Account.find
    Role.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    Account.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    Notification.insertMany = jest.fn().mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("registerClub", () => {
    const defaultBody = {
      name: "CLB Bi-a VIP",
      address: "123 Đường Láng, Hà Nội",
      phone: "0987654321",
      tax_code: "123456789",
      opening_time: "08:00",
      closing_time: "23:00"
    };

    it("should register a club successfully", async () => {
      const req = { body: defaultBody, user: { accountId: "u1" } };
      const res = createRes();

      Club.findOne.mockReturnValue(mockQuery(null));
      geocodeAddress.mockResolvedValue({ lat: 21.0285, lng: 105.8542, district: "Đống Đa" });
      Club.create.mockResolvedValue({ _id: "c1", ...defaultBody });
      Club.findById.mockReturnValue(mockQuery({ _id: "c1", ...defaultBody }));
      Account.find.mockReturnValue(mockQuery([]));

      await clubController.registerClub(req, res);

      expect(Club.create).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        message: "Đăng ký câu lạc bộ thành công, vui lòng chờ duyệt"
      }));
    });

    it("should return 400 if tax code exists", async () => {
      const req = { body: defaultBody, user: { accountId: "u1" } };
      const res = createRes();

      Club.findOne.mockReturnValue(mockQuery({ _id: "existed" }));

      await clubController.registerClub(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        message: "Mã số thuế đã tồn tại"
      }));
    });
  });

  describe("getAllClubs", () => {
    it("should return list of approved clubs with info", async () => {
      const req = { query: { keyword: "VIP" } };
      const res = createRes();

      Club.find.mockReturnValue(mockQuery([{ _id: "c1", name: "VIP Hà Nội", status: "Approved" }]));
      Province.findOne.mockReturnValue(mockQuery({ name: "Hà Nội" }));
      District.findOne.mockReturnValue(mockQuery({ name: "Đống Đa" }));
      Image.find.mockReturnValue(mockQuery([]));
      BilliardTable.find.mockReturnValue({ populate: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) });
      Feedback.find.mockReturnValue(mockQuery([]));

      await clubController.getAllClubs(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].data[0].name).toBe("VIP Hà Nội");
    });
  });

  describe("getClubById", () => {
    it("should return club detail with table availability", async () => {
      const req = { 
        params: { id: "c1" }, 
        query: { play_date: "2026-05-10", startTime: "18:00", duration: "2" } 
      };
      const res = createRes();

      Club.findById.mockReturnValue(mockQuery({ _id: "c1", name: "CLB 1", opening_time: "08:00", closing_time: "23:00" }));
      Image.find.mockReturnValue(mockQuery([]));
      BilliardTable.updateMany.mockResolvedValue({});
      BilliardTable.find.mockReturnValue({ populate: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([{ _id: "t1", status: "Available", price: 100000 }]) });
      Booking.find.mockReturnValue(mockQuery([])); // No overlapping bookings
      SubscriptionAccount.findOne.mockReturnValue({ populate: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(null) });
      Feedback.find.mockReturnValue({ populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) });

      await clubController.getClubById(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].data.name).toBe("CLB 1");
    });

    it("should mark table as Holding if cross midnight booking overlaps", async () => {
        const req = { 
          params: { id: "c1" }, 
          query: { play_date: "2026-05-10", startTime: "01:00", duration: "1" } // 01:00 - 02:00
        };
        const res = createRes();
  
        Club.findById.mockReturnValue(mockQuery({ _id: "c1", opening_time: "00:00", closing_time: "00:00" }));
        BilliardTable.find.mockReturnValue({ populate: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([{ _id: "t1", status: "Available" }]) });
        
        // Mock a booking from yesterday that ended today at 03:00
        Booking.find.mockReturnValue(mockQuery([{ 
            table_id: "t1", 
            play_date: new Date("2026-05-09"), // Yesterday
            start_time: "22:00", 
            end_time: "03:00", // Ended today at 03:00 (Cross midnight)
            status: "Booked"
        }]));
        Image.find.mockReturnValue(mockQuery([]));
        BilliardTable.updateMany.mockResolvedValue({});
        SubscriptionAccount.findOne.mockReturnValue({ populate: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(null) });
        Feedback.find.mockReturnValue({ populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) });
  
        await clubController.getClubById(req, res);
  
        expect(res.json.mock.calls[0][0].data.tables[0].status).toBe("Holding");
      });
  });

  describe("updateClub", () => {
    it("should update club and reset rejected status", async () => {
      const req = { 
        params: { id: "c1" }, 
        user: { accountId: "u1" }, 
        body: { name: "New Name", avatar: "url1" } 
      };
      const res = createRes();

      const clubMock = { _id: "c1", name: "Old", status: "Rejected", save: jest.fn() };
      Club.findOne.mockResolvedValue(clubMock);
      Image.deleteMany.mockResolvedValue({});
      Image.create.mockResolvedValue({});

      await clubController.updateClub(req, res);

      expect(clubMock.name).toBe("New Name");
      expect(clubMock.status).toBe("Pending"); // reset status
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("getClubStatistics", () => {
    it("should return stats for Pro plan", async () => {
      const req = { user: { role: "OWNER", accountId: "u1" }, query: {} };
      const res = createRes();

      Club.findOne.mockReturnValue(mockQuery({ _id: "c1", name: "Club Pro", plan_type: "pro" }));
      Club.findById.mockReturnValue(mockQuery({ _id: "c1", name: "Club Pro", plan_type: "pro" }));
      BilliardTable.find.mockReturnValue(mockQuery([{ _id: "t1" }]));
      Booking.find.mockReturnValue(mockQuery([]));
      Feedback.find.mockReturnValue({ populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) });
      Tournament.find.mockReturnValue(mockQuery([]));

      await clubController.getClubStatistics(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].data.clubName).toBe("Club Pro");
    });

    it("should return 403 for Free plan", async () => {
        const req = { user: { role: "OWNER", accountId: "u1" }, query: {} };
        const res = createRes();
  
        Club.findOne.mockReturnValue(mockQuery({ _id: "c1", plan_type: "free" }));
        Club.findById.mockReturnValue(mockQuery({ _id: "c1", plan_type: "free" }));
  
        await clubController.getClubStatistics(req, res);
  
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json.mock.calls[0][0].message).toContain("gói Basic hoặc Pro");
      });
  });


  // ══════════════════════════════════════════════════════════════
  // registerClub - Extra Branch Coverage
  // ══════════════════════════════════════════════════════════════
  describe("registerClub - extra branches", () => {
    const defaultBody = {
      name: "CLB Bi-a VIP",
      address: "123 Đường Láng, Hà Nội",
      phone: "0987654321",
      tax_code: "123456789",
      opening_time: "08:00",
      closing_time: "23:00"
    };

    it("FAIL 401 - missing user / accountId", async () => {
      const res = createRes();
      await clubController.registerClub({ body: defaultBody, user: null }, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("FAIL 400 - missing required fields (no name)", async () => {
      const res = createRes();
      await clubController.registerClub({
        body: { address: "addr", phone: "0912", tax_code: "123" }, // missing name
        user: { accountId: "u1" }
      }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("SUCCESS - uses frontend lat/lng (skips geocode, uses district from DB)", async () => {
      const res = createRes();
      Club.findOne.mockReturnValue(mockQuery(null));
      Club.create.mockResolvedValue({ _id: "c1", ...defaultBody });
      Club.findById.mockReturnValue(mockQuery({ _id: "c1", ...defaultBody }));
      Account.find.mockReturnValue(mockQuery([]));
      District.findOne.mockReturnValue(mockQuery({ name: "Cầu Giấy", name_with_type: "Quận Cầu Giấy" }));

      await clubController.registerClub({
        body: { ...defaultBody, lat: 21.0, lng: 105.8, district_code: "d1" },
        user: { accountId: "u1" }
      }, res);

      expect(geocodeAddress).not.toHaveBeenCalled(); // skipped
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("SUCCESS - inserts legalDocuments and sends staff notifications", async () => {
      const res = createRes();
      Club.findOne.mockReturnValue(mockQuery(null));
      geocodeAddress.mockResolvedValue({ lat: 21.0, lng: 105.8, district: "Đống Đa" });
      Club.create.mockResolvedValue({ _id: "c2", name: "NewClub" });
      Club.findById.mockReturnValue(mockQuery({ _id: "c2", name: "NewClub" }));
      // Role found → Account.find returns staff
      Role.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: "role1", name: "STAFF_SYSTEM" }) });
      Account.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: "staff1" }]) });
      Image.insertMany = jest.fn().mockResolvedValue([]);
      Notification.insertMany = jest.fn().mockResolvedValue([]);

      await clubController.registerClub({
        body: { ...defaultBody, legalDocuments: ["url1", "url2"] },
        user: { accountId: "u1" }
      }, res);

      expect(Image.insertMany).toHaveBeenCalled();
      expect(Notification.insertMany).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("SUCCESS - geocode fails gracefully (still creates club)", async () => {
      const res = createRes();
      Club.findOne.mockReturnValue(mockQuery(null));
      geocodeAddress.mockRejectedValue(new Error("geocode failed"));
      Club.create.mockResolvedValue({ _id: "c3", ...defaultBody });
      Club.findById.mockReturnValue(mockQuery({ _id: "c3", ...defaultBody }));
      Account.find.mockReturnValue(mockQuery([]));

      await clubController.registerClub({
        body: defaultBody, // no lat/lng → tries to geocode → fails
        user: { accountId: "u1" }
      }, res);

      // Should still succeed despite geocode error
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("FAIL 500 - DB error in Club.create", async () => {
      const res = createRes();
      Club.findOne.mockReturnValue(mockQuery(null));
      geocodeAddress.mockResolvedValue({ lat: 21.0, lng: 105.8, district: "D" });
      Club.create.mockRejectedValue(new Error("DB create fail"));

      await clubController.registerClub({
        body: defaultBody,
        user: { accountId: "u1" }
      }, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // getClubsByAccount - Branch Coverage
  // ══════════════════════════════════════════════════════════════
  describe("getClubsByAccount - branch coverage", () => {
    it("SUCCESS - returns clubs with plan_type synced (basic sub detected)", async () => {
      const res = createRes();
      Club.find.mockReturnValue(mockQuery([{ _id: "c1", plan_type: "free" }]));
      Image.find.mockReturnValue(mockQuery([]));
      // Active subscription with "basic" in name
      SubscriptionAccount.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue({ subscription_id: { name: "Basic Plan" } })
      });
      Club.updateOne.mockResolvedValue({});

      await clubController.getClubsByAccount({ user: { accountId: "u1" }, query: {} }, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("SUCCESS - club with pro subscription detected", async () => {
      const res = createRes();
      Club.find.mockReturnValue(mockQuery([{ _id: "c1", plan_type: "free" }]));
      Image.find.mockReturnValue(mockQuery([{ image_url: "banner.jpg" }])); // banner exists → avatar non-null
      SubscriptionAccount.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue({ subscription_id: { name: "Pro Premium" } })
      });
      Club.updateOne.mockResolvedValue({});

      await clubController.getClubsByAccount({ user: { accountId: "u1" }, query: {} }, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("SUCCESS - no active subscription → stays free (no updateOne call)", async () => {
      const res = createRes();
      Club.find.mockReturnValue(mockQuery([{ _id: "c1", plan_type: "free" }]));
      Image.find.mockReturnValue(mockQuery([]));
      SubscriptionAccount.findOne.mockReturnValue({
        populate: jest.fn().mockResolvedValue(null) // no active sub
      });

      await clubController.getClubsByAccount({ user: { accountId: "u1" }, query: {} }, res);
      expect(Club.updateOne).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("FAIL 400 - missing account_id", async () => {
      const res = createRes();
      await clubController.getClubsByAccount({ user: {}, query: {} }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("FAIL 500 - DB error", async () => {
      const res = createRes();
      Club.find.mockImplementation(() => { throw new Error("DB"); });
      await clubController.getClubsByAccount({ user: { accountId: "u1" }, query: {} }, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // updateClub - Extra Branch Coverage
  // ══════════════════════════════════════════════════════════════
  describe("updateClub - extra branches", () => {
    it("FAIL 404 - club not found or user doesn't own it", async () => {
      const res = createRes();
      Club.findOne.mockResolvedValue(null);
      await clubController.updateClub({ params: { id: "c99" }, user: { accountId: "u1" }, body: {} }, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("SUCCESS - updates avatar and background images", async () => {
      const res = createRes();
      const clubMock = { _id: "c1", name: "Old", status: "Approved", save: jest.fn() };
      Club.findOne.mockResolvedValue(clubMock);
      Image.deleteMany.mockResolvedValue({});
      Image.insertMany.mockResolvedValue([]);
      Image.create.mockResolvedValue({});

      await clubController.updateClub({
        params: { id: "c1" },
        user: { accountId: "u1" },
        body: {
          name: "New Name",
          avatar: "avatar.jpg",
          backgrounds: ["bg1.jpg", "bg2.jpg"] // Array → triggers deleteMany + insertMany
        }
      }, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("SUCCESS - updates legalDocuments images", async () => {
      const res = createRes();
      const clubMock = { _id: "c1", status: "Rejected", save: jest.fn() };
      Club.findOne.mockResolvedValue(clubMock);
      Image.deleteMany.mockResolvedValue({});
      Image.insertMany.mockResolvedValue([]);

      await clubController.updateClub({
        params: { id: "c1" },
        user: { accountId: "u1" },
        body: { legalDocuments: ["legal1.pdf", null, "legal2.pdf"] } // null filtered out
      }, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("SUCCESS - empty backgrounds array → deleteMany but no insertMany", async () => {
      const res = createRes();
      const clubMock = { _id: "c1", save: jest.fn() };
      Club.findOne.mockResolvedValue(clubMock);
      Image.deleteMany.mockResolvedValue({});

      await clubController.updateClub({
        params: { id: "c1" },
        user: { accountId: "u1" },
        body: { backgrounds: [] } // empty → deleteMany only
      }, res);
      expect(Image.deleteMany).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // getClubStatistics - Extra Branch Coverage
  // ══════════════════════════════════════════════════════════════
  describe("getClubStatistics - extra branches", () => {
    it("SUCCESS - STAFF_CLUB role uses direct club_id from user", async () => {
      const res = createRes();
      Club.findById.mockReturnValue(mockQuery({ _id: "c1", name: "Club A", plan_type: "pro" }));
      BilliardTable.find.mockReturnValue(mockQuery([]));
      Booking.find.mockReturnValue(mockQuery([]));
      Feedback.find.mockReturnValue({ populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) });
      Tournament.find.mockReturnValue(mockQuery([]));

      await clubController.getClubStatistics({
        user: { role: "STAFF_CLUB", club_id: "c1" },
        query: {}
      }, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("FAIL 404 - OWNER has no club", async () => {
      const res = createRes();
      Club.findOne.mockReturnValue(mockQuery(null)); // no club found for owner
      await clubController.getClubStatistics({
        user: { role: "OWNER", accountId: "u1" },
        query: {}
      }, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("FAIL 403 - other role (e.g., CUSTOMER) cannot access", async () => {
      const res = createRes();
      await clubController.getClubStatistics({
        user: { role: "CUSTOMER", accountId: "u1" },
        query: {}
      }, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("FAIL 404 - club not found after resolving club_id", async () => {
      const res = createRes();
      // STAFF_CLUB with club_id that doesn't exist
      Club.findById.mockReturnValue(mockQuery(null));
      await clubController.getClubStatistics({
        user: { role: "STAFF_CLUB", club_id: "bad_id" },
        query: {}
      }, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("SUCCESS - with month+year filter applies dateFilter in queries", async () => {
      const res = createRes();
      Club.findById.mockReturnValue(mockQuery({ _id: "c1", name: "Club Pro", plan_type: "pro" }));
      BilliardTable.find.mockReturnValue(mockQuery([]));
      Booking.find.mockReturnValue(mockQuery([{ status: "Completed", total_bill: 500000 }]));
      Feedback.find.mockReturnValue({ populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) });
      Tournament.find.mockReturnValue(mockQuery([]));

      await clubController.getClubStatistics({
        user: { role: "STAFF_CLUB", club_id: "c1" },
        query: { month: "4", year: "2026" }
      }, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("FAIL 500 - DB error", async () => {
      const res = createRes();
      Club.findById.mockImplementation(() => { throw new Error("DB error"); });
      await clubController.getClubStatistics({
        user: { role: "STAFF_CLUB", club_id: "c1" },
        query: {}
      }, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // completeOnboarding - Extra Branch Coverage
  // ══════════════════════════════════════════════════════════════
  describe("completeOnboarding - extra branches", () => {
    it("FAIL 404 - club not found or not owned by user", async () => {
      const res = createRes();
      Club.findOne.mockResolvedValue(null);
      await clubController.completeOnboarding({ params: { id: "c99" }, user: { accountId: "u1" } }, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("SUCCESS - detects 'basic' plan from subscription name", async () => {
      const res = createRes();
      const clubMock = { _id: "c1", plan_type: "free", save: jest.fn() };
      Club.findOne.mockResolvedValue(clubMock);
      SubscriptionAccount.findOne.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue({ subscription_id: { name: "Basic Standard" } })
      });

      await clubController.completeOnboarding({ params: { id: "c1" }, user: { accountId: "u1" } }, res);
      expect(clubMock.plan_type).toBe("basic");
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("SUCCESS - detects 'pro' plan from subscription name", async () => {
      const res = createRes();
      const clubMock = { _id: "c1", plan_type: "free", save: jest.fn() };
      Club.findOne.mockResolvedValue(clubMock);
      SubscriptionAccount.findOne.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue({ subscription_id: { name: "Pro Max" } })
      });

      await clubController.completeOnboarding({ params: { id: "c1" }, user: { accountId: "u1" } }, res);
      expect(clubMock.plan_type).toBe("pro");
    });

    it("SUCCESS - no active subscription → plan stays 'free'", async () => {
      const res = createRes();
      const clubMock = { _id: "c1", plan_type: "basic", save: jest.fn() };
      Club.findOne.mockResolvedValue(clubMock);
      SubscriptionAccount.findOne.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue(null) // no active sub
      });

      await clubController.completeOnboarding({ params: { id: "c1" }, user: { accountId: "u1" } }, res);
      expect(clubMock.plan_type).toBe("free");
    });

    it("FAIL 500 - DB error", async () => {
      const res = createRes();
      Club.findOne.mockRejectedValue(new Error("DB error"));
      await clubController.completeOnboarding({ params: { id: "c1" }, user: { accountId: "u1" } }, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});

