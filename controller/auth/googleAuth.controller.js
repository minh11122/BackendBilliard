const { OAuth2Client } = require("google-auth-library");
const bcrypt = require("bcryptjs");

const { generateTempPassword } = require("../../utils/generateTempPassword");
const { sendAccountPasswordEmail } = require("../../services/mail.service");
const Account = require("../../models/account.model");
const Role = require("../../models/role.model");
const {
  buildAuthToken,
  buildLegacyGoogleAuthToken,
} = require("./auth.helpers");

const client = new OAuth2Client(process.env.VITE_GOOGLE_CLIENT_ID);

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
    if (account) {
      return res.status(400).json({ message: "Email đã được đăng ký" });
    }

    const role = await Role.findOne({ name: "CUSTOMER" });
    if (!role) {
      return res.status(500).json({ message: "Role CUSTOMER chưa được tạo" });
    }

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
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
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

    const account = await Account.findOne({ email }).populate(
      "role_id",
      "name",
    );

    if (!account) {
      return res
        .status(404)
        .json({ message: "Tài khoản Google chưa được đăng ký" });
    }

    if (account.status !== "ACTIVE") {
      return res.status(403).json({ message: "Tài khoản chưa được kích hoạt" });
    }

    const roleName = account.role_id.name;
    const token = buildAuthToken(account, roleName);

    return res.json({
      message: "Đăng nhập Google thành công",
      token,
      role: roleName,
      fullname: account.fullname,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
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
      if (!role) {
        return res
          .status(500)
          .json({ message: "Role CUSTOMER chưa được tạo" });
      }

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

    if (account.provider !== "google") {
      return res
        .status(400)
        .json({ message: "Email đã đăng ký bằng local" });
    }

    if (account.status !== "ACTIVE") {
      return res.status(403).json({ message: "Tài khoản bị khóa" });
    }

    const token = buildLegacyGoogleAuthToken(account);

    return res.json({ message: "Đăng nhập Google thành công", token });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  registerGoogle,
  loginGoogle,
  googleAuth,
};
