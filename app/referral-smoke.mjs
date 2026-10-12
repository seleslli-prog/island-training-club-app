import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

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

const store = await import("./js/store.js");
const STORAGE_KEY = "itc.prototype.v1";
const DAY = 86400000;
const createdAt = Date.parse("2026-10-12T04:00:00.000Z");

localStorage.setItem(STORAGE_KEY, JSON.stringify({
  version: 23,
  sessionUserId: "ada",
  users: [{
    id: "ada",
    role: "member",
    status: "approved",
    email: "ada@itc.test",
    fullName: "Ada Chan",
    preferredName: "Ada",
  }],
  bookings: [],
  receipts: [],
}));
const migrated = store.load();
assert.equal(migrated.version, 24);
assert.deepEqual(migrated.referralInvites, []);
assert.equal(migrated.users[0].email, "ada@itc.test");

const first = await store.createReferralInvite(createdAt);
assert.equal(first.status, "pending");
assert.equal(first.expiresAt, createdAt + policy.REFERRAL_INVITE_TTL_MS);
assert.match(first.inviteToken, /[A-Za-z0-9-]{8,}/);
assert.equal(first.tokenHash.length, 64);
assert.notEqual(first.tokenHash, first.inviteToken);
const persisted = store.load().referralInvites.find((invite) => invite.id === first.id);
assert.equal(persisted.inviteToken, undefined);
assert.equal(persisted.referrerId, "ada");
assert.equal(persisted.tokenHash, createHash("sha256").update(first.inviteToken).digest("hex"));

await store.createReferralInvite(createdAt + 1);
await store.createReferralInvite(createdAt + 2);
await assert.rejects(
  () => store.createReferralInvite(createdAt + 3),
  /You already have 3 active invites\./,
);

const cancelled = await store.cancelReferralInvite(first.id, createdAt + 4);
assert.equal(cancelled.status, "cancelled");
await assert.rejects(
  () => store.cancelReferralInvite(first.id, createdAt + 5),
  /Not authorized for this referral invite\.|Only a pending referral invite can be cancelled\./,
);

localStorage.setItem(STORAGE_KEY, JSON.stringify({
  ...store.load(),
  sessionUserId: "bee",
  users: [
    ...store.load().users,
    {
      id: "bee",
      role: "member",
      status: "approved",
      email: "bee@itc.test",
      fullName: "Bee Lee",
      preferredName: "Bee",
    },
  ],
}));
store.load();
const adaInvite = store.load().referralInvites.find((invite) => invite.status === "pending");
await assert.rejects(
  () => store.cancelReferralInvite(adaInvite.id, createdAt + 6),
  /Not authorized for this referral invite\./,
);

localStorage.setItem(STORAGE_KEY, JSON.stringify({
  ...store.load(),
  sessionUserId: "ada",
}));
store.load();
const expiredSource = store.load().referralInvites.find((invite) => invite.status === "pending");
const cancelRetention = cancelled.cancelledAt + policy.REFERRAL_RETENTION_MS;
store.sweepReferralInvites(cancelRetention - 1);
assert.equal(
  store.referralInvitesForCurrentUser(cancelRetention - 1).some((invite) => invite.id === cancelled.id),
  true,
);
store.sweepReferralInvites(cancelRetention);
assert.equal(
  store.referralInvitesForCurrentUser(cancelRetention).some((invite) => invite.id === cancelled.id),
  false,
);
store.sweepReferralInvites(expiredSource.expiresAt + policy.REFERRAL_RETENTION_MS);
assert.equal(
  store.load().referralInvites.some((invite) => invite.id === expiredSource.id),
  false,
);

console.log("ok  local referral invites migrate, cap, cancel, and expire");

function referralFixture(now) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 24,
    sessionUserId: "ada",
    users: [{
      id: "ada",
      role: "member",
      status: "approved",
      email: "ada@itc.test",
      fullName: "Ada Chan",
      preferredName: "Ada",
      createdAt: now - DAY,
    }, {
      id: "old",
      role: "pending",
      status: "pending",
      email: "old@itc.test",
      fullName: "Old Applicant",
      preferredName: "Old",
      createdAt: now - DAY,
      appliedAt: null,
    }],
    referralInvites: [],
    bookings: [],
    receipts: [],
  }));
  return store.load();
}

const acceptAt = Date.parse("2026-11-02T04:00:00.000Z");
referralFixture(acceptAt);
const freshInvite = await store.createReferralInvite(acceptAt);
assert.equal(store.referralInvitePreview(freshInvite.inviteToken).referrerPreferredName, "Ada");
localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...store.load(), sessionUserId: "old" }));
store.load();
await assert.rejects(
  () => store.acceptReferralInvite(freshInvite.inviteToken, acceptAt + 1),
  /You already have an ITC account or application\./,
);

