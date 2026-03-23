const Tournament = require("../models/tournament.model");

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
      // If image was uploaded via multer/cloudinary, use req.file.path; else fallback to body field
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
    const club_id = req.headers["x-club-id"] || req.query.club_id;
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

module.exports = {
  createTournament,
  getTournamentsByClub,
  getPublicTournaments,
  getTournamentById,
  updateTournament,
  deleteTournament
};
