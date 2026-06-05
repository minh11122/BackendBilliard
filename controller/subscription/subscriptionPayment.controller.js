const Subscription = require("../../models/subscription.model");
const TransactionHistory = require("../../models/transiction_history.model");
const payosService = require("../../services/payos.service");
const {
  ALLOWED_MONTHS,
  isDowngradeBlocked,
  calculateSubscriptionPrice,
  findActiveSubscriptionForClub,
  findClubSubscriptionRecord,
  buildSubscriptionPaymentDescription,
  parseSubscriptionPaymentDescription,
  activateClubSubscription
} = require("./subscription.helpers");

const DEFAULT_RETURN_URL = "http://localhost:5173/owner/payment-success";
const DEFAULT_CANCEL_URL = "http://localhost:5173/owner/settings";
const PAYOS_DESCRIPTION_MAX_LENGTH = 25;
const SUBSCRIPTION_PAYOS_DESCRIPTION = "Gia han goi dich vu";

const getPayosDescription = () =>
  SUBSCRIPTION_PAYOS_DESCRIPTION.slice(0, PAYOS_DESCRIPTION_MAX_LENGTH);

const getDefaultPayosCreds = () => ({
  clientId: process.env.PAYOS_CLIENT_ID,
  apiKey: process.env.PAYOS_API_KEY,
  checksumKey: process.env.PAYOS_CHECKSUM_KEY
});

const markSubscriptionTransactionPaid = async (orderCode) => {
  const transaction = await TransactionHistory.findOneAndUpdate(
    { order_code: orderCode, status: { $ne: "SUCCESS" } },
    { status: "SUCCESS" },
    { new: true }
  );

  if (transaction) {
    return { transaction, newlyPaid: true };
  }

  const existing = await TransactionHistory.findOne({ order_code: orderCode });
  if (!existing) {
    throw new Error("Transaction not found");
  }

  return { transaction: existing, newlyPaid: false };
};

const createSubscriptionPaymentLink = async ({
  accountId,
  amount,
  description,
  returnUrl = DEFAULT_RETURN_URL,
  cancelUrl = DEFAULT_CANCEL_URL
}) => {
  const orderCode = Date.now();

  await TransactionHistory.create({
    account_id: accountId,
    order_code: orderCode,
    amount,
    description,
    transaction_type: "SUBSCRIPTION",
    transaction_time: new Date(),
    status: "PENDING"
  });

  const paymentLink = await payosService.createPaymentLink({
    orderCode,
    amount,
    description: getPayosDescription(),
    returnUrl,
    cancelUrl
  });

  return {
    checkoutUrl: paymentLink.checkoutUrl,
    orderCode
  };
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
    const paymentDescription = buildSubscriptionPaymentDescription(
      subscription_id,
      club_id,
      months
    );

    const payment = await createSubscriptionPaymentLink({
      accountId,
      amount: price,
      description: paymentDescription,
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

const processSubscriptionPaymentSuccess = async ({
  orderCode,
  subscription_id,
  club_id,
  accountId,
  duration_months
}) => {
  const paymentInfo = await payosService.getPaymentInfo(orderCode);
  if (paymentInfo.status !== "PAID") {
    throw new Error("Payment not completed");
  }

  const { newlyPaid } = await markSubscriptionTransactionPaid(orderCode);

  if (newlyPaid) {
    return activateClubSubscription({
      subscription_id,
      club_id,
      accountId,
      duration_months
    });
  }

  return findClubSubscriptionRecord(club_id);
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

    const clubSubscription = await processSubscriptionPaymentSuccess({
      orderCode,
      subscription_id,
      club_id,
      accountId,
      duration_months: months
    });

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

const subscriptionPayOSWebhook = async (req, res) => {
  try {
    const payload = req.body;
    const orderCode = payload?.data?.orderCode;

    if (!orderCode) {
      return res.status(400).json({
        success: false,
        message: "Thiếu orderCode"
      });
    }

    const tx = await TransactionHistory.findOne({ order_code: orderCode }).lean();
    if (!tx || tx.transaction_type !== "SUBSCRIPTION") {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy giao dịch subscription"
      });
    }

    const paymentMeta = parseSubscriptionPaymentDescription(tx.description);
    if (!paymentMeta) {
      return res.status(400).json({
        success: false,
        message: "Giao dịch subscription không hợp lệ"
      });
    }

    let webhookData;
    try {
      webhookData = await payosService.verifyWebhook(payload, getDefaultPayosCreds());
    } catch (e) {
      console.error("Subscription PayOS webhook verify failed:", e?.message || e);
      return res.status(400).json({
        success: false,
        message: "Webhook không hợp lệ"
      });
    }

    const isPaid =
      webhookData?.data?.code === "00" ||
      payload?.data?.code === "00" ||
      payload?.success === true;

    if (!isPaid) {
      return res.status(200).json({
        success: true,
        message: "Webhook received (not paid)"
      });
    }

    const { newlyPaid } = await markSubscriptionTransactionPaid(orderCode);

    if (newlyPaid) {
      await activateClubSubscription({
        subscription_id: paymentMeta.subscription_id,
        club_id: paymentMeta.club_id,
        accountId: tx.account_id,
        duration_months: paymentMeta.duration_months
      });
    }

    return res.status(200).json({
      success: true,
      message: "Đã cập nhật subscription"
    });
  } catch (error) {
    console.error("Error subscriptionPayOSWebhook:", error);

    return res.status(500).json({
      success: false,
      message: "Lỗi server",
      error: error.message
    });
  }
};

module.exports = {
  createSubscriptionPayment,
  verifySubscriptionPayment,
  subscriptionPayOSWebhook
};
