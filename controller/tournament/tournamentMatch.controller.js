const Tournament = require("../../models/tournament.model");
const TournamentPlayer = require("../../models/tournament_player.model");
const TournamentRound = require("../../models/tournament_round.model");
const RoundMatch = require("../../models/round_match.model");
const Booking = require("../../models/booking.model");
const {
  updateRoundStatusAndProgression,
  resolvePendingAutoAdvances,
  propagateMatchOutcomes,
  checkAndCompleteTournament,
} = require("./tournament.helpers");

const startRoundMatch = async (req, res) => {
  try {
    const { id, matchId } = req.params;
    const { table_id, scheduled_at, race_to } = req.body || {};

    const tournament = await Tournament.findById(id)
      .select("status format table_type_id")
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

    const targetTableId = table_id || match.table_id;

    if (targetTableId) {
      const BilliardTable = require("../../models/billiard_table.model");
      const table = await BilliardTable.findById(targetTableId).lean();
      
      if (!table) {
        return res.status(404).json({ success: false, message: "Không tìm thấy bàn thi đấu" });
      }

      if (tournament.table_type_id && String(table.table_type_id) !== String(tournament.table_type_id)) {
        return res.status(400).json({
          success: false,
          message: "Loại bàn không khớp với quy định của giải đấu",
        });
      }

      const activeBooking = await Booking.findOne({
        table_id: targetTableId,
        status: { $in: ["Playing"] },
      });
      if (activeBooking) {
        return res.status(400).json({
          success: false,
          message: "Bàn này đang có khách chơi. Vui lòng chọn bàn khác!",
        });
      }
    }

    match.table_id = targetTableId;
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
      const todayStr = new Date().toLocaleString("en-US", {
        timeZone: "Asia/Ho_Chi_Minh",
      });
      const localToday = new Date(todayStr);
      localToday.setHours(0, 0, 0, 0);

      const vnTimeStr = new Date().toLocaleTimeString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      await Booking.create({
        guest_name: `Trận giải đấu: ${match.match_name}`,
        table_id: match.table_id,
        play_date: localToday,
        start_time: vnTimeStr,
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
      const maxScore = Math.max(p1Score, p2Score);
      if (maxScore < currentRaceTo) {
        return res.status(400).json({
          success: false,
          message: `Trận Race To ${currentRaceTo}: người thắng phải đạt đúng ${currentRaceTo} điểm (điểm cao nhất hiện tại là ${maxScore})`,
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
      const vnTimeStr = new Date().toLocaleTimeString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      await Booking.updateMany(
        { note: `TournamentMatch:${match._id}`, status: "Playing" },
        {
          status: "Completed",
          end_time: vnTimeStr,
          actual_end_time: vnTimeStr,
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


module.exports = {
  startRoundMatch,
  updateMatchResult,
};
