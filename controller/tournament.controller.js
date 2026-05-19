// ============================================================================
// FILE: tournament.controller.js
// BỘ NÃO CỦA MODULE GIẢI ĐẤU BIDA
// Chứa 36 hàm gồm: Hàm Private (Thuật toán Engine) và Hàm Public (API cho Frontend)
// ============================================================================

// === IMPORT CÁC MODEL VÀ SERVICE ===
const mongoose = require("mongoose");
const Tournament = require("../models/tournament.model"); // Model Giải Đấu
const TournamentPlayer = require("../models/tournament_player.model"); // Model Đăng Ký Cơ Thủ
const TournamentRound = require("../models/tournament_round.model"); // Model Vòng Đấu
const RoundMatch = require("../models/round_match.model"); // Model Trận Đấu
const Booking = require("../models/booking.model"); // Model Đặt Bàn (tích hợp khóa bàn khi thi đấu)
const TransactionHistory = require("../models/transiction_history.model"); // Model Lịch Sử Giao Dịch (PayOS)
const ClubBank = require("../models/club_bank.model"); // Model Tài Khoản Ngân Hàng CLB
const Club = require("../models/club.model"); // Model Câu Lạc Bộ
const Notification = require("../models/notification.model"); // Model Thông Báo
const Account = require("../models/account.model"); // Model Tài Khoản Người Dùng
const payosService = require("../services/payos.service"); // Service tích hợp cổng thanh toán PayOS

// Thời gian hết hạn link thanh toán PayOS (phút)
const PAYOS_EXPIRE_MINUTES = 10;

// ============================================================================
// HÀM TIỆN ÍCH: shuffleArray
// Xáo trộn ngẫu nhiên mảng (Thuật toán Fisher-Yates) dùng để bốc thăm vị trí cơ thủ.
// ============================================================================
const shuffleArray = (input) => {
  const arr = [...input]; // Tạo bản sao để không ảnh hưởng mảng gốc
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1)); // Chọn vị trí ngẫu nhiên
    [arr[i], arr[j]] = [arr[j], arr[i]]; // Hoán đổi vị trí
  }
  return arr;
};

// ============================================================================
// HÀM TIỆN ÍCH: nextPowerOfTwo
// Tìm lũy thừa 2 nhỏ nhất >= n. Dùng để tính bracket size.
// VD: n=5 -> 8. n=9 -> 16. n=16 -> 16.
// ============================================================================
const nextPowerOfTwo = (n) => {
  if (n < 2) return 2;
  let p = 1;
  while (p < n) p <<= 1; // Dịch bit trái (nhân đôi) cho đến khi >= n
  return p;
};

