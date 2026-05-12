const bcrypt = require("bcryptjs");

const { generateOtp } = require("../../utils/generateOtp");
const { generateTempPassword } = require("../../utils/generateTempPassword");
const { sendOtpEmail, sendResetPasswordEmail } = require("../../services/mail.service");
const Account = require("../../models/account.model");
const Role = require("../../models/role.model");
const Otp = require("../../models/otp.model");
const {
  buildAuthToken,
  normalizeEmail,
  normalizeString,
} = require("./auth.helpers");

const register = async (req, res) => {
  try {
    let { fullname, email, password, confirmPassword } = req.body;
    email = normalizeEmail(email);

    console.log("REGISTER API RUNNING");

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

    if (!fullname) {
      fullname = email.split("@")[0];
    }

    const existingEmail = await Account.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({
        message: "Email đã tồn tại",
      });
    }

    const role = await Role.findOne({ name: "CUSTOMER" });
    if (!role) {
      return res.status(500).json({
        message: "Không tìm thấy role CUSTOMER",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const account = await Account.create({
      fullname,
      email,
      password_hash: hashedPassword,
      provider: "local",
      status: "PENDING",
      role_id: role._id,
    });

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
      },
    );

    await sendOtpEmail(email, otpCode);

    return res.status(201).json({
      message: "Đăng ký thành công, OTP đã gửi",
    });
  } catch (error) {
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

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      const fieldLabel = field === "email" ? "Email" : field;

      return res.status(400).json({
        message: `${fieldLabel} đã tồn tại`,
        field,
        value: error.keyValue,
      });
    }

    return res.status(500).json({
      message: error.message || "Server Error",
    });
  }
};

const verifyOtp = async (req, res) => {
  try {
    let { email, otp_code } = req.body;
    email = normalizeEmail(email);
    otp_code = normalizeString(otp_code);

    const account = await Account.findOne({ email });
    if (!account) {
      return res.status(404).json({ message: "Không tìm thấy account" });
    }

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

    return res.json({ message: "Xác thực thành công" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const resendOtp = async (req, res) => {
  try {
    let { email } = req.body;
    email = normalizeEmail(email);

    const account = await Account.findOne({ email });
    if (!account) {
      return res.status(404).json({ message: "Không tìm thấy account" });
    }

    if (account.status !== "PENDING") {
      return res
        .status(400)
        .json({ message: "Tài khoản đã được kích hoạt, không cần OTP" });
    }

    const otpCode = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await Otp.findOneAndUpdate(
      { account_id: account._id },
      { otp_code: otpCode, attempts: 0, expires_at: expiresAt },
      { upsert: true, new: true },
    );

    await sendOtpEmail(email, otpCode);

    return res.json({ message: "OTP mới đã được gửi" });
  } catch (error) {
    console.error("Error in resendOtp:", error);
    return res.status(500).json({ message: error.message });
  }
};

const forgotPassword = async (req, res) => {
  try {
    let { email } = req.body;
    email = normalizeEmail(email);

    const account = await Account.findOne({ email }).select("+password_hash");
    if (!account) {
      return res.status(404).json({ message: "Không tìm thấy account" });
    }

    if (account.provider !== "local") {
      return res
        .status(400)
        .json({ message: "Tài khoản Google không dùng mật khẩu" });
    }

    if (account.status !== "ACTIVE") {
      return res.status(400).json({ message: "Tài khoản chưa kích hoạt" });
    }

    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    account.password_hash = hashedPassword;
    await account.save();

    await sendResetPasswordEmail(email, tempPassword);

    return res.json({ message: "Mật khẩu tạm thời đã được gửi" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const login = async (req, res) => {
  try {
    let { email, password } = req.body;
    email = normalizeEmail(email);

    const account = await Account.findOne({ email })
      .select("+password_hash")
      .populate("role_id", "name");

    if (!account) {
      return res.status(404).json({ message: "Email không tồn tại" });
    }

    if (account.provider !== "local") {
      return res
        .status(400)
        .json({ message: "Vui lòng đăng nhập bằng Google" });
    }

    if (account.status !== "ACTIVE") {
      return res.status(403).json({ message: "Tài khoản chưa kích hoạt" });
    }

    const isMatch = await bcrypt.compare(password, account.password_hash);
    if (!isMatch) return res.status(400).json({ message: "Sai mật khẩu" });

    const roleName = account.role_id.name;
    const token = buildAuthToken(account, roleName);

    return res.json({
      message: "Đăng nhập thành công",
      token,
      role: roleName,
      fullname: account.fullname,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getRoleNameById = async (req, res) => {
  const { id } = req.body;
  try {
    const role = await Role.findById(id).select("name");
    if (!role) return res.status(404).json({ message: "Role not found" });
    return res.json({ name: role.name });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  register,
  verifyOtp,
  resendOtp,
  forgotPassword,
  login,
  getRoleNameById,
};
