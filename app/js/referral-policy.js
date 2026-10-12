export const REFERRAL_MONTHLY_LIMIT = 3;
export const REFERRAL_ACTIVE_LIMIT = 3;
export const REFERRAL_INVITE_TTL_MS = 604800000;
export const REFERRAL_RETENTION_MS = 2592000000;

const MONTHLY_REASON = "You have used all 3 referrals this month.";
const ACTIVE_REASON = "You already have 3 active invites.";

export function hongKongMonthKey(now = Date.now()) {
  const date = now instanceof Date ? now : new Date(now);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

export function referralQuota({ invites = [], referrerId, now = Date.now() } = {}) {
  const month = hongKongMonthKey(now);
  const mine = invites.filter((invite) => invite?.referrerId === referrerId);
  const acceptedCount = mine.filter((invite) => invite.status === "accepted"
    && hongKongMonthKey(invite.acceptedAt) === month).length;
  const activeCount = mine.filter((invite) => invite.status === "pending"
    && invite.expiresAt > now).length;
  if (acceptedCount >= REFERRAL_MONTHLY_LIMIT) {
    return { acceptedCount, activeCount, canCreate: false, reason: MONTHLY_REASON };
  }
  if (activeCount >= REFERRAL_ACTIVE_LIMIT) {
    return { acceptedCount, activeCount, canCreate: false, reason: ACTIVE_REASON };
  }
  return { acceptedCount, activeCount, canCreate: true, reason: null };
}

export function referralAcceptanceProblem({ invite, invitee, hasApplication = false, now = Date.now() } = {}) {
  if (!invite || invite.status !== "pending" || invite.inviteeId) {
    return "This referral invite is no longer available.";
  }
  if (invite.expiresAt <= now) return "This referral invite has expired.";
  if (!invitee?.id || invitee.id === invite.referrerId) {
    return "You cannot accept your own referral invite.";
  }
  if (hasApplication || invitee.createdAt < invite.createdAt || invitee.status !== "pending") {
    return "You already have an ITC account or application.";
  }
  return null;
}
