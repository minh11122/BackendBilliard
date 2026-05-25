const SubscriptionAccount = require("../models/subcription_account.model");

const ACTIVE_STATUSES = ["active", "Active"];

function isStatusActive(status) {
  return ACTIVE_STATUSES.includes(status);
}

/** Gói còn hiệu lực đến hết ngày expire_date (23:59:59). */
function isNotExpired(expireDate, now = new Date()) {
  if (!expireDate) return false;
  const endOfExpireDay = new Date(expireDate);
  endOfExpireDay.setHours(23, 59, 59, 999);
  return endOfExpireDay.getTime() >= now.getTime();
}

function isSubscriptionValid(account, now = new Date()) {
  return (
    !!account &&
    isStatusActive(account.status) &&
    isNotExpired(account.expire_date, now)
  );
}

function getPlanTier(subscription) {
  const name = String(subscription?.name || "").toLowerCase();
  if (name.includes("pro")) return 2;
  if (name.includes("basic")) return 1;
  return 0;
}

function isDowngradeBlocked(activeAccount, targetSubscription) {
  if (!isSubscriptionValid(activeAccount)) return false;
  const currentTier = getPlanTier(activeAccount.subscription_id);
  const targetTier = getPlanTier(targetSubscription);
  return currentTier === 2 && targetTier === 1;
}

function calculateSubscriptionPrice(subscription, months) {
  return Math.max(0, Math.round((subscription.price || 0) * months));
}

function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Gia hạn: cộng thêm months từ ngày hết hạn nếu gói còn hạn,
 * hoặc từ hôm nay nếu đã hết hạn.
 */
function calculateRenewalExpireDate(existingExpireDate, months, now = new Date()) {
  let base = new Date(now);
  if (existingExpireDate) {
    const existing = new Date(existingExpireDate);
    if (isNotExpired(existingExpireDate, now)) {
      base = existing;
    }
  }
  return addMonths(base, months);
}

async function markSubscriptionExpired(account) {
  if (!account || !isStatusActive(account.status)) return;
  if (isNotExpired(account.expire_date)) return;
  account.status = "expired";
  await account.save();
}

function findClubSubscriptionRecord(clubId, { populate = false } = {}) {
  let query = SubscriptionAccount.findOne({ club_id: clubId }).sort({
    purchase_date: -1
  });
  if (populate) {
    query = query.populate("subscription_id");
  }
  return query;
}

async function findActiveSubscriptionForClub(clubId, { populate = false } = {}) {
  const record = await findClubSubscriptionRecord(clubId, { populate });
  if (!record) return null;

  if (!isSubscriptionValid(record)) {
    await markSubscriptionExpired(record);
    return null;
  }

  return record;
}

async function expireOverdueSubscriptions() {
  const now = new Date();
  const candidates = await SubscriptionAccount.find({
    status: { $in: ACTIVE_STATUSES }
  }).lean();

  const idsToExpire = candidates
    .filter((row) => !isNotExpired(row.expire_date, now))
    .map((row) => row._id);

  if (idsToExpire.length === 0) return 0;

  const result = await SubscriptionAccount.updateMany(
    { _id: { $in: idsToExpire } },
    { $set: { status: "expired" } }
  );

  return result.modifiedCount || 0;
}

module.exports = {
  ACTIVE_STATUSES,
  isStatusActive,
  isNotExpired,
  isSubscriptionValid,
  getPlanTier,
  isDowngradeBlocked,
  calculateSubscriptionPrice,
  calculateRenewalExpireDate,
  markSubscriptionExpired,
  findClubSubscriptionRecord,
  findActiveSubscriptionForClub,
  expireOverdueSubscriptions
};
