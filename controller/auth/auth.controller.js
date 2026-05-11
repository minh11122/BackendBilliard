const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { generateOtp } = require("../../utils/generateOtp");
const { generateTempPassword } = require("../../utils/generateTempPassword");
const {
  sendOtpEmail,
  sendResetPasswordEmail,
  sendAccountPasswordEmail,
} = require("../../services/mail.service");

const Account = require("../../models/account.model");
const Role = require("../../models/role.model");
const Otp = require("../../models/otp.model");
const Notification = require("../../models/notification.model");

const client = new OAuth2Client(process.env.VITE_GOOGLE_CLIENT_ID);

// Đăng ký (tạo account + gửi OTP)
const register = async (req, res) => {
  try {
    let { fullname, email, password, confirmPassword } = req.body;

    email = typeof email === "string" ? email.trim() : email;

    console.log("REGISTER API RUNNING");

    // Validate
    if (!email || !password || !confirmPassword) {
      return res.status(400).json({
        message: "Vui lòng nhập email và mật khẩu",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        message: "Mật khẩu xác nhận không khớp",
      });
    }

    // fullname mặc định
    if (!fullname) {
      fullname = email.split("@")[0];
    }

    // Check email
    const existingEmail = await Account.findOne({ email });

    if (existingEmail) {
      return res.status(400).json({
        message: "Email đã tồn tại",
      });
    }

    // Role
    const role = await Role.findOne({ name: "CUSTOMER" });

    if (!role) {
      return res.status(500).json({
        message: "Không tìm thấy role CUSTOMER",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create account
    const account = await Account.create({
      fullname,
      email,
      password_hash: hashedPassword,
      provider: "local",
      status: "PENDING",
      role_id: role._id,
    });

    // Generate OTP
    const otpCode = generateOtp();

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await Otp.findOneAndUpdate(
      { account_id: account._id },
      {
        otp_code: otpCode,
        attempts: 0,
        expires_at: expiresAt,
      },
      {
        upsert: true,
      }
    );

    // Send mail
    await sendOtpEmail(email, otpCode);

    return res.status(201).json({
      message: "Đăng ký thành công, OTP đã gửi",
    });

  } catch (error) {

    // ===== LOG FULL ERROR =====
    console.log("========== REGISTER ERROR ==========");

    console.log("MESSAGE:");
    console.log(error.message);

    console.log("CODE:");
    console.log(error.code);

    console.log("KEY PATTERN:");
    console.log(error.keyPattern);

    console.log("KEY VALUE:");
    console.log(error.keyValue);

    console.log("STACK:");
    console.log(error.stack);

    console.log("FULL ERROR:");
    console.dir(error, { depth: null });

    console.log("====================================");

    // ===== DUPLICATE KEY =====
    if (error.code === 11000) {

      const field = Object.keys(error.keyPattern || {})[0];

      return res.status(400).json({
        message: `${field} đã tồn tại`,
        field,
        value: error.keyValue,
      });
    }

    // ===== OTHER ERROR =====
    return res.status(500).json({
      message: error.message || "Server Error",
    });
  }
};


// Xác thực OTP
const verifyOtp = async (req, res) => {
  try {
    let { email, otp_code } = req.body;
    email = typeof email === "string" ? email.trim() : email;
    otp_code = typeof otp_code === "string" ? otp_code.trim() : otp_code;

    const account = await Account.findOne({ email });
    if (!account)
      return res.status(404).json({ message: "Không tìm thấy account" });

    const otp = await Otp.findOne({ account_id: account._id });
    if (!otp) return res.status(400).json({ message: "OTP không tồn tại" });

    if (otp.expires_at < new Date()) {
      await Otp.deleteOne({ _id: otp._id });
      return res.status(400).json({ message: "OTP đã hết hạn" });
    }

    if (otp.attempts >= 5) {
      await Otp.deleteOne({ _id: otp._id });
      return res
        .status(400)
        .json({ message: "OTP đã hết hạn do nhập sai quá 5 lần" });
    }

    if (otp.otp_code !== otp_code) {
      otp.attempts += 1;
      await otp.save();
      if (otp.attempts >= 5) {
        await Otp.deleteOne({ _id: otp._id });
        return res
          .status(400)
          .json({ message: "OTP đã hết hạn do nhập sai quá 5 lần" });
      }
      return res.status(400).json({ message: "OTP sai" });
    }

    account.status = "ACTIVE";
    await account.save();

    await Otp.deleteOne({ _id: otp._id });

    res.json({ message: "Xác thực thành công" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// resend otp
const resendOtp = async (req, res) => {
  try {
    let { email } = req.body;
    email = typeof email === "string" ? email.trim() : email;

    const account = await Account.findOne({ email });
    if (!account) {
      return res.status(404).json({ message: "Không tìm thấy account" });
    }

    if (account.status !== "PENDING") {
      return res
        .status(400)
        .json({ message: "Tài khoản đã được kích hoạt, không cần OTP" });
    }

    // Sinh OTP mới
    const otpCode = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 phút

    await Otp.findOneAndUpdate(
      { account_id: account._id },
      { otp_code: otpCode, attempts: 0, expires_at: expiresAt },
      { upsert: true, new: true },
    );

    // Gửi email
    await sendOtpEmail(email, otpCode);

    return res.json({ message: "OTP mới đã được gửi" });
  } catch (error) {
    console.error("Error in resendOtp:", error);
    res.status(500).json({ message: error.message });
  }
};

const registerGoogle = async (req, res) => {
  try {
    const { tokenId } = req.body;

    if (typeof tokenId !== "string" || !tokenId.trim()) {
      return res.status(400).json({ message: "Google token không hợp lệ" });
    }

    const ticket = await client.verifyIdToken({
      idToken: tokenId,
      audience: process.env.VITE_GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, name, sub } = payload;

    let account = await Account.findOne({ email });
    if (account)
      return res.status(400).json({ message: "Email đã được đăng ký" });

    const role = await Role.findOne({ name: "CUSTOMER" });
    if (!role)
      return res.status(500).json({ message: "Role CUSTOMER chưa được tạo" });

    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    account = await Account.create({
      fullname: name,
      email,
      password_hash: hashedPassword,
      provider: "google",
      provider_id: sub,
      status: "ACTIVE",
      role_id: role._id,
    });

    const mailResult = await sendAccountPasswordEmail(email, tempPassword);
    if (!mailResult?.success) {
      return res.status(500).json({
        message:
          "Tạo tài khoản Google thành công nhưng gửi mật khẩu qua email thất bại",
        error: mailResult?.error,
      });
    }

    return res.status(201).json({
      message: "Đăng ký Google thành công. Mật khẩu đã được gửi về email.",
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

const forgotPassword = async (req, res) => {
  try {
    let { email } = req.body;
    email = typeof email === "string" ? email.trim() : email;

    const account = await Account.findOne({ email }).select("+password_hash");
    if (!account)
      return res.status(404).json({ message: "Không tìm thấy account" });

    if (account.provider !== "local")
      return res
        .status(400)
        .json({ message: "Tài khoản Google không dùng mật khẩu" });

    if (account.status !== "ACTIVE")
      return res.status(400).json({ message: "Tài khoản chưa kích hoạt" });

    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    account.password_hash = hashedPassword;
    await account.save();

    await sendResetPasswordEmail(email, tempPassword);

    res.json({ message: "Mật khẩu tạm thời đã được gửi" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const login = async (req, res) => {
  try {
    let { email, password } = req.body;
    email = typeof email === "string" ? email.trim() : email;

    const account = await Account.findOne({ email })
      .select("+password_hash")
      .populate("role_id", "name");

    if (!account)
      return res.status(404).json({ message: "Email không tồn tại" });

    if (account.provider !== "local")
      return res
        .status(400)
        .json({ message: "Vui lòng đăng nhập bằng Google" });

    if (account.status !== "ACTIVE")
      return res.status(403).json({ message: "Tài khoản chưa kích hoạt" });

    const isMatch = await bcrypt.compare(password, account.password_hash);
    if (!isMatch) return res.status(400).json({ message: "Sai mật khẩu" });

    const roleName = account.role_id.name;

    const token = jwt.sign(
      {
        accountId: account._id,
        roleId: account.role_id._id,
        role: roleName,
        ...(account.club_id && { club_id: account.club_id }),
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.json({
      message: "Đăng nhập thành công",
      token,
      role: roleName,
      fullname: account.fullname,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const loginGoogle = async (req, res) => {
  try {
    const { tokenId } = req.body;

    if (typeof tokenId !== "string" || !tokenId.trim()) {
      return res.status(400).json({ message: "Google token không hợp lệ" });
    }

    const ticket = await client.verifyIdToken({
      idToken: tokenId,
      audience: process.env.VITE_GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email } = payload;

    let account = await Account.findOne({ email }).populate("role_id", "name");

    if (!account) {
      return res
        .status(404)
        .json({ message: "Tài khoản Google chưa được đăng ký" });
    }

    if (account.status !== "ACTIVE") {
      return res.status(403).json({ message: "Tài khoản chưa được kích hoạt" });
    }

    const roleName = account.role_id.name;

    const token = jwt.sign(
      {
        accountId: account._id,
        roleId: account.role_id._id,
        role: roleName,
        ...(account.club_id && { club_id: account.club_id }),
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    return res.json({
      message: "Đăng nhập Google thành công",
      token,
      role: roleName,
      fullname: account.fullname,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getRoleNameById = async (req, res) => {
  const { id } = req.body;
  try {
    const role = await Role.findById(id).select("name");
    if (!role) return res.status(404).json({ message: "Role not found" });
    res.json({ name: role.name });
  } catch (err) {
    console.error(err); // in lá»—i ra Ä‘á»ƒ debug
    res.status(500).json({ message: "Server error" });
  }
};

const googleAuth = async (req, res) => {
  try {
    const { tokenId } = req.body;

    const ticket = await client.verifyIdToken({
      idToken: tokenId,
      audience: process.env.VITE_GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, name, sub } = payload;

    let account = await Account.findOne({ email });

    if (!account) {
      const role = await Role.findOne({ name: "CUSTOMER" });
      if (!role)
        return res
          .status(500)
          .json({ message: "Role CUSTOMER chÆ°a Ä‘Æ°á»£c táº¡o" });

      const tempPassword = generateTempPassword();
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      account = await Account.create({
        fullname: name,
        email,
        password_hash: hashedPassword,
        provider: "google",
        provider_id: sub,
        status: "ACTIVE",
        role_id: role._id,
      });

      const mailResult = await sendAccountPasswordEmail(email, tempPassword);
      if (!mailResult?.success) {
        return res.status(500).json({
          message:
            "Tạo tài khoản Google thành công nhưng gửi mật khẩu qua email thất bại",
          error: mailResult?.error,
        });
      }
    }

    if (account.provider !== "google")
      return res
        .status(400)
        .json({ message: "Email Ä‘Ã£ Ä‘Äƒng kÃ½ báº±ng local" });

    if (account.status !== "ACTIVE")
      return res.status(403).json({ message: "TÃ i khoáº£n bá»‹ khÃ³a" });

    const token = jwt.sign(
      { accountId: account._id, roleId: account.role_id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.json({ message: "ÄÄƒng nháº­p Google thÃ nh cÃ´ng", token });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getInforById = async (req, res) => {
  try {
    const accountId = req.user.accountId;

    const account = await Account.findById(accountId)
      .populate("role_id", "name")
      .select("-password_hash");

    if (!account) {
      return res.status(404).json({
        message: "Account not found",
      });
    }

    res.json({
      message: "Get profile success",
      data: account,
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};
const updateProfile = async (req, res) => {
  try {
    const accountId = req.user.accountId;

    const { fullname, phone, avatar_url } = req.body;

    // validate phone (VN)
    const phoneRegex = /^(0|\+84)[0-9]{9}$/;

    if (phone && !phoneRegex.test(phone)) {
      return res.status(400).json({
        message: "Sá»‘ Ä‘iá»‡n thoáº¡i khÃ´ng há»£p lá»‡",
      });
    }

    const account = await Account.findById(accountId);

    if (!account) {
      return res.status(404).json({
        message: "Account not found",
      });
    }

    // update field
    if (fullname !== undefined) account.fullname = fullname;
    if (phone !== undefined) account.phone = phone;
    if (avatar_url !== undefined) account.avatar_url = avatar_url;

    await account.save();

    const result = await Account.findById(accountId)
      .populate("role_id", "name")
      .select("-password_hash");

    res.json({
      message: "Cáº­p nháº­t profile thÃ nh cÃ´ng",
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};
const updatePassword = async (req, res) => {
  try {
    const accountId = req.user.accountId;
    const { oldPassword, newPassword, confirmPassword } = req.body;

    if (!oldPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        message: "Vui lÃ²ng nháº­p Ä‘áº§y Ä‘á»§ thÃ´ng tin",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        message: "Máº­t kháº©u xÃ¡c nháº­n khÃ´ng khá»›p",
      });
    }

    const account = await Account.findById(accountId).select("+password_hash");

    if (!account) {
      return res.status(404).json({
        message: "Account khÃ´ng tá»“n táº¡i",
      });
    }

    if (account.provider !== "local") {
      return res.status(400).json({
        message: "TÃ i khoáº£n Google khÃ´ng cÃ³ máº­t kháº©u",
      });
    }

    const isMatch = await bcrypt.compare(oldPassword, account.password_hash);

    if (!isMatch) {
      return res.status(400).json({
        message: "Máº­t kháº©u cÅ© khÃ´ng Ä‘Ãºng",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    account.password_hash = hashedPassword;
    await account.save();

    res.json({
      message: "Äá»•i máº­t kháº©u thÃ nh cÃ´ng",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

//  Láº¥y danh sÃ¡ch notification (cÃ³ phÃ¢n trang)
const getNotifications = async (req, res) => {
  try {
    const accountId = req.user.accountId;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const skip = (page - 1) * limit;

    const notifications = await Notification.find({
      account_id: accountId,
    })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Notification.countDocuments({
      account_id: accountId,
    });

    res.json({
      message: "Láº¥y danh sÃ¡ch notification thÃ nh cÃ´ng",
      data: notifications,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// // Táº¡o notification (dÃ¹ng ná»™i bá»™ hoáº·c test)
// const createNotification = async (req, res) => {
//   try {
//     const { account_id, title, message } = req.body;

//     const notification = await Notification.create({
//       account_id,
//       title,
//       message,
//     });

//     res.status(201).json({
//       message: "Táº¡o notification thÃ nh cÃ´ng",
//       data: notification,
//     });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };

// Mark 1 notification lÃ  Ä‘Ã£ Ä‘á»c
const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findByIdAndUpdate(
      id,
      { is_read: true },
      { new: true },
    );

    if (!notification) {
      return res
        .status(404)
        .json({ message: "KhÃ´ng tÃ¬m tháº¥y notification" });
    }

    res.json({
      message: "ÄÃ£ Ä‘Ã¡nh dáº¥u Ä‘Ã£ Ä‘á»c",
      data: notification,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Mark táº¥t cáº£ lÃ  Ä‘Ã£ Ä‘á»c
const markAllAsRead = async (req, res) => {
  try {
    const accountId = req.user.accountId;

    await Notification.updateMany(
      { account_id: accountId, is_read: false },
      { $set: { is_read: true } },
    );

    res.json({
      message: "ÄÃ£ Ä‘Ã¡nh dáº¥u táº¥t cáº£ lÃ  Ä‘Ã£ Ä‘á»c",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// XÃ³a 1 notification
const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findByIdAndDelete(id);

    if (!notification) {
      return res
        .status(404)
        .json({ message: "KhÃ´ng tÃ¬m tháº¥y notification" });
    }

    res.json({
      message: "XÃ³a notification thÃ nh cÃ´ng",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// XÃ³a táº¥t cáº£ notification cá»§a user
const deleteAllNotifications = async (req, res) => {
  try {
    const accountId = req.user.accountId;

    await Notification.deleteMany({ account_id: accountId });

    res.json({
      message: "ÄÃ£ xÃ³a táº¥t cáº£ notification",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Äáº¿m sá»‘ chÆ°a Ä‘á»c
const countUnread = async (req, res) => {
  try {
    const accountId = req.user.accountId;

    const count = await Notification.countDocuments({
      account_id: accountId,
      is_read: false,
    });

    res.json({
      unread: count,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ðŸ”¥ CHECK PROFILE RIÃŠNG
const checkProfileStatus = async (req, res) => {
  try {
    const accountId = req.user.accountId;

    const account = await Account.findById(accountId).select(
      "fullname phone email",
    );

    if (!account) {
      return res.status(404).json({
        message: "Account not found",
      });
    }

    const isComplete = !!(account.fullname && account.phone && account.email);

    res.json({
      message: "Check profile success",
      is_profile_complete: isComplete,
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  getRoleNameById,
  register,
  verifyOtp,
  registerGoogle,
  forgotPassword,
  login,
  loginGoogle,
  resendOtp,
  googleAuth,
  getInforById,
  updateProfile,
  updatePassword,
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  countUnread,
  checkProfileStatus,
};
