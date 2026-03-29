const mongoose = require("mongoose");
const Tournament = require("../models/tournament.model");
const TournamentPlayer = require("../models/tournament_player.model");
const TournamentRound = require("../models/tournament_round.model");
const RoundMatch = require("../models/round_match.model");
const Booking = require("../models/booking.model");
const TransactionHistory = require("../models/transiction_history.model");
const ClubBank = require("../models/club_bank.model");
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
  await TournamentPlayer.findOneAndUpdate(
    { tournament_id: tournamentId, account_id: accountId },
    {
      $set: {
        register_date: new Date(),
        fee_amount: feeAmount,
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

const fetchApprovedPlayers = async (tournamentId) => {
  return TournamentPlayer.find({ tournament_id: tournamentId, status: "Approved" })
    .populate("account_id", "fullname phone avatar_url")
    .lean();
};

const clearBracket = async (tournamentId) => {
  await Promise.all([
    RoundMatch.deleteMany({ tournament_id: tournamentId }),
    TournamentRound.deleteMany({ tournament_id: tournamentId })
  ]);
};

const propagateWinnerToNext = async (matchDoc, session = null) => {
  if (!matchDoc || !matchDoc.next_match_id || !matchDoc.winner_id) return;

  const nextSlot = matchDoc.next_slot;
  const update = nextSlot === 1 ? { player1_id: matchDoc.winner_id } : { player2_id: matchDoc.winner_id };

  const nextMatch = await RoundMatch.findByIdAndUpdate(
    matchDoc.next_match_id,
    { $set: update },
    { new: true, session }
  );

  if (!nextMatch) return;

  if (nextMatch.player1_id && nextMatch.player2_id && nextMatch.status === "Scheduled") {
    nextMatch.status = "Ready";
    await nextMatch.save();
  }
};

const computeRoundRobinLeaderboard = async (tournamentId) => {
  const matches = await RoundMatch.find({
    tournament_id: tournamentId,
    match_format: "RoundRobin",
    status: "Finished"
  })
    .select("player1_id player2_id player1_score player2_score winner_id group_key")
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
        points: 0
      };
    }
    return stats[key];
  };

  matches.forEach((m) => {
    const entries = [
      { id: m.player1_id, scoreFor: m.player1_score, scoreAgainst: m.player2_score },
      { id: m.player2_id, scoreFor: m.player2_score, scoreAgainst: m.player1_score }
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
    frame_diff: row.frames_for - row.frames_against
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
        b.frames_for - a.frames_for
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

  if (tournament.status === "Completed" || tournament.status === "Cancelled") return;

  if (tournament.format === "Knockout") {
    const finalMatch = await RoundMatch.findOne({
      tournament_id: tournamentId,
      match_format: "Knockout",
      next_match_id: null
    }).lean();

    if (finalMatch && finalMatch.status === "Finished" && finalMatch.winner_id) {
      await TournamentPlayer.updateMany(
        { tournament_id: tournamentId },
        { $set: { status: "Eliminated", final_rank: null, elimination_round: null } }
      );

      await TournamentPlayer.findOneAndUpdate(
        { tournament_id: tournamentId, account_id: finalMatch.winner_id },
        { $set: { status: "Champion", final_rank: 1, elimination_round: null } }
      );

      if (finalMatch.loser_id) {
        await TournamentPlayer.findOneAndUpdate(
          { tournament_id: tournamentId, account_id: finalMatch.loser_id },
          { $set: { final_rank: 2 } }
        );
      }

      await Tournament.findByIdAndUpdate(tournamentId, {
        status: "Completed",
        champion_account_id: finalMatch.winner_id,
        completed_at: new Date()
      });
    }
    return;
  }

  if (tournament.format === "Round Robin") {
    const totalMatches = await RoundMatch.countDocuments({
      tournament_id: tournamentId,
      match_format: "RoundRobin"
    });
    const finishedMatches = await RoundMatch.countDocuments({
      tournament_id: tournamentId,
      match_format: "RoundRobin",
      status: "Finished"
    });

    if (totalMatches > 0 && totalMatches === finishedMatches) {
      const leaderboard = await computeRoundRobinLeaderboard(tournamentId);
      const topGroups = Object.values(leaderboard).map((rows) => rows[0]).filter(Boolean);
      if (topGroups.length) {
        topGroups.sort((a, b) => a.rank - b.rank);
        const championId = topGroups[0].account_id;
        await Tournament.findByIdAndUpdate(tournamentId, {
          status: "Completed",
          champion_account_id: championId,
          completed_at: new Date()
        });
        await TournamentPlayer.updateMany(
          { tournament_id: tournamentId },
          { $set: { status: "Eliminated", final_rank: null, elimination_round: null } }
        );
        await TournamentPlayer.findOneAndUpdate(
          { tournament_id: tournamentId, account_id: championId },
          { $set: { status: "Champion", final_rank: 1 } }
        );
      }
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
    approvedPlayers.map((p) => p.account_id?._id || p.account_id)
  );
  const bracketSize = nextPowerOfTwo(playerIds.length);
  while (playerIds.length < bracketSize) {
    playerIds.push(null);
  }

  const roundCount = Math.log2(bracketSize);
  const roundDocs = [];
  for (let i = 1; i <= roundCount; i += 1) {
    roundDocs.push({
      _id: new mongoose.Types.ObjectId(),
      tournament_id: tournament._id,
      round_number: i,
      round_type: "Knockout",
      status: "Pending",
      order: i
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
      const p1 = r === 0 ? playerIds[m * 2] : null;
      const p2 = r === 0 ? playerIds[m * 2 + 1] : null;
      const nextMatchId = r === roundCount - 1 ? null : matchIdMatrix[r + 1][Math.floor(m / 2)];
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
        next_match_id: nextMatchId,
        next_slot: nextSlot,
        match_format: "Knockout",
        status,
        finished_at,
        locked_by_owner: true
      });
    }
  }

  await TournamentRound.insertMany(roundDocs);
  if (matchDocs.length) {
    await RoundMatch.insertMany(matchDocs);
  }

  const byeIds = matchDocs.filter((m) => m.status === "Finished" && m.result === "BYE").map((m) => m._id);
  if (byeIds.length) {
    const byeMatches = await RoundMatch.find({ _id: { $in: byeIds } });
    for (const bye of byeMatches) {
      await propagateWinnerToNext(bye);
    }
  }

  await Tournament.findByIdAndUpdate(tournament._id, {
    bracket_generated: true,
    bracket_generated_at: new Date(),
    status: tournament.status === "Draft" ? "Closed" : tournament.status,
    generation_config: {
      ...(tournament.generation_config || {}),
      format: "Knockout"
    }
  });

  return { roundCount, bracketSize };
};

const generateRoundRobinBracket = async (tournament, groupSizeInput) => {
  const approvedPlayers = await fetchApprovedPlayers(tournament._id);
  if (approvedPlayers.length < 2) {
    throw new Error("Cần ít nhất 2 người chơi đã duyệt để tạo bảng đấu");
  }

  await clearBracket(tournament._id);

  const groupSize = Number(groupSizeInput) > 1 ? Number(groupSizeInput) : 4;
  const shuffled = shuffleArray(approvedPlayers.map((p) => p.account_id?._id || p.account_id));

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
      order: order
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
          next_match_id: null,
          next_slot: null,
          match_format: "RoundRobin",
          status: "Scheduled",
          locked_by_owner: true
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
      group_size: groupSize
    }
  });

  return { groups: groups.length, matches: matchDocs.length };
};

