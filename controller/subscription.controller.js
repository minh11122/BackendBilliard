const Subscription = require("../models/subscription.model");
const SubscriptionAccount = require("../models/subcription_account.model");
const paymentService = require("../services/payment.service");

const ALLOWED_MONTHS = [1, 3, 6, 12];

function getPlanTier(subscription) {
  const name = String(subscription?.name || "").toLowerCase();
  if (name.includes("pro")) return 2;
  if (name.includes("basic")) return 1;
  return 0;
}

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

    const current = await SubscriptionAccount.findOne({
      club_id: club_id,
      status: { $in: ["active", "Active"] }
    })
      .populate("subscription_id")
      .sort({ purchase_date: -1 });

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

    const activeSub = await SubscriptionAccount.findOne({
      club_id,
      status: { $in: ["active", "Active"] }
    }).populate("subscription_id");

    const currentTier = getPlanTier(activeSub?.subscription_id);
    const targetTier = getPlanTier(subscription);
    if (currentTier === 2 && targetTier === 1) {
      return res.status(400).json({
        success: false,
        message: "Đang sử dụng gói Pro, không thể chuyển xuống Basic"
      });
    }

    const unitPrice =
      subscription.price -
      (subscription.price * (subscription.discount_percent || 0)) / 100;
    const price = Math.max(0, Math.round(unitPrice * months));

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

    const activeSub = await SubscriptionAccount.findOne({
      club_id,
      status: { $in: ["active", "Active"] }
    }).populate("subscription_id");

    const currentTier = getPlanTier(activeSub?.subscription_id);
    const targetTier = getPlanTier(subscription);
    if (currentTier === 2 && targetTier === 1) {
      return res.status(400).json({
        success: false,
        message: "Đang sử dụng gói Pro, không thể chuyển xuống Basic"
      });
    }

    const purchaseDate = new Date();

    const expireDate = new Date();
    const baseDays = subscription.duration_days || 30;
    expireDate.setDate(expireDate.getDate() + (baseDays * months));

    const unitPrice =
      subscription.price -
      (subscription.price * (subscription.discount_percent || 0)) / 100;
    const price = Math.max(0, Math.round(unitPrice * months));

    let clubSubscription = await SubscriptionAccount.findOne({
      club_id: club_id
    });

    if (clubSubscription) {

      clubSubscription.subscription_id = subscription_id;
      clubSubscription.account_id = accountId;
      clubSubscription.purchase_date = purchaseDate;
      clubSubscription.start_date = purchaseDate;
      clubSubscription.expire_date = expireDate;
      clubSubscription.purchase_price = price;
      clubSubscription.status = "active";
      clubSubscription.post_limit = subscription.post_limit || 0;
      clubSubscription.posts_used = 0;

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