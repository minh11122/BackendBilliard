const bcrypt = require("bcryptjs");

const Account = require("../../models/account.model");

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

    return res.json({
      message: "Get profile success",
      data: account,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

const updateProfile = async (req, res) => {
  try {
    const accountId = req.user.accountId;
    const { fullname, phone, avatar_url } = req.body;

    const phoneRegex = /^(0|\+84)[0-9]{9}$/;

    if (phone && !phoneRegex.test(phone)) {
      return res.status(400).json({
        message: "Số điện thoại không hợp lệ",
      });
    }

    const account = await Account.findById(accountId);

    if (!account) {
      return res.status(404).json({
        message: "Account not found",
      });
    }

    if (fullname !== undefined) account.fullname = fullname;
    if (phone !== undefined) account.phone = phone;
    if (avatar_url !== undefined) account.avatar_url = avatar_url;

    await account.save();

    const result = await Account.findById(accountId)
      .populate("role_id", "name")
      .select("-password_hash");

    return res.json({
      message: "Cập nhật profile thành công",
      data: result,
    });
    
  } catch (error) {
    return res.status(500).json({
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
        message: "Vui lòng nhập đầy đủ thông tin",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        message: "Mật khẩu xác nhận không khớp",
      });
    }

    const account = await Account.findById(accountId).select("+password_hash");

    if (!account) {
      return res.status(404).json({
        message: "Account không tồn tại",
      });
    }

    if (!account.password_hash) {
      return res.status(400).json({
        message: "Tài khoản này không có mật khẩu",
      });
    }

    const isMatch = await bcrypt.compare(oldPassword, account.password_hash);

    if (!isMatch) {
      return res.status(400).json({
        message: "Mật khẩu cũ không đúng",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    account.password_hash = hashedPassword;
    await account.save();

    return res.json({
      message: "Đổi mật khẩu thành công",
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

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

    return res.json({
      message: "Check profile success",
      is_profile_complete: isComplete,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  getInforById,
  updateProfile,
  updatePassword,
  checkProfileStatus,
};