store.signOut();
const started = store.startReferralAccount({
  fullName: "Bee Lee",
  preferredName: "Bee",
  email: "bee@itc.test",
  now: acceptAt + 2,
});
assert.equal(started.ok, true);
assert.equal(started.user.appliedAt, null);
assert.equal(started.user.status, "pending");
const acceptedInvite = await store.acceptReferralInvite(freshInvite.inviteToken, acceptAt + 3);
assert.equal(acceptedInvite.status, "accepted");
assert.equal(acceptedInvite.inviteeId, started.user.id);
assert.equal(store.referralForApplicant(started.user.id)?.id, acceptedInvite.id);

store.signOut();
const other = store.startReferralAccount({
  fullName: "Cee Wong",
  preferredName: "Cee",
  email: "cee@itc.test",
  now: acceptAt + 4,
});
assert.equal(other.ok, true);
await assert.rejects(
  () => store.acceptReferralInvite(freshInvite.inviteToken, acceptAt + 5),
  /This referral invite is no longer available\./,
);

localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...store.load(), sessionUserId: "ada" }));
store.load();
const second = await store.createReferralInvite(acceptAt + 6);
const third = await store.createReferralInvite(acceptAt + 7);
for (const [token, email, offset] of [
  [second.inviteToken, "dee@itc.test", 8],
  [third.inviteToken, "eve@itc.test", 10],
]) {
  store.signOut();
  store.startReferralAccount({
    fullName: email,
    preferredName: email,
    email,
    now: acceptAt + offset,
  });
  await store.acceptReferralInvite(token, acceptAt + offset + 1);
}
localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...store.load(), sessionUserId: "ada" }));
store.load();
await assert.rejects(
  () => store.createReferralInvite(acceptAt + 12),
  /You have used all 3 referrals this month\./,
);

localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...store.load(), sessionUserId: started.user.id }));
store.load();
const beforeUsers = store.load().users.length;
const applied = store.applyForMembership({
  fullName: "Bee Lee",
  preferredName: "Bee",
  email: "bee@itc.test",
  phone: "90000000",
  emergencyName: "Pat Lee",
  emergencyRelationship: "parent",
  emergencyPhone: "90000001",
  heard: "friend",
  ageConfirmed: true,
  mediaConsent: false,
  donorId: "",
  indemnity: true,
  indemnitySignature: "Bee Lee",
  indemnitySignedAt: "2026-10-12",
});
assert.equal(applied.ok, true);
assert.equal(applied.user.id, started.user.id);
assert.equal(store.load().users.length, beforeUsers);
assert.equal(store.referralForApplicant(started.user.id).applicationId, started.user.id);
store.declineApplicant(started.user.id);
assert.equal(store.referralForApplicant(started.user.id).status, "accepted");

console.log("ok  local referral acceptance keeps the monthly slot and resumes one application");

const views = await import("./js/views.js");
const appSource = readFileSync(new URL("./js/app.js", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("./js/store.js", import.meta.url), "utf8");
const screenAt = Date.parse("2026-10-12T04:00:00.000Z");

function screenFixture(invites) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 24,
    sessionUserId: "ada",
    users: [{
      id: "ada",
      role: "member",
      status: "approved",
      email: "ada@itc.test",
      fullName: "Ada Chan",
      preferredName: "Ada",
      createdAt: screenAt - DAY,
    }, {
      id: "pending-user",
      role: "pending",
      status: "pending",
      email: "pending@itc.test",
      fullName: "Pending Person",
      preferredName: "Pending",
      createdAt: screenAt,
      appliedAt: screenAt,
    }],
    referralInvites: invites,
    bookings: [],
    receipts: [],
  }));
  store.load();
}

const activeInvite = {
  id: "ref-active",
  referrerId: "ada",
  tokenHash: "a".repeat(64),
  status: "pending",
  createdAt: screenAt,
  expiresAt: screenAt + policy.REFERRAL_INVITE_TTL_MS,
  inviteeId: null,
  acceptedAt: null,
  applicationId: null,
};
const acceptedInvites = [1, 2].map((index) => ({
  id: `ref-accepted-${index}`,
  referrerId: "ada",
  tokenHash: String(index).repeat(64),
  status: "accepted",
  createdAt: screenAt,
  expiresAt: screenAt + policy.REFERRAL_INVITE_TTL_MS,
  inviteeId: `invitee-${index}`,
  acceptedAt: screenAt + index,
  applicationId: null,
}));
screenFixture([...acceptedInvites, activeInvite]);
const profile = await views.viewAccount();
assert.match(profile, /Refer a Friend/);
assert.match(profile, /href="#\/account\/referrals"/);
const referrals = await views.viewAccount("referrals");
assert.match(referrals, /<h1[^>]*>Refer a Friend<\/h1>/);
assert.match(referrals, /2 of 3 referrals used this month/);
assert.match(referrals, /1 of 3 active invites/);
assert.match(referrals, /data-action="referral-create"/);
assert.match(referrals, /data-action="referral-cancel"/);
screenFixture([]);
const copyInvite = await store.createReferralInvite(screenAt + 30);
const copyPage = await views.viewAccount("referrals");
assert.match(copyPage, /Copy link/);
assert.match(copyPage, new RegExp(copyInvite.inviteToken));

