// Import model Tournament để thao tác với collection giải đấu.
const Tournament = require("../../models/tournament.model");
// Import model TournamentRound để thao tác với các vòng đấu của giải.
const TournamentRound = require("../../models/tournament_round.model");
// Import model RoundMatch để thao tác với từng trận trong bracket.
const RoundMatch = require("../../models/round_match.model");
// Import các helper xử lý nghiệp vụ tạo bracket và đồng bộ trạng thái giải.
const {
  // Lấy danh sách người chơi đã được duyệt tham gia giải.
  fetchApprovedPlayers,
  // Đồng bộ trạng thái vòng/trận sau khi giải bắt đầu.
  syncRoundStatusesForStartedTournament,
  // Tạo bracket cho thể thức loại trực tiếp.
  generateKnockoutBracket,
  // Tạo bracket cho thể thức nhánh thắng/nhánh thua.
  generateDoubleEliminationBracket,
  // Tự động xử lý các trận có thể cho người chơi đi tiếp.
  resolvePendingAutoAdvances,
  // Kiểm tra và hoàn tất giải nếu tất cả điều kiện đã xong.
  checkAndCompleteTournament,
} = require("./tournament.helpers");

// Controller tạo nhánh/bảng đấu cho một giải đấu.
const generateTournamentBracket = async (req, res) => {
  try {
    // Lấy id giải đấu từ params trên URL, ví dụ /tournaments/:id/bracket.
    const { id } = req.params;
    // Lấy format frontend gửi lên trong body; nếu không gửi thì sẽ dùng format đang lưu trong giải.
    const { format } = req.body || {};

    // Tìm giải đấu theo id và populate club_id để lấy thông tin CLB sở hữu giải.
    const tournament = await Tournament.findById(id).populate("club_id");
    // Nếu không tìm thấy giải thì trả lỗi 404 cho frontend.
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    // Kiểm tra tài khoản hiện tại có phải chủ CLB của giải này không.
    if (String(tournament.club_id.account_id) !== String(req.user.accountId)) {
      // Nếu không đúng chủ CLB thì không cho tạo bracket cho giải này.
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền quản lý giải đấu của CLB này.",
      });
    }
    // Không cho tạo lại bracket khi giải đã bắt đầu, đã hoàn thành hoặc đã bị hủy.
    if (["InProgress", "Completed", "Cancelled"].includes(tournament.status)) {
      return res.status(400).json({
        success: false,
        message: "Không thể tạo nhánh cho giải đã bắt đầu hoặc kết thúc",
      });
    }

    // Lấy danh sách người chơi đã được duyệt để đưa vào bracket.
    const approvedPlayers = await fetchApprovedPlayers(id);
    // Một giải đấu cần tối thiểu 2 người chơi mới tạo được trận đấu.
    if (approvedPlayers.length < 2) {
      return res
        .status(400)
        .json({ success: false, message: "Cần ít nhất 2 người chơi" });
    }

    // Chọn thể thức cần tạo: ưu tiên body.format, không có thì dùng tournament.format.
    const targetFormat = format || tournament.format;
    // Backend chỉ hỗ trợ Knockout và Double Elimination ở luồng bracket này.
    if (!["Knockout", "Double Elimination"].includes(targetFormat)) {
      return res.status(400).json({
        success: false,
        message: "Thể thức giải đấu không hợp lệ",
      });
    }

    // Biến nhận kết quả bracket do helper tạo ra.
    let bracket = null;
    // Nếu chọn Double Elimination thì tạo nhánh thắng, nhánh thua và chung kết.
    if (targetFormat === "Double Elimination") {
      bracket = await generateDoubleEliminationBracket(tournament);
      // Cập nhật format của giải để lưu đúng thể thức đã tạo.
      tournament.format = "Double Elimination";
    } else {
      // Nếu không phải Double Elimination thì tạo bracket loại trực tiếp.
      bracket = await generateKnockoutBracket(tournament);
      // Cập nhật format của giải là Knockout.
      tournament.format = "Knockout";
    }

    // Lưu lại các thay đổi trên tournament sau khi tạo bracket.
    await tournament.save();
    // Lấy bản ghi mới nhất dạng object thuần để trả về frontend.
    const freshTournament = await Tournament.findById(id).lean();

    // Trả về bracket và thông tin giải sau khi tạo thành công.
    return res.status(200).json({
      success: true,
      message: "Đã tạo nhánh/bảng đấu",
      data: { tournament: freshTournament, bracket },
    });
  } catch (error) {
    // Ghi log lỗi ở server để dễ debug khi tạo bracket thất bại.
    console.error("Error generateTournamentBracket:", error);
    // Trả lỗi 500 nếu có lỗi ngoài dự kiến.
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};


