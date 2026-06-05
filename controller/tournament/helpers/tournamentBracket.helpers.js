// Dùng mongoose để tự tạo ObjectId trước khi insert round/match, nhờ vậy ta có thể nối match này sang match sau ngay lúc build bracket.
const mongoose = require("mongoose");
// Model giải đấu, dùng để cập nhật trạng thái đã tạo nhánh và format sau khi sinh bracket.
const Tournament = require("../../../models/tournament.model");
// Model từng vòng đấu của giải: vòng 1, bán kết, chung kết, nhánh thắng, nhánh thua...
const TournamentRound = require("../../../models/tournament_round.model");
// Model từng trận đấu trong mỗi vòng.
const RoundMatch = require("../../../models/round_match.model");
// Lấy danh sách người chơi đã được duyệt/đã thanh toán hợp lệ để đưa vào bracket.
const { fetchApprovedPlayers } = require("./tournamentPlayer.helpers");
// Các helper này dùng để tự đẩy người thắng BYE sang vòng tiếp theo và xử lý match auto-ready.
const {
  propagateMatchOutcomes,
  resolvePendingAutoAdvances,
} = require("./tournamentProgression.helpers");

// Xáo trộn mảng người chơi để seed ngẫu nhiên trước khi xếp cặp.
const shuffleArray = (input) => {
  // Copy mảng để không làm thay đổi mảng gốc truyền vào.
  const arr = [...input];
  // Fisher-Yates shuffle: đi từ cuối mảng về đầu mảng.
  for (let i = arr.length - 1; i > 0; i -= 1) {
    // Chọn một vị trí ngẫu nhiên từ 0 đến i.
    const j = Math.floor(Math.random() * (i + 1));
    // Đổi chỗ phần tử hiện tại với phần tử ngẫu nhiên.
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  // Trả về mảng đã được xáo trộn.
  return arr;
};

// Tính kích thước bracket theo lũy thừa của 2: 3 người -> 4 slot, 5 người -> 8 slot.
const nextPowerOfTwo = (n) => {
  // Bracket tối thiểu phải có 2 slot để tạo được 1 trận.
  if (n < 2) return 2;
  // Bắt đầu từ 1 rồi nhân đôi dần.
  let p = 1;
  // Dịch bit trái tương đương nhân đôi cho tới khi đủ chứa số người chơi.
  while (p < n) p <<= 1;
  // Trả về bracket size cuối cùng.
  return p;
};

// Xóa toàn bộ round/match cũ của giải trước khi tạo lại bracket.
const clearBracket = async (tournamentId) => {
  // Xóa song song để tránh còn dữ liệu nhánh cũ làm lệch bracket mới.
  await Promise.all([
    RoundMatch.deleteMany({ tournament_id: tournamentId }),
    TournamentRound.deleteMany({ tournament_id: tournamentId }),
  ]);
};

// Tạo các cặp vòng đầu tiên, tự chèn BYE nếu số người chơi không đủ bracket size.
const buildFirstRoundPairs = (playerIds, bracketSize) => {
  // Copy danh sách player để shift dần mà không đụng mảng gốc.
  const players = [...playerIds];
  // Số trận vòng đầu bằng một nửa bracket size.
  const matchCount = bracketSize / 2;
  // Mỗi phần tử pairs là [player1, player2], player null nghĩa là BYE/chưa có người.
  const pairs = [];

  // Duyệt từng trận vòng đầu để xếp người chơi vào.
  for (let i = 0; i < matchCount; i += 1) {
    // Số người chơi còn lại chưa được xếp.
    const remainingPlayers = players.length;
    // Số trận còn lại cần lấp.
    const remainingMatches = matchCount - i;

    // Không còn người chơi thì trận này để trống cả hai slot.
    if (remainingPlayers <= 0) {
      pairs.push([null, null]);
      continue;
    }

    // Nếu số người còn lại ít hơn hoặc bằng số trận còn lại, mỗi trận chỉ lấy 1 người để tạo BYE công bằng.
    if (remainingPlayers <= remainingMatches) {
      pairs.push([players.shift() || null, null]);
      continue;
    }

    // Bình thường thì lấy 2 người cho một trận.
    pairs.push([players.shift() || null, players.shift() || null]);
  }

  // Trả về danh sách cặp vòng đầu.
  return pairs;
};

// Sinh bracket loại trực tiếp: thua là bị loại, winner đi tiếp tới trận kế.
const generateKnockoutBracket = async (tournament) => {
  // Lấy người chơi đủ điều kiện tham gia giải.
  const approvedPlayers = await fetchApprovedPlayers(tournament._id);
  // Ít nhất cần 2 người để có một trận đấu.
  if (approvedPlayers.length < 2) {
    throw new Error("Cần ít nhất 2 người chơi để tạo nhánh đấu");
  }

  // Xóa dữ liệu bracket cũ trước khi sinh lại.
  await clearBracket(tournament._id);

  // Lấy account_id của từng player rồi xáo trộn để seed ngẫu nhiên.
  const playerIds = shuffleArray(
    approvedPlayers.map((p) => p.account_id?._id || p.account_id),
  );
  // Làm tròn số slot bracket lên lũy thừa của 2.
  const bracketSize = nextPowerOfTwo(playerIds.length);
  // Tạo cặp đấu vòng đầu, có thể có BYE.
  const firstRoundPairs = buildFirstRoundPairs(playerIds, bracketSize);

  // Số vòng knockout bằng log2(bracketSize): 8 slot -> 3 vòng.
  const roundCount = Math.log2(bracketSize);
  // Danh sách document round sẽ insert vào TournamentRound.
  const roundDocs = [];
  // Tạo lần lượt vòng 1, vòng 2, ..., chung kết.
  for (let i = 1; i <= roundCount; i += 1) {
    roundDocs.push({
      // Tạo sẵn _id để match có thể trỏ tới round này trước khi insert DB.
      _id: new mongoose.Types.ObjectId(),
      // Gắn round vào đúng giải.
      tournament_id: tournament._id,
      // Số thứ tự vòng.
      round_number: i,
      // Loại vòng là Knockout.
      round_type: "Knockout",
      // Round ban đầu chờ giải bắt đầu.
      status: "Pending",
      // order dùng để sort hiển thị round đúng thứ tự.
      order: i,
    });
  }

  // Ma trận ID trận: matchIdMatrix[roundIndex][matchIndex].
  const matchIdMatrix = [];
  // Tạo sẵn ID cho tất cả trận ở tất cả vòng để biết winner sẽ đi tới trận nào.
  for (let r = 0; r < roundCount; r += 1) {
    // Mỗi vòng sau giảm một nửa số trận.
    const matchCount = bracketSize / Math.pow(2, r + 1);
    matchIdMatrix[r] = [];
    for (let m = 0; m < matchCount; m += 1) {
      // Tạo ObjectId cho từng trận.
      matchIdMatrix[r].push(new mongoose.Types.ObjectId());
    }
  }

  // Danh sách match sẽ insert vào RoundMatch.
  const matchDocs = [];
  // Duyệt từng vòng để tạo trận.
  for (let r = 0; r < roundCount; r += 1) {
    // Số trận của vòng hiện tại.
    const matchCount = bracketSize / Math.pow(2, r + 1);
    // Duyệt từng trận trong vòng.
    for (let m = 0; m < matchCount; m += 1) {
      // Vòng đầu có player thật, các vòng sau để null chờ winner được propagate.
      const [p1, p2] = r === 0 ? firstRoundPairs[m] : [null, null];
      // Nếu chưa phải chung kết, winner đi tới trận ở vòng sau.
      const nextMatchId =
        r === roundCount - 1 ? null : matchIdMatrix[r + 1][Math.floor(m / 2)];
      // Slot winner vào trận sau: trận chẵn vào slot 1, trận lẻ vào slot 2.
      const nextSlot = r === roundCount - 1 ? null : (m % 2) + 1;

      // Mặc định trận chưa đủ người là Scheduled.
      let status = "Scheduled";
      // Chưa có winner ở thời điểm sinh bracket.
      let winner_id = null;
      // Knockout không cần loser route, nhưng vẫn lưu loser_id khi có kết quả sau này.
      let loser_id = null;
      // result rỗng nếu trận chưa có kết quả.
      let result = "";
      // finished_at chỉ có khi trận đã auto kết thúc BYE.
      let finished_at = null;

      // Có đủ 2 player thì trận sẵn sàng thi đấu.
      if (p1 && p2) {
        status = "Ready";
      // Chỉ có 1 player thì player đó thắng BYE.
      } else if (p1 || p2) {
        status = "Finished";
        winner_id = p1 || p2;
        result = "BYE";
        finished_at = new Date();
      }

      // Kiểm tra đây có phải chung kết không.
      const isFinal = r === roundCount - 1;
      // Kiểm tra đây có phải bán kết không.
      const isSemi = r === roundCount - 2 && roundCount > 1;
      // Đặt tên trận để frontend hiển thị dễ hiểu.
      const match_name = isFinal
        ? "Chung kết"
        : isSemi
          ? `Bán kết ${m + 1}`
          : `Vòng ${r + 1} - Trận ${m + 1}`;

      // Tạo document match cho trận hiện tại.
      matchDocs.push({
        // Dùng ID đã tạo sẵn trong ma trận để các trận khác có thể trỏ tới.
        _id: matchIdMatrix[r][m],
        // Gắn match vào giải.
        tournament_id: tournament._id,
        // Gắn match vào round hiện tại.
        round_id: roundDocs[r]._id,
        // Số thứ tự trận trong round.
        match_no: m + 1,
        // Người chơi slot 1.
        player1_id: p1,
        // Người chơi slot 2.
        player2_id: p2,
        // Winner nếu đã BYE, còn lại null.
        winner_id,
        // Loser ban đầu null.
        loser_id,
        // Điểm ban đầu của player 1.
        player1_score: 0,
        // Điểm ban đầu của player 2.
        player2_score: 0,
        // Tên trận.
        match_name,
        // Kết quả text, ví dụ BYE.
        result,
        // Race to lấy từ config, mặc định 7.
        race_to: tournament?.generation_config?.race_to || 7,
        // Knockout không chia Winners/Losers nên để null.
        bracket_side: null,
        // Match tiếp theo mà winner sẽ đi tới.
        next_match_id: nextMatchId,
        // Slot trong match tiếp theo.
        next_slot: nextSlot,
        // Field rõ nghĩa cho winner route.
        winner_next_match_id: nextMatchId,
        // Slot của winner trong match sau.
        winner_next_slot: nextSlot,
        // Knockout không có nhánh thua.
        loser_next_match_id: null,
        // Knockout không có slot nhánh thua.
        loser_next_slot: null,
        // Format trận.
        match_format: "Knockout",
        // Trạng thái trận.
        status,
        // Thời điểm kết thúc nếu BYE.
        finished_at,
        // Khóa cấu trúc bracket để owner không tự sửa slot sau khi sinh.
        locked_by_owner: true,
      });
    }
  }

  // Lưu toàn bộ round vào DB.
  await TournamentRound.insertMany(roundDocs);
  // Nếu có match thì lưu toàn bộ match vào DB.
  if (matchDocs.length) {
    await RoundMatch.insertMany(matchDocs);
  }

  // Tìm các trận BYE đã auto Finished.
  const byeMatches = await RoundMatch.find({
    tournament_id: tournament._id,
    status: "Finished",
    result: "BYE",
  });
  // Đẩy winner của từng trận BYE sang trận kế tiếp.
  for (const bye of byeMatches) {
    await propagateMatchOutcomes(bye);
  }
  // Sau khi đẩy BYE, xử lý các trận nào đủ người thì chuyển trạng thái phù hợp.
  await resolvePendingAutoAdvances(tournament._id);

  // Đánh dấu giải đã có bracket.
  await Tournament.findByIdAndUpdate(tournament._id, {
    bracket_generated: true,
    bracket_generated_at: new Date(),
    // Nếu giải đang Draft thì sau khi tạo bracket chuyển sang Closed để khóa đăng ký.
    status: tournament.status === "Draft" ? "Closed" : tournament.status,
    generation_config: {
      // Giữ lại config cũ.
      ...(tournament.generation_config || {}),
      // Lưu format bracket vừa sinh.
      format: "Knockout",
    },
  });

  // Trả thông tin tóm tắt để controller trả về frontend.
  return { roundCount, bracketSize };
};

// Sinh bracket Double Elimination: thua nhánh thắng sẽ rơi xuống nhánh thua, thua ở nhánh thua mới bị loại.
const generateDoubleEliminationBracket = async (tournament) => {
  // Lấy danh sách người chơi đã được duyệt.
  const approvedPlayers = await fetchApprovedPlayers(tournament._id);
  // Ít nhất 2 người mới tạo được bracket.
  if (approvedPlayers.length < 2) {
    throw new Error("Cần ít nhất 2 người chơi để tạo nhánh đấu");
  }

  // Xóa bracket cũ trước khi tạo mới.
  await clearBracket(tournament._id);

  // Lấy account id của player rồi xáo trộn seed.
  const playerIds = shuffleArray(
    approvedPlayers.map((p) => p.account_id?._id || p.account_id),
  );
  // Bracket size luôn là lũy thừa của 2.
  const bracketSize = nextPowerOfTwo(playerIds.length);
  // Số vòng nhánh thắng.
  const roundCount = Math.log2(bracketSize);
  // Cặp vòng đầu của nhánh thắng.
  const firstRoundPairs = buildFirstRoundPairs(playerIds, bracketSize);

  // Trường hợp chỉ có 2 slot thì Double Elimination rút gọn thành một Grand Final.
  if (roundCount === 1) {
    // Tạo ID cho round chung kết.
    const roundId = new mongoose.Types.ObjectId();
    // Tạo round GrandFinal.
    await TournamentRound.create({
      _id: roundId,
      tournament_id: tournament._id,
      round_number: 1,
      round_type: "DoubleElimination",
      bracket_side: "GrandFinal",
      status: "Pending",
      order: 1,
    });

    // Lấy cặp duy nhất của vòng đầu.
    const [p1, p2] = firstRoundPairs[0];
    // Mặc định trận chưa sẵn sàng.
    let status = "Scheduled";
    // Winner ban đầu null.
    let winner_id = null;
    // Result ban đầu rỗng.
    let result = "";
    // finished_at ban đầu null.
    let finished_at = null;

    // Có đủ 2 player thì trận Ready.
    if (p1 && p2) {
      status = "Ready";
    // Có 1 player thì thắng BYE.
    } else if (p1 || p2) {
      status = "Finished";
      winner_id = p1 || p2;
      result = "BYE";
      finished_at = new Date();
    }

    // Tạo trận chung kết duy nhất.
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

    // Đánh dấu giải đã tạo bracket.
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

    // Trả về summary cho case rút gọn.
    return { roundCount: 1, bracketSize, losersRoundCount: 0 };
  }

  // Số vòng nhánh thua trong double elimination.
  const losersRoundCount = Math.max(0, 2 * (roundCount - 1));
  // Danh sách round nhánh thắng.
  const winnersRoundDocs = [];
  // Danh sách round nhánh thua.
  const losersRoundDocs = [];

  // Tạo round cho nhánh thắng.
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

  // Tạo round cho nhánh thua.
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

  // Tạo round chung kết tổng.
  const grandFinalRound = {
    _id: new mongoose.Types.ObjectId(),
    tournament_id: tournament._id,
    round_number: 1,
    round_type: "DoubleElimination",
    bracket_side: "GrandFinal",
    status: "Pending",
    order: roundCount + losersRoundCount + 1,
  };

  // Ma trận ID match của nhánh thắng.
  const winnersMatchIds = [];
  // Tạo sẵn ID cho từng match nhánh thắng.
  for (let r = 0; r < roundCount; r += 1) {
    const matchCount = bracketSize / Math.pow(2, r + 1);
    winnersMatchIds[r] = Array.from(
      { length: matchCount },
      () => new mongoose.Types.ObjectId(),
    );
  }

  // Tính số match ở mỗi vòng nhánh thua.
  const getLosersMatchCount = (roundNumber) =>
    bracketSize / Math.pow(2, Math.floor((roundNumber + 1) / 2) + 1);

  // Ma trận ID match của nhánh thua.
  const losersMatchIds = [];
  // Tạo sẵn ID cho từng match nhánh thua.
  for (let l = 0; l < losersRoundCount; l += 1) {
    const matchCount = getLosersMatchCount(l + 1);
    losersMatchIds[l] = Array.from(
      { length: matchCount },
      () => new mongoose.Types.ObjectId(),
    );
  }

  // ID của trận chung kết tổng.
  const grandFinalId = new mongoose.Types.ObjectId();
  // Tất cả match của Winners, Losers và GrandFinal sẽ được gom vào đây.
  const matchDocs = [];

  // Tạo các trận nhánh thắng.
  for (let r = 0; r < roundCount; r += 1) {
    // Số trận ở vòng nhánh thắng hiện tại.
    const matchCount = winnersMatchIds[r].length;
    // Duyệt từng trận của vòng.
    for (let m = 0; m < matchCount; m += 1) {
      // Vòng đầu có player, vòng sau chờ winner.
      const [p1, p2] = r === 0 ? firstRoundPairs[m] : [null, null];
      // Winner của trận nhánh thắng đi tới vòng thắng kế tiếp hoặc GrandFinal.
      const winnerNextMatchId =
        r === roundCount - 1
          ? grandFinalId
          : winnersMatchIds[r + 1][Math.floor(m / 2)];
      // Winner vào slot 1/2 ở match kế tiếp; nếu vào GrandFinal thì slot 1.
      const winnerNextSlot = r === roundCount - 1 ? 1 : (m % 2) + 1;

      // loserNextMatchId là nơi người thua rơi xuống nhánh thua.
      let loserNextMatchId = null;
      // loserNextSlot là slot của người thua trong match nhánh thua.
      let loserNextSlot = null;
      // Người thua vòng thắng đầu rơi vào vòng thua đầu tiên.
      if (r === 0) {
        loserNextMatchId = losersMatchIds[0]?.[Math.floor(m / 2)] || null;
        loserNextSlot = loserNextMatchId ? (m % 2) + 1 : null;
      // Người thua các vòng giữa rơi vào vòng thua tương ứng.
      } else if (r < roundCount - 1) {
        loserNextMatchId = losersMatchIds[2 * r - 1]?.[m] || null;
        loserNextSlot = loserNextMatchId ? 2 : null;
      // Người thua chung kết nhánh thắng rơi vào chung kết nhánh thua.
      } else {
        loserNextMatchId = losersMatchIds[losersRoundCount - 1]?.[0] || null;
        loserNextSlot = loserNextMatchId ? 2 : null;
      }

      // Mặc định match chờ player.
      let status = "Scheduled";
      // Winner ban đầu null.
      let winner_id = null;
      // Result ban đầu rỗng.
      let result = "";
      // finished_at ban đầu null.
      let finished_at = null;

      // Có đủ 2 người thì trận sẵn sàng.
      if (p1 && p2) {
        status = "Ready";
      // Có 1 người thì thắng BYE.
      } else if (p1 || p2) {
        status = "Finished";
        winner_id = p1 || p2;
        result = "BYE";
        finished_at = new Date();
      }

      // Push match nhánh thắng.
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

  // Tạo các trận nhánh thua.
  for (let l = 0; l < losersRoundCount; l += 1) {
    // Số trận ở vòng nhánh thua hiện tại.
    const matchCount = losersMatchIds[l].length;
    // Duyệt từng trận nhánh thua.
    for (let m = 0; m < matchCount; m += 1) {
      // Nơi winner nhánh thua sẽ đi tiếp.
      let winnerNextMatchId = null;
      // Slot của winner ở trận tiếp theo.
      let winnerNextSlot = null;

      // Winner vòng thua cuối đi vào GrandFinal slot 2.
      if (l === losersRoundCount - 1) {
        winnerNextMatchId = grandFinalId;
        winnerNextSlot = 2;
      // Vòng thua chẵn thường nhận/đẩy winner thẳng sang vòng sau cùng index.
      } else if (l % 2 === 0) {
        winnerNextMatchId = losersMatchIds[l + 1]?.[m] || null;
        winnerNextSlot = winnerNextMatchId ? 1 : null;
      // Vòng thua lẻ gom 2 trận thành 1 trận vòng sau.
      } else {
        winnerNextMatchId = losersMatchIds[l + 1]?.[Math.floor(m / 2)] || null;
        winnerNextSlot = winnerNextMatchId ? (m % 2) + 1 : null;
      }

      // Push match nhánh thua, ban đầu chưa có player.
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

  // Tạo trận Grand Final, chờ winner nhánh thắng và winner nhánh thua.
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

  // Insert tất cả round theo đúng thứ tự Winners -> Losers -> GrandFinal.
  await TournamentRound.insertMany([
    ...winnersRoundDocs,
    ...losersRoundDocs,
    grandFinalRound,
  ]);
  // Insert tất cả match đã build.
  await RoundMatch.insertMany(matchDocs);

  // Tìm các match BYE để tự đẩy winner đi tiếp.
  const byeMatches = await RoundMatch.find({
    tournament_id: tournament._id,
    status: "Finished",
    result: "BYE",
  });
  // Propagate từng match BYE.
  for (const bye of byeMatches) {
    await propagateMatchOutcomes(bye);
  }
  // Xử lý các trận đủ người sau khi propagate.
  await resolvePendingAutoAdvances(tournament._id);

  // Cập nhật thông tin bracket vào tournament.
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

  // Trả summary bracket.
  return { roundCount, bracketSize, losersRoundCount };
};

// Export các hàm tạo bracket để controller gọi.
module.exports = {
  generateKnockoutBracket,
  generateDoubleEliminationBracket,
};
