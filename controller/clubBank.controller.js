const ClubBank = require("../models/club_bank.model");
const Club = require("../models/club.model");

// Lấy thông tin tài khoản ngân hàng theo club_id
const getBankByClub = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ success: false, message: "Thiếu club_id" });
    }

    const bank = await ClubBank.findOne({ club_id: id }).lean();

    return res.status(200).json({
      success: true,
      data: bank || null
    });
  } catch (error) {
    console.error("Lỗi getBankByClub:", error);
    return res.status(500).json({ success: false, message: "Lỗi Server" });
  }
};

// Tạo / cập nhật thông tin tài khoản ngân hàng cho club (chỉ chủ quán được phép)
const upsertBankByClub = async (req, res) => {
  try {
    const { id } = req.params;
    const accountId = req.user?.accountId;
    const { bank_name, account_number, account_name } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, message: "Thiếu club_id" });
    }

    if (!accountId) {
      return res.status(401).json({ success: false, message: "Không xác thực được người dùng" });
    }

    if (!bank_name || !account_number || !account_name) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập đủ tên ngân hàng, số tài khoản và chủ tài khoản"
      });
    }

    // Đảm bảo club thuộc về chủ quán hiện tại
    const club = await Club.findOne({ _id: id, account_id: accountId }).lean();
    if (!club) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền cập nhật thông tin ngân hàng cho câu lạc bộ này"
      });
    }

    let bank = await ClubBank.findOne({ club_id: id });
    if (bank) {
      bank.bank_name = bank_name;
      bank.account_number = account_number;
      bank.account_name = account_name;
      await bank.save();
    } else {
      bank = await ClubBank.create({
        club_id: id,
        bank_name,
        account_number,
        account_name
      });
    }

    return res.status(200).json({
      success: true,
      message: "Cập nhật thông tin ngân hàng thành công",
      data: bank
    });
  } catch (error) {
    console.error("Lỗi upsertBankByClub:", error);
    return res.status(500).json({ success: false, message: "Lỗi Server" });
  }
};

module.exports = {
  getBankByClub,
  upsertBankByClub
};

