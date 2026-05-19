const Tournament = require("../../../models/tournament.model");
const TournamentPlayer = require("../../../models/tournament_player.model");
const TournamentRound = require("../../../models/tournament_round.model");
const RoundMatch = require("../../../models/round_match.model");

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

const updateRoundStatusAndProgression = async (tournamentId, roundId) => {
  const round = await TournamentRound.findById(roundId).lean();
  if (!round) return;
  await syncRoundStatusesForStartedTournament(tournamentId);
};

module.exports = {
  syncRoundStatusesForStartedTournament,
  updateRoundStatusAndProgression,
  resolvePendingAutoAdvances,
  propagateMatchOutcomes,
  checkAndCompleteTournament,
};