// ============================================================================
// HÀM HELPER: ensureTournamentApproved
// Xác nhận đăng ký: Duyệt đăng ký cơ thủ vào giải đấu, gửi thông báo cho Staff/Owner,
// và tự động đóng đăng ký nếu đã đủ người.
// ============================================================================
const ensureTournamentApproved = async (tournamentId, accountId, feeAmount) => {
  // Kiểm tra xem cơ thủ này đã được duyệt trước đó chưa (tránh gửi thông báo lặp lại)
  const existingRegistration = await TournamentPlayer.findOne({
    tournament_id: tournamentId,
    account_id: accountId,
    status: "Approved",
  }).lean();

  // Tạo mới hoặc cập nhật bản ghi đăng ký thành Approved (Upsert)
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

  // Nếu lần đầu đăng ký (chưa từng Approved) -> Gửi thông báo
  if (!existingRegistration) {
    const playerAccount = await Account.findById(accountId).select("fullname phone").lean();
    const playerName = playerAccount ? (playerAccount.fullname || playerAccount.phone || "Một người chơi") : "Một người chơi";

    // Gửi thông báo cho Cơ Thủ đăng ký thành công
    await Notification.create({
      account_id: accountId,
      title: "Đăng ký giải đấu thành công",
      message: `Bạn đã đăng ký thành công giải đấu ${tournament.name || ""}.`,
      link: `/my-tournaments?tournamentId=${tournamentId}`,
      is_read: false,
    });

    // Gửi thông báo cho Staff và Owner của CLB
    const clubStaffs = await Account.find({
      club_id: tournament.club_id,
      status: "ACTIVE",
    }).select("_id").lean();

    const clubInfo = await Club.findById(tournament.club_id).select("account_id").lean();
    
    // Gom danh sách người nhận (Staff + Owner), dùng Set để tránh trùng lặp
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

  // Đếm số cơ thủ đã được duyệt, nếu đủ max_players thì tự động đóng đăng ký
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

// ============================================================================
// HÀM HELPER: markTransactionSuccessAndApprove
// Xác nhận thanh toán: Đánh dấu giao dịch PayOS thành công và tự động duyệt đăng ký cơ thủ.
// ============================================================================
const markTransactionSuccessAndApprove = async (orderCode) => {
  const tx = await TransactionHistory.findOne({ order_code: orderCode });
  // Bỏ qua nếu không tìm thấy hoặc giao dịch không phải lệ phí giải đấu
  if (!tx || !tx.description?.startsWith("TournamentFee:")) return false;

  // Nếu đã xử lý rồi (SUCCESS) thì không xử lý lại
  if (tx.status === "SUCCESS") return true;

  // Tách Tournament ID từ description (format: "TournamentFee:TOURNAMENT_ID")
  const [, tournamentId] = tx.description.split(":");
  // Gọi hàm duyệt đăng ký cơ thủ
  await ensureTournamentApproved(tournamentId, tx.account_id, tx.amount || 0);
  // Cập nhật trạng thái giao dịch
  tx.status = "SUCCESS";
  tx.transaction_time = new Date();
  await tx.save();
  return true;
};

// ============================================================================
// HÀM HELPER: fetchApprovedPlayers
// Lấy danh sách cơ thủ đã được duyệt (Approved) của một giải đấu.
// ============================================================================
const fetchApprovedPlayers = async (tournamentId) => {
  return TournamentPlayer.find({
    tournament_id: tournamentId,
    status: "Approved",
  })
    .populate("account_id", "fullname phone avatar_url")
    .lean();
};

// ============================================================================
// HÀM HELPER: clearBracket
// Xóa sạch toàn bộ Vòng Đấu và Trận Đấu cũ của giải trước khi tạo nhánh mới.
// ============================================================================
const clearBracket = async (tournamentId) => {
  await Promise.all([
    RoundMatch.deleteMany({ tournament_id: tournamentId }),
    TournamentRound.deleteMany({ tournament_id: tournamentId }),
  ]);
};

// ============================================================================
// HÀM HELPER: buildFirstRoundPairs
// Ghép cặp Vòng 1: Dựa vào danh sách cơ thủ đã xáo trộn và bracketSize,
// ghép từng đôi một. Nếu thiếu người -> cặp [người, null] (sẽ thành BYE).
// ============================================================================
const buildFirstRoundPairs = (playerIds, bracketSize) => {
  const players = [...playerIds];
  const matchCount = bracketSize / 2; // Số trận Vòng 1
  const pairs = [];

  for (let i = 0; i < matchCount; i += 1) {
    const remainingPlayers = players.length;
    const remainingMatches = matchCount - i;

    if (remainingPlayers <= 0) {
      // Hết người -> Cặp trống hoàn toàn (ghost match)
      pairs.push([null, null]);
      continue;
    }

    if (remainingPlayers <= remainingMatches) {
      // Không đủ người ghép đôi -> BYE (người còn lại thắng tự động)
      pairs.push([players.shift() || null, null]);
      continue;
    }

    // Đủ người -> Ghép cặp bình thường
    pairs.push([players.shift() || null, players.shift() || null]);
  }

  return pairs;
};

// ============================================================================
// HÀM HELPER: normalizePrizePool
// Xử lý và validate giá trị giải thưởng (prize pool) và phí tham gia.
// ============================================================================
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

  // Tiền thưởng phải lớn hơn phí tham gia (nếu có thu phí)
  if (feeValue > 0 && prizeValue <= feeValue) {
    return { error: "Tiền thưởng phải lớn hơn phí tham gia" };
  }

  return { value: String(prizeValue) };
};

// ============================================================================
// HÀM HELPER: getWinnerFeedTarget
// Lấy tọa độ (ID trận và vị trí ghế) của trận đấu tiếp theo dành cho Người Thắng
// ============================================================================
const getWinnerFeedTarget = (matchDoc) => ({
  // Hỗ trợ cả 2 chuẩn tên field: winner_next_match_id (cho nhánh Kép) hoặc next_match_id (cho nhánh Loại trực tiếp)
  matchId: matchDoc?.winner_next_match_id || matchDoc?.next_match_id || null,
  // Xác định xem người thắng sẽ ngồi ở ghế trên (1) hay ghế dưới (2) ở trận tiếp theo
  slot: matchDoc?.winner_next_slot || matchDoc?.next_slot || null,
});

// ============================================================================
// HÀM ĐỆ QUY DFS: canMatchProduceParticipant
// Radar quét sâu: Kiểm tra xem một trận đấu (matchId) có khả năng đẻ ra người thắng/thua 
// để ngoi lên vòng trong hay không. Đây là cốt lõi để xử lý luật Thắng Tự Động (BYE).
// ============================================================================
const canMatchProduceParticipant = async (
  matchId,
  routeType = "winner", // Đang tìm đường đi cho người thắng (winner) hay người thua (loser)
  visited = new Set(),  // Dùng Set để nhớ các trận đã đi qua, chống lặp vô hạn (Infinite Loop)
) => {
  // Bảo vệ: Nếu không truyền ID trận thì dừng
  if (!matchId) return false;

  // Khóa chống lặp: Đánh dấu nhánh này đã đi qua
  const visitKey = `${matchId}:${routeType}`;
  if (visited.has(visitKey)) return false;
  visited.add(visitKey);

  // Truy vấn DB lấy trạng thái và ID người chơi hiện tại của trận này
  const match = await RoundMatch.findById(matchId)
    .select("status player1_id player2_id winner_id loser_id")
    .lean();
  if (!match) return false;

  // Kịch bản 1: Nếu trận này đã ĐÁNH XONG (Finished)
  if (match.status === "Finished") {
    // Nếu đang rà soát nhánh loser, kiểm tra xem có loser_id không. Ngược lại kiểm tra winner_id.
    // Nếu có người (true), nghĩa là trận này ĐÃ sinh ra người -> Trả về true.
    return routeType === "loser"
      ? Boolean(match.loser_id)
      : Boolean(match.winner_id);
  }

  // Lấy trạng thái xem 2 ghế đã có người ngồi chờ chưa
  const hasPlayer1 = Boolean(match.player1_id);
  const hasPlayer2 = Boolean(match.player2_id);

  // Kịch bản 2: Trận chưa đánh nhưng ĐÃ ĐỦ 2 NGƯỜI ngồi chờ
  // Chắc chắn 100% khi đánh xong sẽ có người đi tiếp -> Trả về true luôn, không cần quét sâu hơn.
  if (hasPlayer1 && hasPlayer2) {
    return true;
  }

  // Kịch bản 3: Đang dò tìm đường đi của nhánh THUA (Dành cho Double Elimination)
  if (routeType === "loser") {
    // Nếu có player1 nhưng trống player2 -> Quét lặn xuống tìm xem tương lai ghế 2 có ai lên không.
    if (hasPlayer1 && !hasPlayer2) {
      return canSlotReceiveParticipant(match._id, 2, visited);
    }
    // Nếu có player2 nhưng trống player1 -> Quét xem ghế 1 tương lai có ai lên không.
    if (!hasPlayer1 && hasPlayer2) {
      return canSlotReceiveParticipant(match._id, 1, visited);
    }
    // Nếu cả 2 ghế đều trống: Phải đảm bảo CẢ 2 nhánh dưới đều sẽ sinh ra người thì mới có trận đấu.
    return (
      (await canSlotReceiveParticipant(match._id, 1, visited)) &&
      (await canSlotReceiveParticipant(match._id, 2, visited))
    );
  }

  // Kịch bản 4: Đang dò tìm đường đi của nhánh THẮNG (Mặc định)
  // Nếu có player1 nhưng trống player2
  if (hasPlayer1 && !hasPlayer2) {
    // Quét xuống vòng dưới xem ghế 2 có ai ngoi lên không
    const missingCanReceive = await canSlotReceiveParticipant(
      match._id,
      2,
      visited,
    );
    // Chỉ cần ghế 2 có người lên (missingCanReceive), HOẶC bản thân player1 đang đứng chờ (để được Thắng Tự Động)
    return missingCanReceive || hasPlayer1;
  }

  // Tương tự, nếu có player2 nhưng trống player1
  if (!hasPlayer1 && hasPlayer2) {
    const missingCanReceive = await canSlotReceiveParticipant(
      match._id,
      1,
      visited,
    );
    return missingCanReceive || hasPlayer2;
  }

  // Nếu cả 2 ghế trống: Trận này sẽ đẻ ra người thắng NẾU 1 trong 2 nhánh con của nó sinh ra người
  return (
    (await canSlotReceiveParticipant(match._id, 1, visited)) ||
    (await canSlotReceiveParticipant(match._id, 2, visited))
  );
};

// ============================================================================
// HÀM ĐỆ QUY DFS: canSlotReceiveParticipant
// Radar phụ trợ: Xác định xem một "ghế trống" (slot) cụ thể của một trận đấu (targetMatchId)
// liệu có nhận được người chơi nào từ các trận vệ tinh xung quanh rớt xuống hay không.
// ============================================================================
const canSlotReceiveParticipant = async (
  targetMatchId,
  slot,
  visited = new Set(),
) => {
  // Tìm TẤT CẢ các trận đấu (sources) đang chĩa mũi tên (chỉ đường) vào cái targetMatchId và slot này.
  // Quét cả đường của người thắng (winner_next) lẫn đường rớt đài của người thua (loser_next).
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

  // Nếu không có bất kỳ trận nào chĩa mũi tên vào ghế này -> Ghế này vĩnh viễn trống (Mồ côi).
  if (!sources.length) {
    return false;
  }

  // Duyệt qua từng trận vệ tinh tìm được
  for (const source of sources) {
    // Trường hợp 1: Nếu mũi tên chĩa vào đây là đường đi của NGƯỜI THẮNG
    const winnerFeedsTarget =
      String(source.winner_next_match_id || source.next_match_id || "") ===
      String(targetMatchId) &&
      Number(source.winner_next_slot || source.next_slot || null) ===
      Number(slot);

    if (winnerFeedsTarget) {
      // Gọi ngược lại hàm canMatchProduceParticipant để hỏi cái trận vệ tinh kia: "Mày có sinh ra người thắng không?"
      if (
        await canMatchProduceParticipant(source._id, "winner", new Set(visited))
      ) {
        return true; // Có -> Ghế này sẽ có người ngồi!
      }
    }

    // Trường hợp 2: Nếu mũi tên chĩa vào đây là đường rớt đài của NGƯỜI THUA
    const loserFeedsTarget =
      String(source.loser_next_match_id || "") === String(targetMatchId) &&
      Number(source.loser_next_slot || null) === Number(slot);

    if (loserFeedsTarget) {
      // Gọi đệ quy hỏi trận vệ tinh: "Mày có sinh ra người thua không?"
      if (
        await canMatchProduceParticipant(source._id, "loser", new Set(visited))
      ) {
        return true; // Có -> Ghế này sẽ có người rớt xuống ngồi!
      }
    }
  }

  // Quét hết mọi hướng mà không thấy ai -> Chắc chắn trống.
  return false;
};

// ============================================================================
// HÀM HELPER: pushParticipantToMatch
// Bàn tay sắp xếp: Dùng để gán ID một người chơi (participantId) vào một ghế (slot) 
// cụ thể của một trận đấu vòng trong (matchId). Thường gọi sau khi có người Thắng/Thua.
// ============================================================================
const pushParticipantToMatch = async (
  matchId,
  slot,
  participantId,
  session = null,
) => {
  // Tránh lỗi undefined nếu thiếu tham số đầu vào
  if (!matchId || !slot || !participantId) return null;

  // Xác định trường cần update trong MongoDB dựa vào slot (1 -> player1_id, 2 -> player2_id)
  const field = slot === 1 ? "player1_id" : "player2_id";
  
  // Lấy trận đấu đích ra từ Database
  const match = await RoundMatch.findById(matchId).session(session || null);
  if (!match) return null;

  // Nếu cái ghế đó hiện đang trống thì mới nhét người chơi vào
  if (!match[field]) {
    match[field] = participantId; // Gán ID người chơi
    await match.save({ session }); // Lưu trực tiếp xuống Database
  }

  return match;
};

// ============================================================================
// HÀM HELPER: syncRoundStatusesForStartedTournament
// Đồng bộ trạng thái Vòng Đấu: Quét toàn bộ các trận đấu trong 1 giải,
// để tự động cập nhật trạng thái của từng Vòng (Round) từ Pending -> InProgress -> Completed.
// ============================================================================
const syncRoundStatusesForStartedTournament = async (tournamentId) => {
  // Chỉ đồng bộ khi giải đấu đang ở trạng thái "Đang diễn ra" (InProgress)
  const tournament = await Tournament.findById(tournamentId)
    .select("status")
    .lean();
  if (!tournament || tournament.status !== "InProgress") return;

  // Lấy toàn bộ danh sách các Vòng đấu (Rounds) của giải này
  const rounds = await TournamentRound.find({
    tournament_id: tournamentId,
  }).lean();
  
  // Lấy toàn bộ danh sách các Trận đấu (Matches) của giải này
  const matches = await RoundMatch.find({ tournament_id: tournamentId })
    .select("round_id status")
    .lean();

  // Gom nhóm các trận đấu theo từng Vòng đấu (Group by round_id) để dễ tính toán
  const byRound = matches.reduce((acc, match) => {
    const key = String(match.round_id);
    acc[key] = acc[key] || [];
    acc[key].push(match);
    return acc;
  }, {});

  // Duyệt qua từng Vòng đấu một
  for (const round of rounds) {
    const roundMatches = byRound[String(round._id)] || [];
    if (!roundMatches.length) continue; // Nếu vòng này không có trận nào thì bỏ qua

    // Kiểm tra xem TOÀN BỘ các trận trong vòng này đã đánh xong hết chưa?
    const allFinished = roundMatches.every(
      (match) => match.status === "Finished",
    );
    
    // Kiểm tra xem CÓ BẤT KỲ trận nào trong vòng này đã/đang diễn ra không?
    const hasStartedMatch = roundMatches.some((match) =>
      ["Ready", "Playing", "Finished"].includes(match.status),
    );

    // Quyết định trạng thái mới cho Vòng đấu:
    // Xong hết -> Completed. Bắt đầu đánh -> InProgress. Chưa có gì -> Pending.
    const desiredStatus = allFinished
      ? "Completed"
      : hasStartedMatch
        ? "InProgress"
        : "Pending";

    // Nếu trạng thái thay đổi so với DB thì mới cập nhật để tiết kiệm truy vấn
    if (round.status !== desiredStatus) {
      await TournamentRound.findByIdAndUpdate(round._id, {
        status: desiredStatus,
      });
    }
  }
};

// ============================================================================
// HÀM HELPER: propagateMatchOutcomes
// Máy bơm luân chuyển: Cỗ máy điều phối chính của giải đấu.
// Đọc tọa độ của trận vừa đánh xong (matchDoc), từ đó đẩy ID của Người Thắng 
// và Người Thua đi đến đúng vị trí ghế tiếp theo của họ.
// ============================================================================
const propagateMatchOutcomes = async (
  matchDoc,
  session = null,
  visited = new Set(),
) => {
  // Bảo vệ: Nếu không có dữ liệu trận thì dừng
  if (!matchDoc) return;

  // Khóa chống lặp vô hạn (Infinite Loop) - Ghi nhớ trận này đã điều phối xong
  const matchId = String(matchDoc._id);
  if (visited.has(matchId)) return;
  visited.add(matchId);

  // 1. ĐIỀU HƯỚNG NGƯỜI THẮNG
  // Lấy tọa độ ghế tiếp theo của Người Thắng
  const winnerTarget = getWinnerFeedTarget(matchDoc);
  if (matchDoc.winner_id && winnerTarget.matchId && winnerTarget.slot) {
    // Gọi hàm nhồi ID người thắng vào trận đấu tiếp theo đó
    const nextMatch = await pushParticipantToMatch(
      winnerTarget.matchId,
      winnerTarget.slot,
      matchDoc.winner_id,
      session,
    );
    // Nếu nhồi thành công, "đánh thức" trận tiếp theo để kiểm tra xem nó đã đủ 2 người chưa
    if (nextMatch) {
      await refreshMatchState(nextMatch._id, session, visited);
    }
  }

  // 2. ĐIỀU HƯỚNG NGƯỜI THUA (Chỉ áp dụng cho Double Elimination có nhánh Loser)
  // Kiểm tra xem trận này có tọa độ rớt đài cho người thua hay không
  if (matchDoc.loser_next_match_id && matchDoc.loser_next_slot) {
    if (matchDoc.loser_id) {
      // Nhồi người thua xuống trận nhánh dưới (Loser bracket)
      const loserMatch = await pushParticipantToMatch(
        matchDoc.loser_next_match_id,
        matchDoc.loser_next_slot,
        matchDoc.loser_id,
        session,
      );
      // Đánh thức trận nhánh thua đó
      if (loserMatch) {
        await refreshMatchState(loserMatch._id, session, visited);
      }
    } else {
      // Trường hợp không có loser_id (Ví dụ: Trận này Thắng tự động do đối thủ bỏ cuộc từ trước)
      // Vẫn phải đánh thức trận nhánh dưới để nó tự tính toán lại xem nó có được Thắng tự động tiếp không
      await refreshMatchState(matchDoc.loser_next_match_id, session, visited);
    }
  }
};

// ============================================================================
// HÀM HELPER: refreshMatchState
// Đánh thức trận đấu: Sau khi có người được nhồi vào, hàm này kiểm tra:
// - ĐỦ NGƯỜI: Đổi trạng thái thành Ready (Sẵn sàng).
// - THIẾU NGƯỜI DO NHÁNH DƯỚI RỖNG: Tự động phán quyết Thắng Tự Động (BYE).
// ============================================================================
async function refreshMatchState(matchId, session = null, visited = new Set()) {
  const match = await RoundMatch.findById(matchId).session(session || null);
  // Nếu trận không tồn tại hoặc đã Đánh xong (Finished) thì không cần kiểm tra nữa
  if (!match || match.status === "Finished") return false;

  let changed = false;

  // Kịch bản 1: CẢ 2 NGƯỜI ĐÃ CÓ MẶT VÀ ĐANG CHỜ (Scheduled)
  if (match.player1_id && match.player2_id && match.status === "Scheduled") {
    // Đổi trạng thái thành Ready (Sẵn sàng) -> Trên giao diện Staff sẽ hiện nút Xanh "Gán Bàn"
    match.status = "Ready";
    await match.save({ session });
    return true; // Báo cáo là trạng thái đã bị thay đổi
  }

  // Kịch bản 2: CẢ 2 GHẾ ĐỀU TRỐNG HOẶC ĐÃ ĐẦY NHƯNG KHÔNG PHẢI SCHEDULED
  // Không có gì để tự động xử lý thêm, thoát luôn.
  if (Boolean(match.player1_id) === Boolean(match.player2_id)) {
    return changed;
  }

  // Kịch bản 3: CHỈ CÓ 1 NGƯỜI NGỒI ĐỢI -> Kiểm tra có được Thắng tự động (BYE) không?
  // Xác định xem đang trống ghế nào (ghế 1 hay ghế 2)
  const missingSlot = match.player1_id ? 2 : 1;
  
  // Dùng Radar rà quét nhánh dưới: "Ê, tương lai có ai lên ngồi cái ghế trống này không?"
  const hasPendingSource = await canSlotReceiveParticipant(
    match._id,
    missingSlot,
    visited,
  );
  
  // Nếu CÓ tiềm năng (người vòng dưới đang đánh chưa xong) -> Phải chờ tiếp, không được xử thắng.
  if (hasPendingSource) {
    return changed;
  }

  // NẾU KHÔNG CÒN AI CÓ THỂ LÊN ĐƯỢC NỮA (Do nhánh dưới hủy hết):
  // Lấy ID của người ĐANG NGỒI CHỜ (may mắn) đó ra.
  const winnerId = match.player1_id || match.player2_id;
  if (!winnerId) return changed; // Bảo vệ lỗi

  // Xử lý Thắng Tự Động ngay lập tức!
  match.winner_id = winnerId;
  match.loser_id = null; // Trận BYE không có ai thua
  match.result = "BYE"; // Ghi chú lại lý do thắng
  match.finished_at = new Date(); // Chốt thời gian kết thúc
  match.status = "Finished"; // Chốt trạng thái trận
  await match.save({ session });

  // Do trận này vừa "Tự động kết thúc", phải tiếp tục gọi cái Máy Bơm ở trên
  // để đẩy ông may mắn này đi tiếp vào vòng trong nữa.
  await propagateMatchOutcomes(match, session, visited);
  return true;
}

// ============================================================================
// HÀM HELPER: resolvePendingAutoAdvances
// Trình Cứu Hộ: Dùng để quét lại toàn bộ giải đấu xem có trận nào đang bị kẹt
// ở trạng thái "Thiếu 1 người" mà nhánh dưới lại không có ai để lên không.
// Nếu có, gọi refreshMatchState để xử Thắng Tự Động cho họ đi tiếp.
// ============================================================================
const resolvePendingAutoAdvances = async (tournamentId) => {
  let shouldContinue = true;

  // Sử dụng vòng lặp while để quét liên tục cho đến khi không còn trận nào kẹt nữa
  // Bởi vì xử thắng trận A có thể vô tình làm trận B (ở vòng trong) bị thiếu người theo.
  while (shouldContinue) {
    shouldContinue = false;
    // Tìm các trận: Chưa đánh (status != Finished) VÀ (chỉ có người 1 HOẶC chỉ có người 2)
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

    // Duyệt qua từng "nạn nhân" đang kẹt
    for (const candidate of candidates) {
      // Đánh thức trận đó để nó tự kiểm tra xem có được BYE không
      const changed = await refreshMatchState(candidate._id);
      // Nếu trạng thái bị đổi (nghĩa là vừa có người được xử thắng lên vòng trong)
      // -> Phải bật cờ true để lặp lại việc quét từ đầu (phòng trường hợp vòng trong lại bị kẹt)
      if (changed) {
        shouldContinue = true;
      }
    }
  }
};

// ============================================================================
// HÀM HELPER: computeRoundRobinLeaderboard
// Bộ đếm điểm: Dành riêng cho thể thức Vòng Tròn (Round Robin).
// Tính toán số trận thắng, thua, điểm số, hiệu số ván thắng/thua để xếp hạng.
// ============================================================================
const computeRoundRobinLeaderboard = async (tournamentId) => {
  // 1. Lấy tất cả các trận ĐÃ ĐÁNH XONG của giải này
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
  
  // Hàm khởi tạo dòng điểm (row) cho một người chơi nếu họ chưa có tên trên bảng vàng
  const ensureEntry = (id, groupKey) => {
    const key = String(id);
    if (!stats[key]) {
      stats[key] = {
        account_id: id,
        group_key: groupKey || "A",
        matches: 0,
        wins: 0,
        losses: 0,
        frames_for: 0, // Tổng số ván cơ thủ này thắng được
        frames_against: 0, // Tổng số ván cơ thủ này bị thua
        points: 0, // Điểm số (Thường: Thắng = 3 điểm)
      };
    }
    return stats[key];
  };

  // 2. Cộng dồn điểm số từ các trận đấu
  matches.forEach((m) => {
    // Tách thông tin của 2 người chơi ra để xử lý độc lập
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
      
      row.matches += 1; // Tăng số trận đã đá
      row.frames_for += Number(entry.scoreFor || 0); // Cập nhật số ván thắng
      row.frames_against += Number(entry.scoreAgainst || 0); // Cập nhật số ván thua
      
      // Nếu người này là người chiến thắng trận đó -> Được 3 điểm
      if (String(m.winner_id || "") === String(entry.id)) {
        row.wins += 1;
        row.points += 3;
      } else {
        row.losses += 1;
      }
    });
  });

  // 3. Tính "Hiệu số" (frame_diff) = Thắng - Thua
  const leaderboard = Object.values(stats).map((row) => ({
    ...row,
    frame_diff: row.frames_for - row.frames_against,
  }));

  // 4. Gom nhóm người chơi theo bảng (VD: Bảng A, Bảng B)
  const grouped = leaderboard.reduce((acc, row) => {
    acc[row.group_key] = acc[row.group_key] || [];
    acc[row.group_key].push(row);
    return acc;
  }, {});

  // 5. Sắp xếp thứ hạng (Rank) trong từng bảng
  Object.keys(grouped).forEach((group) => {
    grouped[group].sort(
      (a, b) =>
        b.points - a.points || // Ưu tiên 1: Điểm số
        b.frame_diff - a.frame_diff || // Ưu tiên 2: Hiệu số ván
        b.frames_for - a.frames_for, // Ưu tiên 3: Tổng số ván thắng
    );
    // Sau khi sắp xếp xong thì gán số Rank cho họ
    grouped[group].forEach((row, idx) => {
      row.rank = idx + 1;
    });
  });

  return grouped;
};

