const cron = require("node-cron");
const Booking = require("../models/booking.model");
const BilliardTable = require("../models/billiard_table.model");

// Job chạy liên tục mỗi 1 phút
cron.schedule("* * * * *", async () => {
  try {
    // Chỉ giới hạn tìm các booking được đặt cho ngày hôm qua hoặc hôm nay
    // Tránh tìm các booking của tương lai (chưa đến hạn)
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - 1);
    targetDate.setHours(0, 0, 0, 0);

    const nextDay = new Date();
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0, 0, 0, 0);

    const bookings = await Booking.find({
      status: "Booked",
      play_date: { $gte: targetDate, $lt: nextDay }
    }).lean();

    if (bookings.length === 0) return;

    const now = new Date();

    for (const b of bookings) {
      if (!b.start_time) continue;
      
      const [h, m] = b.start_time.split(":").map(Number);
      const playStart = new Date(b.play_date);
      playStart.setHours(h, m, 0, 0);
      
      const diffMinutes = (now.getTime() - playStart.getTime()) / (1000 * 60);
      
      // Khách hàng đến hệ thống kiểm tra quá hạn > 15 phút
      if (diffMinutes >= 16) {
        await Booking.findByIdAndUpdate(b._id, {
          status: "Cancelled",
          note: b.note 
            ? `${b.note}\n- Hệ thống tự động hủy do đến trễ quá 15 phút` 
            : "Hệ thống tự động hủy do đến trễ quá 15 phút"
        });

        if (b.table_id) {
            await BilliardTable.findByIdAndUpdate(b.table_id, {
                status: "Available",
                held_by: null,
                held_until: null
            });
        }

        console.log(`[SYS-CRON] Đã tự động hủy Booking ${b.code_number || b._id} do đến trễ 15 phút`);
      }
    }
  } catch (error) {
    console.error("[SYS-CRON] Booking check-in timeout error:", error);
  }
});