const updateRoundStatusAndProgression = async (tournamentId, roundId) => {
  const round = await TournamentRound.findById(roundId).lean();
  if (!round) return;

  const unfinished = await RoundMatch.countDocuments({
    tournament_id: tournamentId,
    round_id: roundId,
    status: { $ne: "Finished" }
  });

  if (unfinished === 0) {
    await TournamentRound.findByIdAndUpdate(roundId, { status: "Completed" });

    if (round.round_type === "Knockout") {
      const nextRound = await TournamentRound.findOne({
        tournament_id: tournamentId,
        round_number: round.round_number + 1
      }).sort({ order: 1 }).lean();

      if (nextRound) {
        await TournamentRound.findByIdAndUpdate(nextRound._id, { status: "InProgress" });
        const nextMatches = await RoundMatch.find({ round_id: nextRound._id });
        for (const m of nextMatches) {
          if (m.player1_id && m.player2_id && m.status === "Scheduled") {
            m.status = "Ready";
            await m.save();
          }
        }
      }
    }
  } else if (round.status === "Pending") {
    await TournamentRound.findByIdAndUpdate(roundId, { status: "InProgress" });
  }
};

// Get tournament players list (for OWNER/STAFF and also public viewing)
const getTournamentPlayers = async (req, res) => {
  try {
    const { id } = req.params;

    const tournament = await Tournament.findById(id).select("name").lean();
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    const players = await TournamentPlayer.find({ tournament_id: id })
      .populate("account_id", "fullname phone avatar_url")
      .sort({ register_date: -1 })
      .lean();

    return res.status(200).json({ success: true, data: players });
  } catch (error) {
    console.error("Error getTournamentPlayers:", error);
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
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
    let club_id = req.headers["x-club-id"] || req.query.club_id;

    // If no explicit club_id, try to get it from the authenticated user's account
    if (!club_id && req.user?.accountId) {
      const Account = require("../models/account.model");
      const account = await Account.findById(req.user.accountId).select("club_id").lean();
      if (account?.club_id) {
        club_id = String(account.club_id);
      }
    }

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

// Get approved tournament ids that current user joined
const getMyRegisteredTournamentIds = async (req, res) => {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) {
      return res.status(401).json({ success: false, message: "Bạn chưa đăng nhập" });
    }

    const rows = await TournamentPlayer.find({
      account_id: accountId,
      status: "Approved"
    })
      .select("tournament_id")
      .lean();

    const tournamentIds = rows.map((row) => String(row.tournament_id));
    return res.status(200).json({ success: true, data: tournamentIds });
  } catch (error) {
    console.error("Error getMyRegisteredTournamentIds:", error);
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Owner/Staff: mở đăng ký
const openTournamentRegistration = async (req, res) => {
  try {
    const { id } = req.params;
    const tournament = await Tournament.findById(id);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Không tìm thấy giải đấu" });
    }
    if (["InProgress", "Completed", "Cancelled"].includes(tournament.status)) {
      return res.status(400).json({ success: false, message: "Không thể mở đăng ký cho giải đã bắt đầu hoặc kết thúc" });
    }

    tournament.status = "Open";
    if (!tournament.registration_open) {
      tournament.registration_open = new Date();
    }
    await tournament.save();

    return res.status(200).json({ success: true, message: "Đã mở đăng ký", data: tournament });
  } catch (error) {
    console.error("Error openTournamentRegistration:", error);
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Owner/Staff: chốt đăng ký & (tuỳ chọn) tạo bracket
const closeTournamentRegistration = async (req, res) => {
  try {
    const { id } = req.params;
    const { auto_generate, group_size } = req.body || {};

    const tournament = await Tournament.findById(id);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Không tìm thấy giải đấu" });
    }
    if (["InProgress", "Completed", "Cancelled"].includes(tournament.status)) {
      return res.status(400).json({ success: false, message: "Không thể chốt đăng ký cho giải đã bắt đầu hoặc kết thúc" });
    }

    const approvedPlayers = await fetchApprovedPlayers(id);
    if (approvedPlayers.length < 2) {
      return res.status(400).json({ success: false, message: "Cần ít nhất 2 người chơi đã duyệt" });
    }

    tournament.status = "Closed";
    tournament.registration_deadline = tournament.registration_deadline || new Date();
    tournament.registered_player = approvedPlayers.length;
    await tournament.save();

    let bracket = null;
    if (auto_generate || tournament.auto_bracket) {
      bracket = tournament.format === "Round Robin"
        ? await generateRoundRobinBracket(tournament, group_size)
        : await generateKnockoutBracket(tournament);
    }

    return res.status(200).json({
      success: true,
      message: "Đã chốt danh sách đăng ký",
      data: { tournament, bracket }
    });
  } catch (error) {
    console.error("Error closeTournamentRegistration:", error);
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

// Owner/Staff: tạo bracket/bảng đấu thủ công
const generateTournamentBracket = async (req, res) => {
  try {
    const { id } = req.params;
    const { format, group_size } = req.body || {};

    const tournament = await Tournament.findById(id);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Không tìm thấy giải đấu" });
    }
    if (["InProgress", "Completed", "Cancelled"].includes(tournament.status)) {
      return res.status(400).json({ success: false, message: "Không thể tạo nhánh cho giải đã bắt đầu hoặc kết thúc" });
    }

    const approvedPlayers = await fetchApprovedPlayers(id);
    if (approvedPlayers.length < 2) {
      return res.status(400).json({ success: false, message: "Cần ít nhất 2 người chơi đã duyệt" });
    }

    const targetFormat = format || tournament.format;
    let bracket = null;
    if (targetFormat === "Round Robin") {
      bracket = await generateRoundRobinBracket(tournament, group_size);
      tournament.format = "Round Robin";
    } else {
      bracket = await generateKnockoutBracket(tournament);
      tournament.format = "Knockout";
    }

    await tournament.save();
    const freshTournament = await Tournament.findById(id).lean();

    return res.status(200).json({
      success: true,
      message: "Đã tạo nhánh/bảng đấu",
      data: { tournament: freshTournament, bracket }
    });
  } catch (error) {
    console.error("Error generateTournamentBracket:", error);
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Owner/Staff: bắt đầu giải đấu
const startTournament = async (req, res) => {
  try {
    const { id } = req.params;
    const tournament = await Tournament.findById(id);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Không tìm thấy giải đấu" });
    }
    if (!tournament.bracket_generated) {
      return res.status(400).json({ success: false, message: "Chưa tạo nhánh/bảng đấu" });
    }
    if (tournament.status === "InProgress") {
      return res.status(200).json({ success: true, message: "Giải đấu đã ở trạng thái đang diễn ra", data: tournament });
    }

    tournament.status = "InProgress";
    tournament.started_at = new Date();
    await tournament.save();

    const roundFilter = tournament.format === "Knockout" ? { round_number: 1 } : {};
    await TournamentRound.updateMany(
      { tournament_id: id, ...roundFilter },
      { status: "InProgress" }
    );

    return res.status(200).json({ success: true, message: "Đã bắt đầu giải đấu", data: tournament });
  } catch (error) {
    console.error("Error startTournament:", error);
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Public/Owner/Staff: lấy bracket + danh sách trận
const getTournamentBracket = async (req, res) => {
  try {
    const { id } = req.params;
    const tournament = await Tournament.findById(id).lean();
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    const rounds = await TournamentRound.find({ tournament_id: id }).sort({ round_number: 1, order: 1 }).lean();
    const matches = await RoundMatch.find({ tournament_id: id })
      .sort({ match_no: 1, _id: 1 })
      .populate("player1_id", "fullname avatar_url")
      .populate("player2_id", "fullname avatar_url")
      .populate("winner_id", "fullname avatar_url")
      .lean();

    const grouped = rounds.map((round) => ({
      ...round,
      matches: matches.filter((m) => String(m.round_id) === String(round._id))
    }));

    return res.status(200).json({ success: true, data: grouped });
  } catch (error) {
    console.error("Error getTournamentBracket:", error);
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Staff: danh sách trận để vận hành (lọc theo status)
const getTournamentMatches = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, round_number } = req.query;

    const query = { tournament_id: id };
    if (status) {
      const statuses = String(status).split(",").map((s) => s.trim());
      query.status = { $in: statuses };
    }

    if (round_number) {
      const rounds = await TournamentRound.find({
        tournament_id: id,
        round_number: Number(round_number)
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
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Staff: gán bàn & bắt đầu trận
const startRoundMatch = async (req, res) => {
  try {
    const { id, matchId } = req.params;
    const { table_id, scheduled_at, race_to } = req.body || {};

    const tournament = await Tournament.findById(id).select("status").lean();
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Không tìm thấy giải đấu" });
    }
    if (tournament.status !== "InProgress") {
      return res.status(400).json({ success: false, message: "Giải đấu chưa ở trạng thái đang diễn ra" });
    }

    const match = await RoundMatch.findOne({ _id: matchId, tournament_id: id });
    if (!match) {
      return res.status(404).json({ success: false, message: "Không tìm thấy trận đấu" });
    }
    if (!match.player1_id || !match.player2_id) {
      return res.status(400).json({ success: false, message: "Chưa đủ người chơi cho trận đấu" });
    }
    if (match.status === "Finished") {
      return res.status(400).json({ success: false, message: "Trận đấu đã kết thúc" });
    }

    match.table_id = table_id || match.table_id;
    if (race_to) match.race_to = Number(race_to);
    match.scheduled_at = scheduled_at ? new Date(scheduled_at) : match.scheduled_at || new Date();
    match.started_at = new Date();
    match.status = "Playing";
    await match.save();

    await TournamentRound.findByIdAndUpdate(match.round_id, { status: "InProgress" });

    if (match.table_id) {
      const activeBooking = await Booking.findOne({
        table_id: match.table_id,
        status: { $in: ["Playing"] }
      });
      if (activeBooking) {
        return res.status(400).json({ success: false, message: "Bàn này đang có khách chơi. Vui lòng chọn bàn khác!" });
      }

      await Booking.create({
        guest_name: `Trận giải đấu: ${match.match_name}`,
        table_id: match.table_id,
        play_date: new Date(),
        start_time: new Date().toTimeString().slice(0, 5),
        end_time: "23:59",
        code_number: `TOUR_${match._id.toString().slice(-6)}_${Date.now().toString().slice(-4)}`,
        deposit: 0,
        hour_price: 0,
        status: "Playing",
        note: `TournamentMatch:${match._id}`
      });
    }

    return res.status(200).json({ success: true, message: "Đã bắt đầu trận đấu", data: match });
  } catch (error) {
    console.error("Error startRoundMatch:", error);
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Staff: cập nhật kết quả & tự động phân nhánh
const updateMatchResult = async (req, res) => {
  try {
    const { id, matchId } = req.params;
    const { player1_score, player2_score, winner_id, race_to } = req.body || {};

    const tournament = await Tournament.findById(id).select("status").lean();
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Không tìm thấy giải đấu" });
    }
    if (tournament.status !== "InProgress") {
      return res.status(400).json({ success: false, message: "Giải đấu chưa bắt đầu" });
    }

    const p1Score = Number(player1_score);
    const p2Score = Number(player2_score);
    if (Number.isNaN(p1Score) || Number.isNaN(p2Score)) {
      return res.status(400).json({ success: false, message: "Điểm số không hợp lệ" });
    }

    const match = await RoundMatch.findOne({ _id: matchId, tournament_id: id });
    if (!match) {
      return res.status(404).json({ success: false, message: "Không tìm thấy trận đấu" });
    }
    if (!match.player1_id || !match.player2_id) {
      return res.status(400).json({ success: false, message: "Chưa đủ người chơi cho trận đấu" });
    }
    if (match.status === "Finished") {
      return res.status(400).json({ success: false, message: "Trận đấu đã được chấm điểm" });
    }

    const declaredWinner = winner_id || (p1Score > p2Score ? match.player1_id : match.player2_id);
    if (!declaredWinner) {
      return res.status(400).json({ success: false, message: "Cần chọn người thắng" });
    }
    const declaredWinnerStr = String(declaredWinner);
    if (![match.player1_id?.toString(), match.player2_id?.toString()].includes(declaredWinnerStr)) {
      return res.status(400).json({ success: false, message: "Người thắng không khớp người chơi" });
    }
    if (p1Score === p2Score) {
      return res.status(400).json({ success: false, message: "Không hỗ trợ kết quả hòa" });
    }

    const loserId = declaredWinnerStr === String(match.player1_id) ? match.player2_id : match.player1_id;

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
          end_time: new Date().toTimeString().slice(0, 5) 
        }
      );
    }

    const round = await TournamentRound.findById(match.round_id).lean();

    if (match.match_format === "Knockout") {
      if (loserId) {
        await TournamentPlayer.findOneAndUpdate(
          { tournament_id: id, account_id: loserId },
          { $set: { status: "Eliminated", elimination_round: round?.round_number || null } }
        );
      }
      await propagateWinnerToNext(match);
    }

    if (match.match_format === "RoundRobin") {
      // No elimination; leaderboard sẽ tính theo điểm
    }

    await updateRoundStatusAndProgression(id, match.round_id);
    await checkAndCompleteTournament(id);

    return res.status(200).json({ success: true, message: "Đã cập nhật kết quả", data: match });
  } catch (error) {
    console.error("Error updateMatchResult:", error);
    return res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Public/Owner: bảng xếp hạng Round Robin
const getRoundRobinLeaderboard = async (req, res) => {
  try {
    const { id } = req.params;
    const tournament = await Tournament.findById(id).lean();
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Không tìm thấy giải đấu" });
    }
    if (tournament.format !== "Round Robin") {
      return res.status(400).json({ success: false, message: "Giải đấu không ở thể thức vòng tròn" });
    }

    const leaderboard = await computeRoundRobinLeaderboard(id);
    return res.status(200).json({ success: true, data: leaderboard });
  } catch (error) {
    console.error("Error getRoundRobinLeaderboard:", error);
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
  getMyRegisteredTournamentIds,
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
  tournamentPayOSWebhook
};
