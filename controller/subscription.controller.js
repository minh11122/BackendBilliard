const Subscription = require("../models/subscription.model");
const SubscriptionAccount = require("../models/subcription_account.model");
const Notification = require("../models/notification.model");
const paymentService = require("../services/payment.service");
const {
  isSubscriptionValid,
  isDowngradeBlocked,
  calculateSubscriptionPrice,
  calculateRenewalExpireDate,
  findActiveSubscriptionForClub,
  findClubSubscriptionRecord
} = require("../utils/subscription.util");

const ALLOWED_MONTHS = [1, 3, 6, 12];
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

//tao thanh toan cho subscription
//Duc 13/3/2026
const createSubscriptionPayment = async (req, res) => {
  try {

    const { subscription_id, club_id, returnUrl, cancelUrl, duration_months } = req.body;

    const accountId = req.user.accountId;

    if (!subscription_id || !club_id) {
      return res.status(400).json({
        success: false,
        message: "subscription_id và club_id là bắt buộc"
      });
    }

    const months = Number(duration_months || 1);
    if (!ALLOWED_MONTHS.includes(months)) {
      return res.status(400).json({
        success: false,
        message: "duration_months chỉ chấp nhận: 1, 3, 6, 12"
      });
    }

    const subscription = await Subscription.findById(subscription_id);

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: "Subscription không tồn tại"
      });
    }

    const activeSub = await findActiveSubscriptionForClub(club_id, {
      populate: true
    });

    if (isDowngradeBlocked(activeSub, subscription)) {
      return res.status(400).json({
        success: false,
        message: "Đang sử dụng gói Pro, không thể chuyển xuống Basic"
      });
    }

    const price = calculateSubscriptionPrice(subscription, months);

    const payment = await paymentService.createPayment({
      accountId,
      amount: price,
      description: "Subscription payment",
      type: "SUBSCRIPTION",
      returnUrl,
      cancelUrl
    });

    return res.json({
      success: true,
      data: payment
    });

  } catch (error) {

    console.error("Create payment error:", error);

    return res.status(500).json({
      success: false,
      message: error.message
    });

  }
};



//xac thuc thanh toan cho subscription
//Duc 13/3/2026
const verifySubscriptionPayment = async (req, res) => {
  try {

    const { orderCode, subscription_id, club_id, duration_months } = req.body;

    const accountId = req.user.accountId;

    if (!orderCode || !subscription_id || !club_id) {
      return res.status(400).json({
        success: false,
        message: "Thiếu thông tin thanh toán"
      });
    }

    const months = Number(duration_months || 1);
    if (!ALLOWED_MONTHS.includes(months)) {
      return res.status(400).json({
        success: false,
        message: "duration_months chỉ chấp nhận: 1, 3, 6, 12"
      });
    }

    await paymentService.verifyPayment(orderCode);

    const subscription = await Subscription.findById(subscription_id);

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: "Subscription không tồn tại"
      });
    }

    const activeSub = await findActiveSubscriptionForClub(club_id, {
      populate: true
    });

    if (isDowngradeBlocked(activeSub, subscription)) {
      return res.status(400).json({
        success: false,
        message: "Đang sử dụng gói Pro, không thể chuyển xuống Basic"
      });
    }

    const purchaseDate = new Date();
    const price = calculateSubscriptionPrice(subscription, months);

    let clubSubscription = await findClubSubscriptionRecord(club_id);

    const isSamePlan =
      clubSubscription &&
      String(clubSubscription.subscription_id) === String(subscription_id);
    const isRenewal =
      isSamePlan &&
      (isSubscriptionValid(clubSubscription) ||
        clubSubscription.status === "expired");

    const expireDate = calculateRenewalExpireDate(
      clubSubscription?.expire_date,
      months,
      purchaseDate
    );

    if (clubSubscription) {

      clubSubscription.subscription_id = subscription_id;
      clubSubscription.account_id = accountId;
      clubSubscription.purchase_date = purchaseDate;
      if (!isRenewal) {
        clubSubscription.start_date = purchaseDate;
      }
      clubSubscription.expire_date = expireDate;
      clubSubscription.purchase_price = price;
      clubSubscription.status = "active";

      if (isRenewal) {
        clubSubscription.post_limit =
          (clubSubscription.post_limit || 0) + (subscription.post_limit || 0);
      } else {
        clubSubscription.post_limit = subscription.post_limit || 0;
        clubSubscription.posts_used = 0;
      }

      await clubSubscription.save();

    } else {

      clubSubscription = await SubscriptionAccount.create({
        subscription_id,
        account_id: accountId,
        club_id: club_id,
        purchase_date: purchaseDate,
        start_date: purchaseDate,
        expire_date: expireDate,
        purchase_price: price,
        status: "active",
        post_limit: subscription.post_limit || 0,
        posts_used: 0
      });

    }

    return res.json({
      success: true,
      message: "Thanh toán thành công",
      data: clubSubscription
    });

  } catch (error) {

    console.error("Verify payment error:", error);

    return res.status(400).json({
      success: false,
      message: error.message
    });

  }
};



module.exports = {
  getSubscriptions,
  getCurrentSubscription,
  createSubscriptionPayment,
  verifySubscriptionPayment
};
