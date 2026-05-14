const mongoose = require("mongoose");
const Tournament = require("../../models/tournament.model");
const TournamentPlayer = require("../../models/tournament_player.model");
const Club = require("../../models/club.model");
const Notification = require("../../models/notification.model");
const Account = require("../../models/account.model");
const {
  normalizePrizePool,
} = require("./tournament.helpers");
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
      table_type_id,
    } = req.body;

    if (!name || !max_players) {
      return res.status(400).json({
        success: false,
        message: "Tên giải và số lượng người chơi là bắt buộc",
      });
    }

    if (format && !["Knockout", "Double Elimination"].includes(format)) {
      return res.status(400).json({
        success: false,
        message: "Thể thức giải đấu không hợp lệ",
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
      table_type_id: table_type_id || null,
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


const getTournamentsByClub = async (req, res) => {
  try {
    const user = req.user;
    let club_id = req.headers["x-club-id"] || req.query.club_id;

    if (user?.role === "STAFF_CLUB") {
      club_id = user.club_id;
    } else if (user?.role === "OWNER") {
      const managedClubId = await resolveManagedClubId(user);
      club_id = managedClubId || club_id;
    }

    // If no explicit club_id, try to get it from the authenticated user's account
    if (!club_id && req.user?.accountId) {
      const Account = require("../../models/account.model");
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


const getTournamentById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = getOptionalUser(req);
    const tournament = await Tournament.findById(id)
      .populate("club_id", "name address")
      .populate("table_type_id", "name")
      .lean();
    if (!tournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }
    const managedClubId = await resolveManagedClubId(user);
    if (
      managedClubId &&
      String(tournament.club_id?._id || tournament.club_id) !== String(managedClubId)
    ) {
      return res.status(403).json({
        success: false,
        message: "Báº¡n khÃ´ng cÃ³ quyá»n xem giáº£i Ä‘áº¥u cá»§a quÃ¡n khÃ¡c",
      });
    }
    return res.status(200).json({ success: true, data: tournament });
  } catch (error) {
    console.error("Error fetching tournament:", error);
    return res
      .status(500)
      .json({ success: false, message: "Lỗi server", error: error.message });
  }
};


const updateTournament = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (
      updates.format &&
      !["Knockout", "Double Elimination"].includes(updates.format)
    ) {
      return res.status(400).json({
        success: false,
        message: "Thể thức giải đấu không hợp lệ",
      });
    }

    const existingTournament = await Tournament.findById(id).lean();
    if (!existingTournament) {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy giải đấu" });
    }

    const club = await require("../../models/club.model")
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
  updateTournament,
  deleteTournament,
  cancelTournament,
};
