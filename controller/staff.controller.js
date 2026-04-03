const Club = require("../models/club.model");
const Tournament = require("../models/tournament.model");
const Booking = require("../models/booking.model");
const Feedback = require("../models/feedback.model");
const Post = require("../models/post.model");
const Account = require("../models/account.model");
const SubscriptionAccount = require("../models/subcription_account.model");
const Role = require("../models/role.model");
const Image = require("../models/image.model");
const Notification = require("../models/notification.model");
const { sendClubApprovalEmail, sendClubRejectionEmail } = require("../services/mail.service");

// ==================== GET DASHBOARD ====================
const getDashboard = async (req, res) => {
    try {
        let startOfDay, endOfDay;
        const { dateType, specificDate } = req.query;
        
        if (dateType === "custom" && specificDate) {
            startOfDay = new Date(specificDate);
            startOfDay.setHours(0, 0, 0, 0);
            endOfDay = new Date(specificDate);
            endOfDay.setHours(23, 59, 59, 999);
        } else if (dateType === "week") {
            const today = new Date();
            const firstDay = today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1);
            startOfDay = new Date(today.setDate(firstDay));
            startOfDay.setHours(0, 0, 0, 0);
            endOfDay = new Date(startOfDay);
            endOfDay.setDate(endOfDay.getDate() + 6);
            endOfDay.setHours(23, 59, 59, 999);
        } else if (dateType === "month") {
            const today = new Date();
            startOfDay = new Date(today.getFullYear(), today.getMonth(), 1);
            endOfDay = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
        } else {
            const today = new Date();
            startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
        }

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
            Tournament.countDocuments({ status: "Open" }),
            Booking.countDocuments({ status: "Pending" })
        ]);

        // 7) Recent activity – lấy 8 hoạt động mới nhất: duyệt/từ chối bài đăng, CLB và mua gói
        const [recentPosts, recentClubs, recentSubs] = await Promise.all([
            Post.find({ status: { $in: ["Approved", "Rejected"] } }).sort({ updated_at: -1 }).limit(3).populate("club_id", "name").lean(),
            Club.find({ status: { $in: ["Approved", "Rejected"] } }).sort({ updated_at: -1 }).limit(3).lean(),
            SubscriptionAccount.find().sort({ created_at: -1 }).limit(3).populate("account_id", "fullname").populate("subscription_id", "name").lean()
        ]);

        const recentActivity = [
            ...recentPosts.map(p => ({
                type: "post",
                text: `Bài đăng của CLB "${p.club_id?.name || '?'}" đã bị ${p.status === 'Approved' ? 'duyệt' : 'từ chối'}`,
                time: p.updated_at || p.created_at
            })),
            ...recentClubs.map(c => ({
                type: "club",
                text: `CLB "${c.name}" đã bị ${c.status === 'Approved' ? 'duyệt' : 'từ chối'}`,
                time: c.updated_at || c.created_at
            })),
            ...recentSubs.map(s => ({
                type: "subscription",
                text: `Người dùng ${s.account_id?.fullname || '?'} đã mua gói ${s.subscription_id?.name || '?'}`,
                time: s.purchase_date || s.created_at
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

        // Fetch legal documents images for clubs
        const clubIds = clubs.map(c => c._id);
        const images = await Image.find({
            club_id: { $in: clubIds },
            image_type: "legal documents"
        }).lean();

        const imageMap = images.reduce((acc, img) => {
            acc[img.club_id] = img.image_url;
            return acc;
        }, {});

        const clubsWithImage = clubs.map(c => ({
            ...c,
            legal_document_image: imageMap[c._id] || null
        }));

        res.status(200).json({ success: true, data: clubsWithImage });
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

// ==================== GET NOTIFICATIONS ====================
const getNotifications = async (req, res) => {
    try {
        const account_id = req.user.accountId;
        if (!account_id) return res.status(401).json({ success: false, message: "Unauthorized" });

        const notifications = await Notification.find({ account_id })
            .sort({ created_at: -1 })
            .lean();
            
        res.status(200).json({ success: true, data: notifications });
    } catch (error) {
        console.error("Lỗi getNotifications:", error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
};

// ==================== MARK ALL READ ====================
const markAllNotificationsRead = async (req, res) => {
    try {
        const account_id = req.user.accountId;
        if (!account_id) return res.status(401).json({ success: false, message: "Unauthorized" });

        await Notification.updateMany(
            { account_id, is_read: false },
            { $set: { is_read: true } }
        );
            
        res.status(200).json({ success: true, message: "Đã đánh dấu tất cả là đã đọc" });
    } catch (error) {
        console.error("Lỗi markAllNotificationsRead:", error);
        res.status(500).json({ success: false, message: "Lỗi server" });
    }
};

// ==================== MARK ONE READ ====================
const markNotificationRead = async (req, res) => {
    try {
        const { id } = req.params;
        const account_id = req.user.accountId;
        if (!account_id) return res.status(401).json({ success: false, message: "Unauthorized" });

        const notif = await Notification.findOneAndUpdate(
            { _id: id, account_id },
            { $set: { is_read: true } },
            { new: true }
        );
        
        if (!notif) return res.status(404).json({ success: false, message: "Không tìm thấy thông báo" });
            
        res.status(200).json({ success: true, data: notif });
    } catch (error) {
        console.error("Lỗi markNotificationRead:", error);
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
    rejectPost,
    getNotifications,
    markAllNotificationsRead,
    markNotificationRead
};
