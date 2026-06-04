const cron = require("node-cron");
const { expireOverdueSubscriptions } = require("../controller/subscription/subscription.helpers");

// Kiểm tra gói hết hạn mỗi giờ
cron.schedule("0 * * * *", async () => {
  try {
    const count = await expireOverdueSubscriptions();
    if (count > 0) {
      console.log(`[SYS-CRON] Đã đánh dấu ${count} gói subscription hết hạn`);
    }
  } catch (error) {
    console.error("[SYS-CRON] Subscription expiry error:", error);
  }
});