// Controller bắt đầu giải đấu sau khi bracket đã được tạo.
const startTournament = async (req, res) => {
  try {
    // Lấy id giải đấu từ URL.
    const { id } = req.params;
    // Tìm giải đấu và populate CLB để kiểm tra quyền sở hữu.
    const tournament = await Tournament.findById(id).populate("club_id");
    // Nếu không tìm thấy giải thì trả lỗi 404.
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    // Kiểm tra người đang đăng nhập có phải chủ CLB của giải này không.
    if (String(tournament.club_id.account_id) !== String(req.user.accountId)) {
      // Nếu không phải chủ CLB thì không cho bắt đầu giải.
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền quản lý giải đấu của CLB này.",
      });
    }
    // Giải phải tạo bracket trước thì mới được bắt đầu.
    if (!tournament.bracket_generated) {
      return res
        .status(400)
        .json({ success: false, message: "Chưa tạo nhánh/bảng đấu" });
    }
    // Nếu giải đang diễn ra rồi thì trả luôn dữ liệu hiện tại, không cập nhật lại started_at.
    if (tournament.status === "InProgress") {
      return res.status(200).json({
        success: true,
        message: "Giải đấu đã ở trạng thái đang diễn ra",
        data: tournament,
      });
    }

    // Chuyển trạng thái giải sang đang diễn ra.
    tournament.status = "InProgress";
    // Ghi nhận thời điểm bắt đầu giải.
    tournament.started_at = new Date();
    // Lưu thay đổi trạng thái giải vào database.
    await tournament.save();

    // Với Knockout, chỉ mở vòng 1 trước.
    if (tournament.format === "Knockout") {
      await TournamentRound.updateMany(
        // Chọn vòng 1 của giải.
        { tournament_id: id, round_number: 1 },
        // Chuyển vòng 1 sang InProgress.
        { status: "InProgress" },
      );
    // Với Double Elimination, chỉ mở vòng 1 của nhánh thắng trước.
    } else if (tournament.format === "Double Elimination") {
      await TournamentRound.updateMany(
        // Chọn vòng 1 ở Winners bracket.
        { tournament_id: id, bracket_side: "Winners", round_number: 1 },
        // Chuyển vòng này sang InProgress.
        { status: "InProgress" },
      );
    } else {
      // Trường hợp format khác/dữ liệu cũ thì mở toàn bộ vòng của giải.
      await TournamentRound.updateMany(
        // Chọn tất cả vòng thuộc giải.
        { tournament_id: id },
        // Chuyển tất cả vòng sang InProgress.
        { status: "InProgress" },
      );
    }
    // Đồng bộ lại trạng thái vòng/trận sau khi mở vòng đầu.
    await syncRoundStatusesForStartedTournament(id);

    // Trả về kết quả bắt đầu giải thành công.
    return res.status(200).json({
      success: true,
      message: "Đã bắt đầu giải đấu",
      data: tournament,
    });
  } catch (error) {
    // Ghi log lỗi ở server nếu bắt đầu giải thất bại.
    console.error("Error startTournament:", error);
    // Trả lỗi 500 cho frontend.
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};


