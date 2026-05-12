const mongoose = require("mongoose");
const Tournament = require("../../models/tournament.model");
const TournamentPlayer = require("../../models/tournament_player.model");
const TournamentRound = require("../../models/tournament_round.model");
const RoundMatch = require("../../models/round_match.model");
const TransactionHistory = require("../../models/transiction_history.model");
const Club = require("../../models/club.model");
const Notification = require("../../models/notification.model");
const Account = require("../../models/account.model");

const shuffleArray = (input) => {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const nextPowerOfTwo = (n) => {
  if (n < 2) return 2;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
};

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
    const playerAccount = await Account.findById(accountId).select("fullname phone").lean();
    const playerName = playerAccount ? (playerAccount.fullname || playerAccount.phone || "Một người chơi") : "Một người chơi";

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

    const clubInfo = await Club.findById(tournament.club_id).select("account_id").lean();

    const targetIds = new Set(clubStaffs.map(staff => staff._id.toString()));
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

const clearBracket = async (tournamentId) => {
  await Promise.all([
    RoundMatch.deleteMany({ tournament_id: tournamentId }),
    TournamentRound.deleteMany({ tournament_id: tournamentId }),
  ]);
};

const buildFirstRoundPairs = (playerIds, bracketSize) => {
  const players = [...playerIds];
  const matchCount = bracketSize / 2;
  const pairs = [];

  for (let i = 0; i < matchCount; i += 1) {
    const remainingPlayers = players.length;
    const remainingMatches = matchCount - i;

    if (remainingPlayers <= 0) {
      pairs.push([null, null]);
      continue;
    }

    if (remainingPlayers <= remainingMatches) {
      pairs.push([players.shift() || null, null]);
      continue;
    }

    pairs.push([players.shift() || null, players.shift() || null]);
  }

  return pairs;
};

const normalizePrizePool = (prizePool, fee = 0) => {
  const feeValue = Number(fee) || 0;
  if (!Number.isFinite(feeValue) || feeValue < 0) {
    return { error: "Phí tham gia không được là số âm" };
  }

  const rawPrizePool =
    typeof prizePool === "string" ? prizePool.trim() : prizePool;

  if (
    rawPrizePool === undefined ||
    rawPrizePool === null ||
    rawPrizePool === ""
  ) {
    return { error: "Tiền thưởng là bắt buộc" };
  }

  const prizeValue = Number(rawPrizePool);
  if (!Number.isFinite(prizeValue) || prizeValue <= 0) {
    return { error: "Tiền thưởng phải lớn hơn 0" };
  }

  if (feeValue > 0 && prizeValue <= feeValue) {
    return { error: "Tiền thưởng phải lớn hơn phí tham gia" };
  }

  return { value: String(prizeValue) };
};

const getWinnerFeedTarget = (matchDoc) => ({
  matchId: matchDoc?.winner_next_match_id || matchDoc?.next_match_id || null,
  slot: matchDoc?.winner_next_slot || matchDoc?.next_slot || null,
});

const canMatchProduceParticipant = async (
  matchId,
  routeType = "winner",
  visited = new Set(),
) => {
  if (!matchId) return false;

  const visitKey = `${matchId}:${routeType}`;
  if (visited.has(visitKey)) return false;
  visited.add(visitKey);

  const match = await RoundMatch.findById(matchId)
    .select("status player1_id player2_id winner_id loser_id")
    .lean();
  if (!match) return false;

  if (match.status === "Finished") {
    return routeType === "loser"
      ? Boolean(match.loser_id)
      : Boolean(match.winner_id);
  }

  const hasPlayer1 = Boolean(match.player1_id);
  const hasPlayer2 = Boolean(match.player2_id);

  if (hasPlayer1 && hasPlayer2) {
    return true;
  }

  if (routeType === "loser") {
    if (hasPlayer1 && !hasPlayer2) {
      return canSlotReceiveParticipant(match._id, 2, visited);
    }

    if (!hasPlayer1 && hasPlayer2) {
      return canSlotReceiveParticipant(match._id, 1, visited);
    }

    return (
      (await canSlotReceiveParticipant(match._id, 1, visited)) &&
      (await canSlotReceiveParticipant(match._id, 2, visited))
    );
  }

  if (hasPlayer1 && !hasPlayer2) {
    const missingCanReceive = await canSlotReceiveParticipant(
      match._id,
      2,
      visited,
    );
    return missingCanReceive || hasPlayer1;
  }

  if (!hasPlayer1 && hasPlayer2) {
    const missingCanReceive = await canSlotReceiveParticipant(
      match._id,
      1,
      visited,
    );
    return missingCanReceive || hasPlayer2;
  }

  return (
    (await canSlotReceiveParticipant(match._id, 1, visited)) ||
    (await canSlotReceiveParticipant(match._id, 2, visited))
  );
};

const canSlotReceiveParticipant = async (
  targetMatchId,
  slot,
  visited = new Set(),
) => {
  const sources = await RoundMatch.find({
    $or: [
      { winner_next_match_id: targetMatchId, winner_next_slot: slot },
      { next_match_id: targetMatchId, next_slot: slot },
      { loser_next_match_id: targetMatchId, loser_next_slot: slot },
    ],
  })
    .select(
      "_id winner_next_match_id winner_next_slot next_match_id next_slot loser_next_match_id loser_next_slot",
    )
    .lean();

  if (!sources.length) {
    return false;
  }

  for (const source of sources) {
    const winnerFeedsTarget =
      String(source.winner_next_match_id || source.next_match_id || "") ===
      String(targetMatchId) &&
      Number(source.winner_next_slot || source.next_slot || null) ===
      Number(slot);

    if (winnerFeedsTarget) {
      if (
        await canMatchProduceParticipant(source._id, "winner", new Set(visited))
      ) {
        return true;
      }
    }

    const loserFeedsTarget =
      String(source.loser_next_match_id || "") === String(targetMatchId) &&
      Number(source.loser_next_slot || null) === Number(slot);

    if (loserFeedsTarget) {
      if (
        await canMatchProduceParticipant(source._id, "loser", new Set(visited))
      ) {
        return true;
      }
    }
  }

  return false;
};

const pushParticipantToMatch = async (
  matchId,
  slot,
  participantId,
  session = null,
) => {
  if (!matchId || !slot || !participantId) return null;

  const field = slot === 1 ? "player1_id" : "player2_id";
  const match = await RoundMatch.findById(matchId).session(session || null);
  if (!match) return null;

  if (!match[field]) {
    match[field] = participantId;
    await match.save({ session });
  }

  return match;
};

const syncRoundStatusesForStartedTournament = async (tournamentId) => {
  const tournament = await Tournament.findById(tournamentId)
    .select("status")
    .lean();
  if (!tournament || tournament.status !== "InProgress") return;

  const rounds = await TournamentRound.find({
    tournament_id: tournamentId,
  }).lean();
  const matches = await RoundMatch.find({ tournament_id: tournamentId })
    .select("round_id status")
    .lean();

  const byRound = matches.reduce((acc, match) => {
    const key = String(match.round_id);
    acc[key] = acc[key] || [];
    acc[key].push(match);
    return acc;
  }, {});

  for (const round of rounds) {
    const roundMatches = byRound[String(round._id)] || [];
    if (!roundMatches.length) continue;

    const allFinished = roundMatches.every(
      (match) => match.status === "Finished",
    );
    const hasStartedMatch = roundMatches.some((match) =>
      ["Ready", "Playing", "Finished"].includes(match.status),
    );

    const desiredStatus = allFinished
      ? "Completed"
      : hasStartedMatch
        ? "InProgress"
        : "Pending";

    if (round.status !== desiredStatus) {
      await TournamentRound.findByIdAndUpdate(round._id, {
        status: desiredStatus,
      });
    }
  }
};

const propagateMatchOutcomes = async (
  matchDoc,
  session = null,
  visited = new Set(),
) => {
  if (!matchDoc) return;

  const matchId = String(matchDoc._id);
  if (visited.has(matchId)) return;
  visited.add(matchId);

  const winnerTarget = getWinnerFeedTarget(matchDoc);
  if (matchDoc.winner_id && winnerTarget.matchId && winnerTarget.slot) {
    const nextMatch = await pushParticipantToMatch(
      winnerTarget.matchId,
      winnerTarget.slot,
      matchDoc.winner_id,
      session,
    );
    if (nextMatch) {
      await refreshMatchState(nextMatch._id, session, visited);
    }
  }

  if (matchDoc.loser_next_match_id && matchDoc.loser_next_slot) {
    if (matchDoc.loser_id) {
      const loserMatch = await pushParticipantToMatch(
        matchDoc.loser_next_match_id,
        matchDoc.loser_next_slot,
        matchDoc.loser_id,
        session,
      );
      if (loserMatch) {
        await refreshMatchState(loserMatch._id, session, visited);
      }
    } else {
      await refreshMatchState(matchDoc.loser_next_match_id, session, visited);
    }
  }
};

async function refreshMatchState(matchId, session = null, visited = new Set()) {
  const match = await RoundMatch.findById(matchId).session(session || null);
  if (!match || match.status === "Finished") return false;

  let changed = false;

  if (match.player1_id && match.player2_id && match.status === "Scheduled") {
    match.status = "Ready";
    await match.save({ session });
    return true;
  }

  if (Boolean(match.player1_id) === Boolean(match.player2_id)) {
    return changed;
  }

  const missingSlot = match.player1_id ? 2 : 1;
  const hasPendingSource = await canSlotReceiveParticipant(
    match._id,
    missingSlot,
    visited,
  );
  if (hasPendingSource) {
    return changed;
  }

  const winnerId = match.player1_id || match.player2_id;
  if (!winnerId) return changed;

  match.winner_id = winnerId;
  match.loser_id = null;
  match.result = "BYE";
  match.finished_at = new Date();
  match.status = "Finished";
  await match.save({ session });

  await propagateMatchOutcomes(match, session, visited);
  return true;
}

const resolvePendingAutoAdvances = async (tournamentId) => {
  let shouldContinue = true;

  while (shouldContinue) {
    shouldContinue = false;
    const candidates = await RoundMatch.find({
      tournament_id: tournamentId,
      status: { $ne: "Finished" },
      $or: [
        { player1_id: { $ne: null }, player2_id: null },
        { player1_id: null, player2_id: { $ne: null } },
      ],
    })
      .select("_id")
      .lean();

    for (const candidate of candidates) {
      const changed = await refreshMatchState(candidate._id);
      if (changed) {
        shouldContinue = true;
      }
    }
  }
};

const checkAndCompleteTournament = async (tournamentId) => {
  const tournament = await Tournament.findById(tournamentId).lean();
  if (!tournament) return;

  if (tournament.status === "Completed" || tournament.status === "Cancelled")
    return;

  if (tournament.format === "Knockout") {
    const finalMatch = await RoundMatch.findOne({
      tournament_id: tournamentId,
      match_format: "Knockout",
      next_match_id: null,
    }).lean();

    if (
      finalMatch &&
      finalMatch.status === "Finished" &&
      finalMatch.winner_id
    ) {
      await TournamentPlayer.updateMany(
        { tournament_id: tournamentId },
        {
          $set: {
            status: "Eliminated",
            final_rank: null,
            elimination_round: null,
          },
        },
      );

      await TournamentPlayer.findOneAndUpdate(
        { tournament_id: tournamentId, account_id: finalMatch.winner_id },
        {
          $set: { status: "Champion", final_rank: 1, elimination_round: null },
        },
      );

      if (finalMatch.loser_id) {
        await TournamentPlayer.findOneAndUpdate(
          { tournament_id: tournamentId, account_id: finalMatch.loser_id },
          { $set: { final_rank: 2 } },
        );
      }

      await Tournament.findByIdAndUpdate(tournamentId, {
        status: "Completed",
        champion_account_id: finalMatch.winner_id,
        completed_at: new Date(),
      });
    }
    return;
  }

  if (tournament.format === "Double Elimination") {
    const grandFinal = await RoundMatch.findOne({
      tournament_id: tournamentId,
      match_format: "DoubleElimination",
      bracket_side: "GrandFinal",
    }).lean();

    if (
      grandFinal &&
      grandFinal.status === "Finished" &&
      grandFinal.winner_id
    ) {
      await TournamentPlayer.updateMany(
        { tournament_id: tournamentId },
        {
          $set: {
            status: "Eliminated",
            final_rank: null,
            elimination_round: null,
          },
        },
      );

      await TournamentPlayer.findOneAndUpdate(
        { tournament_id: tournamentId, account_id: grandFinal.winner_id },
        {
          $set: { status: "Champion", final_rank: 1, elimination_round: null },
        },
      );

      if (grandFinal.loser_id) {
        await TournamentPlayer.findOneAndUpdate(
          { tournament_id: tournamentId, account_id: grandFinal.loser_id },
          { $set: { final_rank: 2 } },
        );
      }

      await Tournament.findByIdAndUpdate(tournamentId, {
        status: "Completed",
        champion_account_id: grandFinal.winner_id,
        completed_at: new Date(),
      });
    }
  }
};

const generateKnockoutBracket = async (tournament) => {
  const approvedPlayers = await fetchApprovedPlayers(tournament._id);
  if (approvedPlayers.length < 2) {
    throw new Error("Cần ít nhất 2 người chơi để tạo nhánh đấu");
  }

  await clearBracket(tournament._id);

  const playerIds = shuffleArray(
    approvedPlayers.map((p) => p.account_id?._id || p.account_id),
  );
  const bracketSize = nextPowerOfTwo(playerIds.length);
  const firstRoundPairs = buildFirstRoundPairs(playerIds, bracketSize);

  const roundCount = Math.log2(bracketSize);
  const roundDocs = [];
  for (let i = 1; i <= roundCount; i += 1) {
    roundDocs.push({
      _id: new mongoose.Types.ObjectId(),
      tournament_id: tournament._id,
      round_number: i,
      round_type: "Knockout",
      status: "Pending",
      order: i,
    });
  }

  const matchIdMatrix = [];
  for (let r = 0; r < roundCount; r += 1) {
    const matchCount = bracketSize / Math.pow(2, r + 1);
    matchIdMatrix[r] = [];
    for (let m = 0; m < matchCount; m += 1) {
      matchIdMatrix[r].push(new mongoose.Types.ObjectId());
    }
  }

  const matchDocs = [];
  for (let r = 0; r < roundCount; r += 1) {
    const matchCount = bracketSize / Math.pow(2, r + 1);
    for (let m = 0; m < matchCount; m += 1) {
      const [p1, p2] = r === 0 ? firstRoundPairs[m] : [null, null];
      const nextMatchId =
        r === roundCount - 1 ? null : matchIdMatrix[r + 1][Math.floor(m / 2)];
      const nextSlot = r === roundCount - 1 ? null : (m % 2) + 1;

      let status = "Scheduled";
      let winner_id = null;
      let loser_id = null;
      let result = "";
      let finished_at = null;

      if (p1 && p2) {
        status = "Ready";
      } else if (p1 || p2) {
        status = "Finished";
        winner_id = p1 || p2;
        result = "BYE";
        finished_at = new Date();
      }

      const isFinal = r === roundCount - 1;
      const isSemi = r === roundCount - 2 && roundCount > 1;
      const match_name = isFinal
        ? "Chung kết"
        : isSemi
          ? `Bán kết ${m + 1}`
          : `Vòng ${r + 1} - Trận ${m + 1}`;

      matchDocs.push({
        _id: matchIdMatrix[r][m],
        tournament_id: tournament._id,
        round_id: roundDocs[r]._id,
        match_no: m + 1,
        player1_id: p1,
        player2_id: p2,
        winner_id,
        loser_id,
        player1_score: 0,
        player2_score: 0,
        match_name,
        result,
        race_to: tournament?.generation_config?.race_to || 7,
        bracket_side: null,
        next_match_id: nextMatchId,
        next_slot: nextSlot,
        winner_next_match_id: nextMatchId,
        winner_next_slot: nextSlot,
        loser_next_match_id: null,
        loser_next_slot: null,
        match_format: "Knockout",
        status,
        finished_at,
        locked_by_owner: true,
      });
    }
  }

  await TournamentRound.insertMany(roundDocs);
  if (matchDocs.length) {
    await RoundMatch.insertMany(matchDocs);
  }

  const byeMatches = await RoundMatch.find({
    tournament_id: tournament._id,
    status: "Finished",
    result: "BYE",
  });
  for (const bye of byeMatches) {
    await propagateMatchOutcomes(bye);
  }
  await resolvePendingAutoAdvances(tournament._id);

  await Tournament.findByIdAndUpdate(tournament._id, {
    bracket_generated: true,
    bracket_generated_at: new Date(),
    status: tournament.status === "Draft" ? "Closed" : tournament.status,
    generation_config: {
      ...(tournament.generation_config || {}),
      format: "Knockout",
    },
  });

  return { roundCount, bracketSize };
};

const generateDoubleEliminationBracket = async (tournament) => {
  const approvedPlayers = await fetchApprovedPlayers(tournament._id);
  if (approvedPlayers.length < 2) {
    throw new Error("Cần ít nhất 2 người chơi để tạo nhánh đấu");
  }

  await clearBracket(tournament._id);

  const playerIds = shuffleArray(
    approvedPlayers.map((p) => p.account_id?._id || p.account_id),
  );
  const bracketSize = nextPowerOfTwo(playerIds.length);
  const roundCount = Math.log2(bracketSize);
  const firstRoundPairs = buildFirstRoundPairs(playerIds, bracketSize);

  if (roundCount === 1) {
    const roundId = new mongoose.Types.ObjectId();
    await TournamentRound.create({
      _id: roundId,
      tournament_id: tournament._id,
      round_number: 1,
      round_type: "DoubleElimination",
      bracket_side: "GrandFinal",
      status: "Pending",
      order: 1,
    });

    const [p1, p2] = firstRoundPairs[0];
    let status = "Scheduled";
    let winner_id = null;
    let result = "";
    let finished_at = null;

    if (p1 && p2) {
      status = "Ready";
    } else if (p1 || p2) {
      status = "Finished";
      winner_id = p1 || p2;
      result = "BYE";
      finished_at = new Date();
    }

    await RoundMatch.create({
      tournament_id: tournament._id,
      round_id: roundId,
      match_no: 1,
      player1_id: p1,
      player2_id: p2,
      winner_id,
      loser_id: null,
      player1_score: 0,
      player2_score: 0,
      match_name: "Chung ket",
      result,
      race_to: tournament?.generation_config?.race_to || 7,
      bracket_side: "GrandFinal",
      next_match_id: null,
      next_slot: null,
      winner_next_match_id: null,
      winner_next_slot: null,
      loser_next_match_id: null,
      loser_next_slot: null,
      match_format: "DoubleElimination",
      status,
      finished_at,
      locked_by_owner: true,
    });

    await Tournament.findByIdAndUpdate(tournament._id, {
      bracket_generated: true,
      bracket_generated_at: new Date(),
      status: tournament.status === "Draft" ? "Closed" : tournament.status,
      generation_config: {
        ...(tournament.generation_config || {}),
        format: "DoubleElimination",
        bracket_size: bracketSize,
        seed_mode: "random",
        grand_final_reset: false,
      },
    });

    return { roundCount: 1, bracketSize, losersRoundCount: 0 };
  }

  const losersRoundCount = Math.max(0, 2 * (roundCount - 1));
  const winnersRoundDocs = [];
  const losersRoundDocs = [];

  for (let i = 1; i <= roundCount; i += 1) {
    winnersRoundDocs.push({
      _id: new mongoose.Types.ObjectId(),
      tournament_id: tournament._id,
      round_number: i,
      round_type: "DoubleElimination",
      bracket_side: "Winners",
      status: "Pending",
      order: i,
    });
  }

  for (let i = 1; i <= losersRoundCount; i += 1) {
    losersRoundDocs.push({
      _id: new mongoose.Types.ObjectId(),
      tournament_id: tournament._id,
      round_number: i,
      round_type: "DoubleElimination",
      bracket_side: "Losers",
      status: "Pending",
      order: roundCount + i,
    });
  }

  const grandFinalRound = {
    _id: new mongoose.Types.ObjectId(),
    tournament_id: tournament._id,
    round_number: 1,
    round_type: "DoubleElimination",
    bracket_side: "GrandFinal",
    status: "Pending",
    order: roundCount + losersRoundCount + 1,
  };

  const winnersMatchIds = [];
  for (let r = 0; r < roundCount; r += 1) {
    const matchCount = bracketSize / Math.pow(2, r + 1);
    winnersMatchIds[r] = Array.from(
      { length: matchCount },
      () => new mongoose.Types.ObjectId(),
    );
  }

  const getLosersMatchCount = (roundNumber) =>
    bracketSize / Math.pow(2, Math.floor((roundNumber + 1) / 2) + 1);

  const losersMatchIds = [];
  for (let l = 0; l < losersRoundCount; l += 1) {
    const matchCount = getLosersMatchCount(l + 1);
    losersMatchIds[l] = Array.from(
      { length: matchCount },
      () => new mongoose.Types.ObjectId(),
    );
  }

  const grandFinalId = new mongoose.Types.ObjectId();
  const matchDocs = [];

  for (let r = 0; r < roundCount; r += 1) {
    const matchCount = winnersMatchIds[r].length;
    for (let m = 0; m < matchCount; m += 1) {
      const [p1, p2] = r === 0 ? firstRoundPairs[m] : [null, null];
      const winnerNextMatchId =
        r === roundCount - 1
          ? grandFinalId
          : winnersMatchIds[r + 1][Math.floor(m / 2)];
      const winnerNextSlot = r === roundCount - 1 ? 1 : (m % 2) + 1;

      let loserNextMatchId = null;
      let loserNextSlot = null;
      if (r === 0) {
        loserNextMatchId = losersMatchIds[0]?.[Math.floor(m / 2)] || null;
        loserNextSlot = loserNextMatchId ? (m % 2) + 1 : null;
      } else if (r < roundCount - 1) {
        loserNextMatchId = losersMatchIds[2 * r - 1]?.[m] || null;
        loserNextSlot = loserNextMatchId ? 2 : null;
      } else {
        loserNextMatchId = losersMatchIds[losersRoundCount - 1]?.[0] || null;
        loserNextSlot = loserNextMatchId ? 2 : null;
      }

      let status = "Scheduled";
      let winner_id = null;
      let result = "";
      let finished_at = null;

      if (p1 && p2) {
        status = "Ready";
      } else if (p1 || p2) {
        status = "Finished";
        winner_id = p1 || p2;
        result = "BYE";
        finished_at = new Date();
      }

      matchDocs.push({
        _id: winnersMatchIds[r][m],
        tournament_id: tournament._id,
        round_id: winnersRoundDocs[r]._id,
        match_no: m + 1,
        player1_id: p1,
        player2_id: p2,
        winner_id,
        loser_id: null,
        player1_score: 0,
        player2_score: 0,
        match_name:
          r === roundCount - 1
            ? "Chung ket nhanh thang"
            : `Nhanh thang - Vong ${r + 1} - Tran ${m + 1}`,
        result,
        race_to: tournament?.generation_config?.race_to || 7,
        bracket_side: "Winners",
        next_match_id: winnerNextMatchId,
        next_slot: winnerNextSlot,
        winner_next_match_id: winnerNextMatchId,
        winner_next_slot: winnerNextSlot,
        loser_next_match_id: loserNextMatchId,
        loser_next_slot: loserNextSlot,
        match_format: "DoubleElimination",
        status,
        finished_at,
        locked_by_owner: true,
      });
    }
  }

  for (let l = 0; l < losersRoundCount; l += 1) {
    const matchCount = losersMatchIds[l].length;
    for (let m = 0; m < matchCount; m += 1) {
      let winnerNextMatchId = null;
      let winnerNextSlot = null;

      if (l === losersRoundCount - 1) {
        winnerNextMatchId = grandFinalId;
        winnerNextSlot = 2;
      } else if (l % 2 === 0) {
        winnerNextMatchId = losersMatchIds[l + 1]?.[m] || null;
        winnerNextSlot = winnerNextMatchId ? 1 : null;
      } else {
        winnerNextMatchId = losersMatchIds[l + 1]?.[Math.floor(m / 2)] || null;
        winnerNextSlot = winnerNextMatchId ? (m % 2) + 1 : null;
      }

      matchDocs.push({
        _id: losersMatchIds[l][m],
        tournament_id: tournament._id,
        round_id: losersRoundDocs[l]._id,
        match_no: m + 1,
        player1_id: null,
        player2_id: null,
        winner_id: null,
        loser_id: null,
        player1_score: 0,
        player2_score: 0,
        match_name:
          l === losersRoundCount - 1
            ? "Chung ket nhanh thua"
            : `Nhanh thua - Vong ${l + 1} - Tran ${m + 1}`,
        result: "",
        race_to: tournament?.generation_config?.race_to || 7,
        bracket_side: "Losers",
        next_match_id: winnerNextMatchId,
        next_slot: winnerNextSlot,
        winner_next_match_id: winnerNextMatchId,
        winner_next_slot: winnerNextSlot,
        loser_next_match_id: null,
        loser_next_slot: null,
        match_format: "DoubleElimination",
        status: "Scheduled",
        finished_at: null,
        locked_by_owner: true,
      });
    }
  }

  matchDocs.push({
    _id: grandFinalId,
    tournament_id: tournament._id,
    round_id: grandFinalRound._id,
    match_no: 1,
    player1_id: null,
    player2_id: null,
    winner_id: null,
    loser_id: null,
    player1_score: 0,
    player2_score: 0,
    match_name: "Chung ket",
    result: "",
    race_to: tournament?.generation_config?.race_to || 7,
    bracket_side: "GrandFinal",
    next_match_id: null,
    next_slot: null,
    winner_next_match_id: null,
    winner_next_slot: null,
    loser_next_match_id: null,
    loser_next_slot: null,
    match_format: "DoubleElimination",
    status: "Scheduled",
    finished_at: null,
    locked_by_owner: true,
  });

  await TournamentRound.insertMany([
    ...winnersRoundDocs,
    ...losersRoundDocs,
    grandFinalRound,
  ]);
  await RoundMatch.insertMany(matchDocs);

  const byeMatches = await RoundMatch.find({
    tournament_id: tournament._id,
    status: "Finished",
    result: "BYE",
  });
  for (const bye of byeMatches) {
    await propagateMatchOutcomes(bye);
  }
  await resolvePendingAutoAdvances(tournament._id);

  await Tournament.findByIdAndUpdate(tournament._id, {
    bracket_generated: true,
    bracket_generated_at: new Date(),
    status: tournament.status === "Draft" ? "Closed" : tournament.status,
    generation_config: {
      ...(tournament.generation_config || {}),
      format: "DoubleElimination",
      bracket_size: bracketSize,
      seed_mode: "random",
      grand_final_reset: false,
    },
  });

  return { roundCount, bracketSize, losersRoundCount };
};

const updateRoundStatusAndProgression = async (tournamentId, roundId) => {
  const round = await TournamentRound.findById(roundId).lean();
  if (!round) return;
  await syncRoundStatusesForStartedTournament(tournamentId);
};


module.exports = {
  ensureTournamentApproved,
  markTransactionSuccessAndApprove,
  fetchApprovedPlayers,
  normalizePrizePool,
  syncRoundStatusesForStartedTournament,
  generateKnockoutBracket,
  generateDoubleEliminationBracket,
  updateRoundStatusAndProgression,
  resolvePendingAutoAdvances,
  propagateMatchOutcomes,
  checkAndCompleteTournament,
};
