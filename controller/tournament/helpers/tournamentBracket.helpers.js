const mongoose = require("mongoose");
const Tournament = require("../../../models/tournament.model");
const TournamentRound = require("../../../models/tournament_round.model");
const RoundMatch = require("../../../models/round_match.model");
const { fetchApprovedPlayers } = require("./tournamentPlayer.helpers");
const {
  propagateMatchOutcomes,
  resolvePendingAutoAdvances,
} = require("./tournamentProgression.helpers");

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

const generateKnockoutBracket = async (tournament) => {
  const approvedPlayers = await fetchApprovedPlayers(tournament._id);
  if (approvedPlayers.length < 2) {
    throw new Error("Cáº§n Ã­t nháº¥t 2 ngÆ°á»i chÆ¡i Ä‘á»ƒ táº¡o nhÃ¡nh Ä‘áº¥u");
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
        ? "Chung káº¿t"
        : isSemi
          ? `BÃ¡n káº¿t ${m + 1}`
          : `VÃ²ng ${r + 1} - Tráº­n ${m + 1}`;

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
    throw new Error("Cáº§n Ã­t nháº¥t 2 ngÆ°á»i chÆ¡i Ä‘á»ƒ táº¡o nhÃ¡nh Ä‘áº¥u");
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

module.exports = {
  generateKnockoutBracket,
  generateDoubleEliminationBracket,
};
