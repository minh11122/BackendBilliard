const mongoose = require("mongoose");
const Club = require("../../models/club.model");
const Tournament = require("../../models/tournament.model");
const Booking = require("../../models/booking.model");
const Feedback = require("../../models/feedback.model");
const Post = require("../../models/post.model");
const Account = require("../../models/account.model");
const SubscriptionAccount = require("../../models/subcription_account.model");
const Notification = require("../../models/notification.model");
const Image = require("../../models/image.model");
const mailService = require("../../services/mail.service");
const staffController = require("../../controller/staff.controller");

jest.mock("../../models/club.model");
jest.mock("../../models/tournament.model");
jest.mock("../../models/booking.model");
jest.mock("../../models/feedback.model");
jest.mock("../../models/post.model");
jest.mock("../../models/account.model");
jest.mock("../../models/subcription_account.model");
jest.mock("../../models/role.model");
jest.mock("../../models/image.model");
jest.mock("../../models/notification.model");
jest.mock("../../services/mail.service", () => ({
  sendClubApprovalEmail: jest.fn().mockResolvedValue(true),
  sendClubRejectionEmail: jest.fn().mockResolvedValue(true),
}));

const createRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const mockQuery = (val) => ({
  populate: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  then: jest.fn((resolve) => Promise.resolve(val).then(resolve)),
  catch: jest.fn((reject) => Promise.resolve(val).catch(reject)),
});

describe("Staff System Controller - Unit Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getDashboard", () => {
    it("should return system dashboard statistics and pending items", async () => {
      const req = { query: { dateType: "today" } };
      const res = createRes();

      Club.find.mockReturnValue(mockQuery([{ _id: "c1", name: "Pending Club" }]));
      Tournament.find.mockReturnValue(mockQuery([]));
      Booking.find.mockReturnValue(mockQuery([]));
      Feedback.find.mockReturnValue(mockQuery([]));
      Post.find.mockReturnValue(mockQuery([]));
      Club.countDocuments.mockResolvedValue(10);
      Tournament.countDocuments.mockResolvedValue(2);
      Booking.countDocuments.mockResolvedValue(5);
      SubscriptionAccount.find.mockReturnValue(mockQuery([]));

      await staffController.getDashboard(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].data.stats.pendingClubs).toBe(1);
    });
  });

  describe("approveClub", () => {
    it("should approve club, upgrade user to OWNER and send email", async () => {
      const req = { params: { id: "c1" } };
      const res = createRes();

      const clubMock = { _id: "c1", account_id: "u1", status: "Pending" };
      const ownerRoleMock = { _id: "role_owner_id", name: "OWNER" };

      const Role = require("../../models/role.model");
      Role.findOne.mockResolvedValue(ownerRoleMock);

      Club.findByIdAndUpdate.mockResolvedValue(clubMock);
      Account.findById.mockResolvedValue({ _id: "u1", email: "owner@gmail.com" });
      Account.findByIdAndUpdate.mockResolvedValue({});

      await staffController.approveClub(req, res);

      expect(Role.findOne).toHaveBeenCalledWith({ name: "OWNER" });
      expect(Account.findByIdAndUpdate).toHaveBeenCalledWith("u1", { role_id: "role_owner_id" });
      expect(mailService.sendClubApprovalEmail).toHaveBeenCalledWith("owner@gmail.com");
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("rejectClub", () => {
    it("should reject club and send email with reason", async () => {
      const req = { params: { id: "c1" }, body: { reason: "Giấy tờ không hợp lệ" } };
      const res = createRes();

      Club.findByIdAndUpdate.mockResolvedValue({ _id: "c1", account_id: "u1" });
      Account.findById.mockResolvedValue({ _id: "u1", email: "owner@gmail.com" });

      await staffController.rejectClub(req, res);

      expect(mailService.sendClubRejectionEmail).toHaveBeenCalledWith("owner@gmail.com", "Giấy tờ không hợp lệ");
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("Club Management - Lock/Unlock/Get", () => {
    it("should get clubs with status filter", async () => {
      const req = { query: { status: "Pending" } };
      const res = createRes();
      Club.find.mockReturnValue(mockQuery([{ _id: "c1" }]));
      Image.find.mockReturnValue(mockQuery([]));
      await staffController.getClubs(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should lock a club successfully", async () => {
      const req = { params: { id: "c1" } };
      const res = createRes();
      Club.findByIdAndUpdate.mockResolvedValue({ _id: "c1", status: "Locked" });
      await staffController.lockClub(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].message).toBe("Đã khoá CLB");
    });

    it("should unlock a club successfully", async () => {
      const req = { params: { id: "c1" } };
      const res = createRes();
      Club.findByIdAndUpdate.mockResolvedValue({ _id: "c1", status: "Approved" });
      await staffController.unlockClub(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].message).toBe("Đã mở khoá CLB");
    });
  });

  describe("Post Moderation", () => {
    it("should approve post successfully", async () => {
      const req = { params: { id: "p1" } };
      const res = createRes();
      Post.findByIdAndUpdate.mockResolvedValue({ _id: "p1", status: "Approved" });
      await staffController.approvePost(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should reject post with reason", async () => {
      const req = { params: { id: "p1" }, body: { reason: "Spam" } };
      const res = createRes();
      Post.findByIdAndUpdate.mockResolvedValue({ _id: "p1", status: "Rejected" });
      await staffController.rejectPost(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].message).toBe("Đã từ chối bài đăng");
    });
  });

  describe("Notifications", () => {
    it("should get notifications for staff account", async () => {
      const req = { user: { accountId: "staff1" } };
      const res = createRes();
      Notification.find.mockReturnValue(mockQuery([{ title: "New Club" }]));
      await staffController.getNotifications(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should mark all notifications as read", async () => {
      const req = { user: { accountId: "staff1" } };
      const res = createRes();
      Notification.updateMany.mockResolvedValue({ modifiedCount: 1 });
      await staffController.markAllNotificationsRead(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should mark one notification as read", async () => {
      const req = { user: { accountId: "staff1" }, params: { id: "n1" } };
      const res = createRes();
      Notification.findOneAndUpdate.mockResolvedValue({ _id: "n1", is_read: true });
      await staffController.markNotificationRead(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
