import assert from "node:assert/strict";

const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
};

const policy = await import("./js/referral-policy.js");

const now = Date.parse("2026-10-12T04:00:00.000Z");
const monthStart = Date.parse("2026-09-30T16:00:00.000Z");

assert.equal(policy.REFERRAL_MONTHLY_LIMIT, 3);
assert.equal(policy.REFERRAL_ACTIVE_LIMIT, 3);
assert.equal(policy.REFERRAL_INVITE_TTL_MS, 604800000);
assert.equal(policy.REFERRAL_RETENTION_MS, 2592000000);
assert.equal(policy.hongKongMonthKey(monthStart), "2026-10");
assert.equal(policy.hongKongMonthKey(Date.parse("2026-09-30T15:59:59.000Z")), "2026-09");

const accepted = (acceptedAt) => ({
  referrerId: "ada",
  status: "accepted",
  acceptedAt,
  expiresAt: acceptedAt + policy.REFERRAL_INVITE_TTL_MS,
});
const pending = (createdAt) => ({
  referrerId: "ada",
  status: "pending",
  createdAt,
  expiresAt: createdAt + policy.REFERRAL_INVITE_TTL_MS,
});

const fullMonth = policy.referralQuota({
  invites: [accepted(monthStart), accepted(monthStart + 1), accepted(monthStart + 2)],
  referrerId: "ada",
  now,
});
assert.equal(fullMonth.acceptedCount, 3);
assert.equal(fullMonth.canCreate, false);
assert.equal(fullMonth.reason, "You have used all 3 referrals this month.");

const activeCap = policy.referralQuota({
  invites: [
    accepted(monthStart),
    accepted(monthStart + 1),
    pending(now),
    pending(now + 1),
    pending(now + 2),
  ],
  referrerId: "ada",
  now,
});
assert.equal(activeCap.acceptedCount, 2);
assert.equal(activeCap.activeCount, 3);
assert.equal(activeCap.canCreate, false);
assert.equal(activeCap.reason, "You already have 3 active invites.");

const invite = {
  referrerId: "ada",
  status: "pending",
  createdAt: now - 1000,
  expiresAt: now + policy.REFERRAL_INVITE_TTL_MS,
  inviteeId: null,
};
const freshInvitee = { id: "bee", createdAt: now, status: "pending" };
assert.equal(policy.referralAcceptanceProblem({
  invite,
  invitee: { ...freshInvitee, createdAt: invite.createdAt - 1 },
  hasApplication: false,
  now,
}), "You already have an ITC account or application.");
assert.equal(policy.referralAcceptanceProblem({
  invite,
  invitee: freshInvitee,
  hasApplication: false,
  now,
}), null);
assert.equal(policy.referralAcceptanceProblem({
  invite,
  invitee: freshInvitee,
  hasApplication: true,
  now,
}), "You already have an ITC account or application.");
assert.equal(policy.referralAcceptanceProblem({
  invite,
  invitee: { id: "ada", createdAt: now, status: "pending" },
  hasApplication: false,
  now,
}), "You cannot accept your own referral invite.");
assert.equal(policy.referralAcceptanceProblem({
  invite: { ...invite, expiresAt: now },
  invitee: freshInvitee,
  hasApplication: false,
  now,
}), "This referral invite has expired.");
assert.equal(policy.referralAcceptanceProblem({
  invite: { ...invite, status: "accepted", inviteeId: "cee" },
  invitee: freshInvitee,
  hasApplication: false,
  now,
}), "This referral invite is no longer available.");

console.log("ok  referral policy enforces the monthly and invite rules");
