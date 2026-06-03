const Subscription = require("../../models/subscription.model");
const Notification = require("../../models/notification.model");
const { findActiveSubscriptionForClub } = require("./subscription.helpers");

const EXPIRING_SOON_DAYS = 3;

const notifySubscriptionExpiringSoon = async (subscriptionAccount) => {
  if (!subscriptionAccount?.expire_date || !subscriptionAccount?.account_id) {
    return;
  }

  const expireDate = new Date(subscriptionAccount.expire_date);
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysRemaining = Math.ceil((expireDate.getTime() - now.getTime()) / msPerDay);

  if (daysRemaining < 0 || daysRemaining > EXPIRING_SOON_DAYS) {
    return;
  }

  const title = "Goi dich vu sap het han";
  const expireDateText = expireDate.toLocaleDateString("vi-VN");
  const planName = subscriptionAccount.subscription_id?.name || "goi dich vu";
  const message = `Goi ${planName} cua quan se het han vao ${expireDateText}. Vui long gia han som.`;

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const existingNotification = await Notification.findOne({
    account_id: subscriptionAccount.account_id,
    title,
    message,
    created_at: {
      $gte: startOfDay,
      $lte: endOfDay
    }
  });

  if (existingNotification) {
    return;
  }

  await Notification.create({
    account_id: subscriptionAccount.account_id,
    title,
    message
  });
};

//lay danh sach Subscription
//Duc 6/3/2026
const getSubscriptions = async (req, res) => {
  try {
    const subscriptions = await Subscription.find().lean();

    return res.status(200).json({
      success: true,
      data: subscriptions
    });
  } catch (error) {
    console.error("Lỗi lấy subscription:", error);

    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

//xem Subscription hien tai theo club
//Duc 6/3/2026
const getCurrentSubscription = async (req, res) => {
  try {
    const { club_id } = req.query;

    if (!club_id) {
      return res.status(400).json({
        success: false,
        message: "club_id là bắt buộc"
      });
    }

    const current = await findActiveSubscriptionForClub(club_id, {
      populate: true
    });

    if (current) {
      await notifySubscriptionExpiringSoon(current);
    }

    return res.status(200).json({
      success: true,
      data: current
    });
  } catch (error) {
    console.error("Lỗi lấy subscription hiện tại:", error);

    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

module.exports = {
  getSubscriptions,
  getCurrentSubscription
};
