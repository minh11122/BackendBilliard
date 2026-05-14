const Tournament = require("../../models/tournament.model");
const TournamentPlayer = require("../../models/tournament_player.model");
const {
  fetchApprovedPlayers,
  generateKnockoutBracket,
  generateDoubleEliminationBracket,
} = require("./tournament.helpers");
const Club = require("../../models/club.model");
const jwt = require("jsonwebtoken");

const getOptionalUser = (req) => {
  if (req.user) return req.user;
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
  } catch {
    return null;
  }
};

const resolveManagedClubId = async (user) => {
  if (!user) return null;
  if (user.role === "STAFF_CLUB" && user.club_id) return String(user.club_id);
  if (user.role === "OWNER") {
    const club = await Club.findOne({ account_id: user.accountId }).select("_id").lean();
    return club ? String(club._id) : null;
  }
  return null;
};

const getTournamentPlayers = async (req, res) => {
  try {
    const { id } = req.params;
    const user = getOptionalUser(req);

    const tournament = await Tournament.findById(id).select("name club_id").lean();
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    const managedClubId = await resolveManagedClubId(user);
    if (managedClubId && String(tournament.club_id) !== String(managedClubId)) {
      return res.status(403).json({
        success: false,
        message: "Báº¡n khÃ´ng cÃ³ quyá»n xem danh sÃ¡ch ngÆ°á»i chÆ¡i cá»§a giáº£i nÃ y",
      });
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


const closeTournamentRegistration = async (req, res) => {
  try {
    const { id } = req.params;
    const { auto_generate } = req.body || {};

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
        .json({ success: false, message: "Cần ít nhất 2 người chơi" });
    }

    tournament.status = "Closed";
    tournament.registration_deadline =
      tournament.registration_deadline || new Date();
    tournament.registered_player = approvedPlayers.length;
    await tournament.save();

    let bracket = null;
    if (auto_generate || tournament.auto_bracket) {
      bracket =
        tournament.format === "Double Elimination"
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


module.exports = {
  getTournamentPlayers,
  getMyRegisteredTournamentIds,
  openTournamentRegistration,
  closeTournamentRegistration,
  getMyTournaments,
};
