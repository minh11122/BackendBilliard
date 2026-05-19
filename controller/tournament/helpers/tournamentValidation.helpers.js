const normalizePrizePool = (prizePool, fee = 0) => {
  const feeValue = Number(fee) || 0;
  if (!Number.isFinite(feeValue) || feeValue < 0) {
    return { error: "Phí tham gia không được là số âm" };
  }

  const rawPrizePool =
    typeof prizePool === "string" ? prizePool.trim() : prizePool;

  if (
    rawPrizePool === undefined ||
    rawPrizePool === null ||
    rawPrizePool === ""
  ) {
    return { error: "Tiền thưởng là bắt buộc" };
  }

  const prizeValue = Number(rawPrizePool);
  if (!Number.isFinite(prizeValue) || prizeValue <= 0) {
    return { error: "Tiền thưởng phải lớn hơn 0" };
  }

  if (feeValue > 0 && prizeValue <= feeValue) {
    return { error: "Tiền thưởng phải lớn hơn phí tham gia" };
  }

  return { value: String(prizeValue) };
};

module.exports = {
  normalizePrizePool,
};
