const TransactionHistory = require("../models/transiction_history.model");
const Booking = require("../models/booking.model");
const Tournament = require("../models/tournament.model");
const ClubBank = require("../models/club_bank.model");
const payosService = require("../services/payos.service");

const SKIPPED_ORDER_PREFIXES = ["CASH-", "FREE-"];

const mapPayosStatusToTransactionStatus = (payosStatus) => {
  const normalized = String(payosStatus || "").toUpperCase();

  if (normalized === "PAID") return "SUCCESS";
  if (normalized === "CANCELLED" || normalized === "CANCELED") return "CANCELLED";
  if (normalized === "EXPIRED") return "EXPIRED";

  return "PENDING";
};

const getDefaultPayosCreds = () => ({
  clientId: process.env.PAYOS_CLIENT_ID,
  apiKey: process.env.PAYOS_API_KEY,
  checksumKey: process.env.PAYOS_CHECKSUM_KEY,
});

const parseTournamentIdFromDescription = (description) => {
  if (!description?.startsWith("TournamentFee:")) return null;
  return description.split(":")[1] || null;
};

const resolveClubBankCreds = async (clubId) => {
  if (!clubId) return null;

  const bank = await ClubBank.findOne({ club_id: clubId }).lean();
  if (
    !bank?.payos_client_id ||
    !bank?.payos_api_key ||
    !bank?.payos_checksum_key
  ) {
    return null;
  }

  return {
    clientId: bank.payos_client_id,
    apiKey: bank.payos_api_key,
    checksumKey: bank.payos_checksum_key,
  };
};

const resolvePayosCredsForTransaction = async (row, { clubIdHint } = {}) => {
  const txType = row.transaction_type;

  if (txType === "SUBSCRIPTION") {
    const creds = getDefaultPayosCreds();
    return creds.clientId && creds.apiKey && creds.checksumKey ? creds : null;
  }

  if (txType === "TOURNAMENT_FEE") {
    const tournamentId =
      row.tournament?._id || parseTournamentIdFromDescription(row.description);

    if (clubIdHint) {
      return resolveClubBankCreds(clubIdHint);
    }

    if (!tournamentId) return null;

    const tournament = await Tournament.findById(tournamentId)
      .select("club_id")
      .lean();

    return resolveClubBankCreds(tournament?.club_id);
  }

  const bookingId = row.booking?._id || row.booking_id;
  if (!bookingId) return null;

  const clubId =
    row.club?._id ||
    row.table?.club_id ||
    clubIdHint ||
    (
      await Booking.findById(bookingId)
        .populate({ path: "table_id", select: "club_id" })
        .lean()
    )?.table_id?.club_id;

  return resolveClubBankCreds(clubId);
};

const shouldSyncTransaction = (row) =>
  row?.status === "PENDING" &&
  row?.order_code &&
  !SKIPPED_ORDER_PREFIXES.some((prefix) =>
    String(row.order_code).startsWith(prefix)
  );

const syncPendingTransactionStatus = async (row, options = {}) => {
  if (!shouldSyncTransaction(row)) {
    return row.status;
  }

  try {
    const creds = await resolvePayosCredsForTransaction(row, options);
    const paymentInfo = creds
      ? await payosService.getPaymentInfo(row.order_code, creds)
      : await payosService.getPaymentInfo(row.order_code);

    const nextStatus = mapPayosStatusToTransactionStatus(paymentInfo?.status);
    if (nextStatus === row.status) {
      return row.status;
    }

    await TransactionHistory.findOneAndUpdate(
      { order_code: row.order_code, status: "PENDING" },
      { status: nextStatus }
    );

    return nextStatus;
  } catch (error) {
    console.error(
      "syncPendingTransactionStatus failed:",
      row.order_code,
      error?.message || error
    );
    return row.status;
  }
};

const syncPendingTransactions = async (rows, options = {}) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return rows;
  }

  await Promise.all(
    rows.map(async (row) => {
      const nextStatus = await syncPendingTransactionStatus(row, options);
      row.status = nextStatus;
    })
  );

  return rows;
};

module.exports = {
  mapPayosStatusToTransactionStatus,
  syncPendingTransactions,
  syncPendingTransactionStatus,
};
