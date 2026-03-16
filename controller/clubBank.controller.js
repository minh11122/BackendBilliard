const ClubBank = require("../models/club_bank.model");
const Club = require("../models/club.model");

const maskSecret = (value, keepStart = 2, keepEnd = 2) => {
  if (!value) return "";
  const s = String(value);
  if (s.length <= keepStart + keepEnd) return "*".repeat(s.length);
  return `${s.slice(0, keepStart)}${"*".repeat(Math.max(4, s.length - keepStart - keepEnd))}${s.slice(-keepEnd)}`;
};

// Lấy thông tin tài khoản ngân hàng theo club_id
const getBankByClub = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ success: false, message: "Thiếu club_id" });
    }

    const bank = await ClubBank.findOne({ club_id: id }).lean();
    if (!bank) {
      return res.status(200).json({ success: true, data: null });
    }

    // Only the club owner can see PayOS secrets.
    let includeSecrets = false;
    try {
      const accountId = req.user?.accountId;
      if (accountId) {
        const club = await Club.findOne({ _id: id, account_id: accountId }).select("_id").lean();
        includeSecrets = !!club;
      }
    } catch (e) {
      includeSecrets = false;
    }

    const safe = {
      _id: bank._id,
      club_id: bank.club_id,
      bank_name: bank.bank_name,
      account_number: bank.account_number,
      account_name: bank.account_name,
      payos_client_id: bank.payos_client_id || "",
      has_payos_keys: !!(bank.payos_client_id && bank.payos_api_key && bank.payos_checksum_key),
      // For non-owner callers: show masked values (optional, helpful UI) but never leak full secrets
      payos_api_key: includeSecrets ? (bank.payos_api_key || "") : maskSecret(bank.payos_api_key || "", 3, 3),
      payos_checksum_key: includeSecrets ? (bank.payos_checksum_key || "") : maskSecret(bank.payos_checksum_key || "", 3, 3),
      can_view_payos_secrets: includeSecrets
    };

    return res.status(200).json({
      success: true,
      data: safe
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
    const { bank_name, account_number, account_name, payos_client_id, payos_api_key, payos_checksum_key } = req.body;

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

    // If any PayOS field is provided, require all 3.
    const anyPayOSProvided = !!(payos_client_id || payos_api_key || payos_checksum_key);
    if (anyPayOSProvided && !(payos_client_id && payos_api_key && payos_checksum_key)) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập đủ PayOS Client ID, API Key và Checksum Key"
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
      if (anyPayOSProvided) {
        bank.payos_client_id = payos_client_id;
        bank.payos_api_key = payos_api_key;
        bank.payos_checksum_key = payos_checksum_key;
      }
      await bank.save();
    } else {
      bank = await ClubBank.create({
        club_id: id,
        bank_name,
        account_number,
        account_name,
        payos_client_id: payos_client_id || "",
        payos_api_key: payos_api_key || "",
        payos_checksum_key: payos_checksum_key || ""
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