screenFixture([1, 2, 3].map((index) => ({ ...acceptedInvites[0], id: `full-${index}`, acceptedAt: screenAt + index })));
assert.match(await views.viewAccount("referrals"), /You have used all 3 referrals this month\./);
assert.match(await views.viewAccount("referrals"), /disabled/);
screenFixture([1, 2, 3].map((index) => ({ ...activeInvite, id: `active-${index}`, createdAt: screenAt + index })));
assert.match(await views.viewAccount("referrals"), /You already have 3 active invites\./);

localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...store.load(), sessionUserId: "pending-user" }));
store.load();
assert.doesNotMatch(await views.viewAccount(), /Refer a Friend/);

screenFixture([]);
const screenInvite = await store.createReferralInvite(screenAt + 20);
store.signOut();
const signedOut = await views.viewReferralInvite(screenInvite.inviteToken);
assert.match(signedOut, /Invited by Ada\./);
assert.match(signedOut, /href="#\/account"/);
assert.doesNotMatch(signedOut, /data-action="referral-accept"/);
assert.equal(store.load().referralInvites.every((invite) => invite.status === "pending"), true);

store.startReferralAccount({ fullName: "Bee Lee", preferredName: "Bee", email: "bee-screen@itc.test", now: screenAt + 10 });
const signedIn = await views.viewReferralInvite(screenInvite.inviteToken);
assert.match(signedIn, /Invited by Ada\./);
assert.match(signedIn, /data-action="referral-accept"/);
assert.match(appSource, /case "referral-accept"[\s\S]*#\/apply/);
assert.match(storeSource, /history\|referrals/);
assert.match(appSource, /referral: "account"/);

console.log("ok  referral screens show quota, invite state, and the accept route");

const adminAt = Date.parse("2026-10-01T16:00:00.000Z");
localStorage.setItem(STORAGE_KEY, JSON.stringify({
  version: 24,
  sessionUserId: "ada",
  users: [{
    id: "ada",
    role: "member",
    status: "approved",
    email: "ada@itc.test",
    fullName: "Ada Chan",
    preferredName: "Ada",
    createdAt: adminAt - DAY,
  }, {
    id: "admin",
    role: "admin",
    status: "approved",
    email: "admin@itc.test",
    fullName: "Admin Lee",
    preferredName: "Admin",
    createdAt: adminAt - DAY,
  }],
  referralInvites: [],
  bookings: [],
  receipts: [],
}));
store.load();
const adminInvite = await store.createReferralInvite(adminAt - 1000);
store.signOut();
const referred = store.startReferralAccount({
  fullName: "Bee Lee",
  preferredName: "Bee",
  email: "bee-admin@itc.test",
  now: adminAt - 500,
});
await store.acceptReferralInvite(adminInvite.inviteToken, adminAt);
store.applyForMembership({
  fullName: "Bee Lee",
  preferredName: "Bee",
  email: "bee-admin@itc.test",
  phone: "90000000",
  emergencyName: "Pat Lee",
  emergencyRelationship: "parent",
  emergencyPhone: "90000001",
  heard: "friend",
  ageConfirmed: true,
  mediaConsent: false,
  donorId: "",
  indemnity: true,
  indemnitySignature: "Bee Lee",
  indemnitySignedAt: "2026-10-01",
});
store.signOut();
store.startReferralAccount({
  fullName: "Plain Applicant",
  preferredName: "Plain",
  email: "plain@itc.test",
  now: adminAt + 1,
});
store.applyForMembership({
  fullName: "Plain Applicant",
  preferredName: "Plain",
  email: "plain@itc.test",
  phone: "90000002",
  emergencyName: "Pat Plain",
  emergencyRelationship: "sibling",
  emergencyPhone: "90000003",
  heard: "event",
  ageConfirmed: true,
  mediaConsent: false,
  donorId: "",
  indemnity: true,
  indemnitySignature: "Plain Applicant",
  indemnitySignedAt: "2026-10-01",
});
store.signIn("admin@itc.test");
const adminHtml = await views.viewAdmin("members");
const approvals = adminHtml.slice(adminHtml.indexOf("Ready for review"));
const beeCard = approvals.slice(approvals.indexOf("Bee Lee"), approvals.indexOf("Plain Applicant"));
const plainCard = approvals.slice(approvals.indexOf("Plain Applicant"));
assert.match(beeCard, /Referred by Ada/);
assert.match(beeCard, /Accepted 2 Oct/);
assert.doesNotMatch(plainCard, /Referred by/);
assert.match(adminHtml, /data-action="approve"/);
assert.match(adminHtml, /data-action="decline"/);
assert.equal(referred.ok, true);

console.log("ok  Admin approvals show referral context without changing decisions");