// ============================================================================
// HÀM HELPER: checkAndCompleteTournament
// Kẻ Kết Liễu: Tìm kiếm trận Chung Kết (Grand Final) xem đã đánh xong chưa.
// Nếu xong rồi thì đóng giải đấu lại, vinh danh Quán Quân, Á Quân.
// ============================================================================
const checkAndCompleteTournament = async (tournamentId) => {
  const tournament = await Tournament.findById(tournamentId).lean();
  if (!tournament) return;

  // Nếu giải đã kết thúc hoặc hủy rồi thì không làm gì nữa
  if (tournament.status === "Completed" || tournament.status === "Cancelled")
    return;

  // ============ THỂ THỨC LOẠI TRỰC TIẾP (KNOCKOUT) ============
  if (tournament.format === "Knockout") {
    // Trận chung kết là trận KHÔNG CÓ next_match_id (Không có đường đi tiếp nữa)
    const finalMatch = await RoundMatch.findOne({
      tournament_id: tournamentId,
      match_format: "Knockout",
      next_match_id: null,
    }).lean();

    // Nếu tìm thấy Chung kết VÀ nó đã đánh xong
    if (
      finalMatch &&
      finalMatch.status === "Finished" &&
      finalMatch.winner_id
    ) {
      // 1. Phế truất tất cả: Đặt trạng thái toàn bộ cơ thủ thành "Bị Loại" (Eliminated)
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

      // 2. Vinh danh Vua: Sửa lại trạng thái của người thắng thành Quán Quân (Champion)
      await TournamentPlayer.findOneAndUpdate(
        { tournament_id: tournamentId, account_id: finalMatch.winner_id },
        {
          $set: { status: "Champion", final_rank: 1, elimination_round: null },
        },
      );

      // 3. Trao giải Á Quân cho người thua ở Chung Kết
      if (finalMatch.loser_id) {
        await TournamentPlayer.findOneAndUpdate(
          { tournament_id: tournamentId, account_id: finalMatch.loser_id },
          { $set: { final_rank: 2 } },
        );
      }

      // 4. Chốt sổ giải đấu: Cập nhật status thành Completed
      await Tournament.findByIdAndUpdate(tournamentId, {
        status: "Completed",
        champion_account_id: finalMatch.winner_id,
        completed_at: new Date(),
      });
    }
    return;
  }

  // ============ THỂ THỨC VÒNG TRÒN (ROUND ROBIN) ============
  if (tournament.format === "Round Robin") {
    // Đếm xem tổng số trận trong giải là bao nhiêu, và số trận đã đánh xong là bao nhiêu
    const totalMatches = await RoundMatch.countDocuments({
      tournament_id: tournamentId,
      match_format: "RoundRobin",
    });
    const finishedMatches = await RoundMatch.countDocuments({
      tournament_id: tournamentId,
      match_format: "RoundRobin",
      status: "Finished",
    });

    // Nếu TẤT CẢ các trận đều đã đánh xong (Finished)
    if (totalMatches > 0 && totalMatches === finishedMatches) {
      // Lấy Bảng xếp hạng điểm
      const leaderboard = await computeRoundRobinLeaderboard(tournamentId);
      
      // Lấy ra những người đứng đầu (Top 1) của từng bảng (Group)
      const topGroups = Object.values(leaderboard)
        .map((rows) => rows[0])
        .filter(Boolean);
        
      if (topGroups.length) {
        // Xếp hạng các Top 1 này để tìm ra Quán Quân tổng
        topGroups.sort((a, b) => a.rank - b.rank);
        const championId = topGroups[0].account_id;
        
        // Chốt sổ Giải đấu
        await Tournament.findByIdAndUpdate(tournamentId, {
          status: "Completed",
          champion_account_id: championId,
          completed_at: new Date(),
        });
        
        // Tương tự, đánh rớt tất cả rồi phong Vương cho Quán Quân
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

  // ============ THỂ THỨC NHÁNH THẮNG THUA (DOUBLE ELIMINATION) ============
  if (tournament.format === "Double Elimination") {
    // Trận chung kết của thể thức này nằm ở nhánh GrandFinal
    const grandFinal = await RoundMatch.findOne({
      tournament_id: tournamentId,
      match_format: "DoubleElimination",
      bracket_side: "GrandFinal",
    }).lean();

    // Quy trình chốt Quán Quân / Á Quân y hệt như Knockout
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

// ============================================================================
// HÀM PRIVATE: generateKnockoutBracket
// Kiến trúc sư Nhánh Loại Trực Tiếp: Tạo toàn bộ cấu trúc nhánh đấu (Bracket)
// cho thể thức Knockout (Thua 1 trận là bị loại vĩnh viễn).
// Input: Object tournament (đã lấy từ DB)
// Output: { roundCount, bracketSize }
// ============================================================================
const generateKnockoutBracket = async (tournament) => {
  // 1. Lấy danh sách những cơ thủ đã được duyệt đăng ký (Approved)
  const approvedPlayers = await fetchApprovedPlayers(tournament._id);
  if (approvedPlayers.length < 2) {
    throw new Error("Cần ít nhất 2 người chơi để tạo nhánh đấu");
  }

  // 2. Xóa toàn bộ nhánh đấu cũ (nếu có), đảm bảo tạo từ đầu sạch sẽ
  await clearBracket(tournament._id);

  // 3. Xáo trộn ngẫu nhiên vị trí cơ thủ (để bốc thăm công bằng)
  const playerIds = shuffleArray(
    approvedPlayers.map((p) => p.account_id?._id || p.account_id),
  );
  
  // 4. Tính bracket size (Lũy thừa 2 gần nhất >= số người)
  // VD: 5 người -> bracketSize = 8. 7 người -> bracketSize = 8. 9 người -> bracketSize = 16.
  const bracketSize = nextPowerOfTwo(playerIds.length);
  
  // 5. Ghép cặp Vòng 1 (các vị trí trống sẽ tự động thành BYE)
  const firstRoundPairs = buildFirstRoundPairs(playerIds, bracketSize);

  // 6. Tạo các đối tượng Vòng Đấu (Round Documents) trong MongoDB
  // Số vòng = log2(bracketSize). VD: 8 người -> 3 vòng (Vòng 1, Bán kết, Chung kết)
  const roundCount = Math.log2(bracketSize);
  const roundDocs = [];
  for (let i = 1; i <= roundCount; i += 1) {
    roundDocs.push({
      _id: new mongoose.Types.ObjectId(), // Tạo ID mới cho Vòng đấu
      tournament_id: tournament._id,
      round_number: i,
      round_type: "Knockout",
      status: "Pending", // Ban đầu tất cả Vòng đều ở trạng thái Chờ
      order: i,
    });
  }

  // 7. Tạo Ma trận ID Trận Đấu: Tạo trước ID cho tất cả trận ở tất cả vòng
  //    Đây là bước QUAN TRỌNG để sau đó nối mũi tên (next_match_id) giữa các trận.
  const matchIdMatrix = [];
  for (let r = 0; r < roundCount; r += 1) {
    // Số trận mỗi vòng = bracketSize / 2^(r+1). VD: Vòng 1 có 4 trận, Vòng 2 có 2, Vòng 3 có 1.
    const matchCount = bracketSize / Math.pow(2, r + 1);
    matchIdMatrix[r] = [];
    for (let m = 0; m < matchCount; m += 1) {
      matchIdMatrix[r].push(new mongoose.Types.ObjectId());
    }
  }

  // 8. Dựng từng Trận Đấu (Match Document) và NỐI MŨI TÊN giữa chúng
  const matchDocs = [];
  for (let r = 0; r < roundCount; r += 1) {
    const matchCount = bracketSize / Math.pow(2, r + 1);
    for (let m = 0; m < matchCount; m += 1) {
      // Vòng 1 lấy cặp đã ghép, vòng 2+ để trống chờ người từ vòng trước ngoi lên
      const [p1, p2] = r === 0 ? firstRoundPairs[m] : [null, null];
      
      // NỐI MŨI TÊN: Trận hiện tại -> Trận vòng sau
      // Trận cuối cùng (Chung kết) không có đường đi tiếp (null)
      const nextMatchId =
        r === roundCount - 1 ? null : matchIdMatrix[r + 1][Math.floor(m / 2)];
      // Xác định ngồi ghế trên hay ghế dưới: Trận chẵn (0,2,4) -> ghế 1, Trận lẻ (1,3,5) -> ghế 2
      const nextSlot = r === roundCount - 1 ? null : (m % 2) + 1;

      // Xác định trạng thái ban đầu của trận
      let status = "Scheduled"; // Mặc định: Đã lên lịch (chưa đủ người)
      let winner_id = null;
      let loser_id = null;
      let result = "";
      let finished_at = null;

      if (p1 && p2) {
        // Nếu CẢ 2 NGƯỜI đều có mặt -> Trận sẵn sàng đánh luôn
        status = "Ready";
      } else if (p1 || p2) {
        // Nếu CHỈ CÓ 1 NGƯỜI (người kia trống do BYE) -> Tự động chốt thắng ngay
        status = "Finished";
        winner_id = p1 || p2;
        result = "BYE";
        finished_at = new Date();
      }

      // Đặt tên hiển thị cho trận đấu
      const isFinal = r === roundCount - 1;
      const isSemi = r === roundCount - 2 && roundCount > 1;
      const match_name = isFinal
        ? "Chung kết"
        : isSemi
          ? `Bán kết ${m + 1}`
          : `Vòng ${r + 1} - Trận ${m + 1}`;

      // Tạo document trận đấu hoàn chỉnh
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
        race_to: tournament?.generation_config?.race_to || 7, // Mặc định chạm 7 nếu không cấu hình
        group_key: null, // Knockout không có bảng (group)
        bracket_side: null, // Knockout không chia nhánh Thắng/Thua
        next_match_id: nextMatchId,
        next_slot: nextSlot,
        winner_next_match_id: nextMatchId,
        winner_next_slot: nextSlot,
        loser_next_match_id: null, // Knockout: Thua là bị loại, không có đường rớt đài
        loser_next_slot: null,
        match_format: "Knockout",
        status,
        finished_at,
        locked_by_owner: true,
      });
    }
  }

  // 9. Lưu tất cả Vòng Đấu và Trận Đấu vào MongoDB cùng lúc
  await TournamentRound.insertMany(roundDocs);
  if (matchDocs.length) {
    await RoundMatch.insertMany(matchDocs);
  }

  // 10. Kích hoạt Engine tự động cho các trận BYE đã Finished ở Vòng 1
  //     Đẩy người thắng BYE đi tiếp vào vòng trong
  const byeMatches = await RoundMatch.find({
    tournament_id: tournament._id,
    status: "Finished",
    result: "BYE",
  });
  for (const bye of byeMatches) {
    await propagateMatchOutcomes(bye);
  }
  // Quét rà lại xem có trận nào bị kẹt do dây chuyền BYE không
  await resolvePendingAutoAdvances(tournament._id);

  // 11. Đánh dấu giải đấu là ĐÃ TẠO NHÁNH ĐẤU
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

// ============================================================================
// HÀM PRIVATE: generateDoubleEliminationBracket
// Kiến trúc sư Nhánh Kép: Tạo cấu trúc nhánh đấu cho thể thức Double Elimination.
// Cơ thủ thua ở nhánh Thắng (Winners) sẽ rơi xuống nhánh Thua (Losers).
// Chỉ khi thua ở nhánh Thua mới bị loại thật sự. Bao gồm 3 phần:
// Nhánh Thắng (Winners) -> Nhánh Thua (Losers) -> Chung Kết (Grand Final).
// ============================================================================
const generateDoubleEliminationBracket = async (tournament) => {
  // 1. Lấy danh sách cơ thủ đã duyệt
  const approvedPlayers = await fetchApprovedPlayers(tournament._id);
  if (approvedPlayers.length < 2) {
    throw new Error("Cần ít nhất 2 người chơi để tạo nhánh đấu");
  }

  // 2. Xóa nhánh cũ, xáo trộn, tính bracket size
  await clearBracket(tournament._id);
  const playerIds = shuffleArray(
    approvedPlayers.map((p) => p.account_id?._id || p.account_id),
  );
  const bracketSize = nextPowerOfTwo(playerIds.length);
  const roundCount = Math.log2(bracketSize);
  const firstRoundPairs = buildFirstRoundPairs(playerIds, bracketSize);

  // 3. TRƯỜNG HỢP ĐẶC BIỆT: Chỉ có 2 người (roundCount = 1)
  //    Không cần nhánh Thắng/Thua, tạo thẳng 1 trận Chung Kết duy nhất
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

    // Tạo trận Chung Kết duy nhất (không có mũi tên đi tiếp)
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

    // Đánh dấu đã tạo nhánh
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

  // 4. Tính số Vòng nhánh Thua: Công thức = 2 * (roundCount - 1)
  //    VD: 8 người (roundCount=3) -> losersRoundCount = 4
  const losersRoundCount = Math.max(0, 2 * (roundCount - 1));
  const winnersRoundDocs = [];
  const losersRoundDocs = [];

  // 5. Tạo Vòng Đấu cho Nhánh Thắng (Winners Rounds)
  for (let i = 1; i <= roundCount; i += 1) {
    winnersRoundDocs.push({
      _id: new mongoose.Types.ObjectId(),
      tournament_id: tournament._id,
      round_number: i,
      round_type: "DoubleElimination",
      bracket_side: "Winners", // Đánh dấu thuộc nhánh Thắng
      status: "Pending",
      order: i,
    });
  }

  // 6. Tạo Vòng Đấu cho Nhánh Thua (Losers Rounds)
  for (let i = 1; i <= losersRoundCount; i += 1) {
    losersRoundDocs.push({
      _id: new mongoose.Types.ObjectId(),
      tournament_id: tournament._id,
      round_number: i,
      round_type: "DoubleElimination",
      bracket_side: "Losers", // Đánh dấu thuộc nhánh Thua
      status: "Pending",
      order: roundCount + i, // Xếp thứ tự sau nhánh Thắng
    });
  }

  // 7. Tạo Vòng Chung Kết (Grand Final Round) - trận cuối cùng
  const grandFinalRound = {
    _id: new mongoose.Types.ObjectId(),
    tournament_id: tournament._id,
    round_number: 1,
    round_type: "DoubleElimination",
    bracket_side: "GrandFinal",
    status: "Pending",
    order: roundCount + losersRoundCount + 1, // Xếp cuối cùng
  };

  // 8. Tạo Ma trận ID cho trận Nhánh Thắng (giống Knockout)
  const winnersMatchIds = [];
  for (let r = 0; r < roundCount; r += 1) {
    const matchCount = bracketSize / Math.pow(2, r + 1);
    winnersMatchIds[r] = Array.from(
      { length: matchCount },
      () => new mongoose.Types.ObjectId(),
    );
  }

  // 9. Hàm tính số trận ở mỗi vòng nhánh Thua (công thức phức tạp hơn Knockout)
  const getLosersMatchCount = (roundNumber) =>
    bracketSize / Math.pow(2, Math.floor((roundNumber + 1) / 2) + 1);

  // 10. Tạo Ma trận ID cho trận Nhánh Thua
  const losersMatchIds = [];
  for (let l = 0; l < losersRoundCount; l += 1) {
    const matchCount = getLosersMatchCount(l + 1);
    losersMatchIds[l] = Array.from(
      { length: matchCount },
      () => new mongoose.Types.ObjectId(),
    );
  }

  // 11. Tạo ID cho trận Chung Kết
  const grandFinalId = new mongoose.Types.ObjectId();
  const matchDocs = [];

  // 12. DỰNG NHÁNH THẮNG (Winners Bracket) - Nối mũi tên Thắng/Thua
  for (let r = 0; r < roundCount; r += 1) {
    const matchCount = winnersMatchIds[r].length;
    for (let m = 0; m < matchCount; m += 1) {
      const [p1, p2] = r === 0 ? firstRoundPairs[m] : [null, null];
      
      // Mũi tên THẮNG: Đi lên vòng tiếp theo của Nhánh Thắng (hoặc Chung Kết)
      const winnerNextMatchId =
        r === roundCount - 1
          ? grandFinalId // Vòng cuối nhánh Thắng -> Đi thẳng vào Chung Kết (Ghế 1)
          : winnersMatchIds[r + 1][Math.floor(m / 2)];
      const winnerNextSlot = r === roundCount - 1 ? 1 : (m % 2) + 1;

      // Mũi tên THUA: Rớt xuống Nhánh Thua (Logic phức tạp nhất!)
      let loserNextMatchId = null;
      let loserNextSlot = null;
      if (r === 0) {
        // Vòng 1 nhánh Thắng: Người thua rớt xuống Vòng 1 nhánh Thua
        loserNextMatchId = losersMatchIds[0]?.[Math.floor(m / 2)] || null;
        loserNextSlot = loserNextMatchId ? (m % 2) + 1 : null;
      } else if (r < roundCount - 1) {
        // Các vòng giữa: Rớt vào vòng lẻ nhánh Thua (cross-feeding)
        loserNextMatchId = losersMatchIds[2 * r - 1]?.[m] || null;
        loserNextSlot = loserNextMatchId ? 2 : null; // Luôn ngồi ghế 2
      } else {
        // Vòng cuối nhánh Thắng: Rớt vào vòng cuối nhánh Thua
        loserNextMatchId = losersMatchIds[losersRoundCount - 1]?.[0] || null;
        loserNextSlot = loserNextMatchId ? 2 : null;
      }

      // Xác định trạng thái ban đầu (giống Knockout)
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
        loser_next_match_id: loserNextMatchId, // Đường rớt đài cho người thua
        loser_next_slot: loserNextSlot,
        match_format: "DoubleElimination",
        status,
        finished_at,
        locked_by_owner: true,
      });
    }
  }

  // 13. DỰNG NHÁNH THUA (Losers Bracket) - Nối mũi tên đi tiếp trong nhánh Thua
  for (let l = 0; l < losersRoundCount; l += 1) {
    const matchCount = losersMatchIds[l].length;
    for (let m = 0; m < matchCount; m += 1) {
      let winnerNextMatchId = null;
      let winnerNextSlot = null;

      if (l === losersRoundCount - 1) {
        // Vòng cuối nhánh Thua: Người thắng đi lên Chung Kết (Ghế 2)
        winnerNextMatchId = grandFinalId;
        winnerNextSlot = 2;
      } else if (l % 2 === 0) {
        // Vòng chẵn nhánh Thua: Đi tiếp vào vòng kế (cùng index)
        winnerNextMatchId = losersMatchIds[l + 1]?.[m] || null;
        winnerNextSlot = winnerNextMatchId ? 1 : null;
      } else {
        // Vòng lẻ nhánh Thua: Đi tiếp vào vòng kế (gộp 2 trận thành 1)
        winnerNextMatchId = losersMatchIds[l + 1]?.[Math.floor(m / 2)] || null;
        winnerNextSlot = winnerNextMatchId ? (m % 2) + 1 : null;
      }

      matchDocs.push({
        _id: losersMatchIds[l][m],
        tournament_id: tournament._id,
        round_id: losersRoundDocs[l]._id,
        match_no: m + 1,
        player1_id: null, // Nhánh Thua ban đầu để trống, chờ người rớt từ nhánh Thắng xuống
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
        loser_next_match_id: null, // Thua ở nhánh Thua = Bị loại, không có đường đi tiếp
        loser_next_slot: null,
        match_format: "DoubleElimination",
        status: "Scheduled",
        finished_at: null,
        locked_by_owner: true,
      });
    }
  }

  // 14. DỰNG TRẬN CHUNG KẾT (Grand Final)
  // Ghế 1: Người thắng nhánh Thắng. Ghế 2: Người thắng nhánh Thua.
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
    next_match_id: null, // Trận cuối cùng, không có đường đi tiếp
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

  // 15. Lưu tất cả Vòng Đấu (3 nhóm: Winners, Losers, GrandFinal) và Trận Đấu vào DB
  await TournamentRound.insertMany([
    ...winnersRoundDocs,
    ...losersRoundDocs,
    grandFinalRound,
  ]);
  await RoundMatch.insertMany(matchDocs);

  // 16. Kích hoạt Engine cho các trận BYE (giống Knockout)
  const byeMatches = await RoundMatch.find({
    tournament_id: tournament._id,
    status: "Finished",
    result: "BYE",
  });
  for (const bye of byeMatches) {
    await propagateMatchOutcomes(bye);
  }
  await resolvePendingAutoAdvances(tournament._id);

  // 17. Đánh dấu giải đấu đã tạo nhánh
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

// ============================================================================
// HÀM PRIVATE: generateRoundRobinBracket
// Kiến trúc sư Bảng Vòng Tròn: Mỗi cơ thủ trong cùng bảng sẽ đánh với tất cả
// người còn lại. Không có loại trực tiếp, chỉ tính điểm để xếp hạng.
// Input: tournament, groupSizeInput (số người mỗi bảng, mặc định 4)
// ============================================================================
const generateRoundRobinBracket = async (tournament, groupSizeInput) => {
  // 1. Lấy cơ thủ đã duyệt
  const approvedPlayers = await fetchApprovedPlayers(tournament._id);
  if (approvedPlayers.length < 2) {
    throw new Error("Cần ít nhất 2 người chơi đã duyệt để tạo bảng đấu");
  }

  // 2. Xóa bảng cũ
  await clearBracket(tournament._id);

  // 3. Xáo trộn ngẫu nhiên và chia bảng
  const groupSize = Number(groupSizeInput) > 1 ? Number(groupSizeInput) : 4;
  const shuffled = shuffleArray(
    approvedPlayers.map((p) => p.account_id?._id || p.account_id),
  );

  // Chia cơ thủ thành các bảng (group), mỗi bảng tối đa groupSize người
  // VD: 8 người, groupSize=4 -> 2 bảng (A, B), mỗi bảng 4 người
  const groups = [];
  for (let i = 0; i < shuffled.length; i += groupSize) {
    groups.push(shuffled.slice(i, i + groupSize));
  }
  if (groups.length === 0) groups.push(shuffled);

  const roundDocs = [];
  const matchDocs = [];
  let order = 1;

  // 4. Duyệt từng bảng để tạo Vòng Đấu và ghép cặp Trận Đấu
  groups.forEach((groupPlayers, groupIdx) => {
    // Tên bảng: A, B, C... (dùng mã ASCII 65='A', 66='B'...)
    const groupKey = String.fromCharCode(65 + groupIdx);
    
    // Tạo Vòng đấu cho bảng này
    const roundId = new mongoose.Types.ObjectId();
    roundDocs.push({
      _id: roundId,
      tournament_id: tournament._id,
      round_number: 1,
      round_type: "RoundRobin",
      group_key: groupKey, // Gán tên bảng (A, B, C...)
      status: "Pending",
      order: order,
    });
    order += 1;

    // 5. Ghép cặp: Mỗi người đánh với tất cả người còn lại (Tổ hợp C(n,2))
    // VD: 4 người -> 6 trận. 5 người -> 10 trận.
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
          bracket_side: null, // Vòng tròn không có nhánh
          next_match_id: null, // Vòng tròn không có mũi tên đi tiếp
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

  // 6. Lưu tất cả vào MongoDB
  await TournamentRound.insertMany(roundDocs);
  if (matchDocs.length) {
    await RoundMatch.insertMany(matchDocs);
  }

  // 7. Đánh dấu giải đấu đã tạo bảng đấu
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

// ============================================================================
// HÀM HELPER: updateRoundStatusAndProgression
// Cập nhật trạng thái Vòng Đấu: Gọi lại hàm syncRoundStatuses sau khi có trận kết thúc.
// ============================================================================
const updateRoundStatusAndProgression = async (tournamentId, roundId) => {
  const round = await TournamentRound.findById(roundId).lean();
  if (!round) return;
  // Đồng bộ lại trạng thái tất cả vòng đấu
  await syncRoundStatusesForStartedTournament(tournamentId);
};

// ============================================================================
// HÀM PUBLIC: getTournamentPlayers
// Lấy danh sách cơ thủ đã đăng ký giải đấu (dùng cho Owner, Staff và Public).
// ============================================================================
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

// ============================================================================
// HÀM PUBLIC: createTournament
// Owner tạo giải đấu mới cho CLB. Validate quyền sở hữu, gói Pro, giải thưởng.
// ============================================================================
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

// ============================================================================
// HÀM PUBLIC: getTournamentsByClub
// Lấy danh sách tất cả giải đấu của 1 CLB (dùng cho Owner/Staff xem quản lý).
// ============================================================================
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

// ============================================================================
// HÀM PUBLIC: getPublicTournaments
// Lấy danh sách giải đấu công khai (loại trừ Draft, chỉ từ CLB đã hoàn tất onboarding).
// ============================================================================
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

// ============================================================================
// HÀM PUBLIC: getTournamentById
// Lấy thông tin chi tiết 1 giải đấu theo ID.
// ============================================================================
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

// ============================================================================
// HÀM PUBLIC: getMyRegisteredTournamentIds
// Lấy danh sách ID giải đấu mà người dùng hiện tại đã đăng ký (Approved).
// ============================================================================
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

// ============================================================================
// HÀM PUBLIC: openTournamentRegistration
// Owner/Staff mở đăng ký giải đấu: Chuyển trạng thái giải từ Draft/Closed -> Open.
// ============================================================================
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

// ============================================================================
// HÀM PUBLIC: closeTournamentRegistration
// Owner/Staff chốt đăng ký: Đóng đăng ký và (tùy chọn) tự động tạo nhánh đấu.
// ============================================================================
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

// ============================================================================
// HÀM PUBLIC: updateTournament
// Owner cập nhật thông tin giải đấu (tên, mô tả, ngày, giải thưởng, banner...).
// ============================================================================
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

// ============================================================================
// HÀM PUBLIC: deleteTournament
// Owner xóa giải đấu. Kiểm tra quyền sở hữu và gói Pro.
// ============================================================================
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

// ============================================================================
// HÀM PUBLIC: generateTournamentBracket
// Owner/Staff tạo nhánh/bảng đấu thủ công. Gọi vào hàm Private tương ứng
// (generateKnockoutBracket / generateDoubleEliminationBracket / generateRoundRobinBracket).
// ============================================================================
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

// ============================================================================
// HÀM PUBLIC: startTournament
// Owner/Staff bắt đầu giải đấu: Chuyển trạng thái sang InProgress,
// kích hoạt Vòng 1 và đồng bộ trạng thái các vòng đấu.
// ============================================================================
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

// ============================================================================
// HÀM PUBLIC: getTournamentBracket
// Lấy nhánh đấu (bracket) + danh sách trận theo vòng. Dùng cho Frontend hiển thị sơ đồ.
// ============================================================================
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

// ============================================================================
// HÀM PUBLIC: getTournamentMatches
// Staff lấy danh sách trận để vận hành (có thể lọc theo status hoặc round_number).
// ============================================================================
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
// ============================================================================
// HÀM PUBLIC: startRoundMatch
// Giao diện Staff (Frontend) gọi hàm này khi bấm nút "Bắt Đầu" một trận đấu.
// Nhiệm vụ: Gán bàn bida (table_id) cho trận đấu, khóa bàn đó lại (tạo Booking) 
// và đổi trạng thái trận sang "Playing" (Đang diễn ra).
// ============================================================================
const startRoundMatch = async (req, res) => {
  try {
    const { id, matchId } = req.params; // Lấy ID giải và ID trận
    const { table_id, scheduled_at, race_to } = req.body || {}; // Dữ liệu Staff truyền lên

    // 1. Kiểm tra tính hợp lệ của Giải Đấu
    const tournament = await Tournament.findById(id)
      .select("status format")
      .lean();
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }
    // Không thể bắt đầu trận nếu Giải chưa InProgress
    if (tournament.status !== "InProgress") {
      return res.status(400).json({
        success: false,
        message: "Giải đấu chưa ở trạng thái đang diễn ra",
      });
    }

    // 2. Kiểm tra tính hợp lệ của Trận Đấu
    const match = await RoundMatch.findOne({ _id: matchId, tournament_id: id });
    if (!match) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy trận đấu" });
    }
    // Phải có đủ mặt 2 cơ thủ mới được đánh
    if (!match.player1_id || !match.player2_id) {
      return res
        .status(400)
        .json({ success: false, message: "Chưa đủ người chơi cho trận đấu" });
    }
    // Trận đánh xong rồi thì không được bắt đầu lại
    if (match.status === "Finished") {
      return res
        .status(400)
        .json({ success: false, message: "Trận đấu đã kết thúc" });
    }

    // 3. Cập nhật dữ liệu Trận Đấu
    match.table_id = table_id || match.table_id;
    if (race_to) match.race_to = Number(race_to); // Cập nhật chạm (nếu có)
    match.scheduled_at = scheduled_at
      ? new Date(scheduled_at)
      : match.scheduled_at || new Date();
    match.started_at = new Date(); // Chốt giờ bắt đầu thực tế
    match.status = "Playing"; // Cập nhật trạng thái
    await match.save();

    // 4. Cập nhật vòng đấu tương ứng thành InProgress
    await TournamentRound.findByIdAndUpdate(match.round_id, {
      status: "InProgress",
    });

    // 5. Tích hợp Hệ thống Booking (Khóa bàn bida)
    if (match.table_id) {
      // Check xem bàn bida này có khách lẻ nào đang chơi không?
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

      // Khởi tạo ngày hiện tại (chuẩn giờ VN) để booking
      const todayStr = new Date().toLocaleString("en-US", {
        timeZone: "Asia/Ho_Chi_Minh",
      });
      const localToday = new Date(todayStr);
      localToday.setHours(0, 0, 0, 0);

      // Tạo một Booking mới giả lập cho giải đấu để khóa bàn lại, không tính tiền giờ
      await Booking.create({
        guest_name: `Trận giải đấu: ${match.match_name}`, // Ghi chú tên khách là tên trận
        table_id: match.table_id,
        play_date: localToday,
        start_time: new Date().toTimeString().slice(0, 5),
        end_time: "23:59", // Đặt lịch tới cuối ngày để chặn khách ngoài
        code_number: `TOUR_${match._id.toString().slice(-6)}_${Date.now().toString().slice(-4)}`,
        deposit: 0, // Giải đấu không thu cọc
        hour_price: 0, // Không tính tiền giờ
        status: "Playing", // Khóa bàn ngay lập tức
        note: `TournamentMatch:${match._id}`, // Để lúc kết thúc biết đường tìm mà tắt bàn
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

// ============================================================================
// HÀM PUBLIC: updateMatchResult
// Tâm điểm bùng nổ: Nơi Staff chốt tỷ số trận đấu.
// Hàm này cực kỳ quan trọng vì nó làm "ngòi nổ" kích hoạt toàn bộ Engine Tự Động 
// ở bên trên (Đẩy người, Tính điểm, Rớt nhánh, Kết thúc giải...).
// ============================================================================
const updateMatchResult = async (req, res) => {
  try {
    const { id, matchId } = req.params;
    const { player1_score, player2_score, winner_id, race_to } = req.body || {};

    // 1. Kiểm tra tính hợp lệ cơ bản
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

    // 2. Validate luật Bida: Điểm số không được vượt quá số điểm Chạm (Race To)
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
    
    // Đảm bảo phải có mặt đủ 2 người mới được chốt điểm (Thắng vắng mặt tính là chức năng khác)
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

    // 3. Phân xử Thắng/Thua
    // Lấy winner_id từ Frontend truyền lên, nếu không có thì tự so sánh điểm
    const declaredWinner =
      winner_id || (p1Score > p2Score ? match.player1_id : match.player2_id);
      
    if (!declaredWinner) {
      return res
        .status(400)
        .json({ success: false, message: "Cần chọn người thắng" });
    }
    
    const declaredWinnerStr = String(declaredWinner);
    // Kiểm tra xem ID người thắng có thực sự là 1 trong 2 người đang ngồi trên bàn không
    if (
      ![match.player1_id?.toString(), match.player2_id?.toString()].includes(
        declaredWinnerStr,
      )
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Người thắng không khớp người chơi" });
    }
    // Giải bida không có kết quả hòa
    if (p1Score === p2Score) {
      return res
        .status(400)
        .json({ success: false, message: "Không hỗ trợ kết quả hòa" });
    }

    // Xác định ai là người Thua
    const loserId =
      declaredWinnerStr === String(match.player1_id)
        ? match.player2_id
        : match.player1_id;

    // 4. Cập nhật và chốt Trận Đấu
    match.player1_score = p1Score;
    match.player2_score = p2Score;
    if (race_to) match.race_to = Number(race_to);
    match.winner_id = declaredWinner;
    match.loser_id = loserId;
    match.result = `${p1Score} - ${p2Score}`; // Ghi chú kết quả tỷ số
    match.finished_at = new Date();
    match.status = "Finished";
    await match.save();

    // 5. Tắt Booking bàn bida: Giải phóng bàn trả lại cho hệ thống quán
    if (match.table_id) {
      await Booking.updateMany(
        { note: `TournamentMatch:${match._id}`, status: "Playing" },
        {
          status: "Completed",
          end_time: new Date().toTimeString().slice(0, 5),
        },
      );
    }

    // 6. LIÊN HOÀN KÍCH HOẠT ENGINE TỰ ĐỘNG (Phần quan trọng nhất)
    const round = await TournamentRound.findById(match.round_id).lean();

    // Kích hoạt Engine Knockout
    if (match.match_format === "Knockout") {
      if (loserId) {
        // Đánh dấu người thua là Bị Loại vĩnh viễn
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
      // Gọi "Máy Bơm" đẩy người đi tiếp
      await propagateMatchOutcomes(match);
    }

    // Kích hoạt Engine Round Robin
    if (match.match_format === "RoundRobin") {
      // Không ai bị loại sau 1 trận, cứ để đó cho hàm tính điểm lo
    }

    // Kích hoạt Engine Double Elimination (Kép)
    if (match.match_format === "DoubleElimination") {
      // Chỉ khi thua ở Nhánh Thua (Losers) mới bị loại thật sự
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
      // Đẩy người đi tiếp vào các trận trong nhánh
      await propagateMatchOutcomes(match);
      // Gọi "Trình cứu hộ" rà quét xem có ai được Thắng Tự Động do trống ghế không
      await resolvePendingAutoAdvances(id);
    }

    // 7. Đồng bộ Vòng Đấu và check Chung Kết
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

// ============================================================================
// HÀM PUBLIC: getRoundRobinLeaderboard
// Lấy bảng xếp hạng thể thức Vòng Tròn (RoundRobin) của giải đấu.
// ============================================================================
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

// ============================================================================
// HÀM PUBLIC: createTournamentPayOSPayment
// Tạo link thanh toán PayOS cho cơ thủ đăng ký giải đấu có thu phí.
// ============================================================================
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
    const description = `Phi tham gia ${String(tournament.name || "giai dau")}`.slice(0, 25);
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

// ============================================================================
// HÀM PUBLIC: verifyTournamentPayOSPayment
// Xác minh thanh toán PayOS từ Frontend return flow (người dùng quay lại sau khi thanh toán).
// ============================================================================
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

// ============================================================================
// HÀM PUBLIC: tournamentPayOSWebhook
// Webhook PayOS: Nhận thông báo từ PayOS khi thanh toán thành công, tự động duyệt đăng ký.
// ============================================================================
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

// ============================================================================
// HÀM PUBLIC: getMyTournaments
// Lấy danh sách giải đấu mà người dùng hiện tại đã đăng ký tham gia.
// ============================================================================
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

// ============================================================================
// HÀM PUBLIC: cancelTournament
// Owner hủy giải đấu: Chuyển trạng thái giải và tất cả cơ thủ sang "Cancelled".
// ============================================================================
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