// Controller lấy bracket của giải để frontend hiển thị theo từng vòng.
const getTournamentBracket = async (req, res) => {
  try {
    // Lấy id giải đấu từ URL.
    const { id } = req.params;
    // Tìm giải đấu dạng lean vì API này chỉ cần đọc dữ liệu.
    const tournament = await Tournament.findById(id).lean();
    // Nếu giải không tồn tại thì trả lỗi 404.
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    // Với Double Elimination, cần xử lý tự động trước khi trả bracket mới nhất.
    if (tournament.format === "Double Elimination") {
      // Tự động cho người chơi đi tiếp ở các trận đủ điều kiện.
      await resolvePendingAutoAdvances(id);
      // Đồng bộ trạng thái vòng/trận sau khi xử lý tự động.
      await syncRoundStatusesForStartedTournament(id);
      // Kiểm tra giải đã hoàn thành chưa.
      await checkAndCompleteTournament(id);
    }

    // Lấy toàn bộ vòng của giải và sắp xếp theo thứ tự hiển thị.
    const rounds = await TournamentRound.find({ tournament_id: id })
      .sort({ order: 1, round_number: 1 })
      .lean();
    // Lấy toàn bộ trận của giải để gắn vào từng vòng.
    const matches = await RoundMatch.find({ tournament_id: id })
      // Sắp xếp trận theo match_no để frontend hiển thị ổn định.
      .sort({ match_no: 1, _id: 1 })
      // Populate thông tin người chơi 1 để frontend có tên và avatar.
      .populate("player1_id", "fullname avatar_url")
      // Populate thông tin người chơi 2.
      .populate("player2_id", "fullname avatar_url")
      // Populate thông tin người thắng nếu trận đã có kết quả.
      .populate("winner_id", "fullname avatar_url")
      // Chuyển về object thuần cho nhẹ.
      .lean();

    // Gom dữ liệu: mỗi round sẽ có thêm display_name và mảng matches của riêng round đó.
    const grouped = rounds.map((round) => {
      // Lọc các trận có round_id trùng với _id của vòng hiện tại.
      const roundMatches = matches.filter(
        (m) => String(m.round_id) === String(round._id),
      );
      // Tên hiển thị mặc định nếu round không thuộc nhánh đặc biệt.
      let display_name = `Round ${round.round_number}`;
      // Nếu là nhánh thắng thì đặt tên theo nhánh thắng.
      if (round.bracket_side === "Winners") {
        display_name = `Nhánh thắng - Vòng ${round.round_number}`;
      // Nếu là nhánh thua thì đặt tên theo nhánh thua.
      } else if (round.bracket_side === "Losers") {
        display_name = `Nhánh thua - Vòng ${round.round_number}`;
      // Nếu là GrandFinal thì hiển thị là chung kết.
      } else if (round.bracket_side === "GrandFinal") {
        display_name = "Chung kết";
      // Nếu là Knockout thường thì hiển thị số vòng.
      } else if (round.round_type === "Knockout") {
        display_name = `Vòng ${round.round_number}`;
      }

      // Trả về object round kèm tên hiển thị và danh sách trận thuộc round đó.
      return {
        // Giữ nguyên toàn bộ dữ liệu gốc của vòng.
        ...round,
        // Thêm tên hiển thị cho UI.
        display_name,
        // Gắn các trận của vòng này.
        matches: roundMatches,
      };
    });

    // Trả bracket đã gom nhóm cho frontend.
    return res.status(200).json({ success: true, data: grouped });
  } catch (error) {
    // Ghi log lỗi ở server nếu lấy bracket thất bại.
    console.error("Error getTournamentBracket:", error);
    // Trả lỗi 500 cho frontend.
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};


// Controller lấy danh sách trận dạng phẳng, có thể lọc theo status hoặc round_number.
const getTournamentMatches = async (req, res) => {
  try {
    // Lấy id giải đấu từ URL.
    const { id } = req.params;
    // Lấy bộ lọc từ query, ví dụ ?status=Pending,InProgress&round_number=1.
    const { status, round_number } = req.query;

    // Tìm giải và chỉ lấy field format vì hàm này chỉ cần biết thể thức.
    const tournament = await Tournament.findById(id).select("format").lean();
    // Nếu không tìm thấy giải thì trả lỗi 404.
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    // Với Double Elimination, trước khi trả danh sách trận cần xử lý các trạng thái tự động.
    if (tournament.format === "Double Elimination") {
      // Tự động cho người chơi đi tiếp ở những trận đủ điều kiện.
      await resolvePendingAutoAdvances(id);
      // Đồng bộ trạng thái vòng/trận sau khi xử lý tự động.
      await syncRoundStatusesForStartedTournament(id);
      // Kiểm tra giải đã hoàn thành hay chưa.
      await checkAndCompleteTournament(id);
    }

    // Query mặc định chỉ lấy các trận thuộc giải hiện tại.
    const query = { tournament_id: id };
    // Nếu frontend truyền status thì lọc theo một hoặc nhiều trạng thái.
    if (status) {
      // Tách chuỗi status theo dấu phẩy để hỗ trợ nhiều status cùng lúc.
      const statuses = String(status)
        .split(",")
        // Xóa khoảng trắng thừa từng status.
        .map((s) => s.trim());
      // Dùng $in để MongoDB tìm các trận có status nằm trong danh sách.
      query.status = { $in: statuses };
    }

    // Nếu frontend truyền round_number thì cần tìm các round có số vòng tương ứng.
    if (round_number) {
      // Lấy danh sách _id của các vòng thuộc giải và có round_number cần lọc.
      const rounds = await TournamentRound.find({
        tournament_id: id,
        round_number: Number(round_number),
      }).select("_id");
      // Gắn điều kiện round_id vào query trận.
      query.round_id = { $in: rounds.map((r) => r._id) };
    }

    // Tìm danh sách trận theo query đã tạo.
    const matches = await RoundMatch.find(query)
      // Sắp xếp theo số trận để frontend hiển thị ổn định.
      .sort({ match_no: 1, _id: 1 })
      // Populate thông tin người chơi 1, gồm cả số điện thoại cho màn hình quản lý trận.
      .populate("player1_id", "fullname phone avatar_url")
      // Populate thông tin người chơi 2.
      .populate("player2_id", "fullname phone avatar_url")
      // Populate thông tin người thắng nếu đã có kết quả.
      .populate("winner_id", "fullname avatar_url")
      // Trả object thuần thay vì Mongoose document.
      .lean();

    // Trả danh sách trận cho frontend.
    return res.status(200).json({ success: true, data: matches });
  } catch (error) {
    // Ghi log lỗi ở server nếu lấy danh sách trận thất bại.
    console.error("Error getTournamentMatches:", error);
    // Trả lỗi 500 cho frontend.
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};


// Export các controller để file routes có thể gắn vào endpoint tương ứng.
module.exports = {
  // API tạo bracket cho giải.
  generateTournamentBracket,
  // API bắt đầu giải sau khi đã tạo bracket.
  startTournament,
  // API lấy bracket đã gom theo từng vòng.
  getTournamentBracket,
  // API lấy danh sách trận, có hỗ trợ filter.
  getTournamentMatches,
};
