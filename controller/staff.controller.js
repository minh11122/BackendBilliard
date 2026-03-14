const Club = require("../models/club.model");
const Tournament = require("../models/tournament.model");
const Booking = require("../models/booking.model");
const Feedback = require("../models/feedback.model");
const Post = require("../models/post.model");
const Account = require("../models/account.model");
const Role = require("../models/role.model");
const { sendClubApprovalEmail, sendClubRejectionEmail } = require("../services/mail.service");

// ==================== GET DASHBOARD ====================
const getDashboard = async (req, res) => {
    try {
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

        // 1) Clubs chờ duyệt
        const pendingClubs = await Club.find({ status: "Pending" })
            .populate("account_id", "fullname email phone")
            .sort({ created_at: -1 })
            .lean();

        // 2) Tất cả tournaments
        const tournaments = await Tournament.find()
            .sort({ created_at: -1 })
            .lean();

        // 3) Bookings hôm nay
        const todayBookings = await Booking.find({
            play_date: { $gte: startOfDay, $lt: endOfDay }
        })
            .populate("account_id", "fullname phone")
            .sort({ created_at: -1 })
            .lean();

        // 4) Feedbacks chưa được trả lời
        const pendingFeedbacks = await Feedback.find({ reply_content: { $exists: false } })
            .populate("account_id", "fullname avatar_url")
            .populate("club_id", "name")
            .sort({ created_at: -1 })
            .lean();

        // 5) Posts chờ duyệt
        const pendingPosts = await Post.find({ status: "Pending" })
            .populate("club_id", "name")
            .sort({ created_at: -1 })
            .lean();

        // 6) Stats tổng hợp
        const [totalClubs, openingTournaments, pendingBookingsCount] = await Promise.all([
            Club.countDocuments({ status: "Approved" }),
            Tournament.countDocuments({ status: "Opening" }),
            Booking.countDocuments({ status: "Pending" })
        ]);

        // 7) Recent activity – lấy 8 hoạt động mới nhất từ clubs + bookings + feedbacks
        const [recentClubs, recentBookings, recentFeedbacks] = await Promise.all([
            Club.find().sort({ created_at: -1 }).limit(3).lean(),
            Booking.find().sort({ created_at: -1 }).limit(3).lean(),
            Feedback.find().sort({ created_at: -1 }).limit(2).populate("club_id", "name").lean()
        ]);

        const recentActivity = [
            ...recentClubs.map(c => ({
                type: "club",
                text: `CLB "${c.name}" đăng ký hệ thống`,
                time: c.created_at,
                status: c.status
            })),
            ...recentBookings.map(b => ({
                type: "booking",
                text: `Đơn đặt bàn mới ${b.code_number}`,
                time: b.created_at,
                status: b.status
            })),
            ...recentFeedbacks.map(f => ({
                type: "feedback",
                text: `Đánh giá ${f.rating}★ cho CLB ${f.club_id?.name || ""}`,
                time: f.created_at
            }))
        ]
            .filter(a => a.time)
            .sort((a, b) => new Date(b.time) - new Date(a.time))
            .slice(0, 8);

        res.status(200).json({
            success: true,
            data: {
                stats: {
                    pendingClubs: pendingClubs.length,
                    openingTournaments,
                    todayBookings: todayBookings.length,
                    pendingFeedbacks: pendingFeedbacks.length,
                    pendingBookings: pendingBookingsCount,
                    totalClubs,
                    pendingPosts: pendingPosts.length
                },
                pendingClubs,
                tournaments,
                todayBookings,
                pendingFeedbacks,
                pendingPosts,
                recentActivity
            }
        });
    } catch (error) {
        console.error("Lỗi getDashboard:", error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
};

// ==================== APPROVE CLUB ====================
const approveClub = async (req, res) => {
    try {
        const club = await Club.findByIdAndUpdate(
            req.params.id,
            { status: "Approved" },
            { new: true }
        );
        if (!club) return res.status(404).json({ success: false, message: "Không tìm thấy CLB" });

        // Lấy thông tin tài khoản trực tiếp để đảm bảo có email
        const account = await Account.findById(club.account_id);

        if (account) {
            // Nâng cấp role người dùng sang OWNER với ID cứng (từ Customer "65d1a1111111111111111112")
            const ownerRoleId = "65d1a1111111111111111111";
            await Account.findByIdAndUpdate(account._id, { role_id: ownerRoleId });
            console.log(`Đã chuyển role_id của tài khoản ${account.email} sang ${ownerRoleId} (OWNER)`);

            // Gửi email thông báo được duyệt
            if (account.email) {
                console.log("Sending APPROVE email to:", account.email);
                await sendClubApprovalEmail(account.email).catch(e => console.error("Lỗi gửi email approve:", e));
            }
        }

        res.status(200).json({ success: true, message: "Đã duyệt CLB", data: club });
    } catch (error) {
        console.error("Lỗi approveClub:", error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
};

// ==================== REJECT CLUB ====================
const rejectClub = async (req, res) => {
    try {
        const { reason } = req.body;
        console.log("Rejecting club ID:", req.params.id, "Reason:", reason);

        const club = await Club.findByIdAndUpdate(
            req.params.id,
            { status: "Rejected" },
            { new: true }
        );
        if (!club) return res.status(404).json({ success: false, message: "Không tìm thấy CLB" });

        // Lấy thông tin tài khoản trực tiếp để lấy email
        const account = await Account.findById(club.account_id);

        // Gửi email thông báo từ chối kèm lý do
        if (account && account.email) {
            console.log("Sending REJECT email to:", account.email, "With reason:", reason);
            await sendClubRejectionEmail(account.email, reason).catch(e => console.error("Lỗi gửi email reject:", e));
        } else {
            console.warn("Không tìm thấy email của tài khoản đăng ký CLB");
        }

        res.status(200).json({ success: true, message: "Đã từ chối CLB", data: club });
    } catch (error) {
        console.error("Lỗi rejectClub:", error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
};

// ==================== GET CLUBS (with optional status filter) ====================
const getClubs = async (req, res) => {
    try {
        const { status } = req.query;
        const filter = status ? { status } : {};
        const clubs = await Club.find(filter)
            .populate("account_id", "fullname email phone")
            .sort({ created_at: -1 })
            .lean();
        res.status(200).json({ success: true, data: clubs });
    } catch (error) {
        console.error("Lỗi getClubs:", error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
};

// ==================== LOCK CLUB ====================
const lockClub = async (req, res) => {
    try {
        const club = await Club.findByIdAndUpdate(
            req.params.id,
            { status: "Locked" },
            { new: true }
        );
        if (!club) return res.status(404).json({ success: false, message: "Không tìm thấy CLB" });
        res.status(200).json({ success: true, message: "Đã khoá CLB", data: club });
    } catch (error) {
        console.error("Lỗi lockClub:", error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
};

// ==================== UNLOCK CLUB ====================
const unlockClub = async (req, res) => {
    try {
        const club = await Club.findByIdAndUpdate(
            req.params.id,
            { status: "Approved" },
            { new: true }
        );
        if (!club) return res.status(404).json({ success: false, message: "Không tìm thấy CLB" });
        res.status(200).json({ success: true, message: "Đã mở khoá CLB", data: club });
    } catch (error) {
        console.error("Lỗi unlockClub:", error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
};

// ==================== APPROVE POST ====================
const approvePost = async (req, res) => {
    try {
        const post = await Post.findByIdAndUpdate(
            req.params.id,
            { status: "Approved", published_at: new Date() },
            { new: true }
        );
        if (!post) return res.status(404).json({ success: false, message: "Không tìm thấy bài đăng" });
        res.status(200).json({ success: true, message: "Đã duyệt bài đăng", data: post });
    } catch (error) {
        console.error("Lỗi approvePost:", error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
};

// ==================== REJECT POST ====================
const rejectPost = async (req, res) => {
    try {
        const { reason } = req.body;
        const post = await Post.findByIdAndUpdate(
            req.params.id,
            { status: "Rejected", rejected_reason: reason || "" },
            { new: true }
        );
        if (!post) return res.status(404).json({ success: false, message: "Không tìm thấy bài đăng" });
        res.status(200).json({ success: true, message: "Đã từ chối bài đăng", data: post });
    } catch (error) {
        console.error("Lỗi rejectPost:", error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
};

module.exports = {
    getDashboard,
    getClubs,
    approveClub,
    rejectClub,
    lockClub,
    unlockClub,
    approvePost,
    rejectPost
};
