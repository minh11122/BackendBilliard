const payosService = require("./payos.service");
const TransactionHistory = require("../models/transiction_history.model");

const createPayment = async ({
  accountId,
  amount,
  description,
  type
}) => {

  console.log("CREATE PAYMENT CALLED");

  const orderCode = Date.now();

  console.log("ORDER CODE:", orderCode);

  await TransactionHistory.create({
    account_id: accountId,
    order_code: orderCode,
    amount: amount,
    description: description,
    transaction_type: type,
    transaction_time: new Date(),
    status: "PENDING"
  });

  console.log("TRANSACTION CREATED");

  const paymentData = {
    orderCode,
    amount,
    description,
    returnUrl: "http://localhost:5173/owner/payment-success",
    cancelUrl: "http://localhost:5173/owner/settings"
  };

  const paymentLink = await payosService.createPaymentLink(paymentData);

  return {
    checkoutUrl: paymentLink.checkoutUrl,
    orderCode
  };
};

const verifyPayment = async (orderCode) => {

  const paymentInfo = await payosService.getPaymentInfo(orderCode);

  if (paymentInfo.status !== "PAID") {
    throw new Error("Payment not completed");
  }

  const transaction = await TransactionHistory.findOne({
    order_code: orderCode
  });

  if (!transaction) {
    throw new Error("Transaction not found");
  }

  if (transaction.status === "SUCCESS") {
    return transaction;
  }

  transaction.status = "SUCCESS";
  await transaction.save();

  return transaction;
};

module.exports = {
  createPayment,
  verifyPayment
};