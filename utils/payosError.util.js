const PAYOS_CONFIG_MSG = "Quán chưa cấu hình hoặc sai PayOS";

const AUTH_ERROR_NAMES = new Set([
  "UnauthorizedError",
  "ForbiddenError",
  "InvalidSignatureError",
]);

function isPayosConfigRelatedError(error) {
  if (!error) return false;
  if (error.message === "Missing PayOS credentials") return true;
  if (AUTH_ERROR_NAMES.has(error.name)) return true;
  if ([401, 403].includes(error.status)) return true;

  const msg = String(error.message || "").toLowerCase();
  return /http 401|http 403|invalid signature|checksum|unauthorized|forbidden/.test(msg);
}

function resolvePayosApiErrorMessage(error, fallback = "Lỗi server") {
  if (isPayosConfigRelatedError(error)) return PAYOS_CONFIG_MSG;
  return error?.response?.data?.message || error?.message || fallback;
}

module.exports = {
  PAYOS_CONFIG_MSG,
  resolvePayosApiErrorMessage,
};
