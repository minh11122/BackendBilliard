const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const Account = require("../../models/account.model");

const client = new OAuth2Client(process.env.VITE_GOOGLE_CLIENT_ID);

/* ================= REGISTER ================= */
const register = async (req, res) => {
  try {
    const { email, password, confirmPassword, phone } = req.body;

    if (!email || !password || !confirmPassword) {
      return res.status(400).json({ message: "Thiếu thông tin" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Mật khẩu xác nhận không khớp" });
    }

    const existingAccount = await Account.findOne({ email });
    if (existingAccount) {
      return res.status(400).json({ message: "Email đã tồn tại" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await Account.create({
      email,
      password: hashedPassword,
      phone: phone || null,
      status: "ACTIVE",
      role: { name: "USER" }
    });

    res.status(201).json({ message: "Đăng ký thành công" });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


/* ================= LOGIN ================= */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const account = await Account.findOne({ email });
    if (!account) {
      return res.status(404).json({ message: "Email không tồn tại" });
    }

    if (account.status !== "ACTIVE") {
      return res.status(403).json({ message: "Tài khoản bị khóa" });
    }

    if (!account.password) {
      return res.status(400).json({
        message: "Tài khoản này đăng nhập bằng Google"
      });
    }

    const isMatch = await bcrypt.compare(password, account.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Sai mật khẩu" });
    }

    const token = jwt.sign(
      {
        accountId: account._id,
        roleName: account.role.name
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRY || "7d" }
    );

    res.json({
      message: "Đăng nhập thành công",
      token
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


/* ================= GOOGLE REGISTER ================= */
const registerGoogle = async (req, res) => {
  try {
    const { tokenId } = req.body;

    const ticket = await client.verifyIdToken({
      idToken: tokenId,
      audience: process.env.VITE_GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, picture } = payload;

    const existingAccount = await Account.findOne({ email });
    if (existingAccount) {
      return res.status(400).json({ message: "Email đã tồn tại" });
    }

    await Account.create({
      email,
      password: null,
      avatar: picture,
      status: "ACTIVE",
      role: { name: "USER" }
    });

    res.status(201).json({ message: "Đăng ký Google thành công" });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


/* ================= GOOGLE LOGIN ================= */
const loginGoogle = async (req, res) => {
  try {
    const { tokenId } = req.body;

    const ticket = await client.verifyIdToken({
      idToken: tokenId,
      audience: process.env.VITE_GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email } = payload;

    const account = await Account.findOne({ email });
    if (!account) {
      return res.status(404).json({ message: "Tài khoản chưa đăng ký" });
    }

    const token = jwt.sign(
      {
        accountId: account._id,
        roleName: account.role.name
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRY || "7d" }
    );

    res.json({
      message: "Đăng nhập Google thành công",
      token
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


/* ================= FORGOT PASSWORD ================= */
const forgotPassword = async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    const account = await Account.findOne({ email });
    if (!account) {
      return res.status(404).json({ message: "Email không tồn tại" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    account.password = hashedPassword;
    await account.save();

    res.json({ message: "Đổi mật khẩu thành công" });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


module.exports = {
  register,
  login,
  registerGoogle,
  loginGoogle,
  forgotPassword
};
