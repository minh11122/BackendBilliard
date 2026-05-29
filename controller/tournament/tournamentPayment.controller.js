const Tournament = require("../../models/tournament.model");
const TournamentPlayer = require("../../models/tournament_player.model");
const TransactionHistory = require("../../models/transiction_history.model");
const ClubBank = require("../../models/club_bank.model");
const payosService = require("../../services/payos.service");
const {
  PAYOS_CONFIG_MSG,
  resolvePayosApiErrorMessage,
} = require("../../utils/payosError.util");

const PAYOS_EXPIRE_MINUTES = 10;
const {
  ensureTournamentApproved,
  markTransactionSuccessAndApprove,
} = require("./tournament.helpers");

const createTournamentPayOSPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const accountId = req.user?.accountId;
    if (!accountId) {
      return res
        .status(401)
        .json({ success: false, message: "Bạn chưa đăng nhập" });
    }

    const tournament = await Tournament.findById(id).lean();
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }
    if (tournament.status !== "Open") {
      return res
        .status(400)
        .json({ success: false, message: "Giải đấu hiện không mở đăng ký" });
    }

    const approvedCount = await TournamentPlayer.countDocuments({
      tournament_id: tournament._id,
      status: "Approved",
    });
    if (approvedCount >= Number(tournament.max_players || 0)) {
      return res.status(400).json({
        success: false,
        message: "Giải đấu đã đủ số lượng người chơi",
      });
    }

    const existedApproved = await TournamentPlayer.findOne({
      tournament_id: tournament._id,
      account_id: accountId,
      status: "Approved",
    }).lean();
    if (existedApproved) {
      return res
        .status(200)
        .json({ success: true, message: "Bạn đã đăng ký giải đấu này rồi" });
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
        status: "SUCCESS",
      });
      return res.status(200).json({
        success: true,
        message: "Đăng ký giải đấu thành công",
      });
    }

    const bank = await ClubBank.findOne({ club_id: tournament.club_id }).lean();
    if (
      !bank ||
      !bank.payos_client_id ||
      !bank.payos_api_key ||
      !bank.payos_checksum_key
    ) {
      return res.status(400).json({
        success: false,
        message: PAYOS_CONFIG_MSG,
      });
    }

    const orderCode = Date.now();
    const expiredAt = Math.floor(
      (Date.now() + PAYOS_EXPIRE_MINUTES * 60 * 1000) / 1000,
    );
    const description = `Phi tham gia ${String(tournament.name || "giai dau")}`.slice(0, 25);
    const returnUrl = `http://localhost:5173/tournament/${tournament._id}/payment`;
    const cancelUrl = `http://localhost:5173/tournament/${tournament._id}/payment`;

    await TransactionHistory.create({
      account_id: accountId,
      order_code: orderCode,
      amount: feeAmount,
      description: `TournamentFee:${tournament._id}`,
      transaction_type: "TOURNAMENT_FEE",
      transaction_time: new Date(),
      status: "PENDING",
    });

    const paymentLink = await payosService.createPaymentLink(
      {
        orderCode,
        amount: feeAmount,
        description,
        returnUrl,
        cancelUrl,
        expiredAt,
      },
      {
        clientId: bank.payos_client_id,
        apiKey: bank.payos_api_key,
        checksumKey: bank.payos_checksum_key,
      },
    );

    return res.status(200).json({
      success: true,
      message: "Tạo mã PayOS thành công",
      data: {
        orderCode,
        checkoutUrl: paymentLink.checkoutUrl,
        qrCode: paymentLink.qrCode || null,
        paymentLinkId: paymentLink.paymentLinkId || paymentLink.id || null,
        expiredAt: paymentLink.expiredAt || expiredAt,
      },
    });
  } catch (error) {
    console.error("Error createTournamentPayOSPayment:", error);
    return res.status(500).json({
      success: false,
      message: resolvePayosApiErrorMessage(error),
    });
  }
};


