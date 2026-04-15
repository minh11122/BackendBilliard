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
          fullname: "Nguyễn Công Thành",
          email: "thanh.nc@gmail.com",
          password: "MatKhau@123",
          confirmPassword: "MatKhau@123",
        },
      };
      const res = createRes();

      Account.findOne.mockResolvedValue(null);
      Role.findOne.mockResolvedValue({ _id: "role-customer-001" });
      bcrypt.hash.mockResolvedValue("hashed-password-xyz");
      Account.create.mockResolvedValue({ _id: "acc-customer-789" });
      generateOtp.mockReturnValue("482951");
      Otp.findOneAndUpdate.mockResolvedValue({});
      sendOtpEmail.mockResolvedValue();

      await authController.register(req, res);

      expect(Account.create).toHaveBeenCalledWith(expect.objectContaining({ 
        email: "thanh.nc@gmail.com",
        fullname: "Nguyễn Công Thành" 
      }));
      expect(sendOtpEmail).toHaveBeenCalledWith("thanh.nc@gmail.com", "482951");
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("should return 400 when required fields are missing", async () => {
      const req = { body: { email: "", password: "", confirmPassword: "" } };
      const res = createRes();
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 when passwords do not match", async () => {
      const req = { body: { email: "lan.tt@yahoo.com", password: "Password@1", confirmPassword: "Password@2" } };
      const res = createRes();
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 when email already exists", async () => {
      const req = { body: { email: "existing.user@gmail.com", password: "Pass@123", confirmPassword: "Pass@123" } };
      const res = createRes();
      Account.findOne.mockResolvedValue({ _id: "acc-existing-111" });
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should handle duplicate key error (11000) for email", async () => {
      const req = { body: { email: "duplicate@gmail.com", password: "Pass@123", confirmPassword: "Pass@123" } };
      const res = createRes();
      Account.findOne.mockResolvedValue(null);
      Role.findOne.mockResolvedValue({ _id: "role-cust-001" });
      Account.create.mockRejectedValue({ code: 11000, keyPattern: { email: 1 } });
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Email đã tồn tại" }));
    });

    it("should return 500 on unexpected registration error", async () => {
      const req = { body: { email: "error.user@gmail.com", password: "Pass@123", confirmPassword: "Pass@123" } };
      const res = createRes();
      Account.findOne.mockRejectedValue(new Error("Mất kết nối Database"));
      await authController.register(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe("verifyOtp", () => {
    it("should verify successfully and activate account", async () => {
      const req = { body: { email: "verify.me@gmail.com", otp_code: "123456" } };
      const res = createRes();
      const account = { save: jest.fn(), status: "PENDING" };
      Account.findOne.mockResolvedValue(account);
      Otp.findOne.mockResolvedValue({ 
        _id: "otp-doc-555", 
        otp_code: "123456", 
        expires_at: new Date(Date.now() + 50000) 
      });
      await authController.verifyOtp(req, res);
      expect(account.status).toBe("ACTIVE");
      expect(res.json).toHaveBeenCalledWith({ message: "Xác thực thành công" });
    });

    it("should return 404 if account not found during verification", async () => {
      const req = { body: { email: "notfound@gmail.com", otp_code: "000000" } };
      const res = createRes();
      Account.findOne.mockResolvedValue(null);
      await authController.verifyOtp(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should return 400 if otp does not exist", async () => {
      const req = { body: { email: "no.otp@gmail.com", otp_code: "111111" } };
      const res = createRes();
      Account.findOne.mockResolvedValue({ _id: "acc-no-otp" });
      Otp.findOne.mockResolvedValue(null);
      await authController.verifyOtp(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 if otp expired", async () => {
      const req = { body: { email: "expired@gmail.com", otp_code: "999999" } };
      const res = createRes();
      Account.findOne.mockResolvedValue({ _id: "acc-expired" });
      Otp.findOne.mockResolvedValue({ expires_at: new Date(Date.now() - 5000) });
      await authController.verifyOtp(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 if max attempts exceeded", async () => {
      const req = { body: { email: "locked@gmail.com", otp_code: "654321" } };
      const res = createRes();
      Account.findOne.mockResolvedValue({ _id: "acc-locked" });
      Otp.findOne.mockResolvedValue({ 
        expires_at: new Date(Date.now() + 50000), 
        attempts: 5 
      });
      await authController.verifyOtp(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Sai OTP quá 5 lần" }));
    });

    it("should return 400 and increment attempts if otp incorrect", async () => {
      const req = { body: { email: "wrong@gmail.com", otp_code: "wrong-code" } };
      const res = createRes();
      const otp = { 
        otp_code: "Correct123", 
        attempts: 2, 
        save: jest.fn(), 
        expires_at: new Date(Date.now() + 50000) 
      };
      Account.findOne.mockResolvedValue({ _id: "acc-wrong" });
      Otp.findOne.mockResolvedValue(otp);
      await authController.verifyOtp(req, res);
      expect(otp.attempts).toBe(3);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("resendOtp", () => {
    it("should resend successfully for pending account", async () => {
      const req = { body: { email: "resend.user@gmail.com" } };
      const res = createRes();
      Account.findOne.mockResolvedValue({ _id: "acc-pending-123", status: "PENDING" });
      generateOtp.mockReturnValue("888222");
      await authController.resendOtp(req, res);
      expect(sendOtpEmail).toHaveBeenCalledWith("resend.user@gmail.com", "888222");
      expect(res.json).toHaveBeenCalledWith({ message: "OTP mới đã được gửi" });
    });

    it("should return 404 if account not found on resend", async () => {
      const req = { body: { email: "missing@gmail.com" } };
      const res = createRes();
      Account.findOne.mockResolvedValue(null);
      await authController.resendOtp(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should return 400 if account is already active", async () => {
      const req = { body: { email: "active.already@gmail.com" } };
      const res = createRes();
      Account.findOne.mockResolvedValue({ status: "ACTIVE" });
      await authController.resendOtp(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Tài khoản đã được kích hoạt, không cần OTP" }));
    });
  });

  describe("registerGoogle", () => {
    const { __mockVerifyIdToken } = require("google-auth-library");
    it("should register successfully with Google credentials", async () => {
      const req = { body: { tokenId: "google-fake-token-id" } };
      const res = createRes();
      __mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({ 
          email: "google.user@gmail.com", 
          name: "Google Member", 
          picture: "https://avatar.google.com/xyz", 
          sub: "google-sub-123456" 
        }),
      });
      Account.findOne.mockResolvedValue(null);
      Role.findOne.mockResolvedValue({ _id: "role-customer-999" });
      Account.create.mockResolvedValue({ _id: "acc-google-777" });

      await authController.registerGoogle(req, res);
      expect(Account.create).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("should return 400 if email is already registered", async () => {
      const req = { body: { tokenId: "google-token-dup" } };
      const res = createRes();
      __mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "existing@gmail.com" }) });
      Account.findOne.mockResolvedValue({ _id: "acc-ex-321" });
      await authController.registerGoogle(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 500 if CUSTOMER role is missing in database", async () => {
      const req = { body: { tokenId: "google-token-role-error" } };
      const res = createRes();
      __mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "no-role@gmail.com" }) });
      Account.findOne.mockResolvedValue(null);
      Role.findOne.mockResolvedValue(null);
      await authController.registerGoogle(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe("forgotPassword", () => {
    it("should send temporary password email for active user", async () => {
      const req = { body: { email: "forgot.pass@gmail.com" } };
      const res = createRes();
      const account = { provider: "local", status: "ACTIVE", save: jest.fn() };
      Account.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(account) });
      generateTempPassword.mockReturnValue("Temp@Pass#123");
      bcrypt.hash.mockResolvedValue("new-hashed-temp-password");
      await authController.forgotPassword(req, res);
      expect(sendResetPasswordEmail).toHaveBeenCalledWith("forgot.pass@gmail.com", "Temp@Pass#123");
      expect(res.json).toHaveBeenCalledWith({ message: "Mật khẩu tạm thời đã được gửi" });
    });

    it("should return 404 if account not found for reset", async () => {
      const req = { body: { email: "unknown.reset@gmail.com" } };
      const res = createRes();
      Account.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
      await authController.forgotPassword(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should return 400 if trying to reset a Google provider account", async () => {
      const req = { body: { email: "google.reset@gmail.com" } };
      const res = createRes();
      Account.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ provider: "google" }) });
      await authController.forgotPassword(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Tài khoản Google không dùng mật khẩu" }));
    });

    it("should return 400 if account is not active", async () => {
      const req = { body: { email: "pending.reset@gmail.com" } };
      const res = createRes();
      Account.findOne.mockReturnValue({ 
        select: jest.fn().mockResolvedValue({ provider: "local", status: "PENDING" }) 
      });
      await authController.forgotPassword(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("login", () => {
    it("should login successfully and return JWT", async () => {
      const req = { body: { email: "login.user@gmail.com", password: "Password@123" } };
      const res = createRes();
      const account = { 
        _id: "acc-id-101", 
        fullname: "User Login",
        provider: "local", 
        status: "ACTIVE", 
        password_hash: "hashed-val-xyz", 
        role_id: { _id: "role-id-001", name: "CUSTOMER" } 
      };
      Account.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(account)
        })
      });
      bcrypt.compare.mockResolvedValue(true);
      jwt.sign.mockReturnValue("signed-jwt-token-id-123");
      await authController.login(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ 
        token: "signed-jwt-token-id-123",
        fullname: "User Login" 
      }));
    });

    it("should return 404 if email does not exist", async () => {
      const req = { body: { email: "noneexist@gmail.com", password: "123" } };
      const res = createRes();
      Account.findOne.mockReturnValue({ 
        select: jest.fn().mockReturnValue({ 
          populate: jest.fn().mockResolvedValue(null) 
        }) 
      });
      await authController.login(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should return 400 if using local login on Google account", async () => {
      const req = { body: { email: "goog.user@gmail.com", password: "123" } };
      const res = createRes();
      Account.findOne.mockReturnValue({ 
        select: jest.fn().mockReturnValue({ 
          populate: jest.fn().mockResolvedValue({ provider: "google" }) 
        }) 
      });
      await authController.login(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Vui lòng đăng nhập bằng Google" }));
    });

    it("should return 403 if account is pending during login", async () => {
      const req = { body: { email: "pending@gmail.com", password: "123" } };
      const res = createRes();
      Account.findOne.mockReturnValue({ 
        select: jest.fn().mockReturnValue({ 
          populate: jest.fn().mockResolvedValue({ provider: "local", status: "PENDING" }) 
        }) 
      });
      await authController.login(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("should return 400 if password is wrong", async () => {
      const req = { body: { email: "user@gmail.com", password: "wrong-password" } };
      const res = createRes();
      Account.findOne.mockReturnValue({ 
        select: jest.fn().mockReturnValue({ 
          populate: jest.fn().mockResolvedValue({ 
            provider: "local", 
            status: "ACTIVE", 
            password_hash: "hashed-pw" 
          }) 
        }) 
      });
      bcrypt.compare.mockResolvedValue(false);
      await authController.login(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("loginGoogle", () => {
    const { __mockVerifyIdToken } = require("google-auth-library");
    it("should login with Google successfully", async () => {
      const req = { body: { tokenId: "valid-google-token" } };
      const res = createRes();
      __mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "google.fan@gmail.com" }) });
      Account.findOne.mockResolvedValue({ 
        _id: "acc-google-001", 
        status: "ACTIVE", 
        role_id: "role-customer-id" 
      });
      jwt.sign.mockReturnValue("jwt-token-google-user");
      await authController.loginGoogle(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: "jwt-token-google-user" }));
    });

    it("should return 404 if Google account not registered", async () => {
      const req = { body: { tokenId: "unknown-google-token" } };
      const res = createRes();
      __mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "stranger@gmail.com" }) });
      Account.findOne.mockResolvedValue(null);
      await authController.loginGoogle(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should return 403 if Google account is banned", async () => {
      const req = { body: { tokenId: "banned-google-token" } };
      const res = createRes();
      __mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "banned@gmail.com" }) });
      Account.findOne.mockResolvedValue({ status: "BANNED" });
      await authController.loginGoogle(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe("googleAuth", () => {
    const { __mockVerifyIdToken } = require("google-auth-library");
    it("should handle mixed auth (create/login) via Google", async () => {
      const req = { body: { tokenId: "google-auth-token-new" } };
      const res = createRes();
      __mockVerifyIdToken.mockResolvedValue({ 
        getPayload: () => ({ email: "new.goog@gmail.com", name: "New Google User", picture: "pic", sub: "sub-999" }) 
      });
      Account.findOne.mockResolvedValue(null);
      Role.findOne.mockResolvedValue({ _id: "role-cust-id" });
      Account.create.mockResolvedValue({ _id: "acc-new-goog-999", provider: "google", status: "ACTIVE", role_id: "role-cust-id" });
      jwt.sign.mockReturnValue("new-goog-token-123");
      await authController.googleAuth(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: "new-goog-token-123" }));
    });

    it("should return 400 if Google email is already linked to local account", async () => {
      const req = { body: { tokenId: "google-token-link-conflict" } };
      const res = createRes();
      __mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "local.user@gmail.com" }) });
      Account.findOne.mockResolvedValue({ provider: "local" });
      await authController.googleAuth(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Email đã đăng ký bằng local" }));
    });

    it("should return 403 if Google account is locked", async () => {
      const req = { body: { tokenId: "locked-goog-token" } };
      const res = createRes();
      __mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "locked.goog@gmail.com" }) });
      Account.findOne.mockResolvedValue({ provider: "google", status: "BANNED" });
      await authController.googleAuth(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe("updateProfile", () => {
    it("should update profile successfully with valid phone", async () => {
      const req = { 
        user: { accountId: "acc-prof-id-001" }, 
        body: { fullname: "Lê Minh Tuấn", phone: "0912345678" } 
      };
      const res = createRes();
      const account = { save: jest.fn() };
      Account.findById.mockResolvedValueOnce(account);
      Account.findById.mockReturnValue({ 
        populate: jest.fn().mockReturnValue({ 
          select: jest.fn().mockResolvedValue({ _id: "acc-prof-id-001", fullname: "Lê Minh Tuấn", phone: "0912345678" }) 
        }) 
      });
      await authController.updateProfile(req, res);
      expect(account.fullname).toBe("Lê Minh Tuấn");
      expect(account.phone).toBe("0912345678");
      expect(account.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
    });

    it("should return 400 for invalid VN phone format", async () => {
      const req = { user: { accountId: "acc-prof-id-002" }, body: { phone: "0123" } };
      const res = createRes();
      await authController.updateProfile(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Số điện thoại không hợp lệ" }));
    });

    it("should return 404 if profile account not found", async () => {
      const req = { user: { accountId: "acc-id-missing" }, body: { fullname: "Stranger" } };
      const res = createRes();
      Account.findById.mockResolvedValue(null);
      await authController.updateProfile(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe("updatePassword", () => {
    it("should change password successfully for local user", async () => {
      const req = { 
        user: { accountId: "acc-user-id-555" }, 
        body: { oldPassword: "Old@Password123", newPassword: "New@Password123", confirmPassword: "New@Password123" } 
      };
      const res = createRes();
      const account = { provider: "local", password_hash: "hashed-old-pw", save: jest.fn() };
      Account.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(account) });
      bcrypt.compare.mockResolvedValue(true);
      bcrypt.hash.mockResolvedValue("hashed-new-pw");
      await authController.updatePassword(req, res);
      expect(account.password_hash).toBe("hashed-new-pw");
      expect(account.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ message: "Đổi mật khẩu thành công" });
    });

    it("should return 400 if fields are missing in password update", async () => {
      const req = { user: { accountId: "id" }, body: { oldPassword: "123" } };
      const res = createRes();
      await authController.updatePassword(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 if confirm password mismatch", async () => {
      const req = { 
        user: { accountId: "id" }, 
        body: { oldPassword: "1", newPassword: "2", confirmPassword: "3" } 
      };
      const res = createRes();
      await authController.updatePassword(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Mật khẩu xác nhận không khớp" }));
    });

    it("should return 404 if account not found during password change", async () => {
      const req = { 
        user: { accountId: "missing-id" }, 
        body: { oldPassword: "1", newPassword: "2", confirmPassword: "2" } 
      };
      const res = createRes();
      Account.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
      await authController.updatePassword(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should return 400 when trying to update password of a Google account", async () => {
      const req = { 
        user: { accountId: "goog-id" }, 
        body: { oldPassword: "1", newPassword: "2", confirmPassword: "2" } 
      };
      const res = createRes();
      Account.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ provider: "google" }) });
      await authController.updatePassword(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Tài khoản Google không có mật khẩu" }));
    });

    it("should return 400 if old password is wrong", async () => {
      const req = { 
        user: { accountId: "id" }, 
        body: { oldPassword: "wrong", newPassword: "new", confirmPassword: "new" } 
      };
      const res = createRes();
      Account.findById.mockReturnValue({ 
        select: jest.fn().mockResolvedValue({ provider: "local", password_hash: "hpw" }) 
      });
      bcrypt.compare.mockResolvedValue(false);
      await authController.updatePassword(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Mật khẩu cũ không đúng" }));
    });
  });

  describe("notifications", () => {
    it("getNotifications should return paginated list", async () => {
      const req = { user: { accountId: "user-id-notif" }, query: { page: "1", limit: "5" } };
      const res = createRes();
      Notification.find.mockReturnValue({ 
        sort: jest.fn().mockReturnValue({ 
          skip: jest.fn().mockReturnValue({ 
            limit: jest.fn().mockResolvedValue([
              { _id: "n1", title: "Chào mừng", message: "Chào bạn đến quán" }
            ]) 
          }) 
        }) 
      });
      Notification.countDocuments.mockResolvedValue(1);
      await authController.getNotifications(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Lấy danh sách notification thành công" }));
    });

    it("markAsRead should update a single notification", async () => {
      const req = { params: { id: "notif-id-001" } };
      const res = createRes();
      Notification.findByIdAndUpdate.mockResolvedValue({ _id: "notif-id-001", is_read: true });
      await authController.markAsRead(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Đã đánh dấu đã đọc" }));
    });

    it("markAsRead should return 404 if notification missing", async () => {
      const req = { params: { id: "notif-id-missing" } };
      const res = createRes();
      Notification.findByIdAndUpdate.mockResolvedValue(null);
      await authController.markAsRead(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("markAllAsRead should bulk update", async () => {
      const req = { user: { accountId: "user-id-all" } };
      const res = createRes();
      await authController.markAllAsRead(req, res);
      expect(Notification.updateMany).toHaveBeenCalledWith(
        { account_id: "user-id-all", is_read: false },
        expect.anything()
      );
    });

    it("deleteNotification should remove successfully", async () => {
      const req = { params: { id: "notif-del-001" } };
      const res = createRes();
      Notification.findByIdAndDelete.mockResolvedValue({ _id: "notif-del-001" });
      await authController.deleteNotification(req, res);
      expect(res.json).toHaveBeenCalledWith({ message: "Xóa notification thành công" });
    });

    it("deleteNotification should return 404 if not found", async () => {
      const req = { params: { id: "notif-del-missing" } };
      const res = createRes();
      Notification.findByIdAndDelete.mockResolvedValue(null);
      await authController.deleteNotification(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("deleteAllNotifications should clear user box", async () => {
      const req = { user: { accountId: "user-id-clear" } };
      const res = createRes();
      await authController.deleteAllNotifications(req, res);
      expect(Notification.deleteMany).toHaveBeenCalledWith({ account_id: "user-id-clear" });
      expect(res.json).toHaveBeenCalledWith({ message: "Đã xóa tất cả notification" });
    });

    it("countUnread should return actual number", async () => {
      const req = { user: { accountId: "user-id-count" } };
      const res = createRes();
      Notification.countDocuments.mockResolvedValue(12);
      await authController.countUnread(req, res);
      expect(res.json).toHaveBeenCalledWith({ unread: 12 });
    });
  });

  describe("checkProfileStatus", () => {
    it("should return is_profile_complete: true if all fields exist", async () => {
      const req = { user: { accountId: "acc-comp" } };
      const res = createRes();
      Account.findById.mockReturnValue({ 
        select: jest.fn().mockResolvedValue({ fullname: "N.V.A", phone: "0987654321", email: "nva@gmail.com" }) 
      });
      await authController.checkProfileStatus(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ is_profile_complete: true }));
    });

    it("should return is_profile_complete: false if any field missing", async () => {
      const req = { user: { accountId: "acc-incomp" } };
      const res = createRes();
      Account.findById.mockReturnValue({ 
        select: jest.fn().mockResolvedValue({ fullname: "N.V.A", email: "nva@gmail.com" }) // missing phone
      });
      await authController.checkProfileStatus(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ is_profile_complete: false }));
    });

    it("should return 404 if account not found during profile check", async () => {
      const req = { user: { accountId: "missing-id" } };
      const res = createRes();
      Account.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
      await authController.checkProfileStatus(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe("Utility Info Methods", () => {
    it("getRoleNameById should return the name of the role", async () => {
      const req = { body: { id: "role-id-001" } };
      const res = createRes();
      Role.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ name: "ADMIN_CLUB" }) });
      await authController.getRoleNameById(req, res);
      expect(res.json).toHaveBeenCalledWith({ name: "ADMIN_CLUB" });
    });

    it("getRoleNameById return 404 for unknown id", async () => {
      const req = { body: { id: "role-id-unknown" } };
      const res = createRes();
      Role.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
      await authController.getRoleNameById(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("getInforById should return account details without password", async () => {
      const req = { user: { accountId: "acc-id-101" } };
      const res = createRes();
      Account.findById.mockReturnValue({ 
        populate: jest.fn().mockReturnValue({ 
          select: jest.fn().mockResolvedValue({ _id: "acc-id-101", fullname: "Testing User", email: "testing@gmail.com" }) 
        }) 
      });
      await authController.getInforById(req, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Get profile success" }));
    });

    it("getInforById return 404", async () => {
      const req = { user: { accountId: "id-not-exist" } };
      const res = createRes();
      Account.findById.mockReturnValue({ 
        populate: jest.fn().mockReturnValue({ 
          select: jest.fn().mockResolvedValue(null) 
        }) 
      });
      await authController.getInforById(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});
