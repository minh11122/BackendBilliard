const cron = require("node-cron");
const Tournament = require("../models/tournament.model");
const TournamentPlayer = require("../models/tournament_player.model");
const Notification = require("../models/notification.model");

// Chạy mỗi phút — kiểm tra giải đấu đã hết hạn đăng ký
cron.schedule("* * * * *", async () => {
  try {
    const now = new Date();

    // Tìm các giải đang "Open" mà registration_deadline đã qua
    const expiredTournaments = await Tournament.find({
      status: "Open",
      registration_deadline: { $lte: now },
    }).populate("club_id", "account_id name");

    if (expiredTournaments.length === 0) return;

    for (const tournament of expiredTournaments) {
      const approvedCount = await TournamentPlayer.countDocuments({
        tournament_id: tournament._id,
        status: "Approved",
      });

      const ownerId = tournament.club_id?.account_id;

      if (approvedCount < 2) {
        // 0 hoặc 1 người → tự động hủy
        tournament.status = "Cancelled";
        await tournament.save();

        // Chuyển tất cả player sang Cancelled
        await TournamentPlayer.updateMany(
          { tournament_id: tournament._id },
          { status: "Cancelled" }
        );

        const reason =
          approvedCount === 0
            ? "không có người đăng ký"
            : "không đủ người chơi (cần ít nhất 2 người)";

        console.log(
          `[SYS-CRON] Đã tự động hủy giải "${tournament.name}" do ${reason}`
        );

        // Thông báo Owner
        if (ownerId) {
          const message =
            approvedCount === 0
              ? `Giải đấu "${tournament.name}" đã tự động bị hủy do hết hạn đăng ký mà không có người tham gia.`
              : `Giải đấu "${tournament.name}" đã tự động bị hủy do hết hạn đăng ký mà chỉ có ${approvedCount} người đăng ký (cần ít nhất 2). Vui lòng liên hệ hoàn phí cho người chơi.`;

          await Notification.create({
            account_id: ownerId,
            title: "Giải đấu đã tự động hủy",
            message,
            link: `/owner/tournaments/${tournament._id}/detail`,
            is_read: false,
          });
        }
      } else {
        // >= 2 người → tự động đóng đăng ký
        tournament.status = "Closed";
        tournament.registered_player = approvedCount;
        await tournament.save();

        console.log(
          `[SYS-CRON] Đã tự động đóng đăng ký giải "${tournament.name}" (${approvedCount} người)`
        );

        // Thông báo Owner
        if (ownerId) {
          await Notification.create({
            account_id: ownerId,
            title: "Đã tự động đóng đăng ký giải đấu",
            message: `Giải đấu "${tournament.name}" đã hết hạn đăng ký và được tự động đóng với ${approvedCount} người tham gia. Bạn có thể tạo bracket và bắt đầu giải.`,
            link: `/owner/tournaments/${tournament._id}/players`,
            is_read: false,
          });
        }
      }
    }
  } catch (error) {
    console.error("[SYS-CRON] Tournament deadline check error:", error);
  }
});
