const Subscription = require("../models/subscription.model");
const SubscriptionAccount = require("../models/subcription_account.model");

//lay danh sach Subscription
//Duc
//6/3/2026
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

//chon Subscription
//Duc
//6/3/2026
const purchaseSubscription = async (req, res) => {
  try {
    const { subscription_id } = req.body;

    const accountId = req.user.accountId;

    const subscription = await Subscription.findById(subscription_id);

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: "Subscription không tồn tại"
      });
    }

    const purchaseDate = new Date();

    const expireDate = new Date();
    expireDate.setMonth(expireDate.getMonth() + 1); // ví dụ 1 tháng

    const purchasePrice =
      subscription.price -
      (subscription.price * (subscription.discount_percent || 0)) / 100;

    let accountSubscription = await SubscriptionAccount.findOne({
      account_id: accountId
    });

    if (accountSubscription) {
      accountSubscription.subscription_id = subscription_id;
      accountSubscription.purchase_date = purchaseDate;
      accountSubscription.expire_date = expireDate;
      accountSubscription.purchase_price = purchasePrice;
      accountSubscription.status = "Active";
      await accountSubscription.save();
    } else {
      accountSubscription = await SubscriptionAccount.create({
        subscription_id,
        account_id: accountId,
        purchase_date: purchaseDate,
        expire_date: expireDate,
        purchase_price: purchasePrice,
        status: "Active"
      });
    }

    return res.status(201).json({
      success: true,
      message: "Đăng ký gói thành công",
      data: accountSubscription
    });
  } catch (error) {
    console.error("Lỗi mua subscription:", error);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

//xem Subscription hien tai
//Duc
//6/3/2026
const getCurrentSubscription = async (req, res) => {
  try {
    const accountId = req.user.accountId;

    const current = await SubscriptionAccount.findOne({
      account_id: accountId,
      status: "Active"
    })
      .sort({ purchase_date: -1 })
      .populate("subscription_id");

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
  purchaseSubscription,
  getCurrentSubscription
};