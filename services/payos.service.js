const { PayOS } = require("@payos/node");

const payos = new PayOS({
  clientId: process.env.PAYOS_CLIENT_ID,
  apiKey: process.env.PAYOS_API_KEY,
  checksumKey: process.env.PAYOS_CHECKSUM_KEY
});

const createPaymentLink = async (data) => {
  const response = await payos.paymentRequests.create(data);
  return response;
};

const getPaymentInfo = async (orderCode) => {
  const response = await payos.paymentRequests.get(orderCode);
  return response;
};

module.exports = {
  createPaymentLink,
  getPaymentInfo
};