const verifyTournamentPayOSPayment = async (req, res) => {
  try {
    const { orderCode } = req.body;
    if (!orderCode) {
      return res
        .status(400)
        .json({ success: false, message: "Thiếu orderCode" });
    }

    const tx = await TransactionHistory.findOne({
      order_code: orderCode,
    }).lean();
    if (!tx || !tx.description?.startsWith("TournamentFee:")) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy giao dịch thanh toán giải đấu",
      });
    }

    if (tx.status === "SUCCESS") {
      return res.status(200).json({
        success: true,
        message: "Thanh toán đã được xác nhận trước đó",
      });
    }

    const [, tournamentId] = tx.description.split(":");
    const tournament = await Tournament.findById(tournamentId).lean();
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    const bank = await ClubBank.findOne({ club_id: tournament.club_id }).lean();
    if (
      !bank ||
      !bank.payos_client_id ||
      !bank.payos_api_key ||
      !bank.payos_checksum_key
    ) {
      return res
        .status(400)
        .json({ success: false, message: PAYOS_CONFIG_MSG });
    }

    const paymentInfo = await payosService.getPaymentInfo(orderCode, {
      clientId: bank.payos_client_id,
      apiKey: bank.payos_api_key,
      checksumKey: bank.payos_checksum_key,
    });

    if (paymentInfo.status !== "PAID") {
      return res
        .status(400)
        .json({ success: false, message: "Thanh toán chưa hoàn tất" });
    }

    await markTransactionSuccessAndApprove(orderCode);
    return res.status(200).json({
      success: true,
      message: "Thanh toán thành công, đăng ký đã được duyệt",
    });
  } catch (error) {
    console.error("Error verifyTournamentPayOSPayment:", error);
    return res.status(500).json({
      success: false,
      message: resolvePayosApiErrorMessage(error),
    });
  }
};


const tournamentPayOSWebhook = async (req, res) => {
  try {
    const payload = req.body;
    const orderCode = payload?.data?.orderCode;
    if (!orderCode) {
      return res
        .status(400)
        .json({ success: false, message: "Thiếu orderCode" });
    }

    const tx = await TransactionHistory.findOne({
      order_code: orderCode,
    }).lean();
    if (!tx || !tx.description?.startsWith("TournamentFee:")) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giao dịch giải đấu" });
    }

    const [, tournamentId] = tx.description.split(":");
    const tournament = await Tournament.findById(tournamentId).lean();
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    const bank = await ClubBank.findOne({ club_id: tournament.club_id }).lean();
    if (
      !bank ||
      !bank.payos_client_id ||
      !bank.payos_api_key ||
      !bank.payos_checksum_key
    ) {
      return res
        .status(400)
        .json({ success: false, message: PAYOS_CONFIG_MSG });
    }

    let webhookData;
    try {
      webhookData = await payosService.verifyWebhook(payload, {
        clientId: bank.payos_client_id,
        apiKey: bank.payos_api_key,
        checksumKey: bank.payos_checksum_key,
      });
    } catch (e) {
      console.error("Tournament PayOS webhook verify failed:", e?.message || e);
      return res
        .status(400)
        .json({ success: false, message: "Webhook không hợp lệ" });
    }

    const isPaid =
      webhookData?.data?.code === "00" ||
      payload?.data?.code === "00" ||
      payload?.success === true;
    if (!isPaid) {
      return res
        .status(200)
        .json({ success: true, message: "Webhook received (not paid)" });
    }

    await markTransactionSuccessAndApprove(orderCode);
    return res
      .status(200)
      .json({ success: true, message: "Đã cập nhật đăng ký giải đấu" });
  } catch (error) {
    console.error("Error tournamentPayOSWebhook:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

module.exports = {
  createTournamentPayOSPayment,
  verifyTournamentPayOSPayment,
  tournamentPayOSWebhook,
};
