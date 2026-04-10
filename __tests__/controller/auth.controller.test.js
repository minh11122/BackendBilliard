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

      expect(Account.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fullname: "ngocanh.nguyen",
          email: "ngocanh.nguyen@example.com",
          provider: "local",
          status: "PENDING",
        }),
      );
      expect(sendOtpEmail).toHaveBeenCalledWith("ngocanh.nguyen@example.com", "482951");
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        message: "Đăng ký thành công, OTP đã gửi",
      });
    });

    it("should return 400 when required fields are missing", async () => {
      const req = {
        body: {
          email: "thao.tran@example.com",
          password: "",
          confirmPassword: "",
        },
      };
      const res = createRes();

      await authController.register(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Vui lòng nhập email và mật khẩu",
      });
    });

    it("should return 400 when email already exists", async () => {
      const req = {
        body: {
          fullname: "Trần Minh Khoa",
          email: "khoa.tran@example.com",
          password: "MatKhau@123",
          confirmPassword: "MatKhau@123",
        },
      };
      const res = createRes();

      Account.findOne.mockResolvedValue({ _id: "acc-dup" });

      await authController.register(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Email đã tồn tại",
      });
    });
  });

  describe("verifyOtp", () => {
    it("should activate account when OTP is valid", async () => {
      const req = {
        body: {
          email: "linh.pham@example.com",
          otp_code: "258369",
        },
      };
      const res = createRes();
      const account = { _id: "acc-otp-01", status: "PENDING", save: jest.fn() };

      Account.findOne.mockResolvedValue(account);
      Otp.findOne.mockResolvedValue({
        _id: "otp-01",
        otp_code: "258369",
        attempts: 0,
        expires_at: new Date(Date.now() + 5 * 60 * 1000),
      });
      Otp.deleteOne.mockResolvedValue({});

      await authController.verifyOtp(req, res);

      expect(account.status).toBe("ACTIVE");
      expect(account.save).toHaveBeenCalled();
      expect(Otp.deleteOne).toHaveBeenCalledWith({ _id: "otp-01" });
      expect(res.json).toHaveBeenCalledWith({ message: "Xác thực thành công" });
    });

    it("should return 400 when OTP is incorrect", async () => {
      const req = {
        body: {
          email: "viet.hoang@example.com",
          otp_code: "111111",
        },
      };
      const res = createRes();
      const otpDoc = {
        otp_code: "654321",
        attempts: 0,
        expires_at: new Date(Date.now() + 5 * 60 * 1000),
        save: jest.fn(),
      };

      Account.findOne.mockResolvedValue({ _id: "acc-otp-02" });
      Otp.findOne.mockResolvedValue(otpDoc);

      await authController.verifyOtp(req, res);

      expect(otpDoc.attempts).toBe(1);
      expect(otpDoc.save).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: "OTP sai" });
    });
  });

  describe("resendOtp", () => {
    it("should resend OTP for pending account", async () => {
      const req = {
        body: {
          email: "huong.le@example.com",
        },
      };
      const res = createRes();

      Account.findOne.mockResolvedValue({ _id: "acc-resend-01", status: "PENDING" });
      generateOtp.mockReturnValue("998877");
      Otp.findOneAndUpdate.mockResolvedValue({});
      sendOtpEmail.mockResolvedValue();

      await authController.resendOtp(req, res);

      expect(sendOtpEmail).toHaveBeenCalledWith("huong.le@example.com", "998877");
      expect(res.json).toHaveBeenCalledWith({ message: "OTP mới đã được gửi" });
    });
  });

  describe("forgotPassword", () => {
    it("should reset password for active local account", async () => {
      const req = {
        body: {
          email: "bao.nguyen@example.com",
        },
      };
      const res = createRes();
      const account = {
        provider: "local",
        status: "ACTIVE",
        password_hash: "old-hash",
        save: jest.fn(),
      };

      Account.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue(account),
      });
      generateTempPassword.mockReturnValue("Tmp@2026!");
      bcrypt.hash.mockResolvedValue("new-temp-hash");
      sendResetPasswordEmail.mockResolvedValue();

      await authController.forgotPassword(req, res);

      expect(account.password_hash).toBe("new-temp-hash");
      expect(account.save).toHaveBeenCalled();
      expect(sendResetPasswordEmail).toHaveBeenCalledWith(
        "bao.nguyen@example.com",
        "Tmp@2026!",
      );
      expect(res.json).toHaveBeenCalledWith({
        message: "Mật khẩu tạm thời đã được gửi",
      });
    });

    it("should return 400 for Google account", async () => {
      const req = {
        body: {
          email: "mai.do@example.com",
        },
      };
      const res = createRes();

      Account.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          provider: "google",
          status: "ACTIVE",
        }),
      });

      await authController.forgotPassword(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Tài khoản Google không dùng mật khẩu",
      });
    });
  });

  describe("login", () => {
    it("should login successfully with valid local account", async () => {
      const req = {
        body: {
          email: "anh.vo@example.com",
          password: "MatKhau@123",
        },
      };
      const res = createRes();
      const account = {
        _id: "acc-login-01",
        role_id: { _id: "role-01", name: "CUSTOMER" },
        provider: "local",
        status: "ACTIVE",
        fullname: "Võ Ngọc Anh",
        password_hash: "hashed-password",
      };

      Account.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(account),
        }),
      });
      bcrypt.compare.mockResolvedValue(true);
      jwt.sign.mockReturnValue("jwt-token-customer");

      await authController.login(req, res);

      expect(jwt.sign).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        message: "Đăng nhập thành công",
        token: "jwt-token-customer",
        role: "CUSTOMER",
        fullname: "Võ Ngọc Anh",
      });
    });

    it("should return 400 when password is incorrect", async () => {
      const req = {
        body: {
          email: "anh.vo@example.com",
          password: "SaiMatKhau@123",
        },
      };
      const res = createRes();
      const account = {
        _id: "acc-login-02",
        role_id: { _id: "role-01", name: "CUSTOMER" },
        provider: "local",
        status: "ACTIVE",
        password_hash: "hashed-password",
      };

      Account.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(account),
        }),
      });
      bcrypt.compare.mockResolvedValue(false);

      await authController.login(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: "Sai mật khẩu" });
    });
  });

  describe("updateProfile", () => {
    it("should update profile successfully", async () => {
      const req = {
        user: { accountId: "acc-profile-01" },
        body: {
          fullname: "Nguyễn Thảo Vy",
          phone: "0912345678",
          avatar_url: "https://cdn.example.com/avatar/thao-vy.jpg",
        },
      };
      const res = createRes();
      const account = { save: jest.fn() };
      const updatedProfile = {
        _id: "acc-profile-01",
        fullname: "Nguyễn Thảo Vy",
        phone: "0912345678",
        avatar_url: "https://cdn.example.com/avatar/thao-vy.jpg",
      };

      Account.findById
        .mockResolvedValueOnce(account)
        .mockReturnValueOnce({
          populate: jest.fn().mockReturnValue({
            select: jest.fn().mockResolvedValue(updatedProfile),
          }),
        });

      await authController.updateProfile(req, res);

      expect(account.fullname).toBe("Nguyễn Thảo Vy");
      expect(account.phone).toBe("0912345678");
      expect(account.avatar_url).toBe("https://cdn.example.com/avatar/thao-vy.jpg");
      expect(account.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        message: "Cập nhật profile thành công",
        data: updatedProfile,
      });
    });

    it("should return 400 when phone format is invalid", async () => {
      const req = {
        user: { accountId: "acc-profile-02" },
        body: {
          phone: "12345",
        },
      };
      const res = createRes();

      await authController.updateProfile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Số điện thoại không hợp lệ",
      });
    });
  });

  describe("updatePassword", () => {
    it("should update password successfully", async () => {
      const req = {
        user: { accountId: "acc-pass-01" },
        body: {
          oldPassword: "OldPass@123",
          newPassword: "NewPass@456",
          confirmPassword: "NewPass@456",
        },
      };
      const res = createRes();
      const account = {
        provider: "local",
        password_hash: "old-hash",
        save: jest.fn(),
      };

      Account.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue(account),
      });
      bcrypt.compare.mockResolvedValue(true);
      bcrypt.hash.mockResolvedValue("new-hash");

      await authController.updatePassword(req, res);

      expect(account.password_hash).toBe("new-hash");
      expect(account.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        message: "Đổi mật khẩu thành công",
      });
    });

    it("should return 400 when old password does not match", async () => {
      const req = {
        user: { accountId: "acc-pass-02" },
        body: {
          oldPassword: "SaiMatKhau@123",
          newPassword: "NewPass@456",
          confirmPassword: "NewPass@456",
        },
      };
      const res = createRes();

      Account.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          provider: "local",
          password_hash: "old-hash",
        }),
      });
      bcrypt.compare.mockResolvedValue(false);

      await authController.updatePassword(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: "Mật khẩu cũ không đúng",
      });
    });
  });

  describe("notifications", () => {
    it("should return paginated notifications", async () => {
      const req = {
        user: { accountId: "acc-notif-01" },
        query: { page: "2", limit: "2" },
      };
      const res = createRes();
      const notifications = [
        { _id: "notif-03", title: "Thanh toán hoàn tất" },
        { _id: "notif-04", title: "Bàn đã được xác nhận" },
      ];

      Notification.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(notifications),
          }),
        }),
      });
      Notification.countDocuments.mockResolvedValue(5);

      await authController.getNotifications(req, res);

      expect(res.json).toHaveBeenCalledWith({
        message: "Lấy danh sách notification thành công",
        data: notifications,
        pagination: {
          total: 5,
          page: 2,
          limit: 2,
          totalPages: 3,
        },
      });
    });

    it("should return 404 when notification is not found while marking as read", async () => {
      const req = {
        params: { id: "67f1c1d7d3f4d2e3a4b5c6d7" },
      };
      const res = createRes();

      Notification.findByIdAndUpdate.mockResolvedValue(null);

      await authController.markAsRead(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        message: "Không tìm thấy notification",
      });
    });

    it("should count unread notifications", async () => {
      const req = {
        user: { accountId: "acc-notif-02" },
      };
      const res = createRes();

      Notification.countDocuments.mockResolvedValue(4);

      await authController.countUnread(req, res);

      expect(res.json).toHaveBeenCalledWith({ unread: 4 });
    });
  });

  describe("checkProfileStatus", () => {
    it("should return incomplete profile status when phone is missing", async () => {
      const req = {
        user: { accountId: "acc-check-01" },
      };
      const res = createRes();

      Account.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          fullname: "Bùi Khánh Linh",
          phone: "",
          email: "linh.bui@example.com",
        }),
      });

      await authController.checkProfileStatus(req, res);

      expect(res.json).toHaveBeenCalledWith({
        message: "Check profile success",
        is_profile_complete: false,
      });
    });
  });
});
