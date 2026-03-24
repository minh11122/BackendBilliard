const Tournament = require("../models/tournament.model");
const TournamentPlayer = require("../models/tournament_player.model");
const TransactionHistory = require("../models/transiction_history.model");
const ClubBank = require("../models/club_bank.model");
const payosService = require("../services/payos.service");

const PAYOS_EXPIRE_MINUTES = 10;

const ensureTournamentApproved = async (tournamentId, accountId, feeAmount) => {
  await TournamentPlayer.findOneAndUpdate(
    { tournament_id: tournamentId, account_id: accountId },
    {
      $set: {
        register_date: new Date(),
        fee_ammount: feeAmount,
        status: "Approved"
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const tournament = await Tournament.findById(tournamentId).select("max_players");
  if (!tournament) return;

  const approvedCount = await TournamentPlayer.countDocuments({
    tournament_id: tournamentId,
    status: "Approved"
  });

  const nextStatus = approvedCount >= Number(tournament.max_players || 0) ? "Closed" : "Open";
  await Tournament.findByIdAndUpdate(tournamentId, {
    registered_player: approvedCount,
    status: nextStatus
  });
};

const markTransactionSuccessAndApprove = async (orderCode) => {
  const tx = await TransactionHistory.findOne({ order_code: orderCode });
  if (!tx || !tx.description?.startsWith("TournamentFee:")) return false;

  if (tx.status === "SUCCESS") return true;

  const [, tournamentId] = tx.description.split(":");
  await ensureTournamentApproved(tournamentId, tx.account_id, tx.amount || 0);
  tx.status = "SUCCESS";
  tx.transaction_time = new Date();
  await tx.save();
  return true;
};

// Create a new tournament
const createTournament = async (req, res) => {
  try {
    const club_id = req.headers["x-club-id"];
    if (!club_id) {
      return res.status(400).json({ success: false, message: "Thiếu club_id" });
    }

    const {
      name,
      description,
      format,
      max_players,
      fee,
      prize_pool,
      registration_open,
      registration_deadline,
      play_date,
      auto_bracket,
      banner
    } = req.body;

    if (!name || !max_players) {
      return res.status(400).json({ success: false, message: "Tên giải và số lượng người chơi là bắt buộc" });
    }

    const tournament = new Tournament({
      club_id,
      name,
      description: description || "",
      format: format || "Knockout",
      max_players,
      fee: fee || 0,
      prize_pool: prize_pool || "",
      registration_open: registration_open ? new Date(registration_open) : null,
      registration_deadline: registration_deadline ? new Date(registration_deadline) : null,
      play_date: play_date ? new Date(play_date) : null,
      auto_bracket: auto_bracket !== undefined ? auto_bracket : true,
      // If image was uploaded via multer/cloudinary, use req.file.path; else fallback to body field
      banner: req.file ? req.file.path : (banner || ""),
      status: "Draft",
      created_by: req.account?._id || null,
      created_at: new Date()
    });

    await tournament.save();

    return res.status(201).json({
      success: true,
      message: "Tạo giải đấu thành công",
      data: tournament
    });
  } catch (error) {
    console.error("Error creating tournament:", error);
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Get all tournaments for a club
const getTournamentsByClub = async (req, res) => {
  try {
    const club_id = req.headers["x-club-id"] || req.query.club_id;
    if (!club_id) {
      return res.status(400).json({ success: false, message: "Thiếu club_id" });
    }

    const tournaments = await Tournament.find({ club_id })
      .sort({ created_at: -1 })
      .lean();

    return res.status(200).json({ success: true, data: tournaments });
  } catch (error) {
    console.error("Error fetching tournaments:", error);
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Get all public tournaments (excluding Draft)
const getPublicTournaments = async (req, res) => {
  try {
    const tournaments = await Tournament.find({
      status: { $in: ["Open", "Closed", "InProgress", "Completed"] }
    })
      .populate("club_id", "name address")
      .sort({ created_at: -1 })
      .lean();

    return res.status(200).json({ success: true, data: tournaments });
  } catch (error) {
    console.error("Error fetching public tournaments:", error);
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Get a single tournament
const getTournamentById = async (req, res) => {
  try {
    const { id } = req.params;
    const tournament = await Tournament.findById(id).populate("club_id", "name address").lean();
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Không tìm thấy giải đấu" });
    }
    return res.status(200).json({ success: true, data: tournament });
  } catch (error) {
    console.error("Error fetching tournament:", error);
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Update a tournament
const updateTournament = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Convert date strings to Date objects if present
    const dateFields = ["registration_open", "registration_deadline", "play_date", "start_time", "end_time"];
    dateFields.forEach(field => {
      if (updates[field]) updates[field] = new Date(updates[field]);
    });

    // If a new banner was uploaded, override
    if (req.file) {
      updates.banner = req.file.path;
    }

    const tournament = await Tournament.findByIdAndUpdate(id, updates, { new: true });
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    return res.status(200).json({
      success: true,
      message: "Cập nhật giải đấu thành công",
      data: tournament
    });
  } catch (error) {
    console.error("Error updating tournament:", error);
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Delete a tournament
const deleteTournament = async (req, res) => {
  try {
    const { id } = req.params;
    const tournament = await Tournament.findByIdAndDelete(id);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Không tìm thấy giải đấu" });
    }
    return res.status(200).json({ success: true, message: "Xóa giải đấu thành công" });
  } catch (error) {
    console.error("Error deleting tournament:", error);
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Create PayOS payment link for tournament registration
const createTournamentPayOSPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const accountId = req.user?.accountId;
    if (!accountId) {
      return res.status(401).json({ success: false, message: "Bạn chưa đăng nhập" });
    }

    const tournament = await Tournament.findById(id).lean();
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Không tìm thấy giải đấu" });
    }
    if (tournament.status !== "Open") {
      return res.status(400).json({ success: false, message: "Giải đấu hiện không mở đăng ký" });
    }

    const approvedCount = await TournamentPlayer.countDocuments({
      tournament_id: tournament._id,
      status: "Approved"
    });
    if (approvedCount >= Number(tournament.max_players || 0)) {
      return res.status(400).json({ success: false, message: "Giải đấu đã đủ số lượng người chơi" });
    }

    const existedApproved = await TournamentPlayer.findOne({
      tournament_id: tournament._id,
      account_id: accountId,
      status: "Approved"
    }).lean();
    if (existedApproved) {
      return res.status(200).json({ success: true, message: "Bạn đã đăng ký giải đấu này rồi" });
    }

    const feeAmount = Number(tournament.fee || 0);
    if (feeAmount <= 0) {
      await ensureTournamentApproved(tournament._id, accountId, 0);
      await TransactionHistory.create({
        account_id: accountId,
        order_code: `FREE-${Date.now()}`,
        amount: 0,
        description: `TournamentFee:${tournament._id}`,
        transaction_type: "TOURNAMENT_FEE",
        transaction_time: new Date(),
        status: "SUCCESS"
      });
      return res.status(200).json({
        success: true,
        message: "Đăng ký giải đấu thành công"
      });
    }

    const bank = await ClubBank.findOne({ club_id: tournament.club_id }).lean();
    if (!bank || !bank.payos_client_id || !bank.payos_api_key || !bank.payos_checksum_key) {
      return res.status(400).json({
        success: false,
        message: "CLB chưa cấu hình PayOS (Client ID / API Key / Checksum Key)"
      });
    }

    const orderCode = Date.now();
    const expiredAt = Math.floor((Date.now() + PAYOS_EXPIRE_MINUTES * 60 * 1000) / 1000);
    const description = `Phi tham gia ${String(tournament.name || "giai dau").slice(0, 20)}`;
    const returnUrl = `http://localhost:5173/tournament/${tournament._id}/payment`;
    const cancelUrl = `http://localhost:5173/tournament/${tournament._id}/payment`;

    await TransactionHistory.create({
      account_id: accountId,
      order_code: orderCode,
      amount: feeAmount,
      description: `TournamentFee:${tournament._id}`,
      transaction_type: "TOURNAMENT_FEE",
      transaction_time: new Date(),
      status: "PENDING"
    });

    const paymentLink = await payosService.createPaymentLink(
      {
        orderCode,
        amount: feeAmount,
        description,
        returnUrl,
        cancelUrl,
        expiredAt
      },
      {
        clientId: bank.payos_client_id,
        apiKey: bank.payos_api_key,
        checksumKey: bank.payos_checksum_key
      }
    );

    return res.status(200).json({
      success: true,
      message: "Tạo mã PayOS thành công",
      data: {
        orderCode,
        checkoutUrl: paymentLink.checkoutUrl,
        qrCode: paymentLink.qrCode || null,
        paymentLinkId: paymentLink.paymentLinkId || paymentLink.id || null,
        expiredAt: paymentLink.expiredAt || expiredAt
      }
    });
  } catch (error) {
    console.error("Error createTournamentPayOSPayment:", error);
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Verify tournament payment (frontend return flow)
const verifyTournamentPayOSPayment = async (req, res) => {
  try {
    const { orderCode } = req.body;
    if (!orderCode) {
      return res.status(400).json({ success: false, message: "Thiếu orderCode" });
    }

    const tx = await TransactionHistory.findOne({ order_code: orderCode }).lean();
    if (!tx || !tx.description?.startsWith("TournamentFee:")) {
      return res.status(404).json({ success: false, message: "Không tìm thấy giao dịch thanh toán giải đấu" });
    }

    if (tx.status === "SUCCESS") {
      return res.status(200).json({ success: true, message: "Thanh toán đã được xác nhận trước đó" });
    }

    const [, tournamentId] = tx.description.split(":");
    const tournament = await Tournament.findById(tournamentId).lean();
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    const bank = await ClubBank.findOne({ club_id: tournament.club_id }).lean();
    if (!bank || !bank.payos_client_id || !bank.payos_api_key || !bank.payos_checksum_key) {
      return res.status(400).json({ success: false, message: "CLB chưa cấu hình PayOS" });
    }

    const paymentInfo = await payosService.getPaymentInfo(orderCode, {
      clientId: bank.payos_client_id,
      apiKey: bank.payos_api_key,
      checksumKey: bank.payos_checksum_key
    });

    if (paymentInfo.status !== "PAID") {
      return res.status(400).json({ success: false, message: "Thanh toán chưa hoàn tất" });
    }

    await markTransactionSuccessAndApprove(orderCode);
    return res.status(200).json({ success: true, message: "Thanh toán thành công, đăng ký đã được duyệt" });
  } catch (error) {
    console.error("Error verifyTournamentPayOSPayment:", error);
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Tournament PayOS webhook
const tournamentPayOSWebhook = async (req, res) => {
  try {
    const payload = req.body;
    const orderCode = payload?.data?.orderCode;
    if (!orderCode) {
      return res.status(400).json({ success: false, message: "Thiếu orderCode" });
    }

    const tx = await TransactionHistory.findOne({ order_code: orderCode }).lean();
    if (!tx || !tx.description?.startsWith("TournamentFee:")) {
      return res.status(404).json({ success: false, message: "Không tìm thấy giao dịch giải đấu" });
    }

    const [, tournamentId] = tx.description.split(":");
    const tournament = await Tournament.findById(tournamentId).lean();
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    const bank = await ClubBank.findOne({ club_id: tournament.club_id }).lean();
    if (!bank || !bank.payos_client_id || !bank.payos_api_key || !bank.payos_checksum_key) {
      return res.status(400).json({ success: false, message: "CLB thiếu cấu hình PayOS" });
    }

    let webhookData;
    try {
      webhookData = await payosService.verifyWebhook(payload, {
        clientId: bank.payos_client_id,
        apiKey: bank.payos_api_key,
        checksumKey: bank.payos_checksum_key
      });
    } catch (e) {
      console.error("Tournament PayOS webhook verify failed:", e?.message || e);
      return res.status(400).json({ success: false, message: "Webhook không hợp lệ" });
    }

    const isPaid =
      webhookData?.data?.code === "00" ||
      payload?.data?.code === "00" ||
      payload?.success === true;
    if (!isPaid) {
      return res.status(200).json({ success: true, message: "Webhook received (not paid)" });
    }

    await markTransactionSuccessAndApprove(orderCode);
    return res.status(200).json({ success: true, message: "Đã cập nhật đăng ký giải đấu" });
  } catch (error) {
    console.error("Error tournamentPayOSWebhook:", error);
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

module.exports = {
  createTournament,
  getTournamentsByClub,
  getPublicTournaments,
  getTournamentById,
  updateTournament,
  deleteTournament,
  createTournamentPayOSPayment,
  verifyTournamentPayOSPayment,
  tournamentPayOSWebhook
};
