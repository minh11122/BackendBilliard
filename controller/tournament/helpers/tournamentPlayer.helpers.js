const Tournament = require("../../../models/tournament.model");
const TournamentPlayer = require("../../../models/tournament_player.model");
const TransactionHistory = require("../../../models/transiction_history.model");
const Club = require("../../../models/club.model");
const Notification = require("../../../models/notification.model");
const Account = require("../../../models/account.model");

const ensureTournamentApproved = async (tournamentId, accountId, feeAmount) => {
  const existingRegistration = await TournamentPlayer.findOne({
    tournament_id: tournamentId,
    account_id: accountId,
    status: "Approved",
  }).lean();

  await TournamentPlayer.findOneAndUpdate(
    { tournament_id: tournamentId, account_id: accountId },
    {
      $set: {
        register_date: new Date(),
        fee_amount: feeAmount,
        status: "Approved",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const tournament =
    await Tournament.findById(tournamentId).select("max_players name club_id");
  if (!tournament) return;

  if (!existingRegistration) {
    const playerAccount = await Account.findById(accountId)
      .select("fullname phone")
      .lean();
    const playerName = playerAccount
      ? (playerAccount.fullname || playerAccount.phone || "Một người chơi")
      : "Một người chơi";

    await Notification.create({
      account_id: accountId,
      title: "Đăng ký giải đấu thành công",
      message: `Bạn đã đăng ký thành công giải đấu ${tournament.name || ""}.`,
      link: `/my-tournaments?tournamentId=${tournamentId}`,
      is_read: false,
    });

    const clubStaffs = await Account.find({
      club_id: tournament.club_id,
      status: "ACTIVE",
    }).select("_id").lean();

    const clubInfo = await Club.findById(tournament.club_id)
      .select("account_id")
      .lean();

    const targetIds = new Set(clubStaffs.map((staff) => staff._id.toString()));
    if (clubInfo?.account_id) {
      targetIds.add(clubInfo.account_id.toString());
    }

    if (targetIds.size > 0) {
      await Notification.insertMany(
        Array.from(targetIds).map((targetId) => ({
          account_id: targetId,
          title: "Có người đăng ký giải đấu",
          message: `Người chơi ${playerName} vừa đăng ký tham gia giải đấu ${tournament.name || ""}.`,
          link: `/staff/tournaments/${tournamentId}/players`,
          is_read: false,
        })),
      );
    }
  }

  const approvedCount = await TournamentPlayer.countDocuments({
    tournament_id: tournamentId,
    status: "Approved",
  });

  const nextStatus =
    approvedCount >= Number(tournament.max_players || 0) ? "Closed" : "Open";
  await Tournament.findByIdAndUpdate(tournamentId, {
    registered_player: approvedCount,
    status: nextStatus,
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

const fetchApprovedPlayers = async (tournamentId) => {
  return TournamentPlayer.find({
    tournament_id: tournamentId,
    status: "Approved",
  })
    .populate("account_id", "fullname phone avatar_url")
    .lean();
};

module.exports = {
  ensureTournamentApproved,
  markTransactionSuccessAndApprove,
  fetchApprovedPlayers,
};
