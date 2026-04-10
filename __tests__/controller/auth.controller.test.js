jest.mock("google-auth-library", () => {
  const verifyIdToken = jest.fn();
  return {
    OAuth2Client: jest.fn(() => ({
      verifyIdToken,
    })),
    __mockVerifyIdToken: verifyIdToken,
  };
});

jest.mock("jsonwebtoken", () => ({
  sign: jest.fn(),
}));

jest.mock("bcryptjs", () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

jest.mock("../../utils/generateOtp", () => ({
  generateOtp: jest.fn(),
}));

jest.mock("../../utils/generateTempPassword", () => ({
  generateTempPassword: jest.fn(),
}));

jest.mock("../../services/mail.service", () => ({
  sendOtpEmail: jest.fn(),
  sendResetPasswordEmail: jest.fn(),
}));

jest.mock("../../models/account.model", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
}));

jest.mock("../../models/role.model", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
}));

jest.mock("../../models/otp.model", () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  deleteOne: jest.fn(),
}));

jest.mock("../../models/notification.model", () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  updateMany: jest.fn(),
  findByIdAndDelete: jest.fn(),
  deleteMany: jest.fn(),
}));

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { generateOtp } = require("../../utils/generateOtp");
const { generateTempPassword } = require("../../utils/generateTempPassword");
const { sendOtpEmail, sendResetPasswordEmail } = require("../../services/mail.service");
const Account = require("../../models/account.model");
const Role = require("../../models/role.model");
const Otp = require("../../models/otp.model");
const Notification = require("../../models/notification.model");
const authController = require("../../controller/auth/auth.controller");

const createRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("Auth Controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("register", () => {
    it("should register successfully and send OTP", async () => {
      const req = {
        body: {
          email: "ngocanh.nguyen@example.com",
          password: "MatKhau@123",
          confirmPassword: "MatKhau@123",
        },
      };
      const res = createRes();

      Account.findOne.mockResolvedValue(null);
      Role.findOne.mockResolvedValue({ _id: "role-customer-01" });
      bcrypt.hash.mockResolvedValue("hashed-password");
      Account.create.mockResolvedValue({ _id: "acc-001" });
      generateOtp.mockReturnValue("482951");
      Otp.findOneAndUpdate.mockResolvedValue({});
      sendOtpEmail.mockResolvedValue();

      await authController.register(req, res);

      expect(Account.create).toHaveBeenCalledWith(expect.objectContaining({ email: "ngocanh.nguyen@example.com" }));
      expect(sendOtpEmail).toHaveBeenCalledWith("ngocanh.nguyen@example.com", "482951");
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("should return 400 when required fields are missing", async () => {
      const req = { body: { email: "", password: "", confirmPassword: "" } };
      const res = createRes();
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 when passwords do not match", async () => {
      const req = { body: { email: "a@a.com", password: "123", confirmPassword: "456" } };
      const res = createRes();
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 when email already exists", async () => {
      const req = { body: { email: "dup@e.com", password: "123", confirmPassword: "123" } };
      const res = createRes();
      Account.findOne.mockResolvedValue({ _id: "acc-02" });
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should handle duplicate key error (11000)", async () => {
      const req = { body: { email: "dup@e.com", password: "123", confirmPassword: "123" } };
      const res = createRes();
      Account.findOne.mockResolvedValue(null);
      Role.findOne.mockResolvedValue({ _id: "r1" });
      Account.create.mockRejectedValue({ code: 11000, keyPattern: { email: 1 } });
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 500 on unexpected error", async () => {
      const req = { body: { email: "e@e.com", password: "123", confirmPassword: "123" } };
      const res = createRes();
      Account.findOne.mockRejectedValue(new Error("DB error"));
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe("verifyOtp", () => {
    it("should verify successfully", async () => {
      const req = { body: { email: "e@e.com", otp_code: "123" } };
      const res = createRes();
      const account = { save: jest.fn(), status: "PENDING" };
      Account.findOne.mockResolvedValue(account);
      Otp.findOne.mockResolvedValue({ _id: "o1", otp_code: "123", expires_at: new Date(Date.now() + 1000) });
      await authController.verifyOtp(req, res);
      expect(account.status).toBe("ACTIVE");
      expect(res.json).toHaveBeenCalledWith({ message: "Xác thực thành công" });
    });

    it("should return 404 if account not found", async () => {
      const req = { body: { email: "n@e.com", otp_code: "1" } };
      const res = createRes();
      Account.findOne.mockResolvedValue(null);
      await authController.verifyOtp(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should return 400 if otp not found", async () => {
      const req = { body: { email: "e@e.com", otp_code: "1" } };
      const res = createRes();
      Account.findOne.mockResolvedValue({ _id: "a1" });
      Otp.findOne.mockResolvedValue(null);
      await authController.verifyOtp(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 if otp expired", async () => {
      const req = { body: { email: "e@e.com", otp_code: "1" } };
      const res = createRes();
      Account.findOne.mockResolvedValue({ _id: "a1" });
      Otp.findOne.mockResolvedValue({ expires_at: new Date(Date.now() - 1000) });
      await authController.verifyOtp(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 if too many attempts", async () => {
      const req = { body: { email: "e@e.com", otp_code: "1" } };
      const res = createRes();
      Account.findOne.mockResolvedValue({ _id: "a1" });
      Otp.findOne.mockResolvedValue({ expires_at: new Date(Date.now() + 1000), attempts: 5 });
      await authController.verifyOtp(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 if otp incorrect", async () => {
      const req = { body: { email: "e@e.com", otp_code: "wrong" } };
      const res = createRes();
      const otp = { otp_code: "123", attempts: 0, save: jest.fn(), expires_at: new Date(Date.now() + 1000) };
      Account.findOne.mockResolvedValue({ _id: "a1" });
      Otp.findOne.mockResolvedValue(otp);
      await authController.verifyOtp(req, res);
      expect(otp.attempts).toBe(1);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("resendOtp", () => {
    it("should resend successfully", async () => {
      const req = { body: { email: "e@e.com" } };
      const res = createRes();
      Account.findOne.mockResolvedValue({ _id: "a1", status: "PENDING" });
      generateOtp.mockReturnValue("111");
      await authController.resendOtp(req, res);
      expect(sendOtpEmail).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ message: "OTP mới đã được gửi" });
    });

    it("should return 404 if account not found", async () => {
      const req = { body: { email: "n@e.com" } };
      const res = createRes();
      Account.findOne.mockResolvedValue(null);
      await authController.resendOtp(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should return 400 if already active", async () => {
      const req = { body: { email: "a@e.com" } };
      const res = createRes();
      Account.findOne.mockResolvedValue({ status: "ACTIVE" });
      await authController.resendOtp(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("registerGoogle", () => {
    const { __mockVerifyIdToken } = require("google-auth-library");
    it("should register via google successfully", async () => {
      const req = { body: { tokenId: "tok" } };
      const res = createRes();
      __mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({ email: "g@e.com", name: "n", picture: "p", sub: "s" }),
      });
      Account.findOne.mockResolvedValue(null);
      Role.findOne.mockResolvedValue({ _id: "role-customer-01" });
      Account.create.mockResolvedValue({ _id: "acc-goog-new" });

      await authController.registerGoogle(req, res);
      expect(Account.create).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("should return 400 if email registered", async () => {
      const req = { body: { tokenId: "tok" } };
      const res = createRes();
      __mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "g@e.com" }) });
      Account.findOne.mockResolvedValue({ _id: "a1" });
      await authController.registerGoogle(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 500 if role CUSTOMER not found", async () => {
      const req = { body: { tokenId: "tok" } };
      const res = createRes();
      __mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "g@e.com" }) });
      Account.findOne.mockResolvedValue(null);
      Role.findOne.mockResolvedValue(null);
      await authController.registerGoogle(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe("forgotPassword", () => {
    it("should send reset email successfully", async () => {
      const req = { body: { email: "e@e.com" } };
      const res = createRes();
      const account = { provider: "local", status: "ACTIVE", save: jest.fn() };
      Account.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(account) });
      generateTempPassword.mockReturnValue("tmp");
      bcrypt.hash.mockResolvedValue("hash");
      await authController.forgotPassword(req, res);
      expect(sendResetPasswordEmail).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ message: "Mật khẩu tạm thời đã được gửi" });
    });

    it("should return 404 if no account", async () => {
      const req = { body: { email: "n@e.com" } };
      const res = createRes();
      Account.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
      await authController.forgotPassword(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should return 400 if google provider", async () => {
      const req = { body: { email: "g@e.com" } };
      const res = createRes();
      Account.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ provider: "google" }) });
      await authController.forgotPassword(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 if not active", async () => {
      const req = { body: { email: "p@e.com" } };
      const res = createRes();
      Account.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ provider: "local", status: "PENDING" }) });
      await authController.forgotPassword(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("login", () => {
    it("should login successfully", async () => {
      const req = { body: { email: "e@e.com", password: "p" } };
      const res = createRes();
      const account = { _id: "a1", provider: "local", status: "ACTIVE", password_hash: "h", role_id: { _id: "r1", name: "USER" } };
      Account.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(account)
        })
      });
      bcrypt.compare.mockResolvedValue(true);
      jwt.sign.mockReturnValue("tok");
      await authController.login(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: "tok" }));
    });

    it("should return 404 if no email", async () => {
      const req = { body: { email: "n" } };
      const res = createRes();
      Account.findOne.mockReturnValue({ select: jest.fn().mockReturnValue({ populate: jest.fn().mockResolvedValue(null) }) });
      await authController.login(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should return 400 if wrong provider", async () => {
      const req = { body: { email: "g" } };
      const res = createRes();
      Account.findOne.mockReturnValue({ select: jest.fn().mockReturnValue({ populate: jest.fn().mockResolvedValue({ provider: "google" }) }) });
      await authController.login(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 403 if not active", async () => {
      const req = { body: { email: "p" } };
      const res = createRes();
      Account.findOne.mockReturnValue({ select: jest.fn().mockReturnValue({ populate: jest.fn().mockResolvedValue({ provider: "local", status: "PENDING" }) }) });
      await authController.login(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("should return 400 if wrong password", async () => {
      const req = { body: { email: "e", password: "p" } };
      const res = createRes();
      Account.findOne.mockReturnValue({ select: jest.fn().mockReturnValue({ populate: jest.fn().mockResolvedValue({ provider: "local", status: "ACTIVE", password_hash: "h" }) }) });
      bcrypt.compare.mockResolvedValue(false);
      await authController.login(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("loginGoogle", () => {
    const { __mockVerifyIdToken } = require("google-auth-library");
    it("should login successfully", async () => {
      const req = { body: { tokenId: "tok" } };
      const res = createRes();
      __mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "g@e.com" }) });
      Account.findOne.mockResolvedValue({ _id: "a1", status: "ACTIVE", role_id: "r1" });
      jwt.sign.mockReturnValue("tok");
      await authController.loginGoogle(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: "tok" }));
    });

    it("should return 404 if not found", async () => {
      const req = { body: { tokenId: "tok" } };
      const res = createRes();
      __mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "g" }) });
      Account.findOne.mockResolvedValue(null);
      await authController.loginGoogle(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should return 403 if not active", async () => {
      const req = { body: { tokenId: "tok" } };
      const res = createRes();
      __mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "g" }) });
      Account.findOne.mockResolvedValue({ status: "BANNED" });
      await authController.loginGoogle(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe("googleAuth", () => {
    const { __mockVerifyIdToken } = require("google-auth-library");
    it("should auth and create successfully", async () => {
      const req = { body: { tokenId: "tok" } };
      const res = createRes();
      __mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "g", name: "n", picture: "p", sub: "s" }) });
      Account.findOne.mockResolvedValue(null);
      Role.findOne.mockResolvedValue({ _id: "r1" });
      Account.create.mockResolvedValue({ _id: "a1", provider: "google", status: "ACTIVE", role_id: "r1" });
      jwt.sign.mockReturnValue("tok");
      await authController.googleAuth(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: "tok" }));
    });

    it("should return 400 if registered with local", async () => {
      const req = { body: { tokenId: "tok" } };
      const res = createRes();
      __mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "g" }) });
      Account.findOne.mockResolvedValue({ provider: "local" });
      await authController.googleAuth(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 403 if trapped status", async () => {
      const req = { body: { tokenId: "tok" } };
      const res = createRes();
      __mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "g" }) });
      Account.findOne.mockResolvedValue({ provider: "google", status: "BANNED" });
      await authController.googleAuth(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe("updateProfile", () => {
    it("should update successfully", async () => {
      const req = { user: { accountId: "a1" }, body: { fullname: "n", phone: "0912345678" } };
      const res = createRes();
      const account = { save: jest.fn() };
      Account.findById.mockResolvedValueOnce(account);
      Account.findById.mockReturnValue({ populate: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: "a1", fullname: "n" }) }) });
      await authController.updateProfile(req, res);
      expect(account.fullname).toBe("n");
      expect(account.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
    });

    it("should return 400 if invalid phone", async () => {
      const req = { user: { accountId: "a1" }, body: { phone: "123" } };
      const res = createRes();
      await authController.updateProfile(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 404 if no account", async () => {
      const req = { user: { accountId: "a1" }, body: { fullname: "n" } };
      const res = createRes();
      Account.findById.mockResolvedValue(null);
      await authController.updateProfile(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe("updatePassword", () => {
    it("should update successfully", async () => {
      const req = { user: { accountId: "a1" }, body: { oldPassword: "o", newPassword: "n", confirmPassword: "n" } };
      const res = createRes();
      const account = { provider: "local", password_hash: "h", save: jest.fn() };
      Account.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(account) });
      bcrypt.compare.mockResolvedValue(true);
      bcrypt.hash.mockResolvedValue("nh");
      await authController.updatePassword(req, res);
      expect(account.password_hash).toBe("nh");
      expect(account.save).toHaveBeenCalled();
    });

    it("should return 400 if missing info", async () => {
      const req = { user: { accountId: "a1" }, body: { oldPassword: "o" } };
      const res = createRes();
      await authController.updatePassword(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 if mismatch", async () => {
      const req = { user: { accountId: "a1" }, body: { oldPassword: "o", newPassword: "n", confirmPassword: "m" } };
      const res = createRes();
      await authController.updatePassword(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 404 if no account", async () => {
      const req = { user: { accountId: "a1" }, body: { oldPassword: "o", newPassword: "n", confirmPassword: "n" } };
      const res = createRes();
      Account.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
      await authController.updatePassword(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should return 400 if google provider", async () => {
      const req = { user: { accountId: "a1" }, body: { oldPassword: "o", newPassword: "n", confirmPassword: "n" } };
      const res = createRes();
      Account.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ provider: "google" }) });
      await authController.updatePassword(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 if old password wrong", async () => {
      const req = { user: { accountId: "a1" }, body: { oldPassword: "wrong", newPassword: "n", confirmPassword: "n" } };
      const res = createRes();
      Account.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ provider: "local", password_hash: "h" }) });
      bcrypt.compare.mockResolvedValue(false);
      await authController.updatePassword(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("notifications", () => {
    it("getNotifications should return list", async () => {
      const req = { user: { accountId: "a1" }, query: { page: "1", limit: "10" } };
      const res = createRes();
      Notification.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ skip: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) });
      Notification.countDocuments.mockResolvedValue(0);
      await authController.getNotifications(req, res);
      expect(res.json).toHaveBeenCalled();
    });

    it("markAsRead should work", async () => {
      const req = { params: { id: "n1" } };
      const res = createRes();
      Notification.findByIdAndUpdate.mockResolvedValue({ _id: "n1" });
      await authController.markAsRead(req, res);
      expect(res.json).toHaveBeenCalled();
    });

    it("markAsRead should return 404 if not found", async () => {
      const req = { params: { id: "n1" } };
      const res = createRes();
      Notification.findByIdAndUpdate.mockResolvedValue(null);
      await authController.markAsRead(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("markAllAsRead should work", async () => {
      const req = { user: { accountId: "a1" } };
      const res = createRes();
      await authController.markAllAsRead(req, res);
      expect(Notification.updateMany).toHaveBeenCalled();
    });

    it("deleteNotification should work", async () => {
      const req = { params: { id: "n1" } };
      const res = createRes();
      Notification.findByIdAndDelete.mockResolvedValue({ _id: "n1" });
      await authController.deleteNotification(req, res);
      expect(res.json).toHaveBeenCalled();
    });

    it("deleteNotification should 404 if not found", async () => {
      const req = { params: { id: "n1" } };
      const res = createRes();
      Notification.findByIdAndDelete.mockResolvedValue(null);
      await authController.deleteNotification(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("deleteAllNotifications should work", async () => {
      const req = { user: { accountId: "a1" } };
      const res = createRes();
      await authController.deleteAllNotifications(req, res);
      expect(Notification.deleteMany).toHaveBeenCalled();
    });

    it("countUnread should work", async () => {
      const req = { user: { accountId: "a1" } };
      const res = createRes();
      Notification.countDocuments.mockResolvedValue(5);
      await authController.countUnread(req, res);
      expect(res.json).toHaveBeenCalledWith({ unread: 5 });
    });
  });

  describe("checkProfileStatus", () => {
    it("should return complete true", async () => {
      const req = { user: { accountId: "a1" } };
      const res = createRes();
      Account.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ fullname: "n", phone: "p", email: "e" }) });
      await authController.checkProfileStatus(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ is_profile_complete: true }));
    });

    it("should return 404 if no account", async () => {
      const req = { user: { accountId: "a1" } };
      const res = createRes();
      Account.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
      await authController.checkProfileStatus(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe("Other Info", () => {
    it("getRoleNameById should work", async () => {
      const req = { body: { id: "r1" } };
      const res = createRes();
      Role.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ name: "R" }) });
      await authController.getRoleNameById(req, res);
      expect(res.json).toHaveBeenCalledWith({ name: "R" });
    });

    it("getRoleNameById return 404", async () => {
      const req = { body: { id: "r1" } };
      const res = createRes();
      Role.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
      await authController.getRoleNameById(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("getInforById should work", async () => {
      const req = { user: { accountId: "a1" } };
      const res = createRes();
      Account.findById.mockReturnValue({ populate: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: "a1" }) }) });
      await authController.getInforById(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Get profile success" }));
    });

    it("getInforById return 404", async () => {
      const req = { user: { accountId: "a1" } };
      const res = createRes();
      Account.findById.mockReturnValue({ populate: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(null) }) });
      await authController.getInforById(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});
