const Subscription = require("../../models/subscription.model");
const SubscriptionAccount = require("../../models/subcription_account.model");

const ACTIVE_STATUSES = ["active", "Active"];
const ALLOWED_MONTHS = [1, 3, 6, 12];
const SUBSCRIPTION_PAYMENT_PREFIX = "SubscriptionPayment:";

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

const buildSubscriptionPaymentDescription = (subscriptionId, clubId, months) =>
  `${SUBSCRIPTION_PAYMENT_PREFIX}${subscriptionId}:${clubId}:${months}`;

const parseSubscriptionPaymentDescription = (description) => {
  if (!description?.startsWith(SUBSCRIPTION_PAYMENT_PREFIX)) {
    return null;
  }

  const parts = description.slice(SUBSCRIPTION_PAYMENT_PREFIX.length).split(":");
  if (parts.length !== 3) {
    return null;
  }

  const [subscription_id, club_id, duration_months] = parts;
  const months = Number(duration_months || 1);

  return {
    subscription_id,
    club_id,
    duration_months: ALLOWED_MONTHS.includes(months) ? months : 1
  };
};

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

async function activateClubSubscription({
  subscription_id,
  club_id,
  accountId,
  duration_months
}) {
  const months = Number(duration_months || 1);
  if (!ALLOWED_MONTHS.includes(months)) {
    throw new Error("duration_months chỉ chấp nhận: 1, 3, 6, 12");
  }

  const subscription = await Subscription.findById(subscription_id);
  if (!subscription) {
    throw new Error("Subscription không tồn tại");
  }

  const activeSub = await findActiveSubscriptionForClub(club_id, {
    populate: true
  });

  if (isDowngradeBlocked(activeSub, subscription)) {
    throw new Error("Đang sử dụng gói Pro, không thể chuyển xuống Basic");
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
      club_id,
      purchase_date: purchaseDate,
      start_date: purchaseDate,
      expire_date: expireDate,
      purchase_price: price,
      status: "active",
      post_limit: subscription.post_limit || 0,
      posts_used: 0
    });
  }

  return clubSubscription;
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
  ALLOWED_MONTHS,
  isStatusActive,
  isNotExpired,
  isSubscriptionValid,
  getPlanTier,
  isDowngradeBlocked,
  calculateSubscriptionPrice,
  calculateRenewalExpireDate,
  buildSubscriptionPaymentDescription,
  parseSubscriptionPaymentDescription,
  markSubscriptionExpired,
  findClubSubscriptionRecord,
  findActiveSubscriptionForClub,
  activateClubSubscription,
  expireOverdueSubscriptions
};
