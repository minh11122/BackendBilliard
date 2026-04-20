const mongoose = require("mongoose");
const Tournament = require("../models/tournament.model");
const TournamentPlayer = require("../models/tournament_player.model");
const TournamentRound = require("../models/tournament_round.model");
const RoundMatch = require("../models/round_match.model");
const Booking = require("../models/booking.model");
const TransactionHistory = require("../models/transiction_history.model");
const ClubBank = require("../models/club_bank.model");
const Club = require("../models/club.model");
const Notification = require("../models/notification.model");
const Account = require("../models/account.model");
const payosService = require("../services/payos.service");

const PAYOS_EXPIRE_MINUTES = 10;

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

const computeRoundRobinLeaderboard = async (tournamentId) => {
  const matches = await RoundMatch.find({
    tournament_id: tournamentId,
    match_format: "RoundRobin",
    status: "Finished",
  })
    .select(
      "player1_id player2_id player1_score player2_score winner_id group_key",
    )
    .lean();

  const stats = {};
  const ensureEntry = (id, groupKey) => {
    const key = String(id);
    if (!stats[key]) {
      stats[key] = {
        account_id: id,
        group_key: groupKey || "A",
        matches: 0,
        wins: 0,
        losses: 0,
        frames_for: 0,
        frames_against: 0,
        points: 0,
      };
    }
    return stats[key];
  };

  matches.forEach((m) => {
    const entries = [
      {
        id: m.player1_id,
        scoreFor: m.player1_score,
        scoreAgainst: m.player2_score,
      },
      {
        id: m.player2_id,
        scoreFor: m.player2_score,
        scoreAgainst: m.player1_score,
      },
    ];

    entries.forEach((entry) => {
      if (!entry.id) return;
      const row = ensureEntry(entry.id, m.group_key);
      row.matches += 1;
      row.frames_for += Number(entry.scoreFor || 0);
      row.frames_against += Number(entry.scoreAgainst || 0);
      if (String(m.winner_id || "") === String(entry.id)) {
        row.wins += 1;
        row.points += 3;
      } else {
        row.losses += 1;
      }
    });
  });

  const leaderboard = Object.values(stats).map((row) => ({
    ...row,
    frame_diff: row.frames_for - row.frames_against,
  }));

  const grouped = leaderboard.reduce((acc, row) => {
    acc[row.group_key] = acc[row.group_key] || [];
    acc[row.group_key].push(row);
    return acc;
  }, {});

  Object.keys(grouped).forEach((group) => {
    grouped[group].sort(
      (a, b) =>
        b.points - a.points ||
        b.frame_diff - a.frame_diff ||
        b.frames_for - a.frames_for,
    );
    grouped[group].forEach((row, idx) => {
      row.rank = idx + 1;
    });
  });

  return grouped;
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

  if (tournament.format === "Round Robin") {
    const totalMatches = await RoundMatch.countDocuments({
      tournament_id: tournamentId,
      match_format: "RoundRobin",
    });
    const finishedMatches = await RoundMatch.countDocuments({
      tournament_id: tournamentId,
      match_format: "RoundRobin",
      status: "Finished",
    });

    if (totalMatches > 0 && totalMatches === finishedMatches) {
      const leaderboard = await computeRoundRobinLeaderboard(tournamentId);
      const topGroups = Object.values(leaderboard)
        .map((rows) => rows[0])
        .filter(Boolean);
      if (topGroups.length) {
        topGroups.sort((a, b) => a.rank - b.rank);
        const championId = topGroups[0].account_id;
        await Tournament.findByIdAndUpdate(tournamentId, {
          status: "Completed",
          champion_account_id: championId,
          completed_at: new Date(),
        });
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
          { tournament_id: tournamentId, account_id: championId },
          { $set: { status: "Champion", final_rank: 1 } },
        );
      }
    }
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
    throw new Error("Cần ít nhất 2 người chơi đã duyệt để tạo nhánh đấu");
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
        group_key: null,
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
    throw new Error("Can it nhat 2 nguoi choi da duyet de tao nhanh dau");
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
      group_key: null,
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
        group_key: null,
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
        group_key: null,
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
    group_key: null,
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

const generateRoundRobinBracket = async (tournament, groupSizeInput) => {
  const approvedPlayers = await fetchApprovedPlayers(tournament._id);
  if (approvedPlayers.length < 2) {
    throw new Error("Cần ít nhất 2 người chơi đã duyệt để tạo bảng đấu");
  }

  await clearBracket(tournament._id);

  const groupSize = Number(groupSizeInput) > 1 ? Number(groupSizeInput) : 4;
  const shuffled = shuffleArray(
    approvedPlayers.map((p) => p.account_id?._id || p.account_id),
  );

  const groups = [];
  for (let i = 0; i < shuffled.length; i += groupSize) {
    groups.push(shuffled.slice(i, i + groupSize));
  }
  if (groups.length === 0) groups.push(shuffled);

  const roundDocs = [];
  const matchDocs = [];
  let order = 1;

  groups.forEach((groupPlayers, groupIdx) => {
    const groupKey = String.fromCharCode(65 + groupIdx);
    const roundId = new mongoose.Types.ObjectId();
    roundDocs.push({
      _id: roundId,
      tournament_id: tournament._id,
      round_number: 1,
      round_type: "RoundRobin",
      group_key: groupKey,
      status: "Pending",
      order: order,
    });
    order += 1;

    let matchNo = 1;
    for (let i = 0; i < groupPlayers.length; i += 1) {
      for (let j = i + 1; j < groupPlayers.length; j += 1) {
        const matchId = new mongoose.Types.ObjectId();
        matchDocs.push({
          _id: matchId,
          tournament_id: tournament._id,
          round_id: roundId,
          match_no: matchNo,
          player1_id: groupPlayers[i],
          player2_id: groupPlayers[j],
          match_name: `Bảng ${groupKey} - Trận ${matchNo}`,
          result: "",
          race_to: tournament?.generation_config?.race_to || 7,
          group_key: groupKey,
          bracket_side: null,
          next_match_id: null,
          next_slot: null,
          winner_next_match_id: null,
          winner_next_slot: null,
          loser_next_match_id: null,
          loser_next_slot: null,
          match_format: "RoundRobin",
          status: "Scheduled",
          locked_by_owner: true,
        });
        matchNo += 1;
      }
    }
  });

  await TournamentRound.insertMany(roundDocs);
  if (matchDocs.length) {
    await RoundMatch.insertMany(matchDocs);
  }

  await Tournament.findByIdAndUpdate(tournament._id, {
    bracket_generated: true,
    bracket_generated_at: new Date(),
    status: tournament.status === "Draft" ? "Closed" : tournament.status,
    generation_config: {
      ...(tournament.generation_config || {}),
      format: "RoundRobin",
      group_size: groupSize,
    },
  });

  return { groups: groups.length, matches: matchDocs.length };
};

const updateRoundStatusAndProgression = async (tournamentId, roundId) => {
  const round = await TournamentRound.findById(roundId).lean();
  if (!round) return;
  await syncRoundStatusesForStartedTournament(tournamentId);
};

// Get tournament players list (for OWNER/STAFF and also public viewing)
const getTournamentPlayers = async (req, res) => {
  try {
    const { id } = req.params;

    const tournament = await Tournament.findById(id).select("name").lean();
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    const players = await TournamentPlayer.find({ tournament_id: id })
      .populate("account_id", "fullname phone email avatar_url")
      .sort({ register_date: -1 })
      .lean();

    return res.status(200).json({ success: true, data: players });
  } catch (error) {
    console.error("Error getTournamentPlayers:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Create a new tournament
const createTournament = async (req, res) => {
  try {
    const club_id = req.headers["x-club-id"];
    if (!club_id || !mongoose.Types.ObjectId.isValid(club_id)) {
      return res
        .status(400)
        .json({ success: false, message: "Thiếu hoặc sai định dạng club_id" });
    }

    const club = await Club.findById(club_id).lean();
    if (!club) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy CLB" });
    }

    // Verify ownership
    if (String(club.account_id) !== String(req.user.accountId)) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền tạo giải đấu cho CLB này.",
      });
    }

    if (club.plan_type !== "pro") {
      return res.status(403).json({
        success: false,
        message: "Tính năng Giải đấu chỉ dành cho gói Pro.",
      });
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
      banner,
    } = req.body;

    if (!name || !max_players) {
      return res.status(400).json({
        success: false,
        message: "Tên giải và số lượng người chơi là bắt buộc",
      });
    }

    const normalizedPrizePool = normalizePrizePool(prize_pool, fee);
    if (normalizedPrizePool.error) {
      return res
        .status(400)
        .json({ success: false, message: normalizedPrizePool.error });
    }

    // Date validations
    if (registration_open && registration_deadline) {
      if (new Date(registration_open) >= new Date(registration_deadline)) {
        return res.status(400).json({
          success: false,
          message: "Ngày mở đăng ký phải trước ngày đóng đăng ký",
        });
      }
    }
    if (registration_deadline && play_date) {
      if (new Date(registration_deadline) >= new Date(play_date)) {
        return res.status(400).json({
          success: false,
          message: "Ngày đóng đăng ký phải trước ngày thi đấu",
        });
      }
    }
    if (registration_open && play_date) {
      if (new Date(registration_open) >= new Date(play_date)) {
        return res.status(400).json({
          success: false,
          message: "Ngày mở đăng ký phải trước ngày thi đấu",
        });
      }
    }

    const tournament = new Tournament({
      club_id,
      name,
      description: description || "",
      format: format || "Knockout",
      max_players,
      fee: fee || 0,
      prize_pool: normalizedPrizePool.value,
      registration_open: registration_open ? new Date(registration_open) : null,
      registration_deadline: registration_deadline
        ? new Date(registration_deadline)
        : null,
      play_date: play_date ? new Date(play_date) : null,
      auto_bracket: auto_bracket !== undefined ? auto_bracket : true,
      banner: req.file ? req.file.path : banner || "",
      status: "Draft",
      created_by: req.user?.accountId || null,
      created_at: new Date(),
    });

    await tournament.save();

    if (req.user && req.user.accountId) {
      await Notification.create({
        account_id: req.user.accountId,
        title: "Tạo giải đấu thành công",
        message: `Bạn đã tạo giải đấu ${tournament.name} thành công.`,
        link: `/owner/tournaments/${tournament._id}/detail`,
        is_read: false,
      });
    }

    const staffsToNotify = await Account.find({ club_id: tournament.club_id, status: "ACTIVE" }).select("_id").lean();
    if (staffsToNotify.length > 0) {
      const staffNotifications = staffsToNotify
        .filter(s => String(s._id) !== String(req.user?.accountId))
        .map(staff => ({
          account_id: staff._id,
          title: "Giải đấu mới được tạo",
          message: `Chủ quán vừa tạo giải đấu mới: ${tournament.name} (Ngày đấu: ${play_date ? new Date(play_date).toLocaleDateString('vi-VN') : 'Sắp tới'}).`,
          link: `/staff/tournaments/${tournament._id}/players`,
          is_read: false,
        }));
      if (staffNotifications.length > 0) {
        await Notification.insertMany(staffNotifications);
      }
    }

    return res.status(201).json({
      success: true,
      message: "Tạo giải đấu thành công",
      data: tournament,
    });
  } catch (error) {
    console.error("Error creating tournament:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Get all tournaments for a club
const getTournamentsByClub = async (req, res) => {
  try {
    let club_id = req.headers["x-club-id"] || req.query.club_id;

    // If no explicit club_id, try to get it from the authenticated user's account
    if (!club_id && req.user?.accountId) {
      const Account = require("../models/account.model");
      const account = await Account.findById(req.user.accountId)
        .select("club_id")
        .lean();
      if (account?.club_id) {
        club_id = String(account.club_id);
      }
    }

    if (!club_id || !mongoose.Types.ObjectId.isValid(club_id)) {
      return res
        .status(400)
        .json({ success: false, message: "Thiếu hoặc sai định dạng club_id" });
    }

    const club = await Club.findById(club_id).lean();
    if (!club || club.plan_type !== "pro") {
      return res.status(403).json({
        success: false,
        message: "Tính năng Giải đấu chỉ dành cho gói Pro.",
      });
    }

    const tournaments = await Tournament.find({ club_id })
      .sort({ created_at: -1 })
      .lean();

    return res.status(200).json({ success: true, data: tournaments });
  } catch (error) {
    console.error("Error fetching tournaments:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Get all public tournaments (excluding Draft, only from onboarded clubs)
const getPublicTournaments = async (req, res) => {
  try {
    // Get IDs of all approved + onboarding-completed clubs
    const eligibleClubs = await Club.find({
      status: "Approved",
      onboarding_completed: true,
    })
      .select("_id")
      .lean();

    const eligibleClubIds = eligibleClubs.map((c) => c._id);

    const tournaments = await Tournament.find({
      status: { $in: ["Open", "Closed", "InProgress", "Completed"] },
      club_id: { $in: eligibleClubIds },
    })
      .populate("club_id", "name address")
      .sort({ created_at: -1 })
      .lean();

    return res.status(200).json({ success: true, data: tournaments });
  } catch (error) {
    console.error("Error fetching public tournaments:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Get a single tournament
const getTournamentById = async (req, res) => {
  try {
    const { id } = req.params;
    const tournament = await Tournament.findById(id)
      .populate("club_id", "name address")
      .lean();
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }
    return res.status(200).json({ success: true, data: tournament });
  } catch (error) {
    console.error("Error fetching tournament:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Get approved tournament ids that current user joined
const getMyRegisteredTournamentIds = async (req, res) => {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) {
      return res
        .status(401)
        .json({ success: false, message: "Bạn chưa đăng nhập" });
    }

    const rows = await TournamentPlayer.find({
      account_id: accountId,
      status: "Approved",
    })
      .select("tournament_id")
      .lean();

    const tournamentIds = rows.map((row) => String(row.tournament_id));
    return res.status(200).json({ success: true, data: tournamentIds });
  } catch (error) {
    console.error("Error getMyRegisteredTournamentIds:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Owner/Staff: mở đăng ký
const openTournamentRegistration = async (req, res) => {
  try {
    const { id } = req.params;
    const tournament = await Tournament.findById(id).populate("club_id");
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    // Verify ownership
    if (String(tournament.club_id.account_id) !== String(req.user.accountId)) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền quản lý giải đấu của CLB này.",
      });
    }
    if (["InProgress", "Completed", "Cancelled"].includes(tournament.status)) {
      return res.status(400).json({
        success: false,
        message: "Không thể mở đăng ký cho giải đã bắt đầu hoặc kết thúc",
      });
    }

    tournament.status = "Open";
    if (!tournament.registration_open) {
      tournament.registration_open = new Date();
    }
    await tournament.save();

    return res
      .status(200)
      .json({ success: true, message: "Đã mở đăng ký", data: tournament });
  } catch (error) {
    console.error("Error openTournamentRegistration:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Owner/Staff: chốt đăng ký & (tuỳ chọn) tạo bracket
const closeTournamentRegistration = async (req, res) => {
  try {
    const { id } = req.params;
    const { auto_generate, group_size } = req.body || {};

    const tournament = await Tournament.findById(id).populate("club_id");
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    // Verify ownership
    if (String(tournament.club_id.account_id) !== String(req.user.accountId)) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền quản lý giải đấu của CLB này.",
      });
    }
    if (["InProgress", "Completed", "Cancelled"].includes(tournament.status)) {
      return res.status(400).json({
        success: false,
        message: "Không thể chốt đăng ký cho giải đã bắt đầu hoặc kết thúc",
      });
    }

    const approvedPlayers = await fetchApprovedPlayers(id);
    if (approvedPlayers.length < 2) {
      return res
        .status(400)
        .json({ success: false, message: "Cần ít nhất 2 người chơi đã duyệt" });
    }

    tournament.status = "Closed";
    tournament.registration_deadline =
      tournament.registration_deadline || new Date();
    tournament.registered_player = approvedPlayers.length;
    await tournament.save();

    let bracket = null;
    if (auto_generate || tournament.auto_bracket) {
      bracket =
        tournament.format === "Round Robin"
          ? await generateRoundRobinBracket(tournament, group_size)
          : tournament.format === "Double Elimination"
            ? await generateDoubleEliminationBracket(tournament)
            : await generateKnockoutBracket(tournament);
    }

    return res.status(200).json({
      success: true,
      message: "Đã chốt danh sách đăng ký",
      data: { tournament, bracket },
    });
  } catch (error) {
    console.error("Error closeTournamentRegistration:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Update a tournament
const updateTournament = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const existingTournament = await Tournament.findById(id).lean();
    if (!existingTournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    const club = await require("../models/club.model")
      .findById(existingTournament.club_id)
      .lean();
    if (!club) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy CLB" });
    }

    // Verify ownership
    if (String(club.account_id) !== String(req.user.accountId)) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền chỉnh sửa giải đấu của CLB này.",
      });
    }

    if (club.plan_type !== "pro") {
      return res.status(403).json({
        success: false,
        message: "Tính năng Giải đấu chỉ dành cho gói Pro.",
      });
    }

    if (existingTournament.registered_player > 0) {
      return res.status(400).json({
        success: false,
        message: "Không thể chỉnh sửa giải đấu đã có người tham gia.",
      });
    }

    // Convert date strings to Date objects if present
    const dateFields = [
      "registration_open",
      "registration_deadline",
      "play_date",
      "start_time",
      "end_time",
    ];
    dateFields.forEach((field) => {
      if (updates[field]) updates[field] = new Date(updates[field]);
    });

    // Date validations
    const regOpen =
      updates.registration_open ||
      (existingTournament.registration_open
        ? new Date(existingTournament.registration_open)
        : null);
    const regDeadline =
      updates.registration_deadline ||
      (existingTournament.registration_deadline
        ? new Date(existingTournament.registration_deadline)
        : null);
    const playDate =
      updates.play_date ||
      (existingTournament.play_date
        ? new Date(existingTournament.play_date)
        : null);

    if (regOpen && regDeadline && regOpen >= regDeadline) {
      return res.status(400).json({
        success: false,
        message: "Ngày mở đăng ký phải trước ngày đóng đăng ký",
      });
    }
    if (regDeadline && playDate && regDeadline >= playDate) {
      return res.status(400).json({
        success: false,
        message: "Ngày đóng đăng ký phải trước ngày thi đấu",
      });
    }
    if (regOpen && playDate && regOpen >= playDate) {
      return res.status(400).json({
        success: false,
        message: "Ngày mở đăng ký phải trước ngày thi đấu",
      });
    }

    const feeValue =
      updates.fee !== undefined ? updates.fee : existingTournament.fee;
    const prizeValue =
      updates.prize_pool !== undefined
        ? updates.prize_pool
        : existingTournament.prize_pool;
    const normalizedPrizePool = normalizePrizePool(prizeValue, feeValue);
    if (normalizedPrizePool.error) {
      return res
        .status(400)
        .json({ success: false, message: normalizedPrizePool.error });
    }
    updates.prize_pool = normalizedPrizePool.value;

    // If a new banner was uploaded, override
    if (req.file) {
      updates.banner = req.file.path;
    }

    const tournament = await Tournament.findByIdAndUpdate(id, updates, {
      new: true,
    });
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    return res.status(200).json({
      success: true,
      message: "Cập nhật giải đấu thành công",
      data: tournament,
    });
  } catch (error) {
    console.error("Error updating tournament:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Delete a tournament
const deleteTournament = async (req, res) => {
  try {
    const { id } = req.params;

    const tournamentCheck = await Tournament.findById(id).populate("club_id");
    if (!tournamentCheck) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    // Verify ownership
    if (
      String(tournamentCheck.club_id.account_id) !== String(req.user.accountId)
    ) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền xóa giải đấu của CLB này.",
      });
    }

    const club = tournamentCheck.club_id;
    if (!club || club.plan_type !== "pro") {
      return res.status(403).json({
        success: false,
        message: "Tính năng Giải đấu chỉ dành cho gói Pro.",
      });
    }

    const tournament = await Tournament.findByIdAndDelete(id);
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }
    return res
      .status(200)
      .json({ success: true, message: "Xóa giải đấu thành công" });
  } catch (error) {
    console.error("Error deleting tournament:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Owner/Staff: tạo bracket/bảng đấu thủ công
const generateTournamentBracket = async (req, res) => {
  try {
    const { id } = req.params;
    const { format, group_size } = req.body || {};

    const tournament = await Tournament.findById(id).populate("club_id");
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    // Verify ownership
    if (String(tournament.club_id.account_id) !== String(req.user.accountId)) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền quản lý giải đấu của CLB này.",
      });
    }
    if (["InProgress", "Completed", "Cancelled"].includes(tournament.status)) {
      return res.status(400).json({
        success: false,
        message: "Không thể tạo nhánh cho giải đã bắt đầu hoặc kết thúc",
      });
    }

    const approvedPlayers = await fetchApprovedPlayers(id);
    if (approvedPlayers.length < 2) {
      return res
        .status(400)
        .json({ success: false, message: "Cần ít nhất 2 người chơi đã duyệt" });
    }

    const targetFormat = format || tournament.format;
    let bracket = null;
    if (targetFormat === "Round Robin") {
      bracket = await generateRoundRobinBracket(tournament, group_size);
      tournament.format = "Round Robin";
    } else if (targetFormat === "Double Elimination") {
      bracket = await generateDoubleEliminationBracket(tournament);
      tournament.format = "Double Elimination";
    } else {
      bracket = await generateKnockoutBracket(tournament);
      tournament.format = "Knockout";
    }

    await tournament.save();
    const freshTournament = await Tournament.findById(id).lean();

    return res.status(200).json({
      success: true,
      message: "Đã tạo nhánh/bảng đấu",
      data: { tournament: freshTournament, bracket },
    });
  } catch (error) {
    console.error("Error generateTournamentBracket:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Owner/Staff: bắt đầu giải đấu
const startTournament = async (req, res) => {
  try {
    const { id } = req.params;
    const tournament = await Tournament.findById(id).populate("club_id");
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    // Verify ownership
    if (String(tournament.club_id.account_id) !== String(req.user.accountId)) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền quản lý giải đấu của CLB này.",
      });
    }
    if (!tournament.bracket_generated) {
      return res
        .status(400)
        .json({ success: false, message: "Chưa tạo nhánh/bảng đấu" });
    }
    if (tournament.status === "InProgress") {
      return res.status(200).json({
        success: true,
        message: "Giải đấu đã ở trạng thái đang diễn ra",
        data: tournament,
      });
    }

    tournament.status = "InProgress";
    tournament.started_at = new Date();
    await tournament.save();

    if (tournament.format === "Knockout") {
      await TournamentRound.updateMany(
        { tournament_id: id, round_number: 1 },
        { status: "InProgress" },
      );
    } else if (tournament.format === "Double Elimination") {
      await TournamentRound.updateMany(
        { tournament_id: id, bracket_side: "Winners", round_number: 1 },
        { status: "InProgress" },
      );
    } else {
      await TournamentRound.updateMany(
        { tournament_id: id },
        { status: "InProgress" },
      );
    }
    await syncRoundStatusesForStartedTournament(id);

    return res.status(200).json({
      success: true,
      message: "Đã bắt đầu giải đấu",
      data: tournament,
    });
  } catch (error) {
    console.error("Error startTournament:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Public/Owner/Staff: lấy bracket + danh sách trận
const getTournamentBracket = async (req, res) => {
  try {
    const { id } = req.params;
    const tournament = await Tournament.findById(id).lean();
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    if (tournament.format === "Double Elimination") {
      await resolvePendingAutoAdvances(id);
      await syncRoundStatusesForStartedTournament(id);
      await checkAndCompleteTournament(id);
    }

    const rounds = await TournamentRound.find({ tournament_id: id })
      .sort({ order: 1, round_number: 1 })
      .lean();
    const matches = await RoundMatch.find({ tournament_id: id })
      .sort({ match_no: 1, _id: 1 })
      .populate("player1_id", "fullname avatar_url")
      .populate("player2_id", "fullname avatar_url")
      .populate("winner_id", "fullname avatar_url")
      .lean();

    const grouped = rounds.map((round) => {
      const roundMatches = matches.filter(
        (m) => String(m.round_id) === String(round._id),
      );
      let display_name = `Round ${round.round_number}`;
      if (round.bracket_side === "Winners") {
        display_name = `Nhánh thắng - Vòng ${round.round_number}`;
      } else if (round.bracket_side === "Losers") {
        display_name = `Nhánh thua - Vòng ${round.round_number}`;
      } else if (round.bracket_side === "GrandFinal") {
        display_name = "Chung kết";
      } else if (round.round_type === "RoundRobin") {
        display_name = round.group_key
          ? `Bảng ${round.group_key}`
          : "Vòng tròn";
      } else if (round.round_type === "Knockout") {
        display_name = `Vòng ${round.round_number}`;
      }

      return {
        ...round,
        display_name,
        matches: roundMatches,
      };
    });

    return res.status(200).json({ success: true, data: grouped });
  } catch (error) {
    console.error("Error getTournamentBracket:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Staff: danh sách trận để vận hành (lọc theo status)
const getTournamentMatches = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, round_number } = req.query;

    const tournament = await Tournament.findById(id).select("format").lean();
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "KhÃ´ng tÃ¬m tháº¥y giáº£i Ä‘áº¥u" });
    }

    if (tournament.format === "Double Elimination") {
      await resolvePendingAutoAdvances(id);
      await syncRoundStatusesForStartedTournament(id);
      await checkAndCompleteTournament(id);
    }

    const query = { tournament_id: id };
    if (status) {
      const statuses = String(status)
        .split(",")
        .map((s) => s.trim());
      query.status = { $in: statuses };
    }

    if (round_number) {
      const rounds = await TournamentRound.find({
        tournament_id: id,
        round_number: Number(round_number),
      }).select("_id");
      query.round_id = { $in: rounds.map((r) => r._id) };
    }

    const matches = await RoundMatch.find(query)
      .sort({ match_no: 1, _id: 1 })
      .populate("player1_id", "fullname phone avatar_url")
      .populate("player2_id", "fullname phone avatar_url")
      .populate("winner_id", "fullname avatar_url")
      .lean();

    return res.status(200).json({ success: true, data: matches });
  } catch (error) {
    console.error("Error getTournamentMatches:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Staff: gán bàn & bắt đầu trận
const startRoundMatch = async (req, res) => {
  try {
    const { id, matchId } = req.params;
    const { table_id, scheduled_at, race_to } = req.body || {};

    const tournament = await Tournament.findById(id)
      .select("status format")
      .lean();
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }
    if (tournament.status !== "InProgress") {
      return res.status(400).json({
        success: false,
        message: "Giải đấu chưa ở trạng thái đang diễn ra",
      });
    }

    const match = await RoundMatch.findOne({ _id: matchId, tournament_id: id });
    if (!match) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy trận đấu" });
    }
    if (!match.player1_id || !match.player2_id) {
      return res
        .status(400)
        .json({ success: false, message: "Chưa đủ người chơi cho trận đấu" });
    }
    if (match.status === "Finished") {
      return res
        .status(400)
        .json({ success: false, message: "Trận đấu đã kết thúc" });
    }

    match.table_id = table_id || match.table_id;
    if (race_to) match.race_to = Number(race_to);
    match.scheduled_at = scheduled_at
      ? new Date(scheduled_at)
      : match.scheduled_at || new Date();
    match.started_at = new Date();
    match.status = "Playing";
    await match.save();

    await TournamentRound.findByIdAndUpdate(match.round_id, {
      status: "InProgress",
    });

    if (match.table_id) {
      const activeBooking = await Booking.findOne({
        table_id: match.table_id,
        status: { $in: ["Playing"] },
      });
      if (activeBooking) {
        return res.status(400).json({
          success: false,
          message: "Bàn này đang có khách chơi. Vui lòng chọn bàn khác!",
        });
      }

      const todayStr = new Date().toLocaleString("en-US", {
        timeZone: "Asia/Ho_Chi_Minh",
      });
      const localToday = new Date(todayStr);
      localToday.setHours(0, 0, 0, 0);

      await Booking.create({
        guest_name: `Trận giải đấu: ${match.match_name}`,
        table_id: match.table_id,
        play_date: localToday,
        start_time: new Date().toTimeString().slice(0, 5),
        end_time: "23:59",
        code_number: `TOUR_${match._id.toString().slice(-6)}_${Date.now().toString().slice(-4)}`,
        deposit: 0,
        hour_price: 0,
        status: "Playing",
        note: `TournamentMatch:${match._id}`,
      });
    }

    return res
      .status(200)
      .json({ success: true, message: "Đã bắt đầu trận đấu", data: match });
  } catch (error) {
    console.error("Error startRoundMatch:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Staff: cập nhật kết quả & tự động phân nhánh
const updateMatchResult = async (req, res) => {
  try {
    const { id, matchId } = req.params;
    const { player1_score, player2_score, winner_id, race_to } = req.body || {};

    const tournament = await Tournament.findById(id).select("status").lean();
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }
    if (tournament.status !== "InProgress") {
      return res
        .status(400)
        .json({ success: false, message: "Giải đấu chưa bắt đầu" });
    }

    const p1Score = Number(player1_score);
    const p2Score = Number(player2_score);
    if (Number.isNaN(p1Score) || Number.isNaN(p2Score)) {
      return res
        .status(400)
        .json({ success: false, message: "Điểm số không hợp lệ" });
    }

    const match = await RoundMatch.findOne({ _id: matchId, tournament_id: id });
    if (!match) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy trận đấu" });
    }

    // Kiểm tra Race To (Nếu có nhập race_to mới hoặc dùng race_to của trận đấu)
    const currentRaceTo = race_to ? Number(race_to) : match.race_to;
    if (currentRaceTo > 0) {
      if (p1Score > currentRaceTo || p2Score > currentRaceTo) {
        return res.status(400).json({
          success: false,
          message: `Điểm số không được vượt quá số điểm chạm (${currentRaceTo})`,
        });
      }
    }
    if (!match.player1_id || !match.player2_id) {
      return res
        .status(400)
        .json({ success: false, message: "Chưa đủ người chơi cho trận đấu" });
    }
    if (match.status === "Finished") {
      return res
        .status(400)
        .json({ success: false, message: "Trận đấu đã được chấm điểm" });
    }

    const declaredWinner =
      winner_id || (p1Score > p2Score ? match.player1_id : match.player2_id);
    if (!declaredWinner) {
      return res
        .status(400)
        .json({ success: false, message: "Cần chọn người thắng" });
    }
    const declaredWinnerStr = String(declaredWinner);
    if (
      ![match.player1_id?.toString(), match.player2_id?.toString()].includes(
        declaredWinnerStr,
      )
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Người thắng không khớp người chơi" });
    }
    if (p1Score === p2Score) {
      return res
        .status(400)
        .json({ success: false, message: "Không hỗ trợ kết quả hòa" });
    }

    const loserId =
      declaredWinnerStr === String(match.player1_id)
        ? match.player2_id
        : match.player1_id;

    match.player1_score = p1Score;
    match.player2_score = p2Score;
    if (race_to) match.race_to = Number(race_to);
    match.winner_id = declaredWinner;
    match.loser_id = loserId;
    match.result = `${p1Score} - ${p2Score}`;
    match.finished_at = new Date();
    match.status = "Finished";
    await match.save();

    if (match.table_id) {
      await Booking.updateMany(
        { note: `TournamentMatch:${match._id}`, status: "Playing" },
        {
          status: "Completed",
          end_time: new Date().toTimeString().slice(0, 5),
        },
      );
    }

    const round = await TournamentRound.findById(match.round_id).lean();

    if (match.match_format === "Knockout") {
      if (loserId) {
        await TournamentPlayer.findOneAndUpdate(
          { tournament_id: id, account_id: loserId },
          {
            $set: {
              status: "Eliminated",
              elimination_round: round?.round_number || null,
            },
          },
        );
      }
      await propagateMatchOutcomes(match);
    }

    if (match.match_format === "RoundRobin") {
      // No elimination; leaderboard sẽ tính theo điểm
    }

    if (match.match_format === "DoubleElimination") {
      if (loserId && match.bracket_side === "Losers") {
        await TournamentPlayer.findOneAndUpdate(
          { tournament_id: id, account_id: loserId },
          {
            $set: {
              status: "Eliminated",
              elimination_round: round?.round_number || null,
            },
          },
        );
      }
      await propagateMatchOutcomes(match);
      await resolvePendingAutoAdvances(id);
    }

    await updateRoundStatusAndProgression(id, match.round_id);
    await checkAndCompleteTournament(id);

    return res
      .status(200)
      .json({ success: true, message: "Đã cập nhật kết quả", data: match });
  } catch (error) {
    console.error("Error updateMatchResult:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Public/Owner: bảng xếp hạng Round Robin
const getRoundRobinLeaderboard = async (req, res) => {
  try {
    const { id } = req.params;
    const tournament = await Tournament.findById(id).lean();
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }
    if (tournament.format !== "Round Robin") {
      return res.status(400).json({
        success: false,
        message: "Giải đấu không ở thể thức vòng tròn",
      });
    }

    const leaderboard = await computeRoundRobinLeaderboard(id);
    return res.status(200).json({ success: true, data: leaderboard });
  } catch (error) {
    console.error("Error getRoundRobinLeaderboard:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Create PayOS payment link for tournament registration
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
        message: "CLB chưa cấu hình PayOS (Client ID / API Key / Checksum Key)",
      });
    }

    const orderCode = Date.now();
    const expiredAt = Math.floor(
      (Date.now() + PAYOS_EXPIRE_MINUTES * 60 * 1000) / 1000,
    );
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
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Verify tournament payment (frontend return flow)
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
        .json({ success: false, message: "CLB chưa cấu hình PayOS" });
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
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Tournament PayOS webhook
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
        .json({ success: false, message: "CLB thiếu cấu hình PayOS" });
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

const getMyTournaments = async (req, res) => {
  try {
    const accountId = req.user?.accountId;
    if (!accountId)
      return res
        .status(401)
        .json({ success: false, message: "Chưa đăng nhập" });

    // Find all tournament registrations by this user
    const playerEntries = await TournamentPlayer.find({ account_id: accountId })
      .populate({
        path: "tournament_id",
        populate: { path: "club_id", select: "name address" },
      })
      .sort({ register_date: -1 });

    const data = playerEntries
      .filter((entry) => entry.tournament_id) // exclude orphaned entries
      .map((entry) => ({
        tournament: entry.tournament_id,
        playerEntry: {
          _id: entry._id,
          status: entry.status,
          fee_amount: entry.fee_amount,
          register_date: entry.register_date,
          elimination_round: entry.elimination_round || null,
        },
      }));

    return res.json({ success: true, data });
  } catch (error) {
    console.error("Error getMyTournaments:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Cancel a tournament
const cancelTournament = async (req, res) => {
  try {
    const { id } = req.params;

    const tournament = await Tournament.findById(id).populate("club_id");
    if (!tournament) {
      console.log(`[CANCEL TOURNAMENT] NOT FOUND: ${id}`);
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    // Verify ownership
    console.log(
      `[CANCEL TOURNAMENT] Auth UserAccountId: ${req.user?.accountId}`,
    );
    console.log(
      `[CANCEL TOURNAMENT] Tournament ClubOwnerId: ${tournament.club_id?.account_id}`,
    );

    if (String(tournament.club_id.account_id) !== String(req.user.accountId)) {
      console.log(`[CANCEL TOURNAMENT] OWNERSHIP MISMATCH!`);
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền quản lý giải đấu của CLB này.",
      });
    }

    if (
      tournament.status === "Completed" ||
      tournament.status === "Cancelled"
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Giải đấu đã kết thúc hoặc đã hủy" });
    }

    tournament.status = "Cancelled";
    await tournament.save();

    // Update all players in this tournament to Cancelled
    await TournamentPlayer.updateMany(
      { tournament_id: id },
      { status: "Cancelled" },
    );

    return res.status(200).json({
      success: true,
      message:
        "Đã hủy giải đấu thành công. Vui lòng liên hệ người chơi để hoàn lệ phí thủ công.",
      data: tournament,
    });
  } catch (error) {
    console.error("Error cancelTournament:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};

module.exports = {
  createTournament,
  getTournamentsByClub,
  getPublicTournaments,
  getTournamentById,
  getMyRegisteredTournamentIds,
  getMyTournaments,
  getTournamentPlayers,
  openTournamentRegistration,
  closeTournamentRegistration,
  generateTournamentBracket,
  startTournament,
  getTournamentBracket,
  getTournamentMatches,
  startRoundMatch,
  updateMatchResult,
  getRoundRobinLeaderboard,
  updateTournament,
  deleteTournament,
  createTournamentPayOSPayment,
  verifyTournamentPayOSPayment,
  tournamentPayOSWebhook,
  cancelTournament,
};
