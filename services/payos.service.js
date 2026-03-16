const { PayOS } = require("@payos/node");

const getPayOSClient = ({ clientId, apiKey, checksumKey }) => {
  if (!clientId || !apiKey || !checksumKey) {
    throw new Error("Missing PayOS credentials");
  }
  return new PayOS({ clientId, apiKey, checksumKey });
};

// Backward-compatible default client (used by existing subscription flow)
const defaultPayOS = new PayOS({
  clientId: process.env.PAYOS_CLIENT_ID,
  apiKey: process.env.PAYOS_API_KEY,
  checksumKey: process.env.PAYOS_CHECKSUM_KEY
});

const createPaymentLink = async (data, creds) => {
  const client = creds ? getPayOSClient(creds) : defaultPayOS;
  return await client.paymentRequests.create(data);
};

const getPaymentInfo = async (orderCode, creds) => {
  const client = creds ? getPayOSClient(creds) : defaultPayOS;
  return await client.paymentRequests.get(orderCode);
};

const verifyWebhook = async (payload, creds) => {
  const client = getPayOSClient(creds);
  return await client.webhooks.verify(payload);
};

module.exports = {
  createPaymentLink,
  getPaymentInfo,
  verifyWebhook
};