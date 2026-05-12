const Tournament = require("../../models/tournament.model");
const TournamentRound = require("../../models/tournament_round.model");
const RoundMatch = require("../../models/round_match.model");
const {
  fetchApprovedPlayers,
  syncRoundStatusesForStartedTournament,
  generateKnockoutBracket,
  generateDoubleEliminationBracket,
  resolvePendingAutoAdvances,
  checkAndCompleteTournament,
} = require("./tournament.helpers");

const generateTournamentBracket = async (req, res) => {
  try {
    const { id } = req.params;
    const { format } = req.body || {};

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
        .json({ success: false, message: "Cần ít nhất 2 người chơi" });
    }

    const targetFormat = format || tournament.format;
    if (!["Knockout", "Double Elimination"].includes(targetFormat)) {
      return res.status(400).json({
        success: false,
        message: "Thể thức giải đấu không hợp lệ",
      });
    }

    let bracket = null;
    if (targetFormat === "Double Elimination") {
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


module.exports = {
  generateTournamentBracket,
  startTournament,
  getTournamentBracket,
  getTournamentMatches,
};
