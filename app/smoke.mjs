// Headless smoke test: render every view for every user state.
// Run: node --input-type=module < smoke.mjs  (from the app/ directory)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { assertFpsCopyBindings } from "./test-html.mjs";

// --- localStorage shim ---
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

function islandEccOpenNow(session, now = Date.now()) {
  if (!session?.dateISO || !data.ISLAND_ECC_HYROX_ACTIVITY_IDS.has(session.activityId)) return now;
  return Math.max(now, data.islandEccSignupOpensAt(session.dateISO));
}
const store = await import("./js/store.js");
const views = await import("./js/views.js");
const data = await import("./js/data.js");
const { buildIndemnityCsv } = await import("./js/exports.js");

const indemnityExportCsv = buildIndemnityCsv([{
  fullName: 'O"Connor, Ada',
  email: "ada@example.test",
  status: "approved",
  role: "member",
  phone: "+852 5555 5555",
  emergencyName: 'Grace O"Connor',
  emergencyRelationship: "Parent",
  emergencyPhone: "+852 6666 6666",
  indemnityStatus: "Accepted",
  indemnitySignature: 'Ada O"Connor',
  indemnitySignedAt: "2026-08-01",
  indemnityFormVersion: "v1",
  indemnityAcceptedAt: "2026-08-01T12:00:00.000Z",
}]);
if (indemnityExportCsv.charCodeAt(0) !== 0xFEFF
    || !indemnityExportCsv.includes("Name,Email,Status,Role,Phone,Emergency name,Emergency relationship,Emergency phone,Indemnity status,Signature,Signed date,Form version,Accepted at")
    || !indemnityExportCsv.includes('O""Connor, Ada')
    || !indemnityExportCsv.includes('Grace O""Connor')) {
  throw new Error("indemnity export must be Excel-compatible CSV with escaped values");
}

// --- Route handoff persistence --------------------------------------------------------------
const LAST_ROUTE_KEY = "itc.last-route.v1";
for (const route of [
  "#/home",
  "#/schedule",
  "#/activity/wnt-2099-01-01",
  "#/hyrox/hyrox-pool-2099-01-03/register",
  "#/community/announcements",
  "#/giving",
  "#/notifications",
  "#/account/bookings/attended",
  "#/account/notifications/edit",
  "#/apply",
  "#/checkout/hyrox-bft-2099-01-03",
  "#/pay/booking-123",
  "#/booking/booking-123",
  "#/receipt/receipt-123",
  "#/admin/payments",
  "#/admin/prayers",
  "#/admin/activity/hyrox-bft",
  "#/admin/campaign/campaign-123",
]) {
  assert.equal(store.rememberLastRoute(route, "member-a"), true, `${route} should be restorable`);
  assert.equal(store.lastRouteFor("member-a"), route, `${route} should round-trip`);
}
assert.equal(store.lastRouteFor("member-b"), null,
  "one signed-in user must not restore another user's route");
store.rememberLastRoute("#/account/bookings", "member-a");
assert.equal(store.startupRoute("", "member-a"), "#/account/bookings",
  "an empty app launch should restore the current user's last route");
assert.equal(store.startupRoute("#/home", "member-a"), "#/home",
  "an explicit Home route must override a stored route");
assert.equal(store.startupRoute("#/community/about", "member-a"), "#/community/about",
  "an explicit deep link must override a stored route");
assert.equal(store.startupRoute("", "member-b"), "#/home",
  "an identity mismatch must fall back to Home");
for (const invalidRoute of [
  "https://example.com/steal",
  "javascript:alert(1)",
  "#/unknown",
  "#/pay/booking-123?next=https://example.com",
  "#/account/not-a-page",
]) {
  assert.equal(store.rememberLastRoute(invalidRoute, "member-a"), false,
    `${invalidRoute} must not be persisted`);
}
localStorage.setItem(LAST_ROUTE_KEY, "not json");
assert.equal(store.lastRouteFor("member-a"), null, "malformed route records must not restore");
assert.equal(localStorage.getItem(LAST_ROUTE_KEY), null, "malformed route records should be cleared");
store.clearLastRoute();
console.log("ok  route handoff storage validates, isolates and round-trips app routes");

assert.equal(store.shouldRedirectPendingApplicant({
  role: "pending",
  hasApplication: false,
  route: "#/community/prayers",
}), false, "pending applicants must be able to reach the read-only Prayer gate");
assert.equal(store.shouldRedirectPendingApplicant({
  role: "pending",
  hasApplication: false,
  route: "#/home",
}), true, "pending applicants without applications should still be routed into onboarding elsewhere");
assert.equal(store.shouldRedirectPendingApplicant({
  role: "pending",
  hasApplication: false,
  route: "#/apply",
}), false, "the application route must not redirect to itself");
assert.equal(store.shouldRedirectPendingApplicant({
  role: "pending",
  hasApplication: true,
  route: "#/home",
}), false, "submitted pending applicants must not be forced back into the application form");
assert.equal(store.shouldRedirectPendingApplicant({
  role: "member",
  hasApplication: false,
  route: "#/home",
}), false, "approved roles must never use pending-applicant routing");
console.log("ok  pending onboarding preserves the read-only Prayer gate");

const hktRolloverInstant = Date.parse("2026-08-05T16:30:00.000Z");
assert.equal(data.todayHktISO(hktRolloverInstant), "2026-08-06",
  "current HKT date must not depend on the browser timezone");
assert.equal(
  data.hktEventStartMs("2026-08-06", "00:30:00"),
  hktRolloverInstant,
  "Hong Kong event wall time must resolve to the same instant in every browser timezone",
);

// A wrong status branch or off-by-one boundary puts collectors or check-in
// controls in the wrong operational state.
assert.equal(store.paymentStateForBooking({ status: "reserved", paymentMarkedAt: null }), "payment_due");
assert.equal(store.paymentStateForBooking({ status: "reserved", paymentMarkedAt: 1 }), "awaiting_confirmation");
assert.equal(store.paymentStateForBooking({ status: "confirmed", paymentMarkedAt: 1 }), "paid");
assert.equal(store.paymentStateForBooking({ status: "attended", paymentMarkedAt: 1 }), "paid");
for (const status of ["cancelled", "expired", "deferred", "withdrawn"]) {
  assert.equal(store.paymentStateForBooking({ status, paymentMarkedAt: 1 }), null);
}
const attendanceBoundarySession = { dateISO: "2026-09-12", time: "11:00", durationMin: 60 };
const attendanceBoundaryStart = Date.parse("2026-09-12T03:00:00.000Z");
assert.deepEqual(
  store.attendanceWindowForSession(attendanceBoundarySession, attendanceBoundaryStart - 15 * 60_000),
  {
    opensAt: Date.parse("2026-09-12T02:45:00.000Z"),
    closesAt: Date.parse("2026-09-13T04:00:00.000Z"),
    state: "open",
  },
);
assert.equal(store.attendanceWindowForSession(
  attendanceBoundarySession, Date.parse("2026-09-12T02:44:59.999Z")
).state, "upcoming");
assert.equal(store.attendanceWindowForSession(
  attendanceBoundarySession, Date.parse("2026-09-13T04:00:00.000Z")
).state, "open");
assert.equal(store.attendanceWindowForSession(
  attendanceBoundarySession, Date.parse("2026-09-13T04:00:00.001Z")
).state, "locked");

let failures = 0;
async function check(label, fn) {
  try {
    const out = await Promise.resolve(fn());
    if (out && typeof out === "object" && out.redirect) {
      console.log(`ok(redirect) ${label} -> ${out.redirect}`);
      return out;
    }
    if (typeof out !== "string" || out.length < 50) {
      throw new Error(`suspicious output (len ${typeof out === "string" ? out.length : "obj"})`);
    }
    console.log(`ok  ${label}`);
    return out;
  } catch (err) {
    failures++;
    console.error(`FAIL ${label}: ${err.message}`);
    return "";
  }
}

function assertProfileSubpageHierarchy(html, expectedTitle) {
  assert.equal((html.match(/<h1\b/g) || []).length, 1,
    `${expectedTitle} must render exactly one h1`);
  assert.match(html, /class="back-link"/,
    `${expectedTitle} must render a back link before its heading`);
  const heading = html.match(/<h1\b[^>]*>([^<]+)<\/h1>/);
  assert.equal(heading?.[1], expectedTitle,
    `${expectedTitle} must be the exact h1 text`);
  assert.doesNotMatch(html, /<div class="kicker mt16">Profile ·/,
    `${expectedTitle} must not repeat Profile in a neon kicker`);
}

const primaryNavLabels = (html) =>
  [...html.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]);

function assertPrimaryNav(user, expected, label) {
  const html = views.navHTML("home", user);
  const labels = primaryNavLabels(html);
  if (JSON.stringify(labels) !== JSON.stringify(expected)) {
    throw new Error(`${label} primary navigation labels were ${JSON.stringify(labels)}`);
  }
  if (labels.includes("Admin")) {
    throw new Error(`${label} primary navigation must not include Admin`);
  }
  if (labels.includes("Giving") !== !!user) {
    throw new Error(`Giving must appear only in signed-in primary navigation (${label})`);
  }
  if (labels.includes("Account") || (labels.includes("Profile") !== !!user)) {
    throw new Error(`Profile must appear only in signed-in primary navigation (${label})`);
  }
}

const freshV27State = store.load();
assert.equal(freshV27State.version, 30, "fresh local state must use the v30 schema");
assert.equal(data.SEED_ACTIVITIES.some(
  (activity) => ["hyrox-bft", "hyrox-midtown"].includes(activity.id)
), false, "fresh activity seeds must not contain the retired BFT/Midtown pool");
assert.equal(freshV27State.activities.some(
  (activity) => ["hyrox-bft", "hyrox-midtown"].includes(activity.id)
), false, "fresh v27 state must not activate retired BFT/Midtown templates");
const quarryBayEarlySeed = data.SEED_ACTIVITIES.find(
  (activity) => activity.id === "hyrox-quarry-bay-early"
);
const quarryBaySeed = data.SEED_ACTIVITIES.find((activity) => activity.id === "hyrox-quarry-bay");
for (const activityId of ["wnt", "run", "water"]) {
  const freeSeed = data.SEED_ACTIVITIES.find((activity) => activity.id === activityId);
  assert.deepEqual(freeSeed && {
    kind: freeSeed.kind,
    requiresRsvp: freeSeed.requiresRsvp,
    capacity: freeSeed.capacity,
  }, {
    kind: "free",
    requiresRsvp: true,
    capacity: null,
  }, `${activityId} must remain free while enabling uncapped RSVP headcounts`);
}
assert.ok(quarryBaySeed, "Island ECC HYROX must remain seeded");
assert.ok(quarryBayEarlySeed, "the early Island ECC HYROX slot must be seeded");
{
  const saturday = "2026-10-10";
  assert.equal(data.islandEccSignupOpensAt(saturday), Date.parse("2026-10-05T18:00:00+08:00"));
  assert.equal(data.islandEccPaymentDeadlineAt(saturday), Date.parse("2026-10-08T18:00:00+08:00"));
  assert.equal(data.islandEccMemberReminderAt(saturday), Date.parse("2026-10-09T18:00:00+08:00"));
  assert.equal(data.islandEccLeftoverPayByAt(saturday), Date.parse("2026-10-09T21:00:00+08:00"));
  assert.equal(data.islandEccCollectorFinalizeNudgeAt(saturday), Date.parse("2026-10-09T21:00:00+08:00"));
  assert.equal(data.islandEccSignupOpen(saturday, Date.parse("2026-10-05T17:59:00+08:00")), false);
  assert.equal(data.islandEccSignupOpen(saturday, Date.parse("2026-10-05T18:00:00+08:00")), true);
  assert.equal(
    data.islandEccNextPayDeadline(saturday, Date.parse("2026-10-08T17:59:00+08:00")),
    Date.parse("2026-10-08T18:00:00+08:00"),
  );
  assert.equal(
    data.islandEccNextPayDeadline(saturday, Date.parse("2026-10-08T18:00:00+08:00")),
    Date.parse("2026-10-09T21:00:00+08:00"),
  );
  assert.equal(typeof data.finalCheckpointFor, "function");
  assert.equal(data.LAST_MINUTE_WINDOW_MS, 2 * 60 * 60 * 1000);
  assert.equal(
    data.nextPayDeadline(saturday, Date.parse("2026-10-08T18:00:00+08:00")),
    data.finalCheckpointFor(saturday),
    "non–Island ECC nextPayDeadline still uses Friday 14:00 after Thursday 18:00",
  );
  assert.equal(data.ISLAND_ECC_SIGNUP_LOCKED_ERROR, "HYROX sign-up opens Monday at 6 PM HKT.");
  console.log("ok  Island ECC HKT signup and pay-by helpers");
}
assert.equal(data.SEED_ACTIVITIES.some((activity) => activity.id === "hyrox"), false,
  "the ambiguous legacy hyrox activity id must not remain canonical");
assert.deepEqual(quarryBaySeed && {
  name: quarryBaySeed.name,
  weekday: quarryBaySeed.weekday,
  time: quarryBaySeed.time,
  durationMin: quarryBaySeed.durationMin,
  location: quarryBaySeed.location,
  mapsQuery: quarryBaySeed.mapsQuery,
  price: quarryBaySeed.price,
  capacity: quarryBaySeed.capacity,
}, {
  name: "ITC HYROX",
  weekday: 6,
  time: "10:30",
  durationMin: 60,
  location: "10/F, Island ECC, Quarry Bay",
  mapsQuery: "Island ECC, Quarry Bay, Hong Kong",
  price: 180,
  capacity: 30,
}, "the later Island ECC HYROX slot must match the approved recurring-session details");
assert.deepEqual(quarryBayEarlySeed && {
  name: quarryBayEarlySeed.name,
  weekday: quarryBayEarlySeed.weekday,
  time: quarryBayEarlySeed.time,
  durationMin: quarryBayEarlySeed.durationMin,
  location: quarryBayEarlySeed.location,
  mapsQuery: quarryBayEarlySeed.mapsQuery,
  price: quarryBayEarlySeed.price,
  capacity: quarryBayEarlySeed.capacity,
}, {
  name: "ITC HYROX",
  weekday: 6,
  time: "09:15",
  durationMin: 60,
  location: "10/F, Island ECC, Quarry Bay",
  mapsQuery: "Island ECC, Quarry Bay, Hong Kong",
  price: 180,
  capacity: 30,
}, "the early Island ECC HYROX slot must match the approved recurring-session details");
const orderedSaturdaySessions = data.sessionsInRange([
  data.SEED_ACTIVITIES.find((activity) => activity.id === "lunch"),
  quarryBaySeed,
  quarryBayEarlySeed,
], new Date(2099, 0, 3), 1);
assert.deepEqual(
  orderedSaturdaySessions.map((session) => session.time),
  ["09:15", "10:30", "12:45"],
  "Saturday sessions must render chronologically so lunch follows both HYROX slots"
);
assert.deepEqual(
  [
    data.SEED_ACTIVITIES.find((activity) => activity.id === "lunch"),
    quarryBaySeed,
    quarryBayEarlySeed,
    data.SEED_ACTIVITIES.find((activity) => activity.id === "wnt"),
    data.SEED_ACTIVITIES.find((activity) => activity.id === "run"),
  ].sort(data.compareActivitiesByWeekday).map((activity) => `${activity.id}:${activity.time}`),
  [
    "run:19:30",
    "wnt:19:30",
    "hyrox-quarry-bay-early:09:15",
    "hyrox-quarry-bay:10:30",
    "lunch:12:45",
  ],
  "recurring activity templates must sort by weekday, then start time"
);
assert.equal(data.fmtMoney(180), "HK$180",
  "consumer-facing Hong Kong prices should use the standard HK$ symbol");
const historicalBftActivity = {
  ...quarryBaySeed,
  id: "hyrox-bft",
  time: "11:15",
  durationMin: 75,
  location: "BFT Causeway Bay",
  mapsQuery: "BFT Causeway Bay, Hong Kong",
  capacity: 20,
};
const legacyBftActivity = { ...historicalBftActivity, id: "hyrox" };
localStorage.setItem("itc.prototype.v1", JSON.stringify({
  version: 16,
  sessionUserId: null,
  activities: [legacyBftActivity, {
    ...quarryBaySeed,
    time: "11:00",
    location: "10/F, 633 King's Road, Quarry Bay, Hong Kong",
    mapsQuery: "10/F, 633 King's Road, Quarry Bay, Hong Kong",
  }],
  users: [{ id: "legacy-member", hyroxPaymentReminders: undefined }],
  bookings: [{
    id: "legacy-bft-booking", userId: "legacy-member",
    sessionId: "hyrox-2099-01-03", status: "confirmed",
    deferredTo: "hyrox-2099-01-10",
    snapshot: { name: "ITC HYROX", dateISO: "2099-01-03", time: "11:15", location: "BFT Causeway Bay", price: 180 },
  }, {
    id: "legacy-quarry-booking", userId: "legacy-member",
    sessionId: "hyrox-quarry-bay-2099-01-03", status: "confirmed",
    snapshot: { name: "ITC HYROX", dateISO: "2099-01-03", time: "11:00", location: "10/F, 633 King's Road, Quarry Bay, Hong Kong", price: 180 },
  }],
  receipts: [{ id: "legacy-receipt", bookingId: "legacy-bft-booking", sessionId: "hyrox-2099-01-03" }],
  receiptCounter: 50,
  paymentPayouts: {}, campaigns: [], donations: [], prayers: [], oneOffEvents: [],
  sessionOverrides: { "hyrox-2099-01-03": { cancelled: "Legacy fixture" } },
  queues: { "hyrox-2099-01-03": { waitlist: [], interest: [] } },
  notifications: [{ id: "legacy-note", link: "#/activity/hyrox-2099-01-03" }],
  duty: {},
}));
const renamedState = store.load();
assert.equal(renamedState.version, 30, "legacy state must advance through the current migrations");
assert.equal(renamedState.users.find((user) => user.id === "legacy-member").hyroxPaymentReminders, true);
assert.equal(renamedState.users.find((user) => user.id === "legacy-member").webPushOps, false);
assert.equal(renamedState.hyroxCycles["legacy-cycle"]?.collectorPaymentReminderSentAt ?? null, null);
assert.equal(renamedState.activities.some((activity) => activity.id === "hyrox-bft"), false);
assert.ok(renamedState.activities.some((activity) => activity.id === "hyrox-quarry-bay"));
assert.ok(renamedState.activities.some((activity) => activity.id === "hyrox-quarry-bay-early"));
assert.equal(renamedState.activities.some((activity) => activity.id === "hyrox"), false);
assert.equal(renamedState.bookings.some((booking) => booking.id === "legacy-bft-booking"), false);
assert.equal(renamedState.receipts.some((receipt) => receipt.id === "legacy-receipt"), false);
assert.equal(renamedState.queues["hyrox-bft-2099-01-03"], undefined);
assert.equal(renamedState.sessionOverrides["hyrox-bft-2099-01-03"], undefined);
assert.equal(renamedState.notifications.some((notification) => notification.id === "legacy-note"), false);
const migratedQuarryBay = renamedState.activities.find((activity) =>
  activity.id === "hyrox-quarry-bay"
);
assert.equal(migratedQuarryBay.location, "10/F, Island ECC, Quarry Bay");
assert.equal(migratedQuarryBay.mapsQuery, "Island ECC, Quarry Bay, Hong Kong");
assert.equal(migratedQuarryBay.time, "10:30");
assert.equal(
  renamedState.bookings.find((booking) => booking.id === "legacy-quarry-booking")?.snapshot.location,
  "10/F, Island ECC, Quarry Bay",
  "existing Quarry Bay booking snapshots must show the corrected venue"
);
assert.equal(
  renamedState.bookings.find((booking) => booking.id === "legacy-quarry-booking")?.snapshot.time,
  "10:30",
  "upcoming Quarry Bay booking snapshots must move from 11:00 AM to 10:30 AM"
);
store.resetLocalData();

// v24 retires only canonical BFT/Midtown relationships. Island ECC and
// unrelated lookalike IDs must survive byte-for-byte through the migration.
{
  const v23PoolFixture = {
    version: 23,
    sessionUserId: null,
    activities: [
      { ...historicalBftActivity },
      { ...historicalBftActivity, id: "hyrox-midtown", time: "11:00", location: "Midtown28 Fitness" },
      { ...quarryBaySeed },
      { id: "event-hyrox-bft-party", name: "BFT community party", kind: "free", published: true },
    ],
    users: [],
    bookings: [
      { id: "pool-booking", cycleId: "hyrox-pool-2099-01-03", sessionId: null, snapshot: { name: "ITC HYROX" } },
      { id: "bft-booking", cycleId: null, sessionId: "hyrox-bft-2099-01-03", snapshot: { name: "ITC HYROX" } },
      { id: "midtown-booking", cycleId: null, sessionId: "hyrox-midtown-2099-01-03", snapshot: { name: "ITC HYROX" } },
      { id: "ecc-booking", cycleId: "island-ecc-cycle-2099-01-03", sessionId: "hyrox-quarry-bay-2099-01-03", snapshot: { name: "ITC HYROX", location: "10/F, Island ECC, Quarry Bay" } },
      { id: "lookalike-booking", cycleId: "community-cycle-2099-01-03", sessionId: "event-hyrox-bft-party-2099-01-03", snapshot: { name: "BFT community party" } },
    ],
    receipts: [
      { id: "pool-receipt", bookingId: "pool-booking", sessionId: null },
      { id: "bft-receipt", bookingId: "bft-booking", sessionId: "hyrox-bft-2099-01-03" },
      { id: "ecc-receipt", bookingId: "ecc-booking", cycleId: "island-ecc-cycle-2099-01-03", sessionId: "hyrox-quarry-bay-2099-01-03" },
      { id: "lookalike-receipt", bookingId: "lookalike-booking", cycleId: "community-cycle-2099-01-03", sessionId: "event-hyrox-bft-party-2099-01-03" },
    ],
    receiptCounter: 77,
    paymentPayouts: {}, campaigns: [], donations: [], prayers: [], oneOffEvents: [],
    sessionOverrides: {
      "hyrox-bft-2099-01-03": { cancelled: "retired" },
      "hyrox-midtown-2099-01-03": { notice: "retired" },
      "hyrox-quarry-bay-2099-01-03": { notice: "Island ECC unchanged" },
      "event-hyrox-bft-party-2099-01-03": { notice: "lookalike unchanged" },
    },
    queues: {
      "hyrox-bft-2099-01-03": { waitlist: [{ userId: "pool-user" }], interest: [] },
      "hyrox-midtown-2099-01-03": { waitlist: [], interest: [{ userId: "pool-user" }] },
      "hyrox-quarry-bay-2099-01-03": { waitlist: [{ userId: "ecc-user" }], interest: [] },
      "event-hyrox-bft-party-2099-01-03": { waitlist: [{ userId: "party-user" }], interest: [] },
    },
    hyroxCycles: {
      "hyrox-pool-2099-01-03": {
        id: "hyrox-pool-2099-01-03",
        bftSessionId: "hyrox-bft-2099-01-03",
        midtownSessionId: "hyrox-midtown-2099-01-03",
      },
    },
    hyroxCycleQueues: {
      "hyrox-pool-2099-01-03": [{ id: "pool-cycle-queue", cycleId: "hyrox-pool-2099-01-03" }],
    },
    replacementRequests: [
      { id: "pool-replacement", bookingId: "pool-booking", status: "accepted" },
      { id: "bft-replacement", bookingId: "bft-booking", status: "pending" },
      { id: "ecc-replacement", bookingId: "ecc-booking", cycleId: "island-ecc-cycle-2099-01-03", status: "confirmed" },
      { id: "lookalike-replacement", bookingId: "lookalike-booking", cycleId: "community-cycle-2099-01-03", status: "rejected" },
    ],
    replacementAudit: [
      { id: "pool-audit", requestId: "pool-replacement", bookingId: "pool-booking" },
      { id: "ecc-audit", requestId: "ecc-replacement", bookingId: "ecc-booking" },
      { id: "lookalike-audit", requestId: "lookalike-replacement", bookingId: "lookalike-booking" },
    ],
    notifications: [
      { id: "pool-kind-note", kind: "operational_hyrox_reserved", destination: "#/schedule" },
      { id: "pool-booking-note", kind: "payment_confirmed", bookingId: "pool-booking" },
      { id: "bft-route-note", kind: "session_updated", destination: "#/activity/hyrox-bft-2099-01-03" },
      { id: "ecc-note", userId: "ecc-user", kind: "payment_confirmed", cycleId: "island-ecc-cycle-2099-01-03", destination: "#/booking/ecc-booking" },
      { id: "unrelated-note", userId: "party-user", kind: "event-hyrox-bft-party", cycleId: "community-cycle-2099-01-03", destination: "#/activity/event-hyrox-bft-party-2099-01-03" },
    ],
    duty: {
      retiredSession: { userId: "collector-a", sessionId: "hyrox-bft-2099-01-03" },
      retiredCycle: { userId: "collector-b", cycleId: "hyrox-pool-2099-01-03" },
      islandEcc: { userId: "collector-c", cycleId: "island-ecc-cycle-2099-01-03", sessionId: "hyrox-quarry-bay-2099-01-03" },
      sharedSaturday: { userId: "collector-d" },
      lookalike: { userId: "collector-e", cycleId: "community-cycle-2099-01-03", sessionId: "event-hyrox-bft-party-2099-01-03" },
    },
  };
  // Historical local producer has only kind/link and Date.now() provenance.
  v23PoolFixture.replacementRequests[0].acceptedAt = 1000;
  v23PoolFixture.replacementRequests[2].acceptedAt = 2000;
  v23PoolFixture.replacementRequests.push(
    { id: "ambiguous-pool", bookingId: "pool-booking", acceptedAt: 3000 },
    { id: "ambiguous-ecc", bookingId: "ecc-booking", acceptedAt: 3000 },
  );
  const reviewNotice = (id, createdAt) => ({
    id, userId: "review-admin", kind: "hyrox-replacement-review",
    body: "A HYROX replacement needs Admin confirmation.",
    link: "#/admin/ops", createdAt, read: false,
  });
  v23PoolFixture.notifications.push(
    reviewNotice("retired-review", 1000), reviewNotice("ecc-review", 2000),
    reviewNotice("ambiguous-review", 3000), reviewNotice("unmatched-review", 4000),
  );
  const expectedEccReview = structuredClone(v23PoolFixture.notifications.find((row) => row.id === "ecc-review"));
  const expectedEccBooking = {
    ...structuredClone(v23PoolFixture.bookings[3]),
    replacementUserId: null,
    replacementConfirmedAt: null,
    replacementConfirmedBy: null,
    cancelledAt: null,
    cancelledSource: null,
    sessionReminderTomorrowSentAt: null,
    sessionReminderMorningSentAt: null,
  };
  const expectedEccReceipt = structuredClone(v23PoolFixture.receipts[2]);
  const expectedUnrelatedBooking = {
    ...structuredClone(v23PoolFixture.bookings[4]),
    replacementUserId: null,
    replacementConfirmedAt: null,
    replacementConfirmedBy: null,
    cancelledAt: null,
    cancelledSource: null,
    sessionReminderTomorrowSentAt: null,
    sessionReminderMorningSentAt: null,
  };
  const expectedUnrelatedReceipt = structuredClone(v23PoolFixture.receipts[3]);
  const expectedEccDuty = structuredClone(v23PoolFixture.duty.islandEcc);
  const expectedUnrelatedDuty = structuredClone(v23PoolFixture.duty.lookalike);
  const expectedEccQueue = structuredClone(v23PoolFixture.queues["hyrox-quarry-bay-2099-01-03"]);
  const expectedEccOverride = structuredClone(v23PoolFixture.sessionOverrides["hyrox-quarry-bay-2099-01-03"]);
  const expectedUnrelatedNotification = structuredClone(v23PoolFixture.notifications[4]);
  localStorage.setItem("itc.prototype.v1", JSON.stringify(v23PoolFixture));
  const migrated = store.load();

  assert.equal(migrated.version, 30);
  assert.deepEqual(store.notificationsFor("review-admin"), [expectedEccReview],
    "generic local review notices must retain only proven active ECC provenance");
  assert.equal(store.notificationsFor("review-admin").filter((row) => !row.read).length, 1,
    "retired, ambiguous and unmatched review notices must not inflate unread counts");
  assert.equal(migrated.activities.some((row) => ["hyrox-bft", "hyrox-midtown"].includes(row.id)), false);
  assert.equal(migrated.activities.some((row) => row.id === "hyrox-quarry-bay"), true);
  assert.equal(Object.keys(migrated.hyroxCycles).length, 0);
  assert.equal(Object.keys(migrated.hyroxCycleQueues).length, 0);
  assert.equal(migrated.bookings.some((row) => row.cycleId === "hyrox-pool-2099-01-03"), false);
  assert.equal(migrated.bookings.some((row) => ["bft-booking", "midtown-booking"].includes(row.id)), false);
  assert.equal(migrated.receipts.some((row) => ["pool-receipt", "bft-receipt"].includes(row.id)), false);
  assert.equal(migrated.replacementRequests.some((row) => ["pool-replacement", "bft-replacement"].includes(row.id)), false);
  assert.equal(migrated.replacementAudit.some((row) => row.id === "pool-audit"), false);
  assert.equal(migrated.notifications.some((row) => ["pool-kind-note", "pool-booking-note", "bft-route-note"].includes(row.id)), false);
  assert.equal(migrated.duty.retiredSession, undefined);
  assert.equal(migrated.duty.retiredCycle, undefined);
  assert.deepEqual(migrated.bookings.find((row) => row.id === "ecc-booking"), expectedEccBooking);
  assert.deepEqual(migrated.bookings.find((row) => row.id === "lookalike-booking"), expectedUnrelatedBooking);
  assert.deepEqual(migrated.receipts.find((row) => row.id === "ecc-receipt"), expectedEccReceipt);
  assert.deepEqual(migrated.receipts.find((row) => row.id === "lookalike-receipt"), expectedUnrelatedReceipt);
  assert.ok(migrated.replacementRequests.some((row) =>
    row.id === "ecc-replacement" && row.cycleId === "island-ecc-cycle-2099-01-03"));
  assert.ok(migrated.replacementRequests.some((row) =>
    row.id === "lookalike-replacement" && row.cycleId === "community-cycle-2099-01-03"));
  assert.ok(migrated.notifications.some((row) =>
    row.id === "ecc-note" && row.cycleId === "island-ecc-cycle-2099-01-03"));
  assert.deepEqual(migrated.queues["hyrox-quarry-bay-2099-01-03"], expectedEccQueue);
  assert.deepEqual(migrated.sessionOverrides["hyrox-quarry-bay-2099-01-03"], expectedEccOverride);
  assert.deepEqual(migrated.notifications.find((row) => row.id === "unrelated-note"), expectedUnrelatedNotification);
  assert.deepEqual(Object.keys(migrated.duty).sort(), ["islandEcc", "lookalike", "sharedSaturday"]);
  assert.deepEqual(migrated.duty.islandEcc, expectedEccDuty);
  assert.deepEqual(migrated.duty.lookalike, expectedUnrelatedDuty);
  assert.ok(migrated.replacementAudit.some((row) => row.id === "ecc-audit"));
  assert.ok(migrated.replacementAudit.some((row) => row.id === "lookalike-audit"));
  assert.ok(migrated.activities.some((row) => row.id === "event-hyrox-bft-party"),
    "substring lookalikes must not be deleted");

  // The same exact-cycle boundary must remain active in v24 runtime selectors.
  assert.equal(store.getBooking("ecc-booking")?.cycleId, "island-ecc-cycle-2099-01-03");
  assert.equal(store.getBooking("lookalike-booking")?.cycleId, "community-cycle-2099-01-03");
  assert.equal(store.getReceipt("ecc-receipt")?.cycleId, "island-ecc-cycle-2099-01-03");
  assert.equal(store.getReceipt("lookalike-receipt")?.cycleId, "community-cycle-2099-01-03");
  assert.equal(store.replacementRequestForBooking("ecc-booking")?.id, "ecc-replacement");
  assert.equal(store.replacementRequestForBooking("lookalike-booking")?.id, "lookalike-replacement");
  assert.equal(store.notificationsFor("ecc-user").some((row) => row.id === "ecc-note"), true);
  assert.equal(store.notificationsFor("party-user").some((row) => row.id === "unrelated-note"), true);
}
store.resetLocalData();

assert.equal(store.effectiveAttendeeId({ userId: "payer" }), "payer");
assert.equal(
  store.effectiveAttendeeId({ userId: "payer", replacementUserId: "friend" }),
  "friend",
);
assert.equal(store.replacementEligible({ status: "reserved" }, Date.now()).ok, false);
assert.equal(store.replacementEligible({ status: "attended" }, Date.now()).ok, false);
assert.equal(store.replacementEligible({
  status: "confirmed",
  userId: "payer",
  snapshot: { kind: "paid", name: "ITC HYROX", dateISO: "2099-01-10", time: "11:15" },
}, Date.now()).ok, true);
const v19ReplacementFixture = structuredClone(store.load());
v19ReplacementFixture.version = 19;
for (const booking of v19ReplacementFixture.bookings) {
  delete booking.replacementUserId;
  delete booking.replacementConfirmedAt;
  delete booking.replacementConfirmedBy;
}
delete v19ReplacementFixture.replacementRequests;
localStorage.setItem("itc.prototype.v1", JSON.stringify(v19ReplacementFixture));
const migratedReplacement = store.load();
assert.equal(migratedReplacement.version, 30, "replacement migration must preserve data through the current v27 state version");
assert.ok(Array.isArray(migratedReplacement.replacementRequests));
assert.ok(Array.isArray(migratedReplacement.replacementAudit));
assert.ok(migratedReplacement.bookings.every((booking) =>
  booking.replacementUserId === null
  && booking.replacementConfirmedAt === null
  && booking.replacementConfirmedBy === null
));
store.resetLocalData();
const { existsSync, readFileSync, readdirSync } = await import("node:fs");
const { createHash } = await import("node:crypto");
const { resolve, dirname } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const __dirnameSmoke = dirname(fileURLToPath(import.meta.url));
const migrationNames = readdirSync(resolve(__dirnameSmoke, "../supabase/migrations"))
  .filter((name) => /^\d+_.+\.sql$/.test(name));
const migrationVersions = new Map();
for (const name of migrationNames) {
  const version = name.split("_", 1)[0];
  const duplicate = migrationVersions.get(version);
  assert.equal(duplicate, undefined,
    `Supabase migration version ${version} is duplicated by ${duplicate} and ${name}`);
  migrationVersions.set(version, name);
}
assert.ok(
  migrationNames.filter((name) => name.startsWith("20260922000001_")).length <= 1,
  "HYROX retirement migration version 20260922000001 must be unique",
);
assert.equal(migrationVersions.get("20260922000002"),
  "20260922000002_harden_retired_hyrox_boundary.sql",
  "production correction must use a unique forward migration");
assert.equal(migrationVersions.get("20260922000003"),
  "20260922000003_reassert_retired_hyrox_pool_acls.sql",
  "drift repair must use unique forward migration 00003");
const correctionSource = readFileSync(resolve(__dirnameSmoke,
  "../supabase/migrations/20260922000002_harden_retired_hyrox_boundary.sql"), "utf8");
const latestRosterSource = readFileSync(resolve(__dirnameSmoke,
  "../supabase/migrations/20260910000002_operational_attendee_names_rsvp.sql"), "utf8");
const latestRosterDefinition = latestRosterSource.match(
  /create or replace function public\.get_operational_attendee_names\([\s\S]*?\n\$\$;/)[0];
assert.ok(correctionSource.includes(latestRosterDefinition.replace(
  "public.get_operational_attendee_names(",
  "public.get_operational_attendee_names_pre_pool_retirement_20260922(")),
  "forward correction must preserve exact latest roster semantics");
const protectedPoolMigrationHashes = new Map([
  ["20260922000002_harden_retired_hyrox_boundary.sql", "1bb968bdbe435d4cad66a1fec993946c5b67692e8f1b25e53b1bde85e2edb6eb"],
  ["20260922000001_retire_bft_midtown_hyrox_pool.sql", "81f66371c360d9e6aed31f4130f38df891aad4100abdbddf2aa1c0d92e7aadb8"],
  ["20260903000001_hyrox_cycle_schema.sql", "0e9129a1b078217ec8459ff42e65b2b9529dcaf1d43a88825041f8260a364bd7"],
  ["20260903000002_hyrox_cycle_member_rpcs.sql", "38d500cbc859bf92c06854b88ae37769f1ea8b61a941330514a71a253d89cc78"],
  ["20260903000003_hyrox_cycle_reconciliation.sql", "4789b3d0ce3ed5ff1dc0128ad1cc9bbf927a936746c1c8ce4fba3d850c35bebd"],
  ["20260903000004_hyrox_cycle_allocation.sql", "c4a4674db1beca969b1493e2eff24c35ce5ce32cc25053f138830b1d7e45b5b7"],
  ["20260904000001_hyrox_cycle_auto_provision.sql", "dc9a2d8b2cdfd71aa2a4b23f0adac08c51131d59b555ee7e36bfe140b924c9ab"],
  ["20260908000001_collector_payment_reminders.sql", "58d444a280f599a6edd55ec58d89f3dc341770cc5aa2e8467e62789b4bf5708c"],
  ["20260908000002_hyrox_venue_reminders.sql", "09379ca96d7a19e502adce33f479796774b17c15d01525f7a4b71ab962056397"],
  ["20260909000001_operational_attendance.sql", "aaa35f3e376c5561071f775fb812901353584d98bf588b4c0c38ee8e65070d36"],
  ["20260910000001_operational_replacement_requests.sql", "fda15c18d250e3c36e0169472c0850bc03baf629571200c9c46551c4a5616d32"],
  ["20260910000004_replacement_hyrox_conflict_scope.sql", "9c0558f00d4e7e351c7407e258a11cae61f309e56838fdbf1cbfda91aa6bc11a"],
  ["20260910000006_replacement_admin_hyrox_conflict_scope.sql", "d234b82f6e38dcc93cfe26658653dc4d8eba71aae9d8a658821c88cb0002afd3"],
]);
for (const [name, expectedHash] of protectedPoolMigrationHashes) {
  const source = readFileSync(resolve(__dirnameSmoke, "../supabase/migrations", name));
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    expectedHash,
    `historical pool migration ${name} must remain byte-for-byte unchanged`,
  );
}
console.log("ok  HYROX retirement migration version and historical pool migrations are protected");

for (const path of ["committee-feedback-tracker.md", "feedback-tracker-builder.js", "feedback-tracker-lists.csv"]) {
  assert.doesNotMatch(readFileSync(resolve(__dirnameSmoke, "../docs", path), "utf8"),
    /HYROX Cycle|HYROX Registration/, `${path} must not offer retired screens`);
}

const currentHyroxDocPaths = [
  "../README.md",
  "../docs/runbooks/operational-backend.md",
  "../docs/runbooks/live-auth.md",
];
const currentHyroxDocs = currentHyroxDocPaths.map((relativePath) => [
  relativePath,
  readFileSync(resolve(__dirnameSmoke, relativePath), "utf8"),
]);
for (const [relativePath, source] of currentHyroxDocs) {
  assert.match(source, /20260922000001_retire_bft_midtown_hyrox_pool\.sql/,
    `${relativePath} must name the pool-retirement migration`);
  assert.match(source, /20260922000002_harden_retired_hyrox_boundary\.sql/,
    `${relativePath} must name the forward correction`);
  assert.match(source, /20260922000003_reassert_retired_hyrox_pool_acls\.sql/,
    `${relativePath} must name the forward drift repair`);
  assert.match(source, /All three migrations are applied and recorded exactly once/,
    `${relativePath} must acknowledge all three applied production migrations`);
  assert.match(source, /Island ECC is the (?:sole|only) active HYROX venue/i,
    `${relativePath} must state the sole active HYROX venue contract`);
  assert.match(source, /9:15 AM[\s\S]*10:30 AM/i,
    `${relativePath} must state both active Island ECC session times`);
  assert.match(source, /Retained BFT\/Midtown pool test records are\s+hidden from browser roles, not deleted\./i,
    `${relativePath} must state the retained-record contract`);
  assert.match(source, /backend-first deployment/i,
    `${relativePath} must state backend-first deployment discipline`);
  assert.match(source, /forward-only rollback/i,
    `${relativePath} must state forward-only rollback discipline`);
  assert.match(source,
    /Known retired (?:HYROX )?deep links render `This session is no longer available\.`;\s+unknown IDs keep the existing safe not-found behavior; neither redirects to\s+Island ECC\./i,
    `${relativePath} must document the exact retired deep-link behavior`);
}
const currentHyroxDocSource = currentHyroxDocs.map(([, source]) => source).join("\n");
for (const staleCurrentContract of [
  /Weekly HYROX uses one shared 32-place BFT\/Midtown pool/i,
  /HYROX registration is one weekly shared-pool booking for BFT\/Midtown/i,
  /Clean future Saturdays receive a draft parent cycle automatically/i,
  /verify the shared workflow on two separate browsers/i,
]) {
  assert.doesNotMatch(currentHyroxDocSource, staleCurrentContract,
    `current documentation must not retain active-pool guidance: ${staleCurrentContract}`);
}

const markdownSection = (source, heading, headingLevel) => {
  const start = source.indexOf(heading);
  assert.ok(start >= 0, `missing documentation section ${heading}`);
  const candidates = Array.from({ length: headingLevel.length }, (_, index) =>
    source.indexOf(`\n${"#".repeat(index + 1)} `, start + heading.length))
    .filter((position) => position >= 0);
  const next = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, next);
};
const promotionHeading = "### Post-application promotion (authoritative)";
const appliedHistoryProtection = "Never edit, replay, reapply, or repair `00001`, `00002`, or `00003`.";
const appliedHyroxArtifacts = [
  ["20260922000001_retire_bft_midtown_hyrox_pool.sql", "81f66371c360d9e6aed31f4130f38df891aad4100abdbddf2aa1c0d92e7aadb8"],
  ["20260922000002_harden_retired_hyrox_boundary.sql", "1bb968bdbe435d4cad66a1fec993946c5b67692e8f1b25e53b1bde85e2edb6eb"],
  ["20260922000003_reassert_retired_hyrox_pool_acls.sql", "48a8f4b5d9dc22f8002e69b2c19b4a736ee83584527d269d7bdd1793150a0857"],
];
function assertPostApplicationContract(source, relativePath) {
  const post = markdownSection(source, promotionHeading, "###");
  assert.match(post, /Controller-verified state on `krxbvgyolxvmzgysfjkj`, 2026-09-23: \*\*POST-APPLICATION\*\*/);
  assert.match(post, /All three migrations are applied and recorded exactly once/);
  for (const [file, digest] of appliedHyroxArtifacts) {
    assert.ok(post.includes(`\`${file}\` | \`${digest}\``),
      `${relativePath} must pin each applied artifact identity`);
  }
  assert.match(post, /resolver v8 is already deployed with `verify_jwt = true`/);
  assert.match(post, /`ITC_APP_ORIGINS` restoration and verification are complete/);
  assert.match(post, /exactly these two supported origins/);
  assert.deepEqual([...post.matchAll(/^- `([^`]+)`$/gm)].map(match => match[1]), [
    "https://island-training-club.vercel.app",
    "https://island-training-club-git-testing-island-training-club.vercel.app",
  ], `${relativePath} must preserve exactly the two supported origins`);
  assert.match(post, /Fixture recovery completed; baseline restored/);
  assert.match(post, /46\/18\/14\/1\/45/);
  assert.match(post, /(?:total )?notifications \*\*131\*\*/);
  assert.match(post, /Testing browser acceptance PASS/);
  assert.match(post, /5a0ecdeb48872f4ec2aacebc1d037c14/);
  assert.match(post, /pool ACLs closed/);
  assert.ok(post.includes(appliedHistoryProtection), `${relativePath} must protect all three applied migrations`);
  assert.match(post, /Do not rerun completed recovery/);
  assert.match(post, /promotion-review\.md/);
  assert.match(post, /controller CORS repair verified/);
  assert.match(source, /HISTORICAL[^\n]*executed 2026-09-23/,
    `${relativePath} must label the completed procedure HISTORICAL with its execution date`);
  assert.match(source, /reviewed precedent\/rollback reference/i);
  assert.match(source, /clean disposable/i);

  // Historical precedent is not the authoritative current path. Keep the local
  // clean-replay instructions, but reject shared-target reapplication commands.
  const rollout = source.includes("## HYROX pool retirement: backend-first deployment")
    ? markdownSection(source, "## HYROX pool retirement: backend-first deployment", "##") : post;
  const current = rollout.split(/(?=^### )/m)
    .filter(section => !section.startsWith("### HISTORICAL"))
    .join("").replaceAll(appliedHistoryProtection, "")
    .replaceAll("Never edit or replay applied migration history.", "");
  // Even historical headings must not smuggle instructions to replay applied
  // versions. The preserved precedent uses past-tense records, not such commands.
  const noReplay = rollout.replaceAll(appliedHistoryProtection, "")
    .replaceAll("Never edit or replay applied migration history.", "");
  assert.doesNotMatch(noReplay,
    /supabase\s+migration\s+repair|\b(?:replay|reapply|repair)\s+(?:(?:all(?: three)?|the)\s+)?applied\s+migrations?/i,
    `${relativePath} must never instruct replay or repair of applied migrations`);
  for (const unsafe of [
    /migration\s+repair\s+2026092200000[123]\b/i,
    /--file\s+(?:supabase\/migrations\/)?2026092200000[123]/i,
    /\b(?:apply|replay|reapply|repair)\s+(?:only\s+)?(?:the\s+)?(?:complete\s+reviewed\s+)?`?(?:supabase\/migrations\/)?(?:2026092200000[123]|0000[123])/i,
    /(?:00003|20260922000003)`?\s+(?:must be|is)\s+absent/i,
    /(?:00003|20260922000003)[^\n]*never applied/i,
    /(?:complete|run|rerun|resume|use)\s+(?:the\s+)?(?:completed\s+|stopped-run\s+|certain-stop\s+|separately reviewed one-off\s+)?recovery\s+(?:below\s+)?(?:before|now|again|for promotion)/i,
    /Deploy the reviewed `resolve-profile-avatars` Edge Function/i,
    /supabase\s+(?:db push|functions deploy resolve-profile-avatars|secrets set ITC_APP_ORIGINS)/i,
  ]) {
    assert.doesNotMatch(current, unsafe,
      `${relativePath} must reject stale pre-application instructions and never instruct replay or repair of applied migrations`);
  }
}
const releaseSequenceMarkers = [
  "1. **Verify the applied backend boundary (read-only).**",
  "2. **Verify the deployed resolver and origins (read-only).**",
  "3. **Confirm completed Testing acceptance.**",
  "4. **Promote the exact accepted snapshot.**",
];
function assertHyroxRunbookContract(source, relativePath) {
  const rollout = markdownSection(
    source,
    "## HYROX pool retirement: backend-first deployment",
    "##",
  );
  assertPostApplicationContract(source, relativePath);
  const sequence = markdownSection(rollout, "### Executable promotion sequence", "###");
  const markerPositions = releaseSequenceMarkers.map((marker) => sequence.indexOf(marker));
  assert.ok(markerPositions.every((position) => position >= 0),
    `${relativePath} must contain every executable release step`);
  assert.deepEqual(markerPositions, [...markerPositions].sort((a, b) => a - b),
    `${relativePath} must order backend, resolver, completed acceptance, then promotion`);
  assert.match(sequence, /Verify applied versions\/hashes/);
  assert.match(sequence, /backend invariants/);
  assert.match(sequence, /Do not rerun completed recovery/);
  assert.match(sequence, /read-only route\/denial\/configuration\/count checks/);
  assert.match(rollout, /never clear uncertainty/i);
  for (const reminder of ["send_hyrox_member_payment_reminders", "send_hyrox_collector_payment_reminder", "send_hyrox_venue_reminders", "sweep_hyrox_cycle_deadlines"]) {
    assert.ok(rollout.includes(`${reminder}(timestamptz)`), `${relativePath} must name each exact reminder overload`);
  }
  assert.match(rollout, /23 statements/);
  assert.match(rollout, /18 pool-only functions/);
  assert.match(rollout, /any subset of historical re-grants/);
  assert.match(rollout, /Do not revoke[\s\S]*shared guarded[\s\S]*approve_operational_payment/);
  assert.match(rollout, /suppress_opted_out_hyrox_payment_reminder/);
  assert.match(rollout, /5a0ecdeb48872f4ec2aacebc1d037c14/);
  assert.match(rollout, /organic-session normalization/i);
  assert.match(rollout, /never adopt or delete/i);
  assert.match(rollout, /mode-0600 receipt/);
  assert.match(rollout, /subtraction had to reproduce|exact baseline equality after subtracting/i);
  assert.match(rollout, /non-retired generator (?:remained active|was not disabled)/i);
  assert.match(sequence, /pool RPC denial and Island ECC active-RPC checks/i,
    `${relativePath} must verify the applied RPC boundary before promotion`);
  assert.match(sequence, /Verify resolver v8 with `verify_jwt = true`/,
    `${relativePath} must verify the existing resolver, not redeploy it`);
  assert.match(rollout, /classifier-failure fail-closed/,
    `${relativePath} requires direct endpoint failure acceptance`);
  assert.match(rollout, /direct authenticated endpoint/i);
  assert.match(rollout, /artifact revision/i);
  assert.match(sequence, /reviewed preview revision/i,
    `${relativePath} must bind the already accepted preview revision`);
  assert.match(sequence, /browser UI and Island ECC lifecycle/i,
    `${relativePath} must verify completed browser acceptance evidence`);

  const rollbackHeading = source.includes("\n## Forward-only rollback")
    ? "## Forward-only rollback"
    : "### Forward-only rollback";
  const rollback = markdownSection(source, rollbackHeading,
    rollbackHeading.startsWith("## ") ? "##" : "###");
  assert.match(rollback, /new, separately reviewed forward migration/i,
    `${relativePath} rollback must require an actionable new forward migration`);
  assert.match(rollback, /compatible frontend deployment/i,
    `${relativePath} rollback must require a compatible frontend`);
  assert.match(rollback, /compatible.*Edge Function/i);
  assert.match(rollback, /Never edit or replay applied migration history\./i,
    `${relativePath} rollback must prohibit editing or replaying applied history`);
  assert.doesNotMatch(rollback,
    /Edit and replay the applied retirement migration to (?:restore|roll back)/i,
    `${relativePath} must reject destructive rollback instructions`);
  assert.match(source, /count-only evidence/i,
    `${relativePath} must require privacy-safe production inventory evidence`);
}

for (const [relativePath, source] of currentHyroxDocs) {
  assertPostApplicationContract(source, relativePath);
}
for (const [relativePath, source] of currentHyroxDocs.slice(1)) {
  assertHyroxRunbookContract(source, relativePath);
}
const operationalRunbookSource = currentHyroxDocs.find(([path]) =>
  path.endsWith("operational-backend.md"))?.[1] || "";
assert.match(operationalRunbookSource, /version alone is not artifact identity/i);
assert.match(operationalRunbookSource,
  /n\.kind = 'hyrox_replacement_review'[\s\S]*?r\.accepted_at = n\.created_at[\s\S]*?r\.booking_id in \(select id from retired_bookings\)[\s\S]*?not exists \([\s\S]*?r\.accepted_at = n\.created_at/i,
  "pre-apply inventory must conservatively count retired and unmatched replacement-review notices");
for (const [kind, timestamp] of [
  ["operational_payment_marked", "payment_marked_at"],
  ["operational_gym_finalized", "gym_confirmed_at"],
]) {
  assert.ok(operationalRunbookSource.includes(`n.kind = '${kind}'`));
  assert.ok(operationalRunbookSource.includes(`${timestamp} = n.created_at`));
}
for (const fingerprint of [
  "n.title = 'HYROX payment claim submitted'",
  "n.destination = '#/admin/payments'",
  "n.body = 'Review the payment claim for ' || c.session_date::text || '.'",
]) {
  assert.ok(operationalRunbookSource.includes(fingerprint),
    `pre-apply inventory needs durable exact pooled producer evidence: ${fingerprint}`);
}
assert.match(operationalRunbookSource, /mark → reject → re-mark/);
assert.match(operationalRunbookSource,
  /query emits only the aggregate bucket—never notification IDs or content/i,
  "production replacement-review inventory must remain count-only");

// Mutation controls cover README and both runbooks, all three applied versions,
// stale pre-application/recovery/deployment instructions, and verified state.
for (const [relativePath, source] of currentHyroxDocs) {
  const inject = text => source.replace(promotionHeading, `${promotionHeading}\n\n${text}`);
  for (const [file] of appliedHyroxArtifacts) {
    const version = file.split("_")[0];
    for (const instruction of [
      `supabase migration repair ${version} --status applied`,
      `supabase migration repair --status applied ${version}`,
      `supabase db query --linked --file supabase/migrations/${file}`,
      `Apply only \`${file}\` now.`, `Replay \`${version}\` now.`,
      `Reapply \`${version}\` now.`, `Repair \`${version}\` now.`,
    ]) assert.throws(() => assertPostApplicationContract(inject(instruction), relativePath),
      /never instruct replay or repair/);
    assert.throws(() => assertPostApplicationContract(source.replaceAll(file, "unreviewed.sql"), relativePath),
      /applied artifact identity/);
  }
  for (const instruction of [
    "00003 must be absent before application.", "00003 was never applied to a shared database.",
    "Complete stopped-run recovery before resuming acceptance.", "Rerun completed recovery for promotion.",
    "Deploy the reviewed `resolve-profile-avatars` Edge Function now.",
    "supabase secrets set ITC_APP_ORIGINS=\"<exact-origin-1>,<exact-origin-2>\"",
    "supabase db push --include-all",
  ]) assert.throws(() => assertPostApplicationContract(inject(instruction), relativePath),
    /stale pre-application instructions/);
  for (const instruction of ["Replay all three applied migrations.", "Repair applied migrations.", "Reapply the applied migrations."]) {
    assert.throws(() => assertPostApplicationContract(inject(instruction), relativePath), /never instruct replay or repair/);
  }
  for (const [from, to] of [
    ["applied and recorded exactly once", "awaiting application"],
    [appliedHistoryProtection, "Never edit, replay, reapply, or repair `00001` or `00002`."],
    ["verify_jwt = true", "verify_jwt = false"],
    ["46/18/14/1/45", "46/18/14/1/44"], ["notifications **131**", "notifications **132**"],
    ["Testing browser acceptance PASS", "Testing browser acceptance pending"],
    ["Fixture recovery completed; baseline restored", "Fixture recovery pending"],
    ["5a0ecdeb48872f4ec2aacebc1d037c14", "unreviewed-catalog"],
    ["- `https://island-training-club.vercel.app`", "- `https://*.vercel.app`"],
    ["- `https://island-training-club.vercel.app`", "- `https://island-training-club.vercel.app`\n- `https://extra.example.invalid`"],
    ["- `https://island-training-club.vercel.app`", "- `https://island-training-club.vercel.app`\n- `http://127.0.0.1:4173`"],
    ["HISTORICAL", "NEXT OPERATION"],
  ]) assert.throws(() => assertPostApplicationContract(source.replaceAll(from, to), relativePath));
}
for (const [relativePath, source] of currentHyroxDocs.slice(1)) {
  const unsafeRollback = source.replace(
    /(?:###|##) Forward-only rollback[\s\S]*?(?=\n## |\n### |$)/,
    `${source.includes("\n## Forward-only rollback") ? "##" : "###"} Forward-only rollback\n\nForward-only rollback. Edit and replay the applied retirement migration to restore pool access.\n`,
  );
  assert.throws(() => assertHyroxRunbookContract(unsafeRollback, `${relativePath} unsafe fixture`),
    /new forward migration|compatible frontend|editing or replaying|destructive rollback/,
    `${relativePath} contract must reject unsafe applied-history rollback`);

  const invertedRollout = source
    .replace(releaseSequenceMarkers[1], "__PREVIEW_STEP__")
    .replace(releaseSequenceMarkers[2], releaseSequenceMarkers[1])
    .replace("__PREVIEW_STEP__", releaseSequenceMarkers[2]);
  assert.throws(() => assertHyroxRunbookContract(invertedRollout, `${relativePath} inverted fixture`),
    /order backend, resolver, completed acceptance, then promotion/,
    `${relativePath} contract must reject inverted verification/acceptance order`);
  const missingRollout = source.replace(releaseSequenceMarkers[1], "");
  assert.throws(() => assertHyroxRunbookContract(missingRollout, `${relativePath} missing fixture`),
    /every executable release step/,
    `${relativePath} contract must reject a missing deployed-boundary verification step`);
}

const retirementIntegrationContractSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/tests/retire_hyrox_pool_integration.sql"),
  "utf8",
);
for (const marker of [
  "count-only inventory classifies retired and unmatched replacement review notices",
  "count-only inventory preserves the proven active Island ECC replacement review notice",
]) {
  assert.ok(retirementIntegrationContractSource.includes(marker),
    `retirement integration must prove ${marker}`);
}
assert.match(retirementIntegrationContractSource,
  /select count\(\*\) filter \(where retired\),\s*count\(\*\) filter \(where not retired\)\s*into v_inventory_retired_review_count, v_inventory_active_review_count/i,
  "replacement-review inventory fixtures must expose only aggregate retired/active counts");
console.log("ok  current HYROX documentation enforces post-application promotion, no replay/recovery rerun, inventory, deep-link, retention, and rollback contracts");

const storeSource = readFileSync(resolve(__dirnameSmoke, "js/store.js"), "utf8");
const weekVenueSource = storeSource.match(
  /export function setWeekVenue[\s\S]*?\/\/ --- Giving/
)?.[0] || "";
const orderedWeekVenueAuthorization = /const before = getSession\(sessionId\);\s*const fallbackActivityId = String\(sessionId\)\.replace\([^\n]+\);\s*const overrideActivityId = before\?\.activityId \|\| fallbackActivityId;\s*if \(!new Set\(\["wnt", "run", "water", "lunch"\]\)\.has\(overrideActivityId\)\) \{/;
if (!orderedWeekVenueAuthorization.test(weekVenueSource)) {
  throw new Error("setWeekVenue should resolve the session before fallback authorization and the allow-list");
}

for (const relativePath of [
  "js/config.js",
  "live-auth-smoke.mjs",
  "../supabase/migrations/20260804000000_profiles.sql",
  "../supabase/migrations/20260805000007_admin_application_decisions.sql",
  "../supabase/migrations/20260827000001_hyrox_indemnity_fields.sql",
  "../supabase/migrations/20260902000001_hyrox_bft_quarry_bay.sql",
  "../supabase/migrations/20260902000002_quarry_bay_island_ecc.sql",
  "../supabase/migrations/20260903000001_hyrox_cycle_schema.sql",
  "../supabase/migrations/20260903000002_hyrox_cycle_member_rpcs.sql",
  "../supabase/migrations/20260903000003_hyrox_cycle_reconciliation.sql",
  "../supabase/migrations/20260903000004_hyrox_cycle_allocation.sql",
  "../supabase/migrations/20260904000001_hyrox_cycle_auto_provision.sql",
  "../supabase/migrations/20260908000001_collector_payment_reminders.sql",
  "../supabase/migrations/20260908000002_hyrox_venue_reminders.sql",
  "../supabase/migrations/20260909000001_operational_attendance.sql",
  "../supabase/config.toml",
]) {
  const absolutePath = resolve(__dirnameSmoke, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Payment Auth baseline missing ${relativePath}`);
  }
}
console.log("ok  Payment Auth baseline foundation files exist");

const authEmailTemplatePaths = [
  "../supabase/email-templates/confirm-signup.html",
  "../supabase/email-templates/magic-link.html",
  "../supabase/email-templates/README.md",
  "../assets/itc/itc-email-logo.png",
];
for (const relativePath of authEmailTemplatePaths) {
  if (!existsSync(resolve(__dirnameSmoke, relativePath))) {
    throw new Error(`Branded auth email asset missing ${relativePath}`);
  }
}
const confirmSignupEmailSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/email-templates/confirm-signup.html"),
  "utf8"
);
const magicLinkEmailSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/email-templates/magic-link.html"),
  "utf8"
);
for (const [name, source] of [
  ["Confirm signup", confirmSignupEmailSource],
  ["Magic link", magicLinkEmailSource],
]) {
  assert.match(source, /\{\{ \.ConfirmationURL \}\}/, `${name} must retain Supabase's confirmation URL`);
  assert.match(source, /https:\/\/raw\.githubusercontent\.com\/syseles\/island-training-club-app\/07917dc47f5f1887c69b8fa487421fe4e905f91e\/assets\/itc\/itc-email-logo\.png/,
    `${name} must use the email crop derived from the approved new logo`);
  assert.match(source, /#CAFF31/i, `${name} must use the ITC volt-green accent`);
  assert.match(source, /expires in 15 minutes/i, `${name} must state the configured expiry`);
  assert.doesNotMatch(source, /logo\.webp|logo-header\.png/i, `${name} must not use an older ITC logo`);
  assert.doesNotMatch(source, /<script|<form/i, `${name} must remain email-client-safe static HTML`);
}
assert.match(confirmSignupEmailSource, /Confirm email and continue/);
assert.match(confirmSignupEmailSource, /membership requires review and approval/i);
assert.match(magicLinkEmailSource, /Sign in to Island Training Club/);
console.log("ok  branded auth emails use the approved new logo and email-safe Night Circuit markup");

const localAvatarStateBefore = JSON.stringify([...mem.entries()]);
const localAvatar = await store.getOwnAvatar();
const localUpload = await store.uploadMyAvatar(new Blob(["local-photo-bytes"], { type: "image/jpeg" }));
const localRemove = await store.removeMyAvatar();
if ([localAvatar, localUpload, localRemove].some((item) => item.source !== "initials" || item.url !== null)) {
  throw new Error("local avatar adapters must return initials only");
}
if (JSON.stringify([...mem.entries()]) !== localAvatarStateBefore) {
  throw new Error("local avatar adapters must never serialize image data");
}
const signedOutPaidSession = store.upcomingSessions(60).find((session) => session.kind === "paid");
if (!signedOutPaidSession || (await store.getSessionAvatars(signedOutPaidSession.id)).length !== 0) {
  throw new Error("local attendee adapter must stay closed without an approved viewer");
}
console.log("ok  local avatar adapters stay initials-only and memory-safe");

const profilesMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260804000000_profiles.sql"),
  "utf8"
);
const indemnityMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260827000001_hyrox_indemnity_fields.sql"),
  "utf8"
);
const assignedPayoutMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260829000005_assigned_collector_payout_rpc.sql"),
  "utf8"
);
const hyroxActivityMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260902000001_hyrox_bft_quarry_bay.sql"),
  "utf8"
);
const quarryBayVenueMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260902000002_quarry_bay_island_ecc.sql"),
  "utf8"
);
const islandEccSlotsMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260929000001_island_ecc_hyrox_slots.sql"),
  "utf8"
);
const collectorPaymentReminderMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260908000001_collector_payment_reminders.sql"),
  "utf8"
);
const hyroxVenueReminderMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260908000002_hyrox_venue_reminders.sql"),
  "utf8"
);
const attendanceMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260909000001_operational_attendance.sql"),
  "utf8"
);
for (const marker of [
  "attended_at", "attended_by", "'attended'", "set_operational_attendance",
  "operational_assert_admin('set_attendance')", "for update", "Asia/Hong_Kong",
  "interval '15 minutes'", "interval '24 hours'", "price_hkd <= 0",
  "cancelled_at is not null", "p_arrived is null",
  "revoke all on function public.set_operational_attendance(uuid, boolean)",
  "grant execute on function public.set_operational_attendance(uuid, boolean) to authenticated",
  "create or replace function public.get_operational_attendee_names",
  "b.status in ('confirmed', 'attended')",
]) {
  assert.ok(attendanceMigrationSource.toLowerCase().includes(marker.toLowerCase()),
    `attendance migration missing ${marker}`);
}
assert.match(attendanceMigrationSource,
  /security definer[\s\S]*?set search_path = public/i);
assert.doesNotMatch(attendanceMigrationSource,
  /grant execute on function public\.set_operational_attendance\(uuid, boolean\) to anon/i);
for (const marker of [
  "venue_choice_reminder_sent_at",
  "venue_finalization_reminder_sent_at",
  "send_hyrox_venue_reminders",
  "Friday at 9 PM HKT",
  "gym_confirmed_at",
  "#/admin/payments",
  "for update skip locked",
]) {
  assert.ok(
    hyroxVenueReminderMigrationSource.toLowerCase().includes(marker.toLowerCase()),
    `HYROX venue reminder migration missing ${marker}`
  );
}
console.log("ok  HYROX venue reminder migration keeps member and collector audiences scoped");
for (const marker of [
  "hyrox_payment_reminders",
  "collector_payment_reminder_sent_at",
  "send_hyrox_member_payment_reminders",
  "send_hyrox_collector_payment_reminder",
  "suppress_opted_out_hyrox_payment_reminder",
  "NEW.kind = 'operational_hyrox_payment_reminder'",
  "a.hyrox_payment_reminders = false",
  "security definer",
  "#/admin/payments",
  "for update skip locked",
  "interval '2 hours'",
]) {
  assert.ok(
    collectorPaymentReminderMigrationSource.toLowerCase().includes(marker.toLowerCase()),
    `collector payment reminder migration missing ${marker}`
  );
}
console.log("ok  collector payment reminder migration preserves opt-out and least-privilege delivery");
{
  const webPushOpsMigration = readFileSync(
    resolve(__dirnameSmoke, "../supabase/migrations/20260926000001_web_push_ops_pref.sql"),
    "utf8",
  );
  for (const marker of [
    "web_push_ops",
    "boolean not null default false",
    "applications",
  ]) {
    assert.ok(
      webPushOpsMigration.toLowerCase().includes(marker.toLowerCase()),
      `web push ops migration missing ${marker}`,
    );
  }
  assert.equal(
    /vapid|push_subscriptions|edge function/i.test(webPushOpsMigration),
    false,
    "phase 1 web push migration must not add sender infrastructure",
  );
}
console.log("ok  web push ops preference migration is phase-1 column only");
{
  const webPushDeliveryMigration = readFileSync(
    resolve(__dirnameSmoke, "../supabase/migrations/20260927000001_web_push_delivery.sql"),
    "utf8",
  );
  for (const marker of [
    "push_subscriptions",
    "request_web_push_delivery",
    "web_push_ops_kind_eligible",
    "pg_net",
    "Venue confirmed",
    "Session venue updated",
  ]) {
    assert.ok(
      webPushDeliveryMigration.includes(marker),
      `web push delivery migration missing ${marker}`,
    );
  }
  const webPushSettingsMigration = readFileSync(
    resolve(__dirnameSmoke, "../supabase/migrations/20260927000002_web_push_settings_table.sql"),
    "utf8",
  );
  for (const marker of [
    "private.web_push_settings",
    "hook_secret",
    "request_web_push_delivery",
  ]) {
    assert.ok(
      webPushSettingsMigration.includes(marker),
      `web push settings migration missing ${marker}`,
    );
  }
  const webPushSnapshotMigration = readFileSync(
    resolve(__dirnameSmoke, "../supabase/migrations/20260929000002_web_push_payload_snapshot.sql"),
    "utf8",
  );
  for (const marker of [
    "profile_id",
    "destination",
    "notification snapshot",
    "request_web_push_delivery",
  ]) {
    assert.ok(
      webPushSnapshotMigration.includes(marker),
      `web push payload snapshot migration missing ${marker}`,
    );
  }
  const webPushCommunityMigration = readFileSync(
    resolve(__dirnameSmoke, "../supabase/migrations/20260930000001_web_push_community_announcement.sql"),
    "utf8",
  );
  for (const marker of [
    "community_announcement_published",
    "web_push_ops_kind_eligible",
  ]) {
    assert.ok(
      webPushCommunityMigration.includes(marker),
      `web push community migration missing ${marker}`,
    );
  }
  assert.equal(
    webPushCommunityMigration.includes("'community_announcement_audit'"),
    false,
    "community web push allowlist must not treat audit rows as eligible",
  );
  const sendWebPushSource = readFileSync(
    resolve(__dirnameSmoke, "../supabase/functions/send-web-push/index.ts"),
    "utf8",
  );
  assert.ok(
    sendWebPushSource.includes("notificationFromPayload")
      && sendWebPushSource.includes("missing_notification"),
    "send-web-push must accept trigger payload snapshots to avoid commit races",
  );
  assert.equal(
    /alter database\s+postgres\s+set/i.test(webPushSettingsMigration),
    false,
    "settings migration must not use ALTER DATABASE SET (denied on hosted Supabase)",
  );
  assert.equal(
    /caches\.|cache\.add/i.test(webPushDeliveryMigration),
    false,
    "delivery migration must not introduce caching APIs",
  );  const pushSw = readFileSync(resolve(__dirnameSmoke, "push-sw.js"), "utf8");
  assert.ok(pushSw.includes('addEventListener("push"'), "push-sw must handle push");
  assert.ok(pushSw.includes("notificationclick"), "push-sw must handle notificationclick");
  assert.ok(pushSw.includes("skipWaiting"), "push-sw must activate promptly");
  assert.equal(/caches\.|cache\.addAll/i.test(pushSw), false, "push-sw must not use Cache API");
  const webPushClient = readFileSync(resolve(__dirnameSmoke, "js/web-push.js"), "utf8");
  assert.ok(webPushClient.includes("syncWebPushSubscription"), "web-push client helper missing");
  assert.ok(webPushClient.includes("push-sw.js"), "web-push client must resolve push-sw.js");
  assert.ok(webPushClient.includes("__itcSyncWebPush"), "web-push debug helper missing");
  assert.ok(webPushClient.includes("__itcTestNotification"), "web-push local banner test helper missing");
  assert.ok(
    webPushClient.includes("if (isLive())") && webPushClient.includes('new URL("/push-sw.js"'),
    "live web-push path helper must register /push-sw.js for canonical root pages",
  );
  assert.ok(
    readFileSync(resolve(__dirnameSmoke, "index.html"), "utf8").includes("VAPID_PUBLIC_KEY"),
    "index.html must expose VAPID_PUBLIC_KEY",
  );
}
console.log("ok  web push delivery migration and push-only service worker markers");
for (const marker of [
  "10/F, Island ECC, Quarry Bay",
  "Island ECC, Quarry Bay, Hong Kong",
  "activity_id = 'hyrox-quarry-bay'",
  "session_date >= (now() at time zone 'Asia/Hong_Kong')::date",
]) {
  assert.ok(quarryBayVenueMigrationSource.includes(marker),
    `Quarry Bay venue migration must include ${marker}`);
}
for (const marker of [
  "'hyrox-quarry-bay-early'",
  "'09:15'",
  "'10:30'",
  "duration_minutes = 60",
  "capacity = 30",
  "price_hkd = 180",
  "operational_session_time_changed",
  "values (b.profile_id), (b.replacement_profile_id)",
  "jsonb_build_object('start_time', '10:30:00')",
  "Choose one Island ECC HYROX slot per Saturday.",
  "pg_advisory_xact_lock",
  "operational_bookings_island_ecc_replacement_slot",
  "coalesce(b.replacement_profile_id, b.profile_id)",
  "reserve_operational_session",
  "join_operational_queue",
  "ensure_operational_sessions",
]) {
  assert.ok(islandEccSlotsMigrationSource.includes(marker),
    `Island ECC slots migration must include ${marker}`);
}
const islandEccReserveGuardSource = islandEccSlotsMigrationSource
  .split("create or replace function public.reserve_operational_session(p_session_id text)")[1]
  ?.split("create or replace function public.join_operational_queue(")[0]
  ?.split(") or exists (")[0] || "";
assert.doesNotMatch(
  islandEccReserveGuardSource,
  /s\.id <> v_session\.id/,
  "replacement attendees must not reserve their existing Island ECC slot again",
);
console.log("ok  dual Island ECC migration retimes, provisions and guards both slots");
{
  const islandEccWindowsMigrationSource = readFileSync(
    resolve(__dirnameSmoke, "../supabase/migrations/20261002000001_island_ecc_signup_windows.sql"),
    "utf8",
  );
  for (const marker of [
    "HYROX sign-up opens Monday at 6 PM HKT.",
    "operational_island_ecc_payment_reminder",
    "operational_island_ecc_week_ops",
    "at time zone 'Asia/Hong_Kong'",
  ]) {
    assert.ok(
      islandEccWindowsMigrationSource.includes(marker),
      `Island ECC windows migration must include ${marker}`,
    );
  }
  console.log("ok  Island ECC signup-window migration markers");
}
assert.equal((hyroxActivityMigrationSource.match(
  /drop constraint operational_activity_templates_activity_id_check/g
) || []).length, 2,
"HYROX activity migration must allow the legacy id during rename, then tighten the constraint");
const settleHyroxConstraintsAt = hyroxActivityMigrationSource.indexOf(
  "operational_rsvp_counts_session_id_fkey immediate;"
);
const tightenHyroxTemplateAt = hyroxActivityMigrationSource.indexOf(
  "-- Tighten the template id contract"
);
assert.ok(settleHyroxConstraintsAt >= 0 && settleHyroxConstraintsAt < tightenHyroxTemplateAt,
  "deferred rename constraints must settle before altering the template table again");
for (const marker of [
  "'hyrox-bft'",
  "'hyrox-quarry-bay'",
  "10/F, 633 King''s Road, Quarry Bay, Hong Kong",
  "'11:00'",
  "60",
  "12",
  "180",
  "default_open",
  "replace(id, 'hyrox-', 'hyrox-bft-')",
]) {
  assert.ok(hyroxActivityMigrationSource.includes(marker),
    `HYROX activity migration must include ${marker}`);
}
for (const marker of [
  "security definer",
  "set search_path = public",
  "current_user_role()",
  "collector_assignments",
  "collector_payout_profiles",
  "revoke all on function public.get_assigned_collector_payout_profiles() from public",
  "grant execute on function public.get_assigned_collector_payout_profiles() to authenticated",
]) {
  assert.ok(
    assignedPayoutMigrationSource.toLowerCase().includes(marker),
    `assigned collector payout migration missing ${marker}`
  );
}
console.log("ok  assigned collector payout RPC migration keeps least-privilege controls");

const applicationMobilePayoutMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260901000001_assigned_collector_application_mobile.sql"),
  "utf8"
);
const applicationMobilePayoutFunction = applicationMobilePayoutMigrationSource.match(
  /create or replace function public\.get_assigned_collector_payout_profiles\(\)[\s\S]*?\n\$\$;/i
)?.[0] || "";
assert.match(applicationMobilePayoutFunction,
  /left join public\.applications as application[\s\S]*?on application\.profile_id = assignment\.collector_profile_id/i,
  "assigned collector payout reads must preserve PayMe if Membership Details are temporarily unavailable");
assert.match(applicationMobilePayoutFunction,
  /left join public\.collector_payout_profiles as payout/i,
  "an assigned collector's FPS number must not require a saved payout profile");
assert.match(applicationMobilePayoutFunction,
  /application\.mobile\s+as fps_phone/i,
  "assigned collector FPS must come directly from applications.mobile");
assert.doesNotMatch(applicationMobilePayoutFunction,
  /payout\.fps_phone/i,
  "assigned collector payout reads must not trust the duplicated payout phone");
assert.match(applicationMobilePayoutFunction,
  /current_user_role\(\)[\s\S]*?'member'[\s\S]*?'admin'[\s\S]*?'super_admin'/i,
  "application mobile payout reads must remain approved-member-only");
console.log("ok  assigned collector FPS reads directly from applications.mobile");

const collectorIdentityMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260901000002_assigned_collector_display_identity.sql"),
  "utf8"
);
const collectorIdentityFunction = collectorIdentityMigrationSource.match(
  /create function public\.get_assigned_collector_payout_profiles\(\)[\s\S]*?\n\$\$;/i
)?.[0] || "";
assert.match(collectorIdentityMigrationSource,
  /drop function public\.get_assigned_collector_payout_profiles\(\)/i,
  "the forward identity migration must explicitly replace the RPC return type");
for (const field of ["full_name text", "preferred_name text"]) {
  assert.match(collectorIdentityFunction, new RegExp(field, "i"),
    `assigned collector identity RPC missing ${field}`);
}
assert.match(collectorIdentityFunction,
  /from public\.collector_assignments as assignment[\s\S]*?left join public\.profiles as profile[\s\S]*?left join public\.applications as application/i,
  "assigned collector identity must remain rooted in collector assignments");
assert.doesNotMatch(collectorIdentityFunction,
  /email|emergency_|guardian_|donor_/i,
  "assigned collector identity RPC must not expose unrelated member details");
assert.match(collectorIdentityFunction,
  /current_user_role\(\)[\s\S]*?'member'[\s\S]*?'admin'[\s\S]*?'super_admin'/i,
  "assigned collector display identity must remain approved-member-only");
console.log("ok  assigned collector RPC exposes only narrow display identity");

const lunchMeetingRpcMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260829000006_lunch_venue_meeting_point_rpc.sql"),
  "utf8"
);
const rsvpIntegrityMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260829000008_rsvp_integrity.sql"),
  "utf8"
);
const freeEventRsvpMigrationPath = resolve(
  __dirnameSmoke, "../supabase/migrations/20260920000001_free_event_rsvp_cancellation.sql"
);
assert.ok(existsSync(freeEventRsvpMigrationPath),
  "authoritative free-event RSVP cancellation migration must exist");
const freeEventRsvpMigrationSource = readFileSync(freeEventRsvpMigrationPath, "utf8");
const freeEventRsvpIntegrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/tests/free_event_rsvp_cancellation_integration.sql"),
  "utf8"
);
for (const activityId of ["wnt", "run", "water"]) {
  assert.match(freeEventRsvpMigrationSource,
    new RegExp(`\\('${activityId}',[\\s\\S]*?null, 0,[\\s\\S]*?true\\)`),
    `${activityId} live template must remain uncapped, zero-price, and RSVP-enabled`);
}
for (const marker of [
  "cancelled_at timestamptz",
  "cancellation_source text",
  "cancellation_source in ('member', 'session')",
  "ensure_operational_sessions(current_date, 16)",
  "at time zone 'Asia/Hong_Kong'",
  "operational_session_cancelled",
  "operational_rsvp_reopened",
]) {
  assert.ok(freeEventRsvpMigrationSource.includes(marker),
    `free-event RSVP migration missing ${marker}`);
}
const freeEventCancellationDispatcher = freeEventRsvpMigrationSource.match(
  /create or replace function public\.cancel_operational_session\([\s\S]*?\n\$\$;/i
)?.[0] || "";
const freeEventRsvpBranch = freeEventCancellationDispatcher.match(
  /if v_is_rsvp then[\s\S]*?return v_session;[\s\S]*?end if;/i
)?.[0] || "";
assert.match(freeEventRsvpBranch, /status = 'confirmed'/,
  "RSVP cancellation must target active confirmed rows");
assert.match(freeEventRsvpBranch,
  /cancelled_at = v_cancelled_at[\s\S]*?cancellation_source = 'session'/,
  "RSVP cancellation must atomically link booking metadata to the occurrence");
assert.match(freeEventRsvpBranch,
  /v_cancelled_at\s*:=\s*clock_timestamp\(\)[\s\S]*?session_date\s*\+\s*v_session\.start_time[\s\S]*?at time zone 'Asia\/Hong_Kong'\s*<=\s*v_cancelled_at[\s\S]*?already started/i,
  "RSVP cancellation must decide the inclusive Hong Kong cutoff with a captured wall clock");
const freeEventSessionLockIndex = freeEventCancellationDispatcher.search(
  /from public\.operational_sessions[\s\S]*?for update/i
);
const freeEventWallClockIndex = freeEventCancellationDispatcher.search(
  /v_cancelled_at\s*:=\s*clock_timestamp\(\)/i
);
const freeEventFirstMutationIndex = freeEventCancellationDispatcher.search(
  /update public\.operational_sessions/i
);
assert.ok(
  freeEventSessionLockIndex !== -1
    && freeEventSessionLockIndex < freeEventWallClockIndex
    && freeEventWallClockIndex < freeEventFirstMutationIndex,
  "RSVP cancellation must capture wall-clock decision time after the session lock and before mutation"
);
assert.match(freeEventRsvpBranch,
  /set cancelled_at = v_cancelled_at[\s\S]*?resolved_at = v_cancelled_at[\s\S]*?cancelled_at = v_cancelled_at[\s\S]*?v_cancelled_at[\s\S]*?from cancelled_rsvps/i,
  "RSVP cancellation must use one captured wall-clock timestamp for session, queue, bookings, and notifications");
assert.ok(
  freeEventRsvpBranch.search(/already started/i)
    < freeEventRsvpBranch.search(/update public\.operational_sessions/i),
  "RSVP cancellation start validation must precede every occurrence mutation"
);
assert.doesNotMatch(freeEventRsvpBranch, /defer|cancel_operational_session_legacy/i,
  "RSVP cancellation must return before paid deferral behavior");
assert.ok(
  freeEventCancellationDispatcher.indexOf("return v_session;")
    < freeEventCancellationDispatcher.indexOf("cancel_operational_session_legacy"),
  "RSVP cancellation must return before the paid legacy dispatcher"
);
assert.match(freeEventRsvpMigrationSource,
  /cancellation_source = 'session'[\s\S]*?cancelled_at = v_session\.cancelled_at[\s\S]*?operational_rsvp_reopened|cancelled_at = v_session\.cancelled_at[\s\S]*?cancellation_source = 'session'[\s\S]*?operational_rsvp_reopened/,
  "reopening must select only recipients linked to that session cancellation");
assert.match(freeEventRsvpMigrationSource,
  /operational_activity_templates_free_one_off_rsvp_check[\s\S]*?activity_id not like 'event-%'[\s\S]*?requires_rsvp[\s\S]*?capacity is null/i,
  "zero-price one-off templates must be guaranteed explicit RSVP and uncapped");
const createOperationalEventFunction = freeEventRsvpMigrationSource.match(
  /create or replace function public\.create_operational_event[\s\S]*?\n\$\$;/i
)?.[0] || "";
assert.match(createOperationalEventFunction,
  /p_price_hkd = 0[\s\S]*?requires_rsvp[\s\S]*?capacity/i,
  "future free one-offs must normalize to RSVP and null capacity");
assert.match(createOperationalEventFunction, /'event-'\s*\|\|\s*gen_random_uuid\(\)/i,
  "one-off event IDs must remain unique when multiple events are created in one second");
assert.doesNotMatch(createOperationalEventFunction, /extract\s*\(\s*epoch/i,
  "one-off event IDs must not use collision-prone second-resolution epochs");
assert.match(freeEventRsvpMigrationSource,
  /create or replace function public\.join_operational_queue[\s\S]*?v_is_rsvp[\s\S]*?raise exception[^;]*queue/i,
  "joining any queue for an explicit free RSVP session must be rejected");
assert.match(freeEventRsvpMigrationSource,
  /create or replace function public\.leave_operational_queue[\s\S]*?v_is_rsvp[\s\S]*?raise exception[^;]*queue/i,
  "leaving a legacy queue row for an explicit free RSVP session must be rejected");
assert.match(freeEventRsvpBranch,
  /operational_queue_entries[\s\S]*?status = 'dissolved'/i,
  "RSVP cancellation must dissolve active legacy queue rows");
const withdrawRsvpFunction = freeEventRsvpMigrationSource.match(
  /create or replace function public\.withdraw_operational_rsvp[\s\S]*?\n\$\$;/i
)?.[0] || "";
assert.match(withdrawRsvpFunction,
  /current_user_role\(\)[\s\S]*?'member'[\s\S]*?'admin'[\s\S]*?'super_admin'/i,
  "RSVP withdrawal must require a currently approved role");
assert.doesNotMatch(freeEventRsvpMigrationSource,
  /grant\s+(?:all|insert|update|delete)[^\n]*on\s+(?:table\s+)?public\./i,
  "free-event RSVP migration must keep browser writes behind RPCs");
for (const marker of [
  "begin;", "rollback;", "unauthorized", "duplicate active RSVP",
  "booking RLS hides another attendee identity", "RSVP cancellation never enters paid deferral",
  "cancellation notifications target active attendees only",
  "reopening targets only attendees cancelled by that occurrence",
  "member can create a fresh RSVP after reopening",
  "future occurrence unchanged", "existing free one-off is normalized",
  "future free one-off defaults to uncapped RSVP", "paid one-off remains capacity-limited",
  "RSVP queue joins are rejected", "RSVP queue leave is rejected",
  "pending withdrawal is rejected", "declined withdrawal is rejected",
  "pending attendee roster access is rejected", "declined attendee roster access is rejected",
  "recurring occurrences use declared weekdays", "cancellation dissolves active RSVP queues",
  "started RSVP cancellation is rejected without mutation",
  "cancellation uses one captured wall-clock timestamp",
]) {
  assert.ok(freeEventRsvpIntegrationSource.includes(marker),
    `free-event RSVP integration evidence missing ${marker}`);
}
console.log("ok  authoritative free-event RSVP migration preserves transactional routing and privacy");
const attendeeNamesMigrationPath = resolve(
  __dirnameSmoke, "../supabase/migrations/20260905000000_operational_attendee_names.sql"
);
if (!existsSync(attendeeNamesMigrationPath)) {
  throw new Error("approved attendee names migration must exist");
}
const attendeeNamesMigrationSource = readFileSync(attendeeNamesMigrationPath, "utf8");
const rsvpAttendeeNamesMigrationPath = resolve(
  __dirnameSmoke, "../supabase/migrations/20260910000002_operational_attendee_names_rsvp.sql"
);
assert.ok(existsSync(rsvpAttendeeNamesMigrationPath), "RSVP attendee-name migration must be present");
const rsvpAttendeeNamesMigrationSource = readFileSync(rsvpAttendeeNamesMigrationPath, "utf8");
assert.match(rsvpAttendeeNamesMigrationSource, /get_operational_attendee_names/);
assert.match(rsvpAttendeeNamesMigrationSource, /requires_rsvp/);
const replacementMigrationPath = resolve(
  __dirnameSmoke, "../supabase/migrations/20260910000001_operational_replacement_requests.sql"
);
if (!existsSync(replacementMigrationPath)) {
  throw new Error("HYROX replacement migration must exist");
}
const replacementMigrationSource = readFileSync(replacementMigrationPath, "utf8");
for (const marker of [
  "operational_booking_replacement_requests",
  "replacement_profile_id",
  "replacement_confirmed_at",
  "replacement_confirmed_by",
  "create_operational_replacement_request",
  "get_operational_replacement_invite",
  "accept_operational_replacement_request",
  "decline_operational_replacement_request",
  "cancel_operational_replacement_request",
  "admin_decide_operational_replacement",
  "security definer",
  "set search_path = public",
  "for update",
  "revoke all",
]) {
  assert.ok(replacementMigrationSource.toLowerCase().includes(marker.toLowerCase()),
    `replacement migration missing ${marker}`);
}
assert.match(replacementMigrationSource,
  /create unique index[\s\S]*?where status in \('pending', 'accepted'\)/i,
  "replacement requests must allow only one active request per booking");
assert.match(replacementMigrationSource,
  /select[\s\S]*?for update[\s\S]*?operational_bookings/i,
  "replacement mutations must lock the booking before changing identity");
assert.doesNotMatch(replacementMigrationSource,
  /grant (?:all|select|insert|update|delete)[^\n]*on (?:table )?public\.operational_booking_replacement_requests/i,
  "browser roles must not receive direct replacement-table writes");
assert.match(replacementMigrationSource, /notify pgrst, 'reload schema'/i,
  "replacement migration must reload the PostgREST schema cache after creating RPCs");
const replacementEligibilityMigrationPath = resolve(
  __dirnameSmoke, "../supabase/migrations/20260910000003_replacement_authoritative_eligibility.sql"
);
assert.ok(existsSync(replacementEligibilityMigrationPath),
  "replacement eligibility repair migration must be present");
const replacementEligibilityMigrationSource = readFileSync(replacementEligibilityMigrationPath, "utf8");
assert.match(replacementEligibilityMigrationSource,
  /operational_activity_templates[\s\S]*?price_hkd[\s\S]*?activity_id/i,
  "replacement eligibility must use authoritative session/template metadata");
assert.doesNotMatch(replacementEligibilityMigrationSource,
  /snapshot\s*->>\s*'kind'/i,
  "replacement eligibility must not require the absent legacy snapshot kind");
const replacementConflictMigrationPath = resolve(
  __dirnameSmoke, "../supabase/migrations/20260910000004_replacement_hyrox_conflict_scope.sql"
);
assert.ok(existsSync(replacementConflictMigrationPath),
  "replacement HYROX-conflict repair migration must be present");
const replacementConflictMigrationSource = readFileSync(replacementConflictMigrationPath, "utf8");
assert.match(replacementConflictMigrationSource, /accept_operational_replacement_request/i);
assert.match(replacementConflictMigrationSource,
  /other_session\.session_date\s*=\s*v_session_date[\s\S]*?other_session\.activity_id\s+ilike\s+'hyrox%'/i,
  "same-day replacement conflicts must be limited to HYROX sessions");
assert.match(replacementConflictMigrationSource, /notify pgrst, 'reload schema'/i);
const replacementAdminNotificationMigrationPath = resolve(
  __dirnameSmoke, "../supabase/migrations/20260910000005_replacement_admin_notification_roles.sql"
);
assert.ok(existsSync(replacementAdminNotificationMigrationPath),
  "replacement Admin-notification repair migration must be present");
const replacementAdminNotificationMigrationSource = readFileSync(
  replacementAdminNotificationMigrationPath, "utf8"
);
assert.match(replacementAdminNotificationMigrationSource,
  /p\.role\s+in\s*\('admin',\s*'super_admin'\)/i,
  "replacement reviews must notify operational Admin roles");
assert.doesNotMatch(replacementAdminNotificationMigrationSource, /p\.status/i,
  "replacement acceptance must not query the nonexistent profiles.status column");
assert.match(replacementAdminNotificationMigrationSource, /notify pgrst, 'reload schema'/i);
const replacementAdminConflictMigrationPath = resolve(
  __dirnameSmoke, "../supabase/migrations/20260910000006_replacement_admin_hyrox_conflict_scope.sql"
);
assert.ok(existsSync(replacementAdminConflictMigrationPath),
  "replacement Admin conflict repair migration must be present");
const replacementAdminConflictMigrationSource = readFileSync(
  replacementAdminConflictMigrationPath, "utf8"
);
assert.match(replacementAdminConflictMigrationSource, /admin_decide_operational_replacement/i);
assert.match(replacementAdminConflictMigrationSource,
  /other_session\.session_date\s*=\s*v_session_date[\s\S]*?other_session\.activity_id\s+ilike\s+'hyrox%'/i,
  "Admin confirmation conflicts must be limited to HYROX sessions");
assert.match(replacementAdminConflictMigrationSource,
  /other_cycle\.session_date\s*=\s*v_session_date/i,
  "Admin confirmation must still detect pooled HYROX conflicts");
assert.match(replacementAdminConflictMigrationSource, /notify pgrst, 'reload schema'/i);
const operationalIntegrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/tests/operational_backend_integration.sql"),
  "utf8"
);
for (const marker of [
  "get_operational_rsvp_counts",
  "requires_rsvp",
  "status = 'confirmed'",
  "at time zone 'Asia/Hong_Kong'",
  "reserve_operational_session",
  "withdraw_operational_rsvp",
  "grant execute on function public.get_operational_rsvp_counts() to anon, authenticated",
]) assert.ok(rsvpIntegrityMigrationSource.includes(marker));
const rsvpCountFunctionSource = rsvpIntegrityMigrationSource.match(
  /create or replace function public\.get_operational_rsvp_counts\(\)[\s\S]*?\n\$\$;/
)?.[0] || "";
const rsvpCountReturnColumns = rsvpCountFunctionSource.match(
  /returns table\s*\(([\s\S]*?)\)/i
)?.[1].replace(/\s+/g, " ").trim();
assert.equal(rsvpCountReturnColumns, "session_id text, going_count bigint",
  "public RSVP counts must expose only session ID and confirmed total");
assert.match(rsvpCountFunctionSource, /from public\.operational_rsvp_counts/,
  "the public RSVP aggregate must read only the identity-free count table");
assert.doesNotMatch(rsvpCountFunctionSource, /operational_bookings|profiles/,
  "the public RSVP aggregate must not read identity-bearing tables");
const rsvpCountTableSource = rsvpIntegrityMigrationSource.match(
  /create table(?: if not exists)? public\.operational_rsvp_counts[\s\S]*?\n\);/
)?.[0] || "";
for (const contract of [
  /session_id text primary key[\s\S]*?references public\.operational_sessions\(id\)/,
  /going_count bigint not null default 0[\s\S]*?check \(going_count >= 0\)/,
  /updated_at timestamptz not null default now\(\)/,
]) assert.match(rsvpCountTableSource, contract);
assert.match(rsvpIntegrityMigrationSource,
  /create table if not exists public\.operational_rsvp_counts/,
  "undeployed RSVP integrity migration must be safe to reapply in disposable integration tests");
assert.match(rsvpIntegrityMigrationSource,
  /alter table public\.operational_rsvp_counts enable row level security/);
assert.match(rsvpIntegrityMigrationSource,
  /drop policy if exists "public read operational RSVP counts"[\s\S]*?create policy "public read operational RSVP counts"/,
  "RSVP count policy recreation must be safe when the migration is reapplied");
assert.match(rsvpIntegrityMigrationSource,
  /create policy[\s\S]*?on public\.operational_rsvp_counts[\s\S]*?for select[\s\S]*?using \(true\)/);
assert.match(rsvpIntegrityMigrationSource,
  /revoke all on table public\.operational_rsvp_counts from public, anon, authenticated/);
assert.match(rsvpIntegrityMigrationSource,
  /grant select on table public\.operational_rsvp_counts to anon, authenticated/);
assert.doesNotMatch(rsvpIntegrityMigrationSource,
  /grant\s+(?:all|insert|update|delete|truncate|references|trigger)[\s\S]*?on\s+(?:table\s+)?public\.operational_rsvp_counts/i,
  "browser roles must never receive RSVP count-table writes");
assert.match(rsvpIntegrityMigrationSource,
  /create or replace function public\.recalculate_operational_rsvp_count\(\s*p_session_id text\s*\)[\s\S]*?security definer/);
assert.match(rsvpIntegrityMigrationSource,
  /create trigger sync_operational_rsvp_count[\s\S]*?after insert or update or delete[\s\S]*?on public\.operational_bookings/);
assert.match(rsvpIntegrityMigrationSource,
  /revoke all on function public\.recalculate_operational_rsvp_count\(text\) from public, anon, authenticated/);
assert.match(rsvpIntegrityMigrationSource,
  /revoke all on function public\.sync_operational_rsvp_count\(\) from public, anon, authenticated/);
assert.match(rsvpIntegrityMigrationSource,
  /insert into public\.operational_rsvp_counts[\s\S]*?left join public\.operational_bookings[\s\S]*?where t\.requires_rsvp/,
  "migration must backfill every existing RSVP session, including zero counts");
assert.match(rsvpIntegrityMigrationSource,
  /if not exists \([\s\S]*?from pg_publication_tables[\s\S]*?tablename = 'operational_rsvp_counts'[\s\S]*?\) then[\s\S]*?alter publication supabase_realtime add table public\.operational_rsvp_counts/,
  "RSVP count publication membership must be guarded for migration reapplication");
const reserveOperationalSessionSource = rsvpIntegrityMigrationSource.match(
  /create or replace function public\.reserve_operational_session\([\s\S]*?\n\$\$;/
)?.[0] || "";
assert.match(reserveOperationalSessionSource,
  /if v_is_rsvp then[\s\S]*?at time zone 'Asia\/Hong_Kong' <= now\(\)[\s\S]*?elsif v_session\.session_date <= \(now\(\) at time zone 'Asia\/Hong_Kong'\)::date then/,
  "RSVP must use its exact HKT start while paid reservations reject the entire HKT session date");
assert.match(rsvpIntegrityMigrationSource,
  /revoke all on function public\.reserve_operational_session\(text\) from public, anon/);
assert.match(rsvpIntegrityMigrationSource,
  /revoke all on function public\.withdraw_operational_rsvp\(uuid\) from public, anon/);
assert.doesNotMatch(rsvpIntegrityMigrationSource,
  /grant[^\n]*(?:all|select|insert|update|delete)[^\n]*on\s+(?:table\s+)?public\.operational_bookings/i,
  "RSVP count migration must not grant direct booking-table access");
const attendeeNamesFunctionSource = attendeeNamesMigrationSource.match(
  /create or replace function public\.get_operational_attendee_names\([^)]*\)[\s\S]*?\n\$\$;/
)?.[0] || "";
assert.match(attendeeNamesFunctionSource, /returns table\s*\(\s*display_name text\s*\)/i,
  "attendee names RPC must return display labels only");
assert.match(attendeeNamesFunctionSource, /security definer/i);
assert.match(attendeeNamesFunctionSource, /(?:auth\.uid\(\)|current_user_role\(\))/i);
assert.match(attendeeNamesFunctionSource, /role in \('member', 'admin', 'super_admin'\)/i);
assert.match(attendeeNamesFunctionSource, /status\s*=\s*'confirmed'/i);
assert.match(attendeeNamesFunctionSource, /operational_bookings[\s\S]*profiles/i);
assert.match(attendeeNamesMigrationSource,
  /revoke all on function public\.get_operational_attendee_names\(text\)\s+from public, anon, authenticated/);
assert.match(attendeeNamesMigrationSource,
  /grant execute on function public\.get_operational_attendee_names\(text\)\s+to authenticated/);
assert.doesNotMatch(attendeeNamesMigrationSource,
  /grant execute on function public\.get_operational_attendee_names\(text\)\s+to anon/);
assert.doesNotMatch(attendeeNamesMigrationSource,
  /grant\s+(?:all|select|insert|update|delete)[^\n]*on\s+(?:table\s+)?public\.operational_bookings/i,
  "attendee names migration must not grant direct booking-table access");
assert.doesNotMatch(attendeeNamesMigrationSource,
  /email|mobile|phone/i,
  "attendee names RPC must not expose contact details");
assert.doesNotMatch(operationalIntegrationSource,
  /from\s+(?:public\.)?reserve_operational_session\('hyrox-2026-/,
  "successful SQL reservation fixtures must use dynamic future sessions");
assert.doesNotMatch(operationalIntegrationSource,
  /join_operational_queue\('hyrox-midtown-\d{4}-\d{2}-\d{2}',\s*'(?:interest|waitlist)'\)/,
  "queue guard scenarios must use a deterministic future Midtown fixture");
assert.match(operationalIntegrationSource,
  /v_future_hk\s+timestamp := \(now\(\) \+ interval '1 hour'\) at time zone 'Asia\/Hong_Kong'/);
assert.match(operationalIntegrationSource,
  /v_boundary_before_session := 'event-rsvp-boundary-before-' \|\| v_future_hk::date::text/,
  "pre-start boundary ID must derive from the same future HKT timestamp as its date/time");
assert.match(operationalIntegrationSource,
  /v_boundary_at_session := 'event-rsvp-boundary-at-' \|\| v_at_start_hk::date::text/,
  "at-start boundary ID must derive from the same HKT timestamp as its date/time");
assert.equal(
  (operationalIntegrationSource.match(/\\ir \.\.\/migrations\/20260829000008_rsvp_integrity\.sql/g) || []).length,
  1,
  "integration must reapply the actual RSVP migration once after backfill fixtures exist",
);
const cancellationQueueIntegrationSource = operationalIntegrationSource.match(
  /-- Admin cancellation atomicity\.[\s\S]*?-- Cancellation rollback test:/
)?.[0] || "";
assert.match(operationalIntegrationSource,
  /cancel_midtown_session text not null/,
  "cancellation coverage must derive its closed Midtown fixture from the shared HKT-relative table");
assert.match(cancellationQueueIntegrationSource,
  /select cancel_session, cancel_midtown_session[\s\S]*?into v_session_id, v_midtown_session_id[\s\S]*?from operational_time_fixtures/,
  "cancellation coverage must select the dated Midtown session from the shared HKT-relative fixture");
assert.match(cancellationQueueIntegrationSource,
  /perform pg_temp\.op_assert\(\s*exists \([\s\S]*?where id = v_midtown_session_id[\s\S]*?and activity_id = 'hyrox-midtown'[\s\S]*?and session_date > \(now\(\) at time zone 'Asia\/Hong_Kong'\)::date[\s\S]*?and not is_open[\s\S]*?and cancelled_at is null[\s\S]*?\),[\s\S]*?'closed Midtown interest fixture exists with required properties'[\s\S]*?\);/,
  "cancellation coverage must explicitly prove the Midtown fixture exists, is future-derived, closed, and active");
assert.match(cancellationQueueIntegrationSource,
  /join_operational_queue\(v_midtown_session_id, 'interest'\)/,
  "cancellation coverage must join interest through the dynamic Midtown fixture variable");
assert.doesNotMatch(cancellationQueueIntegrationSource,
  /join_operational_queue\('hyrox-midtown-\d{4}-\d{2}-\d{2}', 'interest'\)/,
  "cancellation coverage must not call the interest queue with a dated Midtown literal");
const upcomingSessionsSource = storeSource.match(
  /export function upcomingSessions\(days = 14\)[\s\S]*?\n}\n\nexport function nextSession/
)?.[0] || "";
assert.match(upcomingSessionsSource,
  /end\.setDate\(end\.getDate\(\) \+ days - 1\)/,
  "live upcomingSessions must compute an inclusive calendar-day end date");
assert.match(upcomingSessionsSource,
  /s\.dateISO >= todayISO && s\.dateISO <= endISO/,
  "live upcomingSessions must apply its inclusive upper date bound");
assert.match(upcomingSessionsSource, /todayHktISO\(\)/,
  "upcomingSessions must anchor its calendar horizon to the current HKT date");
const nextSocialSessionSource = storeSource.match(
  /export function nextSocialSession\(\)[\s\S]*?\n}\n\n\/\/ --- Community/
)?.[0] || "";
assert.match(nextSocialSessionSource, /hktEventStartMs\(session\.dateISO, session\.time\)/,
  "nextSocialSession must compare Hong Kong event-start instants");
assert.doesNotMatch(nextSocialSessionSource, /setHours\(/,
  "nextSocialSession must not interpret Hong Kong wall time in the browser timezone");
const lunchMeetingRpcSixArgumentSource = lunchMeetingRpcMigrationSource.match(
  /create or replace function public\.set_session_venue\([\s\S]*?p_meeting_lat double precision,[\s\S]*?p_meeting_lng double precision[\s\S]*?\n\$\$;/
)?.[0] || "";
assert.match(lunchMeetingRpcSixArgumentSource,
  /set_session_venue\([\s\S]*?p_meeting_lat double precision,[\s\S]*?p_meeting_lng double precision/);
assert.match(lunchMeetingRpcSixArgumentSource,
  /v_activity_id not in \('wnt', 'run', 'water', 'lunch'\)/);
assert.match(lunchMeetingRpcSixArgumentSource,
  /v_is_wnt_tamar := v_activity_id = 'wnt'/);
assert.match(lunchMeetingRpcSixArgumentSource,
  /when 'lunch' then 'Post-Training Lunch'/);
assert.match(lunchMeetingRpcMigrationSource,
  /select public\.set_session_venue\([\s\S]*?p_was_tbc, null, null[\s\S]*?\);/);
const notificationRoutingMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260829000007_notification_destinations.sql"),
  "utf8"
);
const notificationEventRoutingMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260830000003_notification_event_destinations.sql"),
  "utf8"
);
const operationalBackendIntegrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/tests/operational_backend_integration.sql"),
  "utf8"
);
const normalizedNotificationRoutingMigrationSource = notificationRoutingMigrationSource.toLowerCase();
for (const marker of [
  "security definer",
  "set search_path = public",
  "before insert on public.notifications",
  "resolve_notification_destination",
  "resolve_historical_booking_notification_destination",
  "operational_booking_reserved",
  "#/pay/",
  "count(*)",
  "profile_id",
  "revoke all on function public.resolve_notification_destination",
  "revoke all on function public.resolve_historical_booking_notification_destination",
]) {
  if (!normalizedNotificationRoutingMigrationSource.includes(marker)) {
    throw new Error(`notification routing migration missing ${marker}`);
  }
}
if (/alter\s+table\s+public\.notifications\b[^;]*(?:enable|disable|force|no\s+force)\s+row\s+level\s+security/i.test(notificationRoutingMigrationSource)) {
  throw new Error("notification routing migration must not alter notification RLS");
}
if (/grant\s+[^;]*\b(?:all(?:\s+privileges)?|insert|update|delete|truncate|references|trigger)\b[^;]*\s+on\s+(?:table\s+)?public\.notifications\b/i.test(notificationRoutingMigrationSource)) {
  throw new Error("notification routing migration must not grant notification-table writes");
}
const notificationRoutingFunctionDeclarations = [
  ...notificationRoutingMigrationSource.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/gi),
].map((match) => match[1]).sort();
if (JSON.stringify(notificationRoutingFunctionDeclarations) !== JSON.stringify([
  "resolve_historical_booking_notification_destination",
  "resolve_notification_destination",
  "route_notification_destination",
])) {
  throw new Error("notification routing migration must declare only the exact, historical-booking, and trigger functions");
}
const notificationResolverBody = (functionName, source = notificationRoutingMigrationSource) => {
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${escapedName}\\s*\\([\\s\\S]*?\\)\\s*returns[\\s\\S]*?\\bas\\s+\\$\\$([\\s\\S]*?)\\$\\$;`,
    "i"
  ));
  if (!match) throw new Error(`notification routing migration missing ${functionName} body`);
  return match[1];
};
const exactNotificationResolverBody = notificationResolverBody("resolve_notification_destination");
if (/interval\s+'5 seconds'/i.test(exactNotificationResolverBody)
    || !/=\s*p_created_at\b/i.test(exactNotificationResolverBody)) {
  throw new Error("notification insert resolver must use exact event timestamps, never a fuzzy window");
}
const historicalBookingResolverBody = notificationResolverBody(
  "resolve_historical_booking_notification_destination"
);
if (!/interval\s+'5 seconds'/i.test(historicalBookingResolverBody)
    || !/public\.operational_bookings\b/i.test(historicalBookingResolverBody)) {
  throw new Error("historical booking resolver must retain bounded booking-only fuzzy matching");
}
if (/public\.operational_sessions\b|cancelled_at\b|operational_session_cancelled(?:_no_defer)?\b/i.test(historicalBookingResolverBody)) {
  throw new Error("historical booking resolver must not infer cancellation destinations");
}
console.log("ok  notification migration separates exact inserts from booking-only historical matching");
const eventExactResolverBody = notificationResolverBody(
  "resolve_notification_destination", notificationEventRoutingMigrationSource
);
for (const kind of ["operational_session_cancelled_no_defer", "operational_session_cancelled"]) {
  const branch = eventExactResolverBody.match(new RegExp(
    `if\\s+p_kind\\s*=\\s*'${kind}'[\\s\\S]*?\\n\\s*end\\s+if;`, "i"
  ))?.[0] || "";
  assert.match(branch, /s\.cancelled_at\s*=\s*p_created_at/i,
    `${kind} must use authoritative exact cancellation linkage`);
  assert.doesNotMatch(branch, /price_hkd\s*=\s*0|requires_rsvp/i,
    `${kind} must not exclude paid cancellations`);
  assert.match(branch, /return\s+'#\/activity\/'\s*\|\|\s*v_session_id/i,
    `${kind} must route a unique cancellation to Activity Details`);
}
const historicalEventResolverBody = notificationResolverBody(
  "resolve_historical_notification_event_destination", notificationEventRoutingMigrationSource
);
assert.doesNotMatch(historicalEventResolverBody, /interval\s+'5 seconds'|operational_sessions|cancelled_at/i,
  "historical cancellation resolver must not fuzzy-match session rows");
for (const functionName of [
  "resolve_notification_destination",
  "resolve_historical_booking_notification_destination",
  "resolve_historical_notification_event_destination",
  "route_notification_destination",
]) {
  assert.match(notificationEventRoutingMigrationSource, new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}[\\s\\S]*?security\\s+definer[\\s\\S]*?set\\s+search_path\\s*=\\s*public`, "i"
  ), `${functionName} must be SECURITY DEFINER with a fixed public search_path`);
  assert.match(notificationEventRoutingMigrationSource, new RegExp(
    `revoke\\s+all\\s+on\\s+function\\s+public\\.${functionName}`, "i"
  ), `${functionName} must revoke browser execution`);
}
console.log("ok  event notification resolver keeps paid cancellation routes authoritative and historical rows unresolved");
const normalizedNotificationEventRoutingSource = notificationEventRoutingMigrationSource.toLowerCase();
for (const marker of [
  "create or replace function public.resolve_notification_destination",
  "create or replace function public.resolve_historical_booking_notification_destination",
  "resolve_historical_notification_event_destination",
  "set search_path = public",
  "operational_booking_reserved",
  "operational_rsvp_confirmed",
  "operational_session_cancelled_no_defer",
  "operational_session_cancelled",
  "requires_rsvp",
  "price_hkd",
  "#/pay/",
  "#/activity/",
  "revoke all on function public.resolve_notification_destination",
  "revoke all on function public.resolve_historical_notification_event_destination",
]) {
  if (!normalizedNotificationEventRoutingSource.includes(marker)) {
    throw new Error(`forward notification event migration missing ${marker}`);
  }
}
if (!/left\(n\.destination,\s*2\)\s*<>\s*'#\/'/i.test(notificationEventRoutingMigrationSource)
    || !/b\.destination\s+is\s+not\s+null/i.test(notificationEventRoutingMigrationSource)) {
  throw new Error("forward notification backfill must preserve valid routes and update only resolved rows");
}
if (/grant\s+execute\s+on\s+function\s+public\.(?:resolve_notification_destination|resolve_historical_notification_event_destination)/i.test(notificationEventRoutingMigrationSource)
    || /alter\s+table\s+public\.notifications\b[^;]*(?:enable|disable|force|no\s+force)\s+row\s+level\s+security/i.test(notificationEventRoutingMigrationSource)) {
  throw new Error("forward notification resolvers must stay browser-inaccessible without changing notification RLS");
}
console.log("ok  forward notification migration classifies event routes without broadening browser access");
for (const marker of [
  "v_payment_marked_before",
  "v_payment_marked_after",
  "v_gym_finalized_before",
  "v_gym_finalized_after",
  "v_unique_cancel_session",
  "v_cancelled_admin_before",
  "v_cancelled_admin_after",
  "notification_routing_backfill_snapshot",
  "nearby-booking",
  "historical-rsvp-unique",
  "historical-rsvp-ambiguous",
  "historical-cancellation",
  "notification routing migration second reapplication is idempotent",
]) {
  if (!operationalBackendIntegrationSource.includes(marker)) {
    throw new Error(`notification integration evidence missing ${marker}`);
  }
}
for (const [pattern, label] of [
  [/v_payment_marked_after\s*-\s*v_payment_marked_before\s*=\s*2\b/i, "payment-marked producer count"],
  [/v_gym_finalized_after\s*-\s*v_gym_finalized_before\s*=\s*2\b/i, "gym-finalized producer count"],
  [/v_cancelled_member_after\s*-\s*v_cancelled_member_before\s*=\s*1\b/i, "member cancellation producer count"],
  [/v_cancelled_admin_after\s*-\s*v_cancelled_admin_before\s*=\s*2\b/i, "Admin cancellation producer count"],
]) {
  if (!pattern.test(operationalBackendIntegrationSource)) {
    throw new Error(`notification integration missing scoped ${label}`);
  }
}
if (!/v_expected_admin_recipients\s+constant\s+uuid\[\]\s*:=\s*array\[\s*'aa000000-0000-0000-0000-00000000a001'::uuid\s*,\s*'ff000000-0000-0000-0000-00000000f001'::uuid\s*\]/i.test(operationalBackendIntegrationSource)) {
  throw new Error("notification integration missing exact Admin recipient fixture");
}
const exactAdminRecipientAssertions = operationalBackendIntegrationSource.match(
  /array_agg\(profile_id\s+order\s+by\s+profile_id\)[\s\S]*?=\s*v_expected_admin_recipients/gi
) || [];
if (exactAdminRecipientAssertions.length !== 2) {
  throw new Error("notification integration must assert exact recipients for both Admin producers");
}
if (!/perform\s+(?:public\.)?cancel_operational_session\s*\(\s*v_unique_cancel_session\b/i.test(operationalBackendIntegrationSource)) {
  throw new Error("notification integration must exercise the real unique cancellation producer");
}
const notificationRoutingMigrationReapplications = [
  ...operationalBackendIntegrationSource.matchAll(
    /^\\ir\s+\.\.\/migrations\/20260829000007_notification_destinations\.sql\s*$/gm
  ),
];
if (notificationRoutingMigrationReapplications.length !== 2) {
  throw new Error("notification integration must reapply migration 00007 exactly twice");
}
for (const fixtureClass of [
  "nearby-booking",
  "unique-malformed",
  "ambiguous-same-profile",
  "foreign-only",
  "valid-explicit",
  "read-state",
  "historical-rsvp-unique",
  "historical-rsvp-ambiguous",
  "historical-cancellation",
]) {
  if (!operationalBackendIntegrationSource.includes(`'${fixtureClass}'`)) {
    throw new Error(`notification integration missing historical fixture class ${fixtureClass}`);
  }
}
for (const marker of [
  "operational_time_fixtures",
  "Asia/Hong_Kong",
  "v_paid_session",
  "v_rsvp_session",
  "v_unique_cancel_session",
  "historical_cancel_session",
  "v_historical_cancel_session",
]) {
  if (!operationalBackendIntegrationSource.includes(marker)) {
    throw new Error(`notification integration missing time-stable fixture marker ${marker}`);
  }
}
// Fixed HYROX dates are allowed only in the deterministic August fixture
// window. Any future-guarded workflow must use the HKT-relative fixture table;
// the lone static reservation is cancelled and therefore rejects before its
// date guard. This allowlist forces every new fixed date to document its source.
const explicitlyGeneratedFixedHyroxSessions = new Set([
  "hyrox-bft-2026-08-15",
  "hyrox-midtown-2026-08-15",
  "hyrox-bft-2026-08-22",
  "hyrox-midtown-2026-08-22",
  "hyrox-bft-2026-08-29",
  "hyrox-midtown-2026-08-29",
]);
const fixedHyroxSessionIds = new Set(
  operationalBackendIntegrationSource.match(/\bhyrox-(?:bft|midtown)-\d{4}-\d{2}-\d{2}\b/g) || []
);
const ungroundedFixedHyroxSessions = [...fixedHyroxSessionIds].filter(
  (sessionId) => !explicitlyGeneratedFixedHyroxSessions.has(sessionId)
);
if (ungroundedFixedHyroxSessions.length) {
  throw new Error(
    `notification integration retains fixed HYROX sessions outside its explicit generator: ${ungroundedFixedHyroxSessions.join(", ")}`
  );
}
if (!/ensure_operational_sessions\s*\(\s*date\s+'2026-08-01'\s*,\s*5\s*\)/i.test(operationalBackendIntegrationSource)) {
  throw new Error("notification integration missing the explicit five-week August HYROX fixture generator");
}
const staticFutureGuardedCalls = [
  ...operationalBackendIntegrationSource.matchAll(
    /\b(?:reserve_operational_session|join_operational_queue|defer_operational_booking)\s*\(\s*'([^']+-\d{4}-\d{2}-\d{2})'/g
  ),
].map((match) => match[0]).filter((call) =>
  !call.includes("reserve_operational_session('hyrox-bft-2026-08-15'")
);
if (staticFutureGuardedCalls.length) {
  throw new Error(`notification integration retains static future-guarded calls: ${staticFutureGuardedCalls.join(", ")}`);
}
for (const fixtureClass of [
  "ambiguous-same-profile",
  "foreign-only",
  "historical-rsvp-ambiguous",
  "historical-cancellation",
]) {
  const rowExistsOnceWithNull = new RegExp(
    `perform\\s+pg_temp\\.op_assert\\(\\s*\\(select\\s+count\\(\\*\\)[\\s\\S]*?where\\s+f\\.fixture_class\\s*=\\s*'${fixtureClass}'[\\s\\S]*?and\\s+n\\.destination\\s+is\\s+null\\s*\\)\\s*=\\s*1\\s*,`,
    "i"
  );
  if (!rowExistsOnceWithNull.test(operationalBackendIntegrationSource)) {
    throw new Error(`notification integration must prove ${fixtureClass} exists once with null destination`);
  }
}
if (/update\s+public\.notifications\s+\w+\s+set\s+destination\s*=\s*public\.resolve_notification_destination/is.test(operationalBackendIntegrationSource)) {
  throw new Error("notification integration must execute migration backfill instead of copying its update");
}
const invalidSessionGenerationCall = [
  ...operationalBackendIntegrationSource.matchAll(
    /ensure_operational_sessions\s*\(\s*date\s+'[^']+'\s*,\s*(\d+)\s*\)/gi
  ),
].find((match) => Number(match[1]) > 16);
if (invalidSessionGenerationCall) {
  throw new Error(`notification integration exceeds the 16-week session generation bound: ${invalidSessionGenerationCall[1]}`);
}
console.log("ok  notification SQL evidence exercises scoped producers and migration reapplication");
for (const column of [
  "waiver_signature_text",
  "waiver_signed_at",
  "waiver_form_version",
  "emergency_relationship",
]) {
  if (!indemnityMigrationSource.includes(column)) {
    throw new Error(`Hyrox indemnity migration missing ${column}`);
  }
}
const liveAuthRunbookSource = readFileSync(
  resolve(__dirnameSmoke, "../docs/runbooks/live-auth.md"),
  "utf8"
);
const supabaseConfigSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/config.toml"),
  "utf8"
);
for (const marker of [
  "functions/deno.json",
  "functions.process-profile-avatar",
  "functions.resolve-profile-avatars",
  "functions.moderate-profile-avatar",
]) {
  if (!supabaseConfigSource.includes(marker)) {
    throw new Error(`Supabase CLI config missing ${marker}`);
  }
}
const readmeSource = readFileSync(resolve(__dirnameSmoke, "../README.md"), "utf8");
const deploymentDocs = `${readmeSource}\n${liveAuthRunbookSource}`;
for (const marker of [
  "20260805000011_giving_campaigns.sql",
  "20260806000001_donor_id.sql",
  "Admin Tools → Giving",
  "No fake campaign data is restored",
]) {
  if (!deploymentDocs.includes(marker)) {
    throw new Error(`Giving deployment recovery docs missing ${marker}`);
  }
}
console.log("ok  Giving deployment recovery is documented without fake campaign data");

for (const marker of [
  "20260917000001_profile_avatars.sql",
  "profile-avatars",
  "process-profile-avatar",
  "resolve-profile-avatars",
  "moderate-profile-avatar",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ITC_APP_ORIGINS",
  "600 seconds",
  "rollback",
]) {
  if (!liveAuthRunbookSource.includes(marker)) {
    throw new Error(`profile-photo deployment runbook missing ${marker}`);
  }
}
if (/eyJ[a-zA-Z0-9_-]{20,}[.][a-zA-Z0-9_-]{20,}[.][a-zA-Z0-9_-]{20,}/.test(liveAuthRunbookSource)
    || /sb_secret_[a-zA-Z0-9_-]{12,}/.test(liveAuthRunbookSource)) {
  throw new Error("profile-photo runbook must never contain a JWT or service-role secret literal");
}
console.log("ok  profile-photo deployment and rollback are documented without secrets");

const freeEventRunbookSection = liveAuthRunbookSource.match(
  /## Free-event RSVP cancellation: deployment and acceptance[\s\S]*?(?=\n## )/,
)?.[0] || "";
for (const marker of [
  "20260920000001_free_event_rsvp_cancellation.sql",
  "authoritative recurring free sessions",
  "never deferred",
  "Reopening does not restore cancelled RSVPs",
  "in-app only",
  'supabase link --project-ref "$SUPABASE_PROJECT_REF"',
  "supabase migration list --linked",
  "supabase migration repair --status applied 20260920000001 --linked",
  'psql "$ITC_PRODUCTION_DATABASE_URL" -v ON_ERROR_STOP=1 -f',
  "required release gate",
  "security-definer",
  "read-only production verification",
  "controlled Testing/preview frontend",
  "production frontend promotion",
]) {
  if (!freeEventRunbookSection.includes(marker)) {
    throw new Error(`free-event RSVP deployment runbook missing ${marker}`);
  }
}
if (/^\s*supabase db query/m.test(freeEventRunbookSection)
    || /^\s*supabase[^\n]*(?:--linked[^\n]*--project-ref|--project-ref[^\n]*--linked)/m.test(freeEventRunbookSection)) {
  throw new Error("free-event RSVP runbook must not mix linked/project-ref flags or use db query");
}
for (const marker of [
  "acceptance_finished_at",
  "expected_recipient_kinds",
  "Unexpected notification recipients/kinds",
  "must return zero rows",
]) {
  if (!freeEventRunbookSection.includes(marker)) {
    throw new Error(`free-event RSVP notification anti-join documentation missing ${marker}`);
  }
}
if (!/n\.destination\s*=\s*'#\/activity\/'\s*\|\|\s*p\.session_id[\s\S]*?n\.created_at\s*>=\s*p\.acceptance_started_at[\s\S]*?n\.created_at\s*<\s*p\.acceptance_finished_at/i.test(freeEventRunbookSection)
    || !/from\s+observed\s+o[\s\S]*?left\s+join\s+expected_recipient_kinds\s+e\s+using\s*\(\s*profile_id\s*,\s*kind\s*\)[\s\S]*?where\s+e\.profile_id\s+is\s+null/i.test(freeEventRunbookSection)) {
  throw new Error("free-event RSVP notification verification must anti-join bounded observed rows against exact expected recipients");
}
const freeEventRolloutMarkers = [
  "Apply the backend migration",
  "Run read-only production verification",
  "Deploy the controlled Testing/preview frontend",
  "Complete authenticated RSVP/cancel/reopen/venue/time/notification acceptance",
  "Promote the production frontend",
];
let previousRolloutMarker = -1;
for (const marker of freeEventRolloutMarkers) {
  const markerIndex = freeEventRunbookSection.indexOf(marker);
  if (markerIndex <= previousRolloutMarker) {
    throw new Error(`free-event RSVP rollout order missing or invalid at ${marker}`);
  }
  previousRolloutMarker = markerIndex;
}
console.log("ok  free-event RSVP deployment order and rollback semantics are documented");

const prayerRunbookSection = liveAuthRunbookSource.match(
  /## Private prayer requests[\s\S]*?(?=\n## )/,
)?.[0] || "";
const prayerRolloutMarkers = [
  "Private prayer requests",
  "Apply and verify the backend migration",
  "Verify RPC grants and anonymous redaction",
  "Deploy the Testing frontend",
  "Complete authenticated member/Admin acceptance",
  "Promote the production frontend",
  "Withdrawal clears request text",
];
let previousPrayerRolloutMarker = -1;
for (const marker of prayerRolloutMarkers) {
  const markerIndex = prayerRunbookSection.indexOf(marker);
  if (markerIndex <= previousPrayerRolloutMarker) {
    throw new Error(`private prayer rollout order missing or invalid at ${marker}`);
  }
  previousPrayerRolloutMarker = markerIndex;
}
const normalizedPrayerRunbook = prayerRunbookSection.replace(/\\\s*\n\s*/g, " ").replace(/\s+/g, " ");
assert.match(
  normalizedPrayerRunbook,
  /supabase migration repair 20260921000001 --status applied --linked --yes supabase migration list --linked/,
  "prayer migration history repair must use linked-project mode and immediately re-list linked history",
);
assert.doesNotMatch(
  normalizedPrayerRunbook,
  /supabase migration repair 20260921000001(?:(?!supabase migration list).)*--project-ref/,
  "prayer migration repair must not mix the incompatible project-ref and linked forms",
);
for (const signature of [
  "public.submit_prayer_request(text,boolean)",
  "public.list_my_prayer_requests()",
  "public.set_my_prayer_request_state(uuid,text)",
  "public.list_admin_prayer_requests()",
  "public.set_admin_prayer_request_status(uuid,text)",
  "public.prayer_assert_approved()",
  "public.prayer_assert_admin()",
]) {
  assert.ok(prayerRunbookSection.includes(`('${signature}'`),
    `prayer trust-boundary verification missing ${signature}`);
}
for (const contract of [
  /approved_owner[\s\S]*?'postgres'/i,
  /pg_get_userbyid\(p\.proowner\)/i,
  /security_definer[\s\S]*fixed_search_path[\s\S]*trusted_owner/i,
  /raise exception 'Prayer function trust check failed/i,
  /verified_count\s*<>\s*7/i,
  /do not\s+(?:change|replace)[\s\S]*postgres[\s\S]*make the check pass/i,
]) {
  assert.match(prayerRunbookSection, contract,
    `prayer function owner/security gate missing ${contract}`);
}
const declinedDecisionRolloutMarkers = [
  "Confirm the prayer backend baseline",
  "Apply the forward profile-decision repair",
  "Verify the repaired decision boundary",
  "Record only the forward repair version",
  "Create the declined acceptance fixture",
];
let previousDeclinedDecisionMarker = -1;
for (const marker of declinedDecisionRolloutMarkers) {
  const markerIndex = prayerRunbookSection.indexOf(marker);
  if (markerIndex <= previousDeclinedDecisionMarker) {
    throw new Error(`declined profile decision prerequisite order missing or invalid at ${marker}`);
  }
  previousDeclinedDecisionMarker = markerIndex;
}
assert.match(
  prayerRunbookSection,
  /never replay, edit, repair, or mark[\s\S]*?20260805000007_admin_application_decisions\.sql/i,
  "prayer rollout must forbid historical profile-decision migration repair",
);
assert.doesNotMatch(
  normalizedPrayerRunbook,
  /supabase migration repair 20260805000007/,
  "prayer rollout must never repair the historical profile-decision migration",
);
assert.match(
  normalizedPrayerRunbook,
  /20260921000001_prayer_requests\.sql[\s\S]*20260921000002_declined_profile_decisions\.sql/,
  "clean prayer chain must apply the forward profile-decision repair after prayer requests",
);
console.log("ok  private prayer deployment order, forward decision repair, trusted function ownership, and rollback semantics are documented");

if (!/values\s*\([\s\S]*?'pending'\s*\)/i.test(profilesMigrationSource)
    || /existing_count|count\s*\(\s*\*\s*\)[\s\S]*super_admin/i.test(profilesMigrationSource)) {
  throw new Error("fresh OAuth profiles must always bootstrap as pending");
}
for (const marker of ["trusted SQL", "known profile UUID", "role_changes", "Initial Super Admin bootstrap"]) {
  if (!liveAuthRunbookSource.includes(marker)) {
    throw new Error(`initial Super Admin bootstrap procedure missing ${marker}`);
  }
}
console.log("ok  fresh OAuth bootstrap is pending-only with an audited trusted procedure");

const appIndexSource = readFileSync(resolve(__dirnameSmoke, "index.html"), "utf8");
if (!appIndexSource.includes("window.SUPABASE_URL") || !appIndexSource.includes("window.SUPABASE_ANON_KEY")) {
  throw new Error("static Supabase configuration seam must remain explicit in app/index.html");
}
const canonicalProductionOrigin = "https://island-training-club.vercel.app";
const vercelConfig = JSON.parse(readFileSync(resolve(__dirnameSmoke, "../vercel.json"), "utf8"));
assert.doesNotMatch(appIndexSource, /<base\b/i,
  "hash-only app routes must remain on the canonical root without a document base URL");
for (const assetReference of [
  'href="/app/manifest.webmanifest"',
  'href="/app/styles.css"',
  'src="/app/js/config.js"',
  'src="/app/js/app.js"',
  'href="/app/vendor/supabase-js.2.117.2.umd.js"',
  'href="/assets/itc/favicon-48.png"',
  'href="/assets/fonts/archivo-latin-variable.woff2"',
  'src="/assets/itc/logo-header.png"',
]) {
  assert.ok(appIndexSource.includes(assetReference),
    `canonical-root document must use explicit static asset URL ${assetReference}`);
}
assert.deepEqual(vercelConfig.rewrites, [
  { source: "/", destination: "/app/index.html" },
  { source: "/push-sw.js", destination: "/app/push-sw.js" },
], "canonical root must serve the app and expose push-sw.js at / for root-scope registration");
assert.doesNotMatch(appIndexSource, /esm\.sh/,
  "Home must not load supabase-js from esm.sh");
assert.doesNotMatch(appIndexSource, /<script[^>]+src="\/app\/vendor\/supabase-js/,
  "supabase-js must not parse as a blocking classic script before app modules");
assert.match(appIndexSource, /rel="preload"[^>]+href="\/app\/vendor\/supabase-js\.2\.117\.2\.umd\.js"/,
  "supabase-js should preload in the background for the Google return path");
assert.match(appIndexSource, /rel="preconnect"[^>]+href="https:\/\/accounts\.google\.com"/,
  "Google accounts origin should preconnect so Continue with Google navigates quickly");
assert.ok(
  Array.isArray(vercelConfig.headers)
    && vercelConfig.headers.some((entry) => entry.source === "/push-sw.js"
      && (entry.headers || []).some((header) => header.key === "Service-Worker-Allowed"
        && header.value === "/")),
  "push-sw.js must allow root scope via Service-Worker-Allowed",
);
const cacheHeader = (source) => (vercelConfig.headers || [])
  .find((entry) => entry.source === source)
  ?.headers?.find((header) => header.key === "Cache-Control")
  ?.value || "";
assert.match(cacheHeader("/app/js/:path*"), /max-age=300/,
  "app JS must be browser-cacheable; cookies do not gate the Vercel CDN");
assert.match(cacheHeader("/app/vendor/:path*"), /immutable/,
  "versioned vendor JS must be long-cached");
assert.match(cacheHeader("/assets/:path*"), /max-age=300/,
  "static assets must be browser-cacheable");
assert.equal(cacheHeader("/push-sw.js"), "no-cache",
  "the service worker must not be long-cached");
{
  const vendorSource = readFileSync(
    resolve(__dirnameSmoke, "vendor/supabase-js.2.117.2.umd.js"),
    "utf8",
  );
  assert.match(vendorSource, /createClient/,
    "vendored supabase-js UMD must expose createClient");
}
const legacyProductionHosts = [
  "island-training-club-app-island-training-club.vercel.app",
  "island-training-club-app.vercel.app",
  "island-training-club-island-training-club.vercel.app",
];
const hostRedirect = (host, source, destination) => ({
  source,
  has: [{ type: "host", value: host }],
  destination,
  permanent: true,
});
assert.deepEqual(vercelConfig.redirects, [
  ...legacyProductionHosts.flatMap((host) => [
    hostRedirect(host, "/", `${canonicalProductionOrigin}/`),
    hostRedirect(host, "/app", `${canonicalProductionOrigin}/`),
    hostRedirect(host, "/app/", `${canonicalProductionOrigin}/`),
    hostRedirect(host, "/:path*", `${canonicalProductionOrigin}/:path*`),
  ]),
  { source: "/app", destination: "/", permanent: true },
  { source: "/app/", destination: "/", permanent: true },
], "legacy exact document routes must canonicalize before generic app-document redirects");
assert.ok(liveAuthRunbookSource.includes(`${canonicalProductionOrigin}/`),
  "the live-auth runbook must name the canonical production root");
if (/## Vercel env vars|Vercel project settings[^\n]*Environment Variables/i.test(liveAuthRunbookSource)) {
  throw new Error("runbook must not claim Vercel env vars inject into static HTML");
}
for (const marker of ["static no-build deployment", "app/index.html", "does not inject", "service_role", "deployment-specific values"]) {
  if (!liveAuthRunbookSource.includes(marker)) {
    throw new Error(`static deployment procedure missing ${marker}`);
  }
}
console.log("ok  static Vercel documentation matches the app/index.html configuration seam");

const integrationSourceTips = {
  payment: "720dc732944dac692334e885db2d9418d024d9bc",
  notification: "5842839e08f5e486f4b9e175232acec3cb347eb2",
  giving: "3ef00adc4efb327826d5308b20610bc18a9102db",
  community: "40bb7c2acb5ee0a7460f840e73b283cfebce4d31",
};
if (new Set(Object.values(integrationSourceTips)).size !== 4) {
  throw new Error("integration source tips must stay explicit and distinct");
}
console.log("ok  integration source-tip provenance is explicit");

const integratedViewSource = readFileSync(resolve(__dirnameSmoke, "js/views.js"), "utf8");
const integratedAppSource = readFileSync(resolve(__dirnameSmoke, "js/app.js"), "utf8");
const integratedStyleSource = readFileSync(resolve(__dirnameSmoke, "styles.css"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(__dirnameSmoke, "manifest.webmanifest"), "utf8"));
assert.equal(manifest.start_url, "/",
  "installed app launches must use the canonical root with an empty hash so the last route can restore");
assert.equal(manifest.scope, "/", "the installed app must stay within the canonical root scope");
assert.match(integratedAppSource,
  /store\.startupRoute\(location\.hash, store\.currentUser\(\)\?\.id\)/,
  "boot must resolve an empty launch against the current user's last route");
assert.match(integratedAppSource,
  /store\.rememberLastRoute\(location\.hash, user\?\.id\)/,
  "successful route commits must persist the exact internal hash for the current identity");
assert.match(integratedAppSource,
  /viewEl\.querySelector\("\[data-route-not-found\]"\)/,
  "not-found route output must not overwrite the last successful route");
assert.match(integratedAppSource,
  /visibilitychange[\s\S]*?store\.startupRoute\(location\.hash, store\.currentUser\(\)\?\.id\)/,
  "resume must recover an unexpectedly empty hash before refreshing the route");
const signedInListenerSource = integratedAppSource.match(
  /supabase\.auth\.onAuthStateChange\(\(event\) => \{[\s\S]*?\n\s*\}\);/
)?.[0] || "";
assert.ok(signedInListenerSource, "live auth SIGNED_IN listener must remain wired");
assert.doesNotMatch(signedInListenerSource, /location\.hash\s*=\s*"#\/home"/,
  "tab-refocus SIGNED_IN events must not replace the current route with Home");
assert.match(signedInListenerSource, /await renderWithFeedback\(\);[\s\S]*?await maybeRedirectToApply\(\);/,
  "SIGNED_IN must refresh the current route before checking pending-applicant routing");
assert.match(integratedViewSource, /data-route-not-found/,
  "not-found output must expose a stable route-commit guard");
console.log("ok  app launch, route commit and resume are wired to route handoff storage");
assert.match(integratedViewSource, /export async function viewAdmin\(tab = "members"\)/,
  "Admin must default to Members");
assert.doesNotMatch(integratedViewSource, /\["approvals", "Approvals"\]/,
  "Approvals must be merged into Members instead of remaining a separate tab");
assert.doesNotMatch(integratedStyleSource, /\.hyrox-(?:cycle-row|registration|reserve-card|preference-grid|radio|pool-card|threshold-rule|booking-preference)\b/,
  "retired member pool components must not retain CSS");
assert.doesNotMatch(integratedStyleSource,
  /\.(?:admin-hyrox-counts?|admin-upcoming-weeks|admin-roster-reject|hyrox-admin-cycle|hyrox-gym-controls|hyrox-queue-state)\b/,
  "retired Admin pool components must not retain CSS");
for (const sharedStyle of [
  ".hyrox-venue-card", ".hyrox-island-ecc-card", ".admin-payment-group",
  ".admin-attendance-session", ".admin-roster-row", ".replacement-admin-row",
]) {
  assert.ok(integratedStyleSource.includes(sharedStyle),
    `shared Island ECC/replacement style must remain: ${sharedStyle}`);
}
for (const retiredAdminHelper of [
  "adminHyroxGymControls", "paymentVisibleHyroxCycles", "adminHyroxCycleCards",
  "adminHyroxWeeklyBookingSetup", "adminHyroxVenuePreferenceLabel",
]) {
  assert.equal(integratedViewSource.includes(retiredAdminHelper), false,
    `retired Admin pool helper remains: ${retiredAdminHelper}`);
}
assert.doesNotMatch(integratedViewSource, /function adminHyroxProvisioningInfo/);
assert.match(integratedViewSource, /function venueDisplayName\(session\)/);
assert.match(integratedViewSource, /Mark confirmed with \$\{esc\(venueName\)\}/);
assert.match(integratedViewSource, /function adminCapacityLine\(count, capacity\)/);
assert.match(readFileSync(resolve(__dirnameSmoke, "js/app.js"), "utf8"),
  /closest\("a\[href\^='#'\][^"]*"\)/,
  "App click delegate must intercept hash-only anchor links before the router runs");
assert.match(
  readFileSync(resolve(__dirnameSmoke, "js/app.js"), "utf8"),
  /const isInPageAnchor = \/\^#\[A-Za-z\]\[A-Za-z0-9_-\]\*\$\/\.test\(href\);[\s\S]*?const target = isInPageAnchor \? document\.querySelector\(href\) : null;/,
  "In-page anchor interception must exclude SPA route hashes like #/receipt/<id> so querySelector never throws on them");
assert.doesNotMatch(
  readFileSync(resolve(__dirnameSmoke, "js/app.js"), "utf8"),
  /const target = document\.querySelector\(href\);/,
  "Unguarded querySelector on arbitrary hash hrefs would throw SyntaxError for route links");
assert.match(integratedAppSource, /form\.id === "form-privacy"[\s\S]*?updateMyPrivacyPreferences\(/,
  "Notifications must persist reminder preferences through the form delegate");
assert.match(integratedAppSource,
  /pendingVisitorHydrate = store\.hydrateLiveOperations\(\{ ensureWindow: true \}\)/,
  "signed-out live boot must not await schedule hydrate before the first Home paint");
assert.match(integratedAppSource, /peekStoredLiveSession\(\)|returningFromAuthRedirect\(\)/,
  "first-visit guests must not wait on supabase-js before Continue with Google can navigate");
assert.match(integratedAppSource, /await ensureLiveClient\(\)/,
  "live boot must load supabase-js on demand instead of from a blocking classic script");
{
  const configSource = readFileSync(resolve(__dirnameSmoke, "js/config.js"), "utf8");
  assert.match(configSource, /export function isLiveConfigured/,
    "guest Google CTA must be able to render before the vendor client exists");
  assert.match(configSource, /export async function ensureLiveClient/,
    "supabase-js UMD must load on demand");
  assert.match(configSource, /document\.createElement\("script"\)/,
    "vendor load must inject the UMD after first paint");
}
{
  const storeSource = readFileSync(resolve(__dirnameSmoke, "js/store.js"), "utf8");
  const googleSignIn = storeSource.match(
    /export async function signInWithGoogle\(\) \{[\s\S]*?\nexport async function signInWithMagicLink/
  )?.[0] || "";
  assert.match(googleSignIn, /if \(!isLiveConfigured\(\)\)/,
    "Continue with Google must not wait for the supabase client to exist");
  const redirectAt = googleSignIn.indexOf("requestGoogleIdCredential");
  const clientAt = googleSignIn.indexOf("ensureLiveClient");
  assert.ok(redirectAt >= 0, "Google sign-in must start the OIDC redirect");
  assert.ok(clientAt === -1 || redirectAt < clientAt,
    "Google OIDC navigation must start before supabase-js is required");
}
assert.match(integratedViewSource, /id="guest-email-link"/,
  "live Home must reveal the email link on the join card instead of routing to Account");
assert.match(integratedViewSource, /<summary class="guest-alt-auth">Use an email link instead</,
  "Use an email link instead must expand in place on Home");
assert.doesNotMatch(integratedViewSource, /href="#\/account"[^>]*>Use an email link instead</,
  "Home must not send email-link visitors to the Account sign-in page");
assert.match(integratedAppSource, /captureGuestEmailLink/,
  "Home re-renders must keep an in-progress email-link form");
assert.match(integratedAppSource, /dataset\.form === "photo-consent"[\s\S]*?updateMyPhotoConsent\(/,
  "Agreements must persist required photo consent through the form delegate");
assert.match(integratedAppSource, /applyOwnAvatarToRoster/,
  "Activity Who's coming must overlay the viewer's own profile photo onto their roster row");
assert.equal(typeof store.attendeeCountFor, "function",
  "store must export attendeeCountFor for identity-independent RSVP counts");
assert.equal((integratedViewSource.match(/store\.attendeeCountFor\([^)]*\)/g) || []).length, 4,
  "Schedule Going/RSVP states, capability-driven Activity Details, and Admin controls must use attendeeCountFor");
assert.doesNotMatch(integratedViewSource, /store\.attendeesFor\(s\)\.length/,
  "RSVP count surfaces must not derive counts from attendee identities");
const combinedRuntimeSource = `${integratedViewSource}\n${integratedAppSource}`;
for (const marker of [
  "Continue with Google",
  "notification-filter",
  "Giving &amp; Fundraising",
  "ITC Anniversary",
  "HYROX",
  "download-indemnity-list",
  "listIndemnityRecords",
  "buildIndemnityCsv",
]) {
  if (!combinedRuntimeSource.includes(marker)) {
    throw new Error(`testing integration missing ${marker}`);
  }
}
console.log("ok  final cross-domain runtime markers coexist");
for (const marker of [
  "Continue with Google",
  "Membership Details",
  "Agreements",
  "Notifications",
  "Members",
  "HYROX",
  "Duty",
  "Session controls",
]) {
  if (!integratedViewSource.toLowerCase().includes(marker.toLowerCase())) {
    throw new Error(`integrated Payment/Auth UI missing ${marker}`);
  }
}
console.log("ok  composed Payment/Auth UI markers coexist");
for (const marker of ['case "pay"', 'case "form-reserve"', 'case "form-mark-paid"', 'case "replacement"', 'case "replacement-accept"', "store.reserveSession", "store.markBookingPaid", "store.createReplacementRequest"]) {
  if (!integratedAppSource.includes(marker)) {
    throw new Error(`integrated Payment router missing ${marker}`);
  }
}
assert.ok(integratedAppSource.includes('location.hash = /^#\\/replacement\\/[^/?#]+$/.test'),
  "sign-in handoff must preserve the private replacement route");
console.log("ok  Payment reserve, replacement, and mark-paid routes remain delegated");
for (const marker of ['case "release-reservation"', 'case "defer-to"', 'case "copy-fps"']) {
  if (!integratedAppSource.includes(marker)) {
    throw new Error(`integrated Payment router missing ${marker}`);
  }
}
for (const retiredAction of [
  'case "demo-signin"', 'case "reset-demo"', 'case "form-checkout"',
  "store.payForSession", "use a demo profile",
]) {
  if (integratedAppSource.includes(retiredAction)) {
    throw new Error(`retired runtime action/copy remains: ${retiredAction}`);
  }
}
console.log("ok  rendered Payment controls are delegated and retired actions/copy are absent");
for (const marker of [
  "notificationBellHTML",
  "notification-filter",
  "notification-kind-badge",
  "notificationRelativeTime",
  "notificationHktTime",
]) {
  if (!integratedViewSource.includes(marker) && !integratedAppSource.includes(marker)) {
    throw new Error(`integrated Notification domain missing ${marker}`);
  }
}
console.log("ok  latest Notification domain markers coexist");
{
  const notificationFallbacks = new Map([
    ["operational_booking_reserved", "#/account/payments"],
    ["operational_rsvp_confirmed", "#/schedule"],
    ["operational_payment_approved", "#/account/payments"],
    ["operational_session_deferred", "#/account/payments"],
    ["operational_session_cancelled_no_defer", "#/schedule"],
    ["operational_payment_marked", "#/admin/payments"],
    ["operational_gym_finalized", "#/admin/payments"],
    ["operational_session_cancelled", "#/schedule"],
    ["operational_session_venue_updated", "#/schedule"],
    ["admin_application_submitted", "#/admin/approvals"],
    ["admin_application_approved", "#/admin/members"],
    ["admin_application_declined", "#/admin/members"],
    ["admin_role_promoted", "#/admin/members"],
    ["admin_role_demoted", "#/admin/members"],
    ["admin_membership_revoked", "#/admin/members"],
    ["admin_role_changed", "#/admin/members"],
    ["giving_campaign_published", "#/giving"],
    ["welcome", "#/account"],
  ]);
  const malformedDestinations = [
    "https://example.com/foreign",
    "/account/payments",
    "#account/payments",
    "javascript:alert(1)",
  ];
  for (const [kind, expected] of notificationFallbacks) {
    if (data.notificationDestination(kind) !== expected) {
      failures++;
      console.error(`FAIL ${kind} notification fallback should be ${expected}`);
    }
    if (data.notificationDestination(kind, "#/pay/booking-123") !== "#/pay/booking-123") {
      failures++;
      console.error(`FAIL explicit internal notification destination should win for ${kind}`);
    }
    for (const destination of malformedDestinations) {
      if (data.notificationDestination(kind, destination) !== expected) {
        failures++;
        console.error(`FAIL malformed notification destination should not win for ${kind}: ${destination}`);
      }
    }
  }
  if (data.notificationDestination("unknown_kind") !== "#/account") {
    failures++;
    console.error("FAIL unknown notification kinds should fall back to #/account");
  }
  console.log("ok  notification destinations use explicit internal routes or stable semantic fallbacks");
}
{
  // Live deployments: recurring activity defaults are seed/SQL-administered,
  // so the Admin activity editor must render read-only with an honest note
  // instead of silently writing device-local state behind a success toast.
  if (!/export function viewAdminActivity[\s\S]*?isLive\(\)/.test(integratedViewSource)) {
    throw new Error("viewAdminActivity must gate the recurring editor on isLive()");
  }
  if (!integratedViewSource.includes("form-fieldset")) {
    throw new Error("live activity editor must disable the form via a fieldset");
  }
  if (!integratedViewSource.includes("recurring defaults are bundled with the app build")) {
    throw new Error("live activity editor must explain that recurring defaults are bundled");
  }
  console.log("ok  live deployments render the recurring activity editor read-only");
}

const anniversary = data.ANNOUNCEMENTS[0];
if (
  data.ANNOUNCEMENTS.length !== 1 ||
  anniversary?.title !== "Island Training Club turns 2" ||
  anniversary?.milestones?.length !== 5
) {
  failures++;
  console.error("FAIL announcement seeds should contain only the structured ITC anniversary");
} else console.log("ok  announcement seeds contain only the ITC anniversary");
if (
  anniversary?.postedAt == null ||
  new Date(anniversary.postedAt).getFullYear() !== 2026 ||
  new Date(anniversary.postedAt).getMonth() !== 7 ||
  new Date(anniversary.postedAt).getDate() !== 6
) {
  failures++;
  console.error("FAIL announcement postedAt should resolve to 2026-08-06 local date");
} else console.log("ok  announcement postedAt resolves to 2026-08-06 local date");

{
  const md = await import("./js/announcement-markdown.js");
  const html = md.renderAnnouncementMarkdown("Hello **bold** and *italic* and __under__\n\n- one\n- two\n\n1. a\n2. b");
  if (!html.includes("<strong>bold</strong>") || !html.includes("<em>italic</em>")) {
    throw new Error("markdown must render bold/italic");
  }
  if (!html.includes("<u>under</u>") && !html.includes("<strong>under</strong>")) {
    throw new Error("markdown must render underline via __text__ → <u>");
  }
  if (!html.includes("<ul>") || !html.includes("<ol>")) {
    throw new Error("markdown must render lists");
  }
  try {
    md.renderAnnouncementMarkdown("<script>alert(1)</script>");
    throw new Error("raw HTML must be rejected or escaped");
  } catch (err) {
    if (!/unsafe|invalid|forbidden/i.test(String(err.message))) {
      // Escaped script tags are OK — assert no executable tag remains
    }
  }
  if (md.renderAnnouncementMarkdown("x <script>y</script> z").includes("<script>")) {
    throw new Error("script tags must not survive render");
  }
  if (md.announcementPlainText("Hello **world**") !== "Hello world") {
    throw new Error("plain text strip must remove marks");
  }
  console.log("ok  announcement markdown subset");
}

// --- Community announcement publish fan-out (Task 2) ---
store.resetLocalData();
installLocalFixtures();
{
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  const member = raw.users.find((u) => u.id === "fixture-member");
  if (member) member.communityNews = true;
  raw.users.push({
    id: "fixture-other-admin", role: "superadmin", status: "approved",
    fullName: "Test Other Admin", preferredName: "Other",
    email: "other-admin@example.test",
    isMinor: false, appliedAt: Date.now() - 86400000,
    indemnityAcceptedAt: Date.now() - 86400000,
    privacyAcceptedAt: Date.now() - 86400000,
    whatsappReminders: false, emailReceipts: false, communityNews: false,
  });
  raw.users.push({
    id: "fixture-member-off", role: "member", status: "approved",
    fullName: "Test Member Off", preferredName: "Off",
    email: "member-off@example.test",
    isMinor: false, appliedAt: Date.now() - 7200000,
    indemnityAcceptedAt: Date.now() - 7200000,
    privacyAcceptedAt: Date.now() - 7200000,
    whatsappReminders: false, emailReceipts: false, communityNews: false,
  });
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
}
store.signIn("admin@example.test");
const published = await store.publishAnnouncement({
  title: "Saturday social",
  body: "Bring **shoes**\n\n- water\n- smile",
  photoUrl: "https://example.test/photo.webp",
});
if (!published?.id || published.status !== "published") throw new Error("publish must return published row");
const annMemberNotes = store.notificationsFor("fixture-member").filter((n) => n.kind === "community_announcement_published");
const annActorNotes = store.notificationsFor("fixture-admin").filter((n) => n.kind === "community_announcement_published");
const annAuditNotes = store.notificationsFor("fixture-other-admin").filter((n) => n.kind === "community_announcement_audit");
const annOptedOutNotes = store.notificationsFor("fixture-member-off").filter((n) => n.kind === "community_announcement_published");
if (annMemberNotes.length !== 1) throw new Error("opted-in member must get shared");
if (annActorNotes.length !== 1) throw new Error("acting admin must get shared");
if (annAuditNotes.length !== 1) throw new Error("other admin must get audit");
if (annOptedOutNotes.length !== 0) throw new Error("opted-out member must not get shared");
if (annMemberNotes[0].link !== "#/community/announcements") throw new Error("shared destination");
if (annAuditNotes[0].title !== "Announcement published") throw new Error("audit notification title must match live trigger");
if (!data.ANNOUNCEMENTS.some((a) => a.id === "ann-itc-turns-2")) throw new Error("anniversary seed intact");
let unsafeBodyRejected = false;
try {
  await store.publishAnnouncement({ title: "Unsafe", body: "<script>alert(1)</script>" });
} catch (err) {
  unsafeBodyRejected = true;
  if (!/HTML tags/i.test(String(err?.message || ""))) {
    throw new Error("unsafe announcement body must reject HTML with clear error");
  }
}
if (!unsafeBodyRejected) throw new Error("publishAnnouncement must reject unsafe markdown");
console.log("ok  announcement publish fan-out");

store.signIn("admin@example.test");
{
  const compose = await views.viewAdminAnnouncementCompose();
  for (const marker of [
    'data-form="announcement-publish"',
    'name="title"',
    'name="body"',
    'name="photo_url"',
    "announcement-preview",
  ]) {
    if (!compose.includes(marker)) throw new Error(`compose missing ${marker}`);
  }
}
console.log("ok  admin announcement compose markers");
{
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.announcements = [];
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
}

// Weekly encouragement rotates on Hong Kong Sundays, regardless of the host
// calendar. Each expected reference is hand-derived from the fixed HKT epoch.
{
  const refs = data.WEEKLY_VERSES.map((verse) => verse.ref);
  if (data.WEEKLY_VERSES.length !== 32) {
    throw new Error(`Weekly verse pool should have 32 entries, got ${data.WEEKLY_VERSES.length}`);
  }
  if (new Set(refs).size !== refs.length) {
    throw new Error("Weekly verse pool refs must be unique");
  }

  const verseCases = [
    ["one second before the epoch boundary", "2026-10-10T15:59:59.000Z", "Psalm 23:1"],
    ["one millisecond before the epoch boundary", "2026-10-10T15:59:59.999Z", "Psalm 23:1"],
    ["at the epoch boundary", "2026-10-10T16:00:00.000Z", "Hebrews 12:1"],
    ["one millisecond before the next boundary", "2026-10-17T15:59:59.999Z", "Hebrews 12:1"],
    ["at the next boundary", "2026-10-17T16:00:00.000Z", "Isaiah 40:31"],
    ["one week before the epoch", "2026-10-03T16:00:00.000Z", "Psalm 23:1"],
    ["eight weeks before the epoch", "2026-08-15T16:00:00.000Z", "Proverbs 3:5"],
    ["nine weeks before the epoch", "2026-08-08T16:00:00.000Z", "James 1:3"],
  ];
  for (const [label, instant, expectedRef] of verseCases) {
    const actualRef = data.weeklyVerse(new Date(instant)).ref;
    if (actualRef !== expectedRef) {
      throw new Error(`Weekly verse ${label} should be ${expectedRef}, got ${actualRef}`);
    }
  }

  const dataModuleURL = new URL("./js/data.js", import.meta.url).href;
  const fixedInstant = "2026-10-10T16:00:00.000Z";
  const childSource = `
    const RealDate = Date;
    const fixedInstant = ${JSON.stringify(fixedInstant)};
    globalThis.Date = class FixedDate extends RealDate {
      constructor(...args) { super(...(args.length ? args : [fixedInstant])); }
      static now() { return new RealDate(fixedInstant).getTime(); }
    };
    const { weeklyVerse } = await import(${JSON.stringify(dataModuleURL)});
    const supplied = weeklyVerse(new RealDate(fixedInstant)).ref;
    const defaulted = weeklyVerse().ref;
    process.stdout.write(JSON.stringify({ supplied, defaulted }));
  `;
  for (const timeZone of ["Asia/Hong_Kong", "America/Los_Angeles"]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "--eval", childSource], {
      encoding: "utf8",
      env: { ...process.env, TZ: timeZone },
    });
    if (child.status !== 0) {
      throw new Error(`Weekly verse ${timeZone} child failed: ${child.stderr.trim()}`);
    }
    const result = JSON.parse(child.stdout);
    if (result.supplied !== "Hebrews 12:1" || result.defaulted !== "Hebrews 12:1") {
      throw new Error(`Weekly verse should use the same HKT instant under ${timeZone}; got ${child.stdout}`);
    }
  }
  console.log("ok  weekly verse rotates at deterministic HKT Sunday boundaries");
  console.log("ok  weekly verse matches across HKT and Los Angeles host timezones");
}

// --- Visitor state ---
store.signOut();
const allUpcoming = store.upcomingSessions(14);
for (const activityId of ["wnt", "run", "water"]) {
  assert.ok(allUpcoming.some((session) => session.activityId === activityId),
    `local mode must continue generating recurring ${activityId} sessions`);
}
// booking tests need a session that hasn't started yet — today's sessions
// are unbookable once their start time passes
const paid = allUpcoming.find((s) => s.kind === "paid" && !data.sessionStarted(s));
const free = allUpcoming.find((s) => s.kind === "free");
if (!paid || !free) throw new Error("expected both paid and free sessions in window");
const localVisitorHome = views.viewHome();
if (!localVisitorHome.includes("<h2>This week — open to all</h2>")) {
  throw new Error("visitor Home must show the exact open-to-all h2");
}
if (localVisitorHome.includes("My Week")) {
  throw new Error("visitor Home must not show My Week");
}
{
  const weekStart = data.sundayOf(data.todayLocal());
  const weekEnd = data.addDays(weekStart, 6);
  const freeInWeek = allUpcoming.filter((session) => {
    if (session.kind !== "free") return false;
    const iso = session.dateISO || (session.snapshot && session.snapshot.dateISO);
    if (!iso) return false;
    const t = data.parseISO(iso).getTime();
    return t >= weekStart.getTime() && t <= weekEnd.getTime();
  });
  const distinctDays = new Set(freeInWeek.map((session) => session.dateISO));
  if (freeInWeek.length) {
    if (!localVisitorHome.includes('class="week-day-head"')) {
      throw new Error("visitor Home week list must group sessions under day headers");
    }
    const headCount = (localVisitorHome.match(/class="week-day-head"/g) || []).length;
    if (headCount !== distinctDays.size) {
      throw new Error(`visitor Home must render one day head per distinct day (${distinctDays.size}), got ${headCount}`);
    }
  }
}
const assertRenderedActivityLinksAreFree = (html, label) => {
  const linkedIds = [...html.matchAll(/href="#\/activity\/([^"]+)"/g)].map((match) => match[1]);
  if (!linkedIds.length) {
    // Mirror viewHome()'s visitor branch: when no free sessions exist in the
    // current Sun–Sat window (same as Schedule), the empty state is the
    // expected output and there are no links to verify.
    const weekStart = data.sundayOf(data.todayLocal());
    const weekEnd = data.addDays(weekStart, 6);
    const freeInWeek = allUpcoming.filter((session) => {
      if (session.kind !== "free") return false;
      const iso = session.dateISO || (session.snapshot && session.snapshot.dateISO);
      if (!iso) return false;
      const t = data.parseISO(iso).getTime();
      return t >= weekStart.getTime() && t <= weekEnd.getTime();
    });
    if (freeInWeek.length) {
      throw new Error(`${label} must render at least one activity link (${freeInWeek.length} free sessions this week)`);
    }
    if (!html.includes("No open sessions this week")) {
      throw new Error(`${label} should render the empty state when no free sessions are in the current week`);
    }
    return;
  }
  for (const id of linkedIds) {
    const session = allUpcoming.find((item) => item.id === id);
    if (!session || session.kind !== "free") {
      throw new Error(`${label} rendered a non-free activity link: ${id}`);
    }
  }
};
assertRenderedActivityLinksAreFree(localVisitorHome, "visitor Home");
{
  const weekStart = data.sundayOf(data.todayLocal());
  const weekEnd = data.addDays(weekStart, 6);
  const freeInWeek = allUpcoming.filter((session) => {
    if (session.kind !== "free") return false;
    const iso = session.dateISO || (session.snapshot && session.snapshot.dateISO);
    if (!iso) return false;
    const t = data.parseISO(iso).getTime();
    return t >= weekStart.getTime() && t <= weekEnd.getTime();
  });
  if (freeInWeek.length) {
    // free is guaranteed non-null in this branch — guard above found one.
    if (!localVisitorHome.includes(free.name) || localVisitorHome.includes(paid.name)) {
      throw new Error("visitor Home must show free sessions only");
    }
  } else {
    // Outside free-session weekdays: no free sessions in window.
    if (localVisitorHome.includes(free.name) || localVisitorHome.includes(paid.name)) {
      throw new Error("visitor Home should not list session names when the current week has no free sessions");
    }
  }
  if (localVisitorHome.includes("This week — open to all") && localVisitorHome.includes(paid.name)) {
    throw new Error("visitor Home must show free sessions only");
  }
  if (!localVisitorHome.includes("This week — open to all")
      && !localVisitorHome.includes("No open sessions this week")) {
    throw new Error("visitor Home must fall back to the no-sessions copy");
  }
}
if (!localVisitorHome.includes("This week — open to all")
    && !localVisitorHome.includes("No open sessions this week")) {
  throw new Error("visitor Home must fall back to the no-sessions copy");
}
if (localVisitorHome.includes("No open sessions this week")) {
  if (localVisitorHome.includes('href="#/schedule">See more →</a>')) {
    throw new Error("visitor Home empty week must not show See more");
  }
} else if (!localVisitorHome.includes('href="#/schedule">See more →</a>')) {
  throw new Error("visitor Home with sessions must keep See more");
}
assertPrimaryNav(null, ["Home", "Schedule", "Community"], "visitor");
if (!localVisitorHome.includes('href="#/account">Sign in or join</a>')) {
  throw new Error("local signed-out Home must retain the Account sign-in link");
}
if (!localVisitorHome.includes("<h3 class=\"mt8 guest-join-title\">Join the club.</h3>")) {
  throw new Error("signed-out Home must prompt visitors to join, not browse");
}
if (!localVisitorHome.includes("Sign up to book sessions and stay in the community.")) {
  throw new Error("signed-out Home must explain why to sign up");
}
if (localVisitorHome.includes("Loading this week's sessions…")) {
  throw new Error("local signed-out Home must not show the live schedule loading copy");
}
if (localVisitorHome.includes("<h3 class=\"mt8\">Everyone is welcome</h3>")) {
  throw new Error("signed-out Home must not use a welcome heading on the join card");
}
if (localVisitorHome.includes('data-action="sign-in-google"')) {
  throw new Error("local signed-out Home must not render the live Google action");
}
console.log("ok  signed-out Home uses the correct live/local sign-in action");
await check("home (visitor)", () => views.viewHome());
const scheduleHtml = await check("schedule", () => views.viewSchedule());
try {
  assert.doesNotMatch(scheduleHtml, /Free sessions are open to everyone/,
    "Schedule must not repeat global free/paid guidance after the session list");
} catch (err) {
  failures++;
  console.error(`FAIL Schedule hierarchy: ${err.message}`);
}

// Member Schedule weeks run Sunday–Saturday. Boundary and selection values
// are hand-checked literals so a Monday fallback or off-by-seven navigation
// cannot satisfy the expectations by sharing the implementation's logic.
{
  if (typeof data.sundayOf !== "function") {
    throw new Error("Schedule requires an exported sundayOf helper");
  }
  for (const [dateISO, expectedSunday] of [
    ["2026-08-09", "2026-08-09"], // Sunday stays in its own week
    ["2026-08-10", "2026-08-09"], // Monday crosses back one day
    ["2026-08-15", "2026-08-09"], // Saturday closes the same week
  ]) {
    const actual = data.isoDate(data.sundayOf(data.parseISO(dateISO)));
    if (actual !== expectedSunday) {
      throw new Error(`sundayOf(${dateISO}) should be ${expectedSunday}, got ${actual}`);
    }
  }

  if (typeof views.scheduleSelectionForWeek !== "function") {
    throw new Error("Schedule requires a shared week-selection fallback");
  }
  const navigationCases = [
    ["2026-08-12", 0, "2026-08-12"], // current week keeps today selected
    ["2026-08-12", 1, "2026-08-16"], // next week opens Sunday
    ["2026-08-12", 2, "2026-08-23"], // next again moves seven days
    ["2026-08-12", -1, "2026-08-02"], // previous week opens Sunday
    ["2026-08-09", 1, "2026-08-16"], // Sunday boundary moves exactly seven days
  ];
  for (const [today, offset, expectedSelection] of navigationCases) {
    const actual = views.scheduleSelectionForWeek(data.parseISO(today), offset);
    if (actual !== expectedSelection) {
      throw new Error(`Schedule offset ${offset} from ${today} should select ${expectedSelection}, got ${actual}`);
    }
  }

  views.resetScheduleState();
  const currentSchedule = views.viewSchedule();
  const currentSunday = data.sundayOf(data.todayLocal());
  const stripLabels = [...currentSchedule.matchAll(/data-date="[^"]+">\s*([A-Z][a-z]{2})<strong/g)]
    .map((match) => match[1]);
  const expectedLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (JSON.stringify(stripLabels) !== JSON.stringify(expectedLabels)) {
    throw new Error(`Schedule strip should be Sunday-first; got ${stripLabels.join(" ")}`);
  }
  if (!currentSchedule.includes(`Week of ${data.fmtDateLong(currentSunday)}`)) {
    throw new Error("Schedule Week of date should be the current Sunday");
  }
  const currentSelectedPattern = new RegExp(
    `class="day-cell [^"]*active[^"]*"\\s*data-action="sched-day" data-date="${data.isoDate(data.todayLocal())}"`
  );
  if (!currentSelectedPattern.test(currentSchedule)) {
    throw new Error("Current Schedule week should keep the current date selected");
  }

  views.scheduleState.weekOffset = 1;
  views.scheduleState.selected = null;
  const nextSchedule = views.viewSchedule();
  const expectedNextSunday = data.addDays(currentSunday, 7);
  if (views.scheduleState.selected !== data.isoDate(expectedNextSunday)) {
    throw new Error("A non-current Schedule week should default to Sunday");
  }
  if (!nextSchedule.includes(`Week of ${data.fmtDateLong(expectedNextSunday)}`)) {
    throw new Error("Next Schedule week should move seven days to the next Sunday");
  }
  views.resetScheduleState();
  console.log("ok  Schedule uses Sunday boundaries and Sunday-first day labels");
  console.log("ok  Schedule navigation selects Sundays and returns to today");
}

// Schedule filters: only chronological activity categories remain.
{
  const schedHtml = views.viewSchedule();
  const expectedFilterOrder = ["all", "Run", "Water", "Strength", "HYROX", "Socials"];
  const renderedFilterOrder = [...schedHtml.matchAll(/data-filter="([^"]+)"/g)].map((match) => match[1]);
  if (JSON.stringify(renderedFilterOrder) !== JSON.stringify(expectedFilterOrder)) {
    failures++;
    console.error(`FAIL Schedule filter order should be ${expectedFilterOrder.join(", ")}; got ${renderedFilterOrder.join(", ")}`);
  } else console.log("ok  Schedule filters follow weekly event order without Free/Paid chips");
  for (const removed of ['data-filter="free"', 'data-filter="paid"']) {
    if (schedHtml.includes(removed)) {
      failures++;
      console.error(`FAIL Schedule should not render the ${removed} filter chip`);
    }
  }
  console.log("ok  Schedule keeps chronological category filters only");
}
const hyroxSid = store.nextSession().kind === "paid" ? store.nextSession().id : null;
await check("activity paid (visitor)", () => views.viewActivity(paid.id));
await check("activity free (visitor)", () => views.viewActivity(free.id));
await check("community", () => views.viewCommunity());
const commHtml = await views.viewCommunity();
if (!commHtml.includes("Find your place in the crew.")) {
  failures++;
  console.error("FAIL visitor Community heading is not personalized");
} else console.log("ok  visitor Community heading is personalized");
for (const required of [
  "Socials",
  "Connect beyond training",
  "Meet up, share a meal, and find your people.",
  "View next social",
  "Latest from ITC",
  "Island Training Club turns 2",
  "Ways to connect",
  "Explore",
]) {
  if (!commHtml.includes(required)) {
    failures++;
    console.error(`FAIL Community Pulse missing ${required}`);
  }
}
const selectedCommunitySocial = store.nextSocialSession();
if (!selectedCommunitySocial
    || !commHtml.includes(`Next up: ${selectedCommunitySocial.name}`)
    || !commHtml.includes(data.fmtDate(selectedCommunitySocial.dateISO))
    || !commHtml.includes(`href="#/activity/${selectedCommunitySocial.id}"`)) {
  failures++;
  console.error("FAIL Community Pulse should show and link to the next Socials event");
}
if (commHtml.includes("Post-training lunch") || commHtml.includes("Every Saturday after HYROX")
    || commHtml.includes("See the next lunch")) {
  failures++;
  console.error("FAIL Community Pulse should not use lunch-specific preview copy");
}
const coexistenceSurface = `${integratedViewSource}\n${localVisitorHome}\n${commHtml}`;
for (const marker of ["Home", "notificationBellHTML", '#/giving', "community-pulse", "HYROX"]) {
  if (!coexistenceSurface.includes(marker)) {
    failures++;
    console.error(`FAIL combined domain coexistence missing ${marker}`);
  }
}
console.log("ok  Home, Notification bell, Giving nav, Community pulse, and HYROX admin coexist");
let commOk = true;
for (const link of [
  "#/community/prayers",
  "#/community/fellowship",
  "#/schedule",
  "#/community/announcements",
  "#/community/about",
]) {
  if (!commHtml.includes(`href="${link}"`)) {
    failures++;
    commOk = false;
    console.error(`FAIL Community missing ${link} card`);
  }
}
if (commOk) console.log("ok  Community shows the five destination links");
{
  const connectAt = commHtml.indexOf("<h2>Ways to connect</h2>");
  const socialAt = commHtml.indexOf("Connect beyond training");
  if (connectAt < 0 || socialAt < 0 || connectAt > socialAt) {
    failures++;
    console.error("FAIL Community Pulse should put Ways to connect before the next-social feature");
  } else console.log("ok  Community Pulse puts Ways to connect first");
}
if (!/community-action-grid\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*1fr;/.test(integratedStyleSource)
    || !/community-action-card\s*\{\s*display:\s*flex;/.test(integratedStyleSource)) {
  failures++;
  console.error("FAIL Ways to connect should render as full-width tap rows");
} else console.log("ok  Ways to connect uses full-width tap rows");
if (!commHtml.includes('#/community/about')) {
  failures++;
  console.error("FAIL Community Explore should still link to About ITC");
} else console.log("ok  About ITC remains reachable from Community");
if (commHtml.includes("Arnold Wong") || commHtml.includes("Our foundation")) {
  failures++;
  console.error("FAIL leaders/culture should live behind the About card");
} else console.log("ok  leaders & culture live behind the About card");
await check("community > prayers", () => views.viewCommunity("prayers"));
const visitorPrayerHtml = await views.viewCommunity("prayers");
if (!/approved member/i.test(visitorPrayerHtml) || visitorPrayerHtml.includes('id="form-prayer"')) {
  failures++;
  console.error("FAIL visitor Prayer must show the approved-member gate without a form");
} else console.log("ok  visitor Prayer is gated without hiding the public description");
assert.match(visitorPrayerHtml,
  /We pray for each other — injuries, exams, work, family, anything\./,
  "visitor Prayer gate must retain the public prayer description");
assert.match(visitorPrayerHtml,
  /<a class="btn ghost mt16" href="#\/account">Sign in or view Profile<\/a>/,
  "visitor Prayer gate must offer the signed-out account CTA");
assert.doesNotMatch(visitorPrayerHtml, /My Prayer Requests|prayer-request-list/,
  "visitor Prayer gate must not expose member history");
await check("community > fellowship", () => views.viewCommunity("fellowship"));
await check("community > meals -> redirect", () => views.viewCommunity("meals"));
const mealsRoute = await views.viewCommunity("meals");
if (mealsRoute?.redirect !== "#/schedule") {
  failures++;
  console.error("FAIL community meals should redirect to the Schedule tab");
} else console.log("ok  community meals redirects to Schedule");
await check("community > announcements", () => views.viewCommunity("announcements"));
const announcementHtml = await views.viewCommunity("announcements");
for (const required of [
  "Island Training Club turns 2",
  "620",
  "members strong",
  "14",
  "committed leaders",
  "unwavering vision",
  "clear mission",
  "God who made this all possible",
  "ITC Leadership and Coaching Team",
  "fitness, friendship, community and faith",
]) {
  if (!announcementHtml.includes(required)) {
    failures++;
    console.error(`FAIL anniversary story missing ${required}`);
  }
}
const savedAnnouncements = [...data.ANNOUNCEMENTS];
data.ANNOUNCEMENTS.splice(0);
const rawEmptyAnnouncements = JSON.parse(mem.get("itc.prototype.v1"));
const savedStoreAnnouncements = Array.isArray(rawEmptyAnnouncements.announcements)
  ? [...rawEmptyAnnouncements.announcements]
  : [];
rawEmptyAnnouncements.announcements = [];
mem.set("itc.prototype.v1", JSON.stringify(rawEmptyAnnouncements));
store.load();
let emptyCommunity = "";
let emptyAnnouncements = "";
try {
  emptyCommunity = await views.viewCommunity();
  emptyAnnouncements = await views.viewCommunity("announcements");
} finally {
  data.ANNOUNCEMENTS.splice(0, data.ANNOUNCEMENTS.length, ...savedAnnouncements);
  rawEmptyAnnouncements.announcements = savedStoreAnnouncements;
  mem.set("itc.prototype.v1", JSON.stringify(rawEmptyAnnouncements));
  store.load();
}
if (!emptyCommunity.includes("No announcements yet") || !emptyAnnouncements.includes("No announcements yet")) {
  failures++;
  console.error("FAIL Community announcement empty states should render safely");
} else console.log("ok  Community announcement empty states render safely");
await check("community > about", () => views.viewCommunity("about"));
const commAbout = await views.viewCommunity("about");
if (!commAbout.includes("Arnold Wong") || !commAbout.includes("Our foundation")) {
  failures++;
  console.error("FAIL Community About page missing leaders or culture content");
} else console.log("ok  Community About page carries leaders & culture");
if (commAbout.includes("Community copy is draft placeholder text for review with ITC leadership.")) {
  failures++;
  console.error("FAIL Community About should drop the draft-placeholder disclaimer");
} else console.log("ok  Community About drops the draft disclaimer");
for (const [section, heading] of [
  ["prayers", "Prayers"],
  ["fellowship", "Fellowship"],
  ["announcements", "Announcements"],
]) {
  const html = await views.viewCommunity(section);
  if (!html.includes(`<h1 class="display sm mt16">${heading}</h1>`) || html.includes("Community · ")) {
    failures++;
    console.error(`FAIL community > ${section} should use a white title without a Community kicker`);
  }
}
if (!commAbout.includes(">About Island Training Club<") || commAbout.includes("Community · ")) {
  failures++;
  console.error("FAIL Community About kicker should read About Island Training Club");
} else console.log("ok  Community About kicker reads About Island Training Club");
if (!commAbout.includes(`<h2 class="display sm">More than a workout.</h2>`)) {
  failures++;
  console.error("FAIL Community About should keep the More than a workout title");
} else console.log("ok  Community About keeps More than a workout");
console.log("ok  community sub-pages use white titles without Community kickers");
const fellowshipHtml = await views.viewCommunity("fellowship");
if (fellowshipHtml.includes("I’m interested") || fellowshipHtml.includes("tell me more")
    || fellowshipHtml.includes("connect-interest")) {
  failures++;
  console.error("FAIL Fellowship should not show the unused interest button");
} else console.log("ok  Fellowship drops the unused interest button");
if (!announcementHtml.includes("Island Training Club turns 2.")) {
  failures++;
  console.error("FAIL announcements should keep the anniversary story title");
}
if (announcementHtml.includes("Publish announcement")) {
  failures++;
  console.error("FAIL visitors should not see Publish announcement");
} else console.log("ok  visitors do not see Publish announcement");
{
  const snapshot = mem.get("itc.prototype.v1");
  installLocalFixtures();
  store.signIn("admin@example.test");
  const adminAnnouncements = await views.viewCommunity("announcements");
  const publishAt = adminAnnouncements.indexOf("Publish announcement");
  const storyAt = adminAnnouncements.indexOf("Island Training Club turns 2.");
  if (publishAt < 0 || storyAt < 0 || publishAt < storyAt) {
    failures++;
    console.error("FAIL Admin Publish announcement should sit below the announcement story");
  } else console.log("ok  Admin Publish announcement sits at the bottom of Announcements");
  const compose = await views.viewAdminAnnouncementCompose();
  if (!compose.includes("form-announcement-publish") || !compose.includes("Publish")) {
    failures++;
    console.error("FAIL Admin announcement compose should render the publish form");
  } else console.log("ok  Admin announcement compose renders");
  store.signIn("member@example.test");
  const memberAnnouncements = await views.viewCommunity("announcements");
  if (memberAnnouncements.includes("Publish announcement")) {
    failures++;
    console.error("FAIL members should not see Publish announcement");
  } else console.log("ok  members do not see Publish announcement");
  mem.set("itc.prototype.v1", snapshot);
  store.load();
}
if (!(await views.viewCommunity("nope")).includes("Page not found")) {
  failures++;
  console.error("FAIL unknown Community section should 404");
} else console.log("ok  unknown Community section 404s");
await check("account (visitor)", () => views.viewAccount());
{
  const localVisitorAccount = await views.viewAccount();
  if (localVisitorAccount.includes("Membership is free")) {
    throw new Error("signed-out Account must not say membership is free");
  }
}
await check("apply", () => views.viewApply());
if (!views.viewApply().includes('name="donorId"')) {
  failures++;
  console.error("FAIL apply form missing optional Donor ID field");
} else console.log("ok  apply form collects optional Donor ID");

// --- apply form checkboxes render the read-and-accept links (all three docs) ---
// local mode: viewApply() dispatches to viewApplyLocal when isLive() is false
const applyLocalHtml = views.viewApply();
for (const [key, label] of [
  ["indemnity", "Indemnity"],
  ["privacy", "privacy policy"],
  ["guidelines", "community guidelines"],
]) {
  if (!applyLocalHtml.includes(`data-action="open-doc" data-doc="${key}"`)) {
    failures++;
    console.error(`FAIL local-mode apply form missing modal trigger for "${key}"`);
  }
  if (!applyLocalHtml.includes(`data-doc-accept="${key}"`)) {
    failures++;
    console.error(`FAIL local-mode apply form missing doc-accept container for "${key}"`);
  }
  if (!applyLocalHtml.includes(label)) {
    failures++;
    console.error(`FAIL local-mode apply form missing label text "${label}"`);
  }
}
if (!applyLocalHtml.includes("data-doc-checkbox")) {
  failures++;
  console.error("FAIL local-mode apply form checkboxes missing data-doc-checkbox attribute");
}
const applyDocHint = "Click on the highlighted link below to read the document and enable acceptance.";
if (!applyLocalHtml.includes(applyDocHint)) {
  failures++;
  console.error("FAIL local-mode apply form missing the read-first hint copy");
}
if ((applyLocalHtml.match(new RegExp(applyDocHint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length !== 3) {
  failures++;
  console.error("FAIL local-mode apply form should show the read-first hint for all three documents");
}
if (!applyLocalHtml.includes('data-doc-warn hidden role="alert"')) {
  failures++;
  console.error("FAIL local-mode apply form missing per-document submit warning slots");
}
for (const key of ["privacy", "guidelines", "indemnity"]) {
  const block = applyLocalHtml.match(new RegExp(`data-doc-accept="${key}"[\\s\\S]*?</div>`));
  if (!block || block[0].indexOf("data-doc-hint") > block[0].indexOf("data-doc-checkbox")) {
    failures++;
    console.error(`FAIL local-mode apply form should place the hint above the ${key} checkbox`);
  }
}
const liveApplySrc = (integratedViewSource.match(/export async function viewApplyLive\([\s\S]*?^export function viewApply\(/m) || [""])[0];
if ((liveApplySrc.match(new RegExp(applyDocHint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length !== 3) {
  failures++;
  console.error("FAIL live-mode apply form should show the read-first hint for all three documents");
}
for (const key of ["privacy", "guidelines", "indemnity"]) {
  const block = liveApplySrc.match(new RegExp(`data-doc-accept="${key}"[\\s\\S]*?</div>`));
  if (!block || block[0].indexOf("data-doc-hint") > block[0].indexOf("data-doc-checkbox")) {
    failures++;
    console.error(`FAIL live-mode apply form should place the hint above the ${key} checkbox`);
  }
}
if (!applyLocalHtml.includes('name="mediaConsent" required') || applyLocalHtml.includes("(Optional) I consent")) {
  failures++;
  console.error("FAIL local-mode apply form photo consent should be required");
}
if (!applyLocalHtml.includes("Please contact ITC Committee if you have any questions/concerns about this.")) {
  failures++;
  console.error("FAIL apply form missing the ITC Committee contact line under photo consent");
}
if (!integratedViewSource.includes('name="photo_consent" ${checked("photo_consent")} required')) {
  failures++;
  console.error("FAIL live-mode apply form photo consent should be required");
}
console.log("ok  local-mode apply form wires all three documents (indemnity, privacy, guidelines)");
for (const name of ["emergencyRelationship", "indemnitySignature", "indemnitySignedAt"]) {
  if (!applyLocalHtml.includes(`name="${name}"`)) {
    failures++;
    console.error(`FAIL local apply form missing ${name}`);
  }
}
if (!applyLocalHtml.includes("Participant's full name as signature")) {
  failures++;
  console.error("FAIL local apply form missing signature label");
}
if (!/name="indemnity"[^>]*disabled[^>]*data-doc-checkbox/.test(applyLocalHtml)) {
  failures++;
  console.error("FAIL local indemnity checkbox should stay disabled until the modal is read");
}
if (!applyLocalHtml.includes(`value="${data.todayHktISO()}"`)) {
  failures++;
  console.error("FAIL local signing date should default to HKT today");
}
if (!applyLocalHtml.includes(`max="${data.todayHktISO()}"`)) {
  failures++;
  console.error("FAIL local signing date should be capped at HKT today");
}
const localGuidelinesAt = applyLocalHtml.indexOf('data-doc-accept="guidelines"');
const localIndemnityAt = applyLocalHtml.indexOf('data-doc-accept="indemnity"');
const localSignatureAt = applyLocalHtml.indexOf('name="indemnitySignature"');
const localSignedAt = applyLocalHtml.indexOf('name="indemnitySignedAt"');
if (!(localGuidelinesAt >= 0
    && localGuidelinesAt < localIndemnityAt
    && localIndemnityAt < localSignatureAt
    && localSignatureAt < localSignedAt)) {
  failures++;
  console.error("FAIL local apply must put indemnity, signature, and signing date after community guidelines");
}
console.log("ok  local-mode apply form collects emergencyRelationship, signature, and signing date");
for (const marker of [
  'emergencyRelationship: fd.get("emergencyRelationship") || ""',
  'indemnitySignature: fd.get("indemnitySignature") || ""',
  'indemnitySignedAt: fd.get("indemnitySignedAt") || ""',
]) {
  if (!integratedAppSource.includes(marker)) {
    failures++;
    console.error(`FAIL local apply handler missing structured indemnity contract: ${marker}`);
  }
}
console.log("ok  local apply handler bridges the structured indemnity contract");

// Live-mode apply form: old plain-checkbox copy and indemnity-only attributes
// must be gone. Source-level check: rendering viewApplyLive() requires
// Supabase state, so we assert against the integrated source instead.
for (const stale of [
  "I accept the participation waiver",
  "I accept the privacy policy. (⏳",
  "I accept the community guidelines. (⏳",
  'data-action="open-indemnity-doc"',
  "data-indemnity-checkbox",
]) {
  if (combinedRuntimeSource.includes(stale)) {
    failures++;
    console.error(`FAIL stale pre-registry pattern still present: "${stale}"`);
  }
}
console.log("ok  no stale plain-checkbox or indemnity-only patterns remain");
await check("checkout (visitor) -> redirect", () => views.viewCheckout(paid.id));
await check("admin (visitor) -> redirect", () => views.viewAdmin("members"));
await check("notfound", () => views.viewNotFound());

// free activity must never show booking/capacity language
const freeHtml = views.viewActivity(free.id);
for (const banned of ["spots left", "Book & pay", "capacity", "Confirm booking", "Add to bag"]) {
  if (freeHtml.toLowerCase().includes(banned.toLowerCase())) {
    failures++;
    console.error(`FAIL free activity contains banned phrase: "${banned}"`);
  }
}
console.log("ok  free activity has no booking/capacity language");
const freeCopyWntSession = store.upcomingSessions(14).find(
  (session) => session.activityId === "wnt" && !data.sessionStarted(session)
);
const freeCopyWntHtml = views.viewActivity(freeCopyWntSession.id);
if (!freeCopyWntHtml.includes("Everyone is welcome — just show up.")
    || freeCopyWntHtml.includes("look for the lime ITC flag")) {
  failures++;
  console.error("FAIL WNT free-event subtext should match the other free events");
} else console.log("ok  WNT free-event subtext matches the other free events");

// paid activity must show price + free/paid badges everywhere
const freeDetailHtml = views.viewActivity(free.id);
const freeBadgeMatch = freeDetailHtml.match(/<span class="badge free">([^<]*)<\/span>/);
if (freeBadgeMatch?.[1] !== "Free") {
  failures++;
  console.error("FAIL free activity badge should read only Free");
} else console.log("ok  free activity badge reads only Free");
const paidHtml = views.viewActivity(paid.id);
if (!paidHtml.includes("HK$") || !paidHtml.includes("badge paid")) {
  failures++;
  console.error("FAIL paid activity missing price or paid badge");
} else console.log("ok  paid activity shows price + badge");
if (!paidHtml.includes('badge paid">HK$180</span>') || paidHtml.includes("per session") || paidHtml.includes("Paid · HK$180")) {
  failures++;
  console.error("FAIL unbooked paid activity badge should read only its price");
} else console.log("ok  unbooked paid activity badge reads only its price");
const unpaidBadgeSession = allUpcoming.find((s) => s.kind === "paid" && s.activityId === "hyrox-quarry-bay" && !data.sessionStarted(s));
installLocalFixtures();
store.signIn("member@example.test");
const paidHtmlWithAttendeeNames = views.viewActivity(paid.id, ["Alex C.", "Sam L."]);
if (!paidHtmlWithAttendeeNames.includes("Alex C.")
    || !paidHtmlWithAttendeeNames.includes("Sam L.")
    || !paidHtmlWithAttendeeNames.includes("Who’s coming")) {
  failures++;
  console.error("FAIL approved attendee names should render on paid Activity Details");
} else console.log("ok  approved attendee names render on paid Activity Details");
if (!unpaidBadgeSession) {
  failures++;
  console.error("FAIL smoke needs an upcoming HYROX session for badge state checks");
} else {
  const unpaidReservation = store.reserveSession("fixture-member", unpaidBadgeSession.id, islandEccOpenNow(unpaidBadgeSession));
  const unpaidBadgeHtml = views.viewActivity(unpaidBadgeSession.id);
  if (!unpaidBadgeHtml.includes('badge warn">To be paid</span>')) {
    failures++;
    console.error("FAIL reserved unpaid paid activity should show To be paid");
  } else console.log("ok  reserved unpaid paid activity shows To be paid");
  if (store.markBookingPaid(unpaidReservation.id, "FPS", "BADGE-STATE")) {
    const awaitingBadgeHtml = views.viewActivity(unpaidBadgeSession.id);
    if (!awaitingBadgeHtml.includes('badge warn">Awaiting confirmation</span>')) {
      failures++;
      console.error("FAIL marked-paid paid activity should show Awaiting confirmation");
    } else console.log("ok  marked-paid paid activity shows Awaiting confirmation");
  } else {
    failures++;
    console.error("FAIL badge-state fixture should mark its reservation paid");
  }
  store.signOut();
  store.signIn("admin@example.test");
  if (!store.confirmBookingPayment(unpaidReservation.id)) {
    failures++;
    console.error("FAIL badge-state fixture should confirm its paid reservation");
  } else {
    store.signOut();
    store.signIn("member@example.test");
    const confirmedBadgeHtml = views.viewActivity(unpaidBadgeSession.id);
    if (!confirmedBadgeHtml.includes('badge free">Paid</span>')) {
      failures++;
      console.error("FAIL confirmed paid activity should show Paid");
    } else console.log("ok  confirmed paid activity shows Paid");
  }
}
store.signOut();
const paidDirectionsSession = allUpcoming.find((s) => s.kind === "paid" && s.activityId === "hyrox-quarry-bay" && !data.sessionStarted(s));
const paidDirectionsHtml = paidDirectionsSession ? views.viewActivity(paidDirectionsSession.id) : "";
if (!paidDirectionsHtml.includes("Get directions")) {
  failures++;
  console.error("FAIL paid activity should expose Get directions");
} else console.log("ok  paid activity exposes Get directions");
if (paidDirectionsSession) {
  const paidActivity = store.activities().find((activity) => activity.id === paidDirectionsSession.activityId);
  const originalMapsQuery = paidActivity?.mapsQuery;
  if (paidActivity) paidActivity.mapsQuery = "";
  const locationFallbackHtml = views.viewActivity(paidDirectionsSession.id);
  if (paidActivity) paidActivity.mapsQuery = originalMapsQuery;
  if (!locationFallbackHtml.includes("Get directions")) {
    failures++;
    console.error("FAIL paid activity should fall back to its location for Get directions");
  } else console.log("ok  paid activity falls back to its location for Get directions");
}
if (!paidHtml.includes('data-photo-fallback="/assets/itc/itc-hyrox-mood.webp"')) {
  failures++;
  console.error("FAIL paid activity should provide a root asset fallback for its HYROX image");
} else console.log("ok  paid activity provides a HYROX image fallback");

// --- Application flow ---
const applyRes = store.applyForMembership({
  fullName: "Test Person",
  preferredName: "Test",
  email: "test@example.com",
  phone: "+852 1234 5678",
  emergencyName: "E Person",
  emergencyRelationship: "Sibling",
  emergencyPhone: "+852 8765 4321",
  heard: "A friend",
  ageConfirmed: true,
  mediaConsent: true,
  donorId: "Not applicable",
  indemnity: true,
  indemnitySignature: "Test Person",
  indemnitySignedAt: data.isoDate(data.todayLocal()),
});
if (!applyRes.ok) throw new Error("apply failed");
if (applyRes.user.donorId !== null) {
  failures++;
  console.error('FAIL "Not applicable" donor ID should normalize to null');
} else console.log("ok  N/A donor ID at signup normalizes to null");
if (!applyRes.user.indemnityAcceptedAt) {
  failures++;
  console.error("FAIL indemnity acceptance not recorded at application");
} else console.log("ok  indemnity acceptance recorded at application");
for (const [field, expected] of [
  ["emergencyRelationship", "Sibling"],
  ["indemnitySignature", "Test Person"],
  ["indemnitySignedAt", data.isoDate(data.todayLocal())],
  ["indemnityFormVersion", "v1"],
]) {
  if (applyRes.user[field] !== expected) {
    failures++;
    console.error(`FAIL application ${field} expected ${expected}, got ${applyRes.user[field]}`);
  }
}
if (!store.isIndemnityCurrent(applyRes.user)) {
  failures++;
  console.error("FAIL signed v1 application should have current indemnity");
}
const localApplicationFixture = (email, overrides = {}) => ({
  fullName: "Contact Check",
  preferredName: "Contact",
  email,
  phone: "+852 1234 5678",
  emergencyName: "E Person",
  emergencyRelationship: "Sibling",
  emergencyPhone: "+852 8765 4321",
  heard: "A friend",
  ageConfirmed: true,
  mediaConsent: false,
  donorId: "Not applicable",
  indemnity: true,
  indemnitySignature: "Contact Check",
  indemnitySignedAt: data.isoDate(data.todayLocal()),
  ...overrides,
});
for (const [label, email, overrides] of [
  ["missing emergency name", "missing-emergency-name@example.test", { emergencyName: "" }],
  ["missing emergency phone", "missing-emergency-phone@example.test", { emergencyPhone: "" }],
]) {
  let error = null;
  try { store.applyForMembership(localApplicationFixture(email, overrides)); } catch (err) { error = err; }
  if (!error || !/emergency contact name, relationship and phone/.test(error.message)) {
    failures++;
    console.error(`FAIL ${label} should reject with the canonical emergency-contact error`);
  }
}
if (store.isIndemnityCurrent({ ...applyRes.user, emergencyPhone: "" })) {
  failures++;
  console.error("FAIL indemnity currentness should require canonical emergency contact phone");
}
for (const [label, payload, pattern] of [
  ["short signature", { signature: "X", signedAt: data.isoDate(data.todayLocal()), emergencyRelationship: "Sibling" }, /full name as your signature/],
  ["invalid date", { signature: "Test Person", signedAt: "2026-02-31", emergencyRelationship: "Sibling" }, /valid signing date/],
  ["future date", { signature: "Test Person", signedAt: "2999-01-01", emergencyRelationship: "Sibling" }, /cannot be in the future/],
  ["missing relationship", { signature: "Test Person", signedAt: data.isoDate(data.todayLocal()), emergencyRelationship: "" }, /relationship/],
]) {
  let error = null;
  try { store.acceptIndemnity(applyRes.user.id, payload); } catch (err) { error = err; }
  if (!error || !pattern.test(error.message)) {
    failures++;
    console.error(`FAIL ${label} should reject with ${pattern}`);
  }
}
for (const [label, field] of [
  ["missing canonical emergency name", "emergencyName"],
  ["missing canonical emergency phone", "emergencyPhone"],
]) {
  const original = applyRes.user[field];
  applyRes.user[field] = "";
  let error = null;
  try {
    store.acceptIndemnity(applyRes.user.id, {
      signature: "Test Person",
      signedAt: data.isoDate(data.todayLocal()),
      emergencyRelationship: "Sibling",
    });
  } catch (err) {
    error = err;
  }
  applyRes.user[field] = original;
  if (!error || !/emergency contact name, relationship and phone/.test(error.message)) {
    failures++;
    console.error(`FAIL ${label} should block re-sign acceptance`);
  }
}

// --- Application draft persistence ---
{
  localStorage.removeItem("itc.device.id");
  localStorage.removeItem("itc.apply.draft.v1");
  localStorage.removeItem("itc.apply.drafts.v2");

  if (store.getApplyDraft() !== null) {
    throw new Error("fresh application draft should be null");
  }

  const first = store.saveApplyDraft({ fields: { mobile: "+852 6123 4567" } });
  if (!first?.deviceId || first.version !== 2 || first.fields.mobile !== "+852 6123 4567") {
    throw new Error("application draft should persist its device, version and fields");
  }

  const merged = store.saveApplyDraft({ fields: { preferred_name: "Jiffriy" } });
  if (merged.fields.mobile !== "+852 6123 4567" || merged.fields.preferred_name !== "Jiffriy") {
    throw new Error("application draft saves should merge fields");
  }

  localStorage.setItem("itc.apply.drafts.v2", JSON.stringify({
    __unclaimed__: {
      version: 99,
      deviceId: first.deviceId,
      savedAt: Date.now(),
      fields: { mobile: "stale" },
    },
  }));
  if (store.getApplyDraft() !== null) {
    throw new Error("incompatible application draft should be discarded");
  }

  localStorage.removeItem("itc.apply.drafts.v2");
  localStorage.setItem("itc.apply.draft.v1", JSON.stringify({
    version: 1,
    deviceId: first.deviceId,
    savedAt: Date.now(),
    fields: { mobile: "+852 1111 1111" },
  }));
  const migrated = store.getApplyDraft();
  if (migrated?.fields?.mobile !== "+852 1111 1111" || localStorage.getItem("itc.apply.draft.v1") !== null) {
    throw new Error("legacy single-draft storage should migrate into the per-account map");
  }

  store.saveApplyDraft({ profileId: "account-a", fields: { full_name: "Account A" } });
  store.saveApplyDraft({ profileId: "account-b", fields: { full_name: "Account B" } });
  if (store.getApplyDraft({ profileId: "account-a" })?.fields?.full_name !== "Account A"
      || store.getApplyDraft({ profileId: "account-b" })?.fields?.full_name !== "Account B") {
    throw new Error("application drafts must remain isolated per account on one device");
  }

  store.saveApplyDraft({ fields: { mobile: "+852 6999 0000" } });
  store.clearApplyDraft();
  if (store.getApplyDraft() !== null
      || store.getApplyDraft({ profileId: "account-a" }) !== null
      || store.getApplyDraft({ profileId: "account-b" }) !== null) {
    throw new Error("clearApplyDraft should remove the application draft");
  }
  console.log("ok  application drafts persist, merge, version and clear");
}

{
  store.signOut();
  store.clearApplyDraft();
  const homeWithoutDraft = views.viewHome();
  if (homeWithoutDraft.includes("Continue your application")) {
    throw new Error("fresh visitor home should not advertise a draft");
  }

  store.saveApplyDraft({ fields: { mobile: "+852 6123 4567" } });
  const homeWithDraft = views.viewHome();
  const accountWithDraft = await views.viewAccount();
  for (const [label, html] of [["home", homeWithDraft], ["account", accountWithDraft]]) {
    if (!html.includes("Continue your application")
        || !html.includes("You started the membership form earlier")
        || !html.includes('data-action="discard-draft"')) {
      throw new Error(`${label} should expose Continue + Discard for a saved draft`);
    }
  }
  store.clearApplyDraft();
  store.signIn("test@example.com");
  console.log("ok  visitor Home and Account surface resumable drafts");
}

// donor ID format: last name, hyphen, then 4 or 5 digits (CHUI-08879 / CHUI-8879);
// dash variants and spaces as the separator normalize to a plain hyphen
for (const [input, expect] of [
  ["CHUI-08879", null],
  ["CHUI-8879", null],
  ["chui-8879", null],
  ["CHUI 08879", null],
  ["CHUI—08879", null], // em-dash (phone autocorrect)
  ["CHUI -08879", null],
  ["", null],
  ["Not applicable", null],
  ["CHUI08879", "format"], // no separator — rejected, user re-enters
  ["CHUI-887", "format"],
  ["CHUI-088797", "format"],
  ["CHUI-0887A", "format"],
]) {
  const got = data.donorIdProblem(input);
  if (got !== expect) {
    failures++;
    console.error(`FAIL donorIdProblem(${JSON.stringify(input)}) = ${got}, expected ${expect}`);
  }
}
console.log("ok  donor ID format validation");
const pendingAccount = await check("account (pending)", () => views.viewAccount());
if (pendingAccount.includes('data-action="manage-profile-photo"')) {
  throw new Error("pending Profile must not expose photo management");
}
const pendingHome = views.viewHome();
{
  // Pending applicants see "My Week" filtered to free sessions in the
  // current Sun–Sat window (same as Schedule / visitor Home).
  const weekStart = data.sundayOf(data.todayLocal());
  const weekEnd = data.addDays(weekStart, 6);
  const freeInWeek = allUpcoming.filter((session) => {
    if (session.kind !== "free") return false;
    const iso = session.dateISO || (session.snapshot && session.snapshot.dateISO);
    if (!iso) return false;
    const t = data.parseISO(iso).getTime();
    return t >= weekStart.getTime() && t <= weekEnd.getTime();
  });
  if (freeInWeek.length) {
    if (!pendingHome.includes("My Week") || !pendingHome.includes(free.name) || pendingHome.includes(paid.name)) {
      throw new Error("pending Home must show My Week with free sessions only");
    }
  } else {
    if (!pendingHome.includes("My Week")) {
      throw new Error("pending Home must show My Week heading even when no sessions this week");
    }
    if (pendingHome.includes(free.name) || pendingHome.includes(paid.name)) {
      throw new Error("pending Home should not list session names when the current week has no free sessions");
    }
  }
  if (!pendingHome.includes("My Week")) {
    throw new Error("pending Home must show the My Week heading");
  }
  if (pendingHome.includes(free.name) && pendingHome.includes(paid.name)) {
    throw new Error("pending Home must not include paid sessions");
  }
}
assertRenderedActivityLinksAreFree(pendingHome, "pending Home");
const pendingCommunity = await views.viewCommunity();
if (!pendingCommunity.includes("You’re welcome here.")) {
  failures++;
  console.error("FAIL pending Community heading is not personalized");
} else console.log("ok  pending Community heading is personalized");
const pendingPrayerHtml = await views.viewCommunity("prayers");
if (!/approved member/i.test(pendingPrayerHtml) || pendingPrayerHtml.includes('id="form-prayer"')) {
  throw new Error("pending Prayer must show the approved-member gate without a form");
}
// Island ECC remains the only paid HYROX path and must keep the pending-user
// "Booking locked" gate used by the existing direct-session flow.
const islandEccPaid = allUpcoming.find((s) => s.activityId === "hyrox-quarry-bay" && !data.sessionStarted(s));
const pendHtml = views.viewActivity(islandEccPaid.id);
if (!pendHtml.includes("Booking locked")) {
  failures++;
  console.error("FAIL pending user should see booking locked");
} else console.log("ok  pending user blocked from paid booking");

// --- Admin approval flow ---
installLocalFixtures(); store.signIn("admin@example.test");
{
  const beforeRetiredMutations = localStorage.getItem("itc.prototype.v1");
  assert.throws(
    () => store.saveActivity({ id: "hyrox-bft", name: "Retired", kind: "paid" }),
    /This session is no longer available\./,
  );
  assert.equal(typeof store.scheduleHyroxCycle, "undefined",
    "retired Admin cycle provisioning must not remain exported");
  assert.equal(localStorage.getItem("itc.prototype.v1"), beforeRetiredMutations,
    "v24 pool mutation denials must not change local state");
}
const defaultAdminHtml = await views.viewAdmin();
if (!defaultAdminHtml.includes('href="#/admin/members" class="active"')
    || defaultAdminHtml.includes('href="#/admin/approvals"')
    || !defaultAdminHtml.includes("Test Person")) {
  throw new Error("Admin must default to Members and show pending applicants there without an Approvals tab");
}
try {
  assert.match(defaultAdminHtml, /<a class="back-link" href="#\/account">← Profile<\/a>/,
    "Admin must link back to Profile");
  assert.equal((defaultAdminHtml.match(/<h1\b/g) || []).length, 1,
    "Admin must render exactly one h1");
  assert.match(defaultAdminHtml, /<h1 class="display mt16">Admin Tools<\/h1>\s*<nav class="admin-tabs/,
    "Admin Tools must be the h1 immediately before the tabs");
  assert.doesNotMatch(defaultAdminHtml, /<div class="kicker">Admin<\/div>|Club Operations/,
    "Admin must not retain the redundant kicker or Club Operations title");
} catch (err) {
  failures++;
  console.error(`FAIL Admin hierarchy: ${err.message}`);
}
for (const tab of ["members", "activities", "prayers", "giving", "payments"]) {
  const adminHtml = await check(`admin ${tab}`, () => views.viewAdmin(tab));
  const activeTabs = adminHtml.match(/<a[^>]*aria-current="page"[^>]*>/g) || [];
  if (activeTabs.length !== 1 || !activeTabs[0].includes(`href="#/admin/${tab}"`)) {
    throw new Error(`Admin ${tab} must expose exactly one matching active tab`);
  }
}
console.log("ok  every Admin route exposes exactly one active tab");
const adminMembersHtml = await views.viewAdmin("members");
if (!adminMembersHtml.includes('data-action="download-indemnity-list"')) {
  throw new Error("Admin Members must expose the indemnity list download");
}
const indemnityRecords = await store.listIndemnityRecords();
if (!indemnityRecords.some((record) => record.fullName === "Test Admin")
    || !indemnityRecords.some((record) => record.fullName === "Test Member")) {
  throw new Error("indemnity export must include all local profiles");
}
store.signIn("member@example.test");
try {
  await store.listIndemnityRecords();
  throw new Error("non-admin should not download indemnity records");
} catch (err) {
  if (!/Approved Admin access required/.test(err.message)) throw err;
}
store.signIn("admin@example.test");
console.log("ok  Admin Members exposes a gated all-profile indemnity export");
const adminActivitiesHtml = await views.viewAdmin("activities");
const adminScheduleHtml = await views.viewAdmin("payments");
const retiredAdminPoolCopy = /BFT|Midtown|shared pool|venue allocation|switch queue|weekly booking setup/i;
for (const [surface, html] of [
  ["Admin Activities", adminActivitiesHtml],
  ["Admin Payments", adminScheduleHtml],
]) {
  assert.doesNotMatch(html, retiredAdminPoolCopy, `${surface} must not render retired pool operations`);
  assert.doesNotMatch(html,
    /hyrox-allocation-close|midtown-toggle|form-cancel-hyrox-cycle|hyrox-plan-retry|form-hyrox-payment-reject/,
    `${surface} must not render retired pool action contracts`);
  assert.match(html, /Island ECC/, `${surface} must retain Island ECC administration`);
}
const islandEccAdminRosters = [...adminScheduleHtml.matchAll(
  /data-payment-roster="(hyrox-quarry-bay-[^"]+)"/g
)].map((match) => match[1]);
assert.ok(islandEccAdminRosters.length > 0, "Admin Payments must render Island ECC financial rosters");
assert.equal(new Set(islandEccAdminRosters).size, islandEccAdminRosters.length,
  "Admin Payments must render each Island ECC financial roster exactly once");
for (const activeContract of [
  'case "confirm-payment"', 'case "attendance-toggle"', 'case "replacement-decision"',
  'case "join-waitlist"', 'case "leave-waitlist"', 'case "cancel-booking"',
  'case "form-gym-note"',
]) {
  assert.ok(integratedAppSource.includes(activeContract),
    `direct Island ECC action contract must remain: ${activeContract}`);
}
for (const retiredContract of [
  'case "hyrox-plan-retry"', 'case "midtown-toggle"',
  'case "hyrox-allocation-close"', 'case "form-cancel-hyrox-cycle"',
  'case "form-hyrox-payment-reject"',
]) {
  assert.equal(integratedAppSource.includes(retiredContract), false,
    `retired Admin pool action contract remains: ${retiredContract}`);
}
for (const retiredApi of [
  "hyroxCycleBookings", "hyroxCycles", "hyroxCycleForDate", "scheduleHyroxCycle",
  "hyroxCycleQueues", "sweepHyroxCycleDeadlines", "rejectHyroxCyclePayment",
  "finalizeHyroxVenuePlan", "closeHyroxVenueAllocation", "cancelHyroxCycle",
  "isMidtown", "midtownOpenFor", "setMidtownOpen",
]) {
  assert.equal(typeof store[retiredApi], "undefined", `retired Admin pool API remains: ${retiredApi}`);
}
console.log("ok  Admin Activities and Payments retain one direct Island ECC workflow without pool operations");

// --- Admin Giving (local mode) ---
// Empty local state still surfaces an actionable Create campaign link.
const localEmptyGivingHtml = await views.viewAdmin("giving");
if (!localEmptyGivingHtml.includes("No Giving campaigns yet.") ||
    !localEmptyGivingHtml.includes("+ Create campaign")) {
  failures++;
  console.error("FAIL local empty Admin Giving must show empty state and Create campaign link");
} else console.log("ok  local empty Admin Giving shows empty state and Create campaign link");

// Closed campaigns remain visible while the open-campaign guard lets a
// successor be drafted.
const closedCampaign = {
  id: "closed-fixture-1",
  title: "Closed Local Campaign",
  description: "A previously closed local Giving campaign.",
  goalHKD: 12000,
  fpsId: "1111111",
  fpsPayee: "Island Evangelical Community Church",
  status: "closed",
  creatorProfileId: "fixture-admin",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  publishedAt: "2026-07-02T00:00:00.000Z",
  closedAt: "2026-07-15T00:00:00.000Z",
};
store.campaigns().push(structuredClone(closedCampaign));
const localClosedGivingHtml = await views.viewAdmin("giving");
if (!localClosedGivingHtml.includes("Closed Local Campaign") ||
    !localClosedGivingHtml.includes('<span class="badge neutral">closed</span>') ||
    !localClosedGivingHtml.includes("+ Create campaign")) {
  failures++;
  console.error("FAIL local closed Admin Giving must keep history visible and unlock Create campaign");
} else console.log("ok  local closed Admin Giving keeps history visible and unlocks Create campaign");
// Restore baseline so other tests do not observe this fixture campaign.
store.campaigns().pop();

const navFixtureUser = store.currentUser();
const originalNavFixtureRole = navFixtureUser.role;
try {
  for (const [role, label] of [
    ["member", "member"],
    ["admin", "Admin"],
    ["superadmin", "Super Admin"],
  ]) {
    navFixtureUser.role = role;
    assertPrimaryNav(
      navFixtureUser,
      ["Home", "Schedule", "Community", "Giving", "Profile"],
      label
    );
  }
} finally {
  navFixtureUser.role = originalNavFixtureRole;
}
const adminProfile = await views.viewAccount();
if (!adminProfile.includes("Admin Tools") || !adminProfile.includes('href="#/admin"')) {
  throw new Error("Admin Tools must remain available from Profile");
}
await check("admin activity edit", () => views.viewAdminActivity("hyrox"));
await check("admin activity new", () => views.viewAdminActivity("new"));
{
  // Local prototype mode keeps the recurring editor fully editable; the
  // read-only live gate must not leak into local renders.
  const editHtml = views.viewAdminActivity("wnt");
  if (!editHtml.includes('id="form-activity"') || editHtml.includes("form-fieldset\" disabled"))
    throw new Error("local mode must keep the recurring activity editor editable");
  const listHtml = await views.viewAdmin("activities");
  if (!listHtml.includes('#/admin/activity/new'))
    throw new Error("local mode must offer + New activity");
  console.log("ok  recurring activity editor stays editable in local mode");
}
{
  const swimmingBeforeEdit = structuredClone(store.getActivity("water"));
  store.saveActivity({
    ...swimmingBeforeEdit,
    location: "TBC",
    mapsQuery: "",
    photo: "../assets/itc/main.webp",
  });
  if (store.getActivity("water").photo !== "../assets/itc/water.webp") {
    throw new Error("editing Swimming must preserve its existing photo");
  }

  const activityId = "photo-regression-new";
  store.saveActivity({
    id: activityId,
    title: "Photo Regression New",
    kind: "paid",
    location: "Main Hall",
    mapsQuery: "Main Hall, Hong Kong",
    photo: "../assets/itc/main.webp",
    weekday: 2,
    durationMin: 60,
    price: 50,
    capacity: 10,
  });
  if (store.getActivity(activityId).photo !== "../assets/itc/main.webp") {
    throw new Error("new activities may keep the generic photo");
  }
  store.activities().splice(store.activities().findIndex((activity) => activity.id === activityId), 1);
}
const newApplicant = store.pendingApplicants().find((u) => u.email === "test@example.com");
store.approveApplicant(newApplicant.id);
console.log("ok  admin approved new applicant");

// --- Member booking + payment flow ---
const signIn = store.signIn("test@example.com");
if (!signIn.ok || signIn.user.status !== "approved") throw new Error("approval did not take effect");
const approvedAccount = await check("account (new member)", () => views.viewAccount());
if (!/button[^>]+data-action="manage-profile-photo"[^>]+aria-label="Manage profile photo/.test(approvedAccount)) {
  throw new Error("approved Profile must expose a labelled manage-photo button");
}
const approvedAvatarRole = store.currentUser().role;
store.currentUser().role = "unexpected_role";
const malformedRoleAccount = await views.viewAccount();
if (malformedRoleAccount.includes('data-action="manage-profile-photo"')) {
  throw new Error("unknown roles must not expose profile-photo management");
}
store.currentUser().role = approvedAvatarRole;
const topAvatarWithPhoto = views.avatarHTML(signIn.user, {
  url: "https://project.supabase.co/storage/v1/object/sign/profile-avatars/member/custom.jpg?token=test",
  source: "custom",
  state: "active",
  expiresAt: "2099-01-01T00:00:00.000Z",
});
if (!topAvatarWithPhoto.includes('class="avatar__image"') || topAvatarWithPhoto.includes('loading="lazy"')) {
  throw new Error("top navigation must use eager resolved avatar presentation markup");
}
const approvedCommunity = await views.viewCommunity();
if (!approvedCommunity.includes("Connect and grow with us.")) {
  failures++;
  console.error("FAIL approved Community heading is not personalized");
} else console.log("ok  approved Community heading is personalized");

// Profile sections are tappable rows, while the neon stats link to the
// canonical booking views. Donor details live under Membership Details and
// History is not duplicated as a Profile row.
const newMemberAcct = await views.viewAccount();
for (const link of [
  "#/account/bookings",
  "#/account/bookings/attended",
  "#/account/details",
  "#/account/agreements",
  "#/account/payments",
  "#/account/notifications",
]) {
  if (!newMemberAcct.includes(`href="${link}"`)) {
    failures++;
    console.error(`FAIL Profile missing ${link} link`);
  }
}
for (const redundantLink of ["#/account/donor", "#/account/history", "#/account/about", "#/account/indemnity", "#/account/privacy"]) {
  if (newMemberAcct.includes(`href="${redundantLink}"`)) {
    failures++;
    console.error(`FAIL Profile should not show redundant ${redundantLink} row`);
  }
}
for (const sub of [
  "Contact, emergency and donor information",
  "Bookings, donations and orders",
  "Session alerts, email and web push",
]) {
  if (!newMemberAcct.includes(sub)) {
    failures++;
    console.error(`FAIL Profile row missing subtext "${sub}"`);
  }
}
console.log("ok  Profile exposes booking stats and four focused section rows");
for (const selector of [".ph-stats > .ph-stat", ".ph-stats > .ph-stat:hover", ".ph-stats > .ph-stat:focus-visible"]) {
  if (!integratedStyleSource.includes(selector)) {
    failures++;
    console.error(`FAIL clickable Profile stats missing style ${selector}`);
  }
}
await check("profile > details", () => views.viewAccount("details"));
await check("profile > agreements", () => views.viewAccount("agreements"));
await check("profile > payments", () => views.viewAccount("payments"));
await check("profile > notifications", () => views.viewAccount("notifications"));
const privacyEditHtml = await views.viewAccount("notifications", "edit");
if (!privacyEditHtml.includes('name="hyrox_payment_reminders"')
    || !privacyEditHtml.includes("Thursday payment reminders for unpaid HYROX reservations")) {
  failures++;
  console.error("FAIL Notifications edit missing HYROX reminder preference");
} else console.log("ok  Notifications exposes HYROX reminder preference");
if (!privacyEditHtml.includes('name="session_alerts"')
    || !privacyEditHtml.includes("Session alerts")
    || privacyEditHtml.includes("WhatsApp session reminders")
    || privacyEditHtml.includes('name="session_reminders"')) {
  failures++;
  console.error("FAIL Notifications edit missing Session alerts preference");
} else console.log("ok  Notifications exposes Session alerts preference");
if (!privacyEditHtml.includes('name="web_push_ops"')
    || !privacyEditHtml.includes("> Web push<")
    || privacyEditHtml.includes("Web push for bookings, venue &amp; announcements")) {
  failures++;
  console.error("FAIL Notifications edit missing short Web push preference");
} else console.log("ok  Notifications exposes short Web push preference");
if (!privacyEditHtml.includes('name="email_receipts"')
    || !privacyEditHtml.includes("itc.admin.ops@gmail.com")
    || !privacyEditHtml.includes("Membership Details")) {
  failures++;
  console.error("FAIL Notifications edit missing email receipt sender/recipient copy");
} else console.log("ok  Notifications exposes email receipt From/To copy");
if (privacyEditHtml.includes('name="photo_consent"')) {
  failures++;
  console.error("FAIL Notifications edit should not include photo consent");
} else console.log("ok  Notifications edit excludes photo consent");
const privacyUser = store.currentUser();
if (privacyUser?.webPushOps) {
  failures++;
  console.error("FAIL web push ops must default off");
} else console.log("ok  web push ops defaults off");
if (privacyUser?.sessionAlerts === false) {
  failures++;
  console.error("FAIL session alerts must default on");
} else console.log("ok  session alerts default on");
const privacyPreferenceBase = {
  session_alerts: privacyUser?.sessionAlerts !== false,
  email_receipts: !!privacyUser?.emailReceipts,
  community_news: !!privacyUser?.communityNews,
  web_push_ops: false,
};
await store.updateMyPrivacyPreferences({ ...privacyPreferenceBase, hyrox_payment_reminders: false });
if (store.currentUser()?.hyroxPaymentReminders !== false) {
  failures++;
  console.error("FAIL local Privacy & Notifications update did not persist HYROX opt-out");
} else console.log("ok  local Privacy & Notifications update persists HYROX opt-out");
await store.updateMyPrivacyPreferences({
  ...privacyPreferenceBase,
  hyrox_payment_reminders: true,
  web_push_ops: true,
});
if (store.currentUser()?.webPushOps !== true) {
  failures++;
  console.error("FAIL local Privacy & Notifications update did not persist web push ops opt-in");
} else console.log("ok  local Privacy & Notifications update persists web push ops opt-in");
await store.updateMyPrivacyPreferences({
  ...privacyPreferenceBase,
  hyrox_payment_reminders: true,
  web_push_ops: false,
});
if (store.currentUser()?.webPushOps !== false) {
  failures++;
  console.error("FAIL local Privacy & Notifications update did not clear web push ops");
} else console.log("ok  local Privacy & Notifications update clears web push ops");
if (!data.webPushOpsKindEligible("operational_payment_marked")
    || !data.webPushOpsKindEligible("community_announcement_audit")
    || !data.webPushOpsKindEligible("admin_application_submitted")
    || !data.webPushOpsKindEligible("operational_session_reminder_tomorrow")
    || !data.webPushOpsKindEligible("welcome")) {
  failures++;
  console.error("FAIL web push must be eligible for every inbox kind for that profile");
} else console.log("ok  web push is eligible for all profile inbox kinds");
{
  const sessionReminderMigration = readFileSync(
    resolve(__dirnameSmoke, "../supabase/migrations/20261003000001_session_reminders_web_push.sql"),
    "utf8",
  );
  for (const marker of [
    "session_alerts boolean not null default true",
    "operational_session_reminder_tomorrow",
    "operational_session_reminder_morning",
    "sweep_session_reminders",
    "select true",
    "session_reminder_tomorrow_sent_at",
    "session_reminder_morning_sent_at",
  ]) {
    assert.ok(
      sessionReminderMigration.toLowerCase().includes(marker.toLowerCase()),
      `session reminder migration missing ${marker}`,
    );
  }
  const sessionAlertsPrefMigration = readFileSync(
    resolve(__dirnameSmoke, "../supabase/migrations/20261003000003_session_alerts_pref.sql"),
    "utf8",
  );
  assert.ok(sessionAlertsPrefMigration.includes("rename column session_reminders to session_alerts"));
  assert.ok(sessionAlertsPrefMigration.includes("a.session_alerts = false"));
}
console.log("ok  session reminder / web-push expansion migration markers");
{
  const emailReceiptMigration = readFileSync(
    resolve(__dirnameSmoke, "../supabase/migrations/20261003000002_email_receipts.sql"),
    "utf8",
  );
  for (const marker of [
    "private.email_receipt_settings",
    "request_email_receipt",
    "send-email-receipt",
    "email_receipts",
    "profiles.email",
    "itc.admin.ops@gmail.com",
  ]) {
    assert.ok(
      emailReceiptMigration.toLowerCase().includes(marker.toLowerCase()),
      `email receipt migration missing ${marker}`,
    );
  }
  const emailReceiptFn = readFileSync(
    resolve(__dirnameSmoke, "../supabase/functions/send-email-receipt/index.ts"),
    "utf8",
  );
  assert.ok(emailReceiptFn.includes("itc.admin.ops@gmail.com"));
  assert.ok(emailReceiptFn.includes("smtp.gmail.com"));
  assert.ok(emailReceiptFn.includes("GMAIL_SMTP_APP_PASSWORD"));
  assert.equal(
    /GMAIL_SMTP_APP_PASSWORD\s*=\s*['\"][^'\"]+['\"]/.test(emailReceiptFn),
    false,
    "email receipt function must not hardcode the Gmail App Password",
  );
  const configToml = readFileSync(resolve(__dirnameSmoke, "../supabase/config.toml"), "utf8");
  assert.ok(configToml.includes("send-email-receipt"));
  const runbook = readFileSync(resolve(__dirnameSmoke, "../docs/runbooks/email-receipts.md"), "utf8");
  assert.ok(runbook.includes("itc.admin.ops@gmail.com"));
  assert.doesNotMatch(runbook, /[A-Za-z0-9]{16} [A-Za-z0-9]{16}/);
}
console.log("ok  email receipt migration, function, and runbook markers");
const membershipDetailsHtml = await views.viewAccount("details");
const membershipDetailsEditHtml = await views.viewAccount("details", "edit");
for (const marker of ["Emergency contact relationship", "Donor ID"]) {
  if (!membershipDetailsHtml.includes(marker)) {
    failures++;
    console.error(`FAIL Membership Details summary missing ${marker}`);
  }
}
for (const field of ['name="emergency_relationship"', 'name="donorId"']) {
  if (!membershipDetailsEditHtml.includes(field)) {
    failures++;
    console.error(`FAIL Membership Details edit form missing ${field}`);
  }
}
const donorDetailsHtml = await views.viewAccount("donor");
if (!donorDetailsHtml.includes("Membership Details")) {
  failures++;
  console.error("FAIL legacy Donor Profile route should render Membership Details");
}
if (!integratedViewSource.includes('donor: "Membership Details"')) {
  failures++;
  console.error("FAIL unavailable live legacy donor route should retain Membership Details context");
} else console.log("ok  Membership Details owns emergency and donor information");

// Profile sub-pages expose one predictable semantic title after one back link.
for (const [label, html, title] of [
  ["details", membershipDetailsHtml, "Membership Details"],
  ["details edit", membershipDetailsEditHtml, "Edit Membership Details"],
  ["legacy donor", donorDetailsHtml, "Membership Details"],
  ["indemnity", await views.viewAccount("indemnity"), "Agreements"],
  ["payments", await views.viewAccount("payments"), "Payments &amp; Receipts"],
  ["privacy", await views.viewAccount("privacy"), "Notifications"],
  ["privacy edit", privacyEditHtml, "Edit Notifications"],
]) {
  try {
    assertProfileSubpageHierarchy(html, title);
  } catch (err) {
    failures++;
    console.error(`FAIL profile > ${label} hierarchy: ${err.message}`);
  }
}
console.log("ok  Profile detail routes use title-cased semantic headings");
if (!(await views.viewAccount("nope")).includes("Page not found")) {
  failures++;
  console.error("FAIL unknown Profile section should 404");
} else console.log("ok  unknown Profile section 404s");

// indemnity: accepted at application -> confirmed on Profile as a single
// "Indemnity confirmed on [date]" line; stale consent must be detected from
// store.isIndemnityCurrent(), not from the timestamp alone.
if (!newMemberAcct.includes("Indemnity confirmed on") || newMemberAcct.includes("Accepted on")) {
  failures++;
  console.error("FAIL Profile should show a single indemnity-confirmed-on-date line");
} else console.log("ok  Profile shows single-line indemnity confirmation");
store.currentUser().mediaConsent = false;
const photoRequiredProfile = await views.viewAccount();
if (!photoRequiredProfile.includes("Photo consent required") || photoRequiredProfile.includes("Indemnity confirmed on")) {
  failures++;
  console.error("FAIL Profile Agreements row should require photo consent before showing indemnity status");
} else console.log("ok  Profile Agreements row requires photo consent");
store.currentUser().mediaConsent = true;
const currentIndemnityHtml = await views.viewAccount("indemnity");
for (const marker of [
  "Indemnity confirmed on",
  "Signed by",
  "Test Person",
  "Date of signing",
  "Emergency contact relationship",
  "Sibling",
  "Document version",
  "v1",
]) {
  if (!currentIndemnityHtml.includes(marker)) {
    failures++;
    console.error(`FAIL current Indemnity page missing "${marker}"`);
  }
}
console.log("ok  current indemnity page shows the stored consent record");
for (const marker of [
  'data-form="photo-consent"',
  "I consent to photos/videos of me being used on ITC channels. *",
  "Please contact ITC Committee if you have any questions/concerns about this.",
  "View Privacy Policy",
  "View Community Guidelines",
  "View Indemnity",
  'data-action="open-doc" data-doc="privacy"',
  'data-action="open-doc" data-doc="guidelines"',
]) {
  if (!currentIndemnityHtml.includes(marker)) {
    failures++;
    console.error(`FAIL Agreements page missing "${marker}"`);
  }
}
if (!/name="photo_consent"[^>]*required/.test(currentIndemnityHtml)) {
  failures++;
  console.error("FAIL Agreements photo consent must be required");
} else console.log("ok  Agreements shows required photo consent and accepted-document viewers");
store.currentUser().indemnityAcceptedAt = Date.now() - 86400000;
store.currentUser().indemnityFormVersion = "v0";
const legacyIndemnityProfile = await views.viewAccount();
if (legacyIndemnityProfile.includes("Indemnity confirmed on") || !legacyIndemnityProfile.includes("Legacy acceptance recorded on")) {
  failures++;
  console.error("FAIL timestamp-only or stale indemnity should stay stale on Profile");
} else console.log("ok  timestamp-only or stale indemnity stays stale on Profile");
const staleIndemnityHtml = await views.viewAccount("indemnity");
for (const marker of [
  "A new version of the Indemnity is available",
  'data-doc-accept="indemnity"',
  'name="signature"',
  'name="signedAt"',
  'name="emergencyRelationship"',
  "Accept &amp; Confirm",
  "Edit in Membership Details",
]) {
  if (!staleIndemnityHtml.includes(marker)) {
    failures++;
    console.error(`FAIL stale Indemnity page missing "${marker}"`);
  }
}
console.log("ok  stale indemnity page renders the re-sign flow");
if (staleIndemnityHtml.includes('name="indemnityAccept"') || !/data-doc-submit[^>]*disabled/.test(staleIndemnityHtml)) {
  failures++;
  console.error("FAIL stale Indemnity should use one modal acknowledgement to unlock Accept & Confirm");
} else console.log("ok  stale Indemnity uses one modal acknowledgement to unlock Accept & Confirm");
for (const marker of [
  'await store.acceptMyIndemnity({',
  'signature: fd.get("signature") || ""',
  'signedAt: fd.get("signedAt") || ""',
  'emergencyRelationship: fd.get("emergencyRelationship") || ""',
]) {
  if (!integratedAppSource.includes(marker)) {
    failures++;
    console.error(`FAIL Profile > Indemnity handler missing structured contract: ${marker}`);
  }
}
console.log("ok  Profile > Indemnity handler bridges the structured contract");
store.currentUser().indemnityAcceptedAt = null;
store.currentUser().indemnityFormVersion = null;
if (!(await views.viewAccount()).includes("To be accepted")) {
  failures++;
  console.error('FAIL unaccepted indemnity should read "To be accepted"');
} else console.log('ok  unaccepted indemnity reads "To be accepted"');
if (!(await views.viewAccount("indemnity")).includes("Accept &amp; Confirm")) {
  failures++;
  console.error("FAIL indemnity page missing Accept & Confirm");
} else console.log("ok  indemnity page offers Accept & Confirm");

// --- Profile > Indemnity: one modal acknowledgement + full document button ---
const indemnityPageHtml = await views.viewAccount("indemnity");
if (!indemnityPageHtml.includes("View Indemnity")) {
  failures++;
  console.error('FAIL Profile > Agreements should expose a "View Indemnity" button');
} else console.log('ok  Profile > Agreements exposes "View Indemnity" button');
if (!indemnityPageHtml.includes('data-action="open-doc" data-doc="indemnity"')) {
  failures++;
  console.error('FAIL Profile > Indemnity button should target the indemnity document');
} else console.log("ok  Profile > Indemnity button targets the indemnity document");
if (indemnityPageHtml.includes('class="doc-content"')) {
  failures++;
  console.error("FAIL Profile > Indemnity should not duplicate the full document inline");
} else console.log("ok  Profile > Indemnity uses the modal as its only document reader");
store.acceptIndemnity(store.currentUser().id, {
  signature: "Test Person",
  signedAt: data.isoDate(data.todayLocal()),
  emergencyRelationship: "Sibling",
});
if (!(await views.viewAccount()).includes("Indemnity confirmed on")) {
  failures++;
  console.error("FAIL acceptIndemnity did not confirm on Profile");
} else console.log("ok  acceptIndemnity confirms on Profile");
if (!views.viewHome().includes("Nothing booked this week")) {
  failures++;
  console.error('FAIL "My week" should prompt when the member has no bookings');
} else console.log('ok  "My week" empty state prompts to book');
{
  const emptyWeekHome = views.viewHome();
  if (!emptyWeekHome.includes('href="#/schedule" style="color:var(--accent)">Find a session →</a>')) {
    failures++;
    console.error("FAIL empty My Week should keep Find a session");
  }
  if (emptyWeekHome.includes('href="#/schedule">See more →</a>')) {
    failures++;
    console.error("FAIL empty My Week should not also show See more");
  } else console.log("ok  empty My Week hides See more and keeps Find a session");
}
await check("checkout (member)", () => views.viewCheckout(paid.id));

// --- document registry (indemnity + privacy + guidelines) ---
const docsModule = await import("./js/documents.js");
const DOCS = docsModule.DOCUMENTS;
if (docsModule.INDEMNITY_VERSION !== "v1") {
  failures++;
  console.error(`FAIL indemnity version should be v1, got ${docsModule.INDEMNITY_VERSION}`);
}
if (DOCS.indemnity?.title !== "Indemnity") {
  failures++;
  console.error(`FAIL indemnity title should be Indemnity, got ${DOCS.indemnity?.title}`);
}
for (const key of ["indemnity", "privacy", "guidelines"]) {
  if (!DOCS[key] || typeof DOCS[key].renderBody !== "function" || !DOCS[key].title) {
    failures++;
    console.error(`FAIL documents registry missing entry for "${key}"`);
  }
}
console.log("ok  documents registry exposes indemnity + privacy + guidelines");
for (const [key, expected] of [["indemnity", false], ["privacy", false], ["guidelines", false]]) {
  if (!!DOCS[key]?.provisional !== expected) {
    failures++;
    console.error(`FAIL ${key} provisional watermark flag expected ${expected}, got ${!!DOCS[key]?.provisional}`);
  }
}
console.log("ok  document registry scopes provisional watermarks by document");

const indemnityBody = DOCS.indemnity?.renderBody?.() || "";
for (const marker of [
  "ITC Hyrox Training - Liability Release &amp; Data Privacy Form",
  "Hyrox Training from the date of signing to 30 June 2027",
  "and for this purpose, the data shall be owned by IECC and ITC",
]) {
  if (!indemnityBody.includes(marker)) {
    failures++;
    console.error(`FAIL indemnity document missing opening marker "${marker}"`);
  }
}
for (const [clause, phrase] of [
  ["1", "to assume and accept all and any risks"],
  ["2", "to waive any and all claims"],
  ["3", "to release:"],
  ["4", "to hold harmless and indemnify:"],
  ["5", "that appropriate insurance shall be taken out by me"],
  ["6", "the leaders of ITC and/or IECC have the right"],
  ["7", "that my level of physical fitness is adequate"],
  ["8", "that this Form shall be effective and binding"],
  ["9", "that I agree to the personal data privacy statement"],
  ["10", "that the laws of Hong Kong shall govern this Form"],
]) {
  if (!indemnityBody.includes(`data-clause="${clause}"`) || !indemnityBody.includes(phrase)) {
    failures++;
    console.error(`FAIL indemnity document missing clause ${clause}: "${phrase}"`);
  }
}
if (!indemnityBody.includes("https://www.islandecc.hk/privacy-policy/")) {
  failures++;
  console.error("FAIL indemnity document missing the IECC privacy-policy URL");
}
for (const removed of [
  "Health declaration",
  "Participation at my own risk",
  "Draft — pending ITC leadership review",
]) {
  if (indemnityBody.includes(removed)) {
    failures++;
    console.error(`FAIL indemnity document still contains draft marker "${removed}"`);
  }
}
console.log("ok  indemnity registry exposes versioned Hyrox legal copy");

for (const [key, headings] of Object.entries({
  privacy: [
    "What we collect",
    "Why we collect it",
    "Who sees it",
    "Your choices",
  ],
  guidelines: [
    "Everyone is welcome",
    "Respect and encouragement",
    "Safety first",
    "Photos and media",
    "Conduct",
  ],
})) {
  const body = DOCS[key]?.renderBody?.() || "";
  for (const heading of headings) {
    if (!body.includes(heading)) {
      failures++;
      console.error(`FAIL ${key} document missing heading "${heading}"`);
    }
  }
}
console.log("ok  privacy and guidelines registry bodies still expose their section headings");

// --- modal component: scroll-end math (Task 2) ---
const components = await import("./js/components.js");
if (components.SCROLL_END_THRESHOLD_PX !== 4) {
  failures++;
  console.error(`FAIL scroll-end threshold should be 4, got ${components.SCROLL_END_THRESHOLD_PX}`);
} else console.log("ok  scroll-end threshold is 4px");

const scrollCases = [
  [100, 200, 300, true],   // 300 >= 296
  [50, 200, 300, false],   // 250 < 296
  [0, 200, 200, true],     // everything fits, 200 >= 196
  [0, 100, 50, true],      // degenerate: doc smaller than viewport
];
for (const [top, height, scroll, expected] of scrollCases) {
  const got = components.isAtScrollEnd(top, height, scroll);
  if (got !== expected) {
    failures++;
    console.error(`FAIL isAtScrollEnd(${top},${height},${scroll}) expected ${expected}, got ${got}`);
  }
}
console.log("ok  isAtScrollEnd math returns correct values for 4 cases");

// --- generalized modal API ---
if (typeof components.openReadAndAcceptModal !== "function") {
  failures++;
  console.error("FAIL components should export openReadAndAcceptModal");
} else console.log("ok  components exports openReadAndAcceptModal");

// --- applyDocumentAcceptance: scoped per document container ---
const mkContainer = (key = "privacy") => {
  const checkbox = { disabled: true, checked: false };
  const submit = { disabled: true };
  const hint = { hidden: false };
  const warn = { hidden: true, textContent: "", scrollIntoView() {} };
  return {
    checkbox,
    submit,
    hint,
    warn,
    el: {
      getAttribute: (name) => (name === "data-doc-accept" ? key : null),
      querySelector: (sel) =>
        sel === "[data-doc-checkbox]" ? checkbox
        : sel === "[data-doc-submit]" ? submit
        : sel === "[data-doc-hint]" ? hint
        : sel === "[data-doc-warn]" ? warn
        : null,
    },
  };
};
const indemnityC = mkContainer("indemnity");
const privacyC = mkContainer("privacy");
const guidelinesC = mkContainer("guidelines");
const privacyTrigger = { closest: (sel) => (sel === "[data-doc-accept]" ? privacyC.el : null) };
if (components.applyDocumentAcceptance(privacyTrigger) !== true) {
  failures++;
  console.error("FAIL applyDocumentAcceptance should return true when a container is paired");
}
if (privacyC.checkbox.disabled !== false || privacyC.checkbox.checked !== true || privacyC.submit.disabled !== false || privacyC.hint.hidden !== true || privacyC.warn.hidden !== true || privacyC.warn.textContent !== "") {
  failures++;
  console.error("FAIL applyDocumentAcceptance did not unlock the privacy checkbox, submit button, and hint");
}
if (indemnityC.checkbox.checked || guidelinesC.checkbox.checked || indemnityC.submit.disabled !== true || guidelinesC.submit.disabled !== true || indemnityC.hint.hidden || guidelinesC.hint.hidden) {
  failures++;
  console.error("FAIL applyDocumentAcceptance mutated a container other than the trigger's");
}
const submitOnly = {
  submit: { disabled: true },
  hint: { hidden: false },
  warn: { hidden: false, textContent: "stale", scrollIntoView() {} },
  querySelector: (sel) =>
    sel === "[data-doc-submit]" ? submitOnly.submit
    : sel === "[data-doc-hint]" ? submitOnly.hint
    : sel === "[data-doc-warn]" ? submitOnly.warn
    : null,
};
const submitOnlyTrigger = { closest: (sel) => (sel === "[data-doc-accept]" ? submitOnly : null) };
if (components.applyDocumentAcceptance(submitOnlyTrigger) !== true || submitOnly.submit.disabled || !submitOnly.hint.hidden || !submitOnly.warn.hidden || submitOnly.warn.textContent !== "") {
  failures++;
  console.error("FAIL applyDocumentAcceptance should unlock a submit-only document container");
}
console.log("ok  applyDocumentAcceptance mutates only the trigger's document container");

// --- validateApplyDocumentAcceptance: warn under every unread document ---
privacyC.warn.hidden = true;
privacyC.warn.textContent = "";
indemnityC.warn.hidden = true;
indemnityC.warn.textContent = "";
guidelinesC.warn.hidden = true;
guidelinesC.warn.textContent = "";
const unreadApplyForm = {
  querySelectorAll: (sel) => (sel === "[data-doc-accept]"
    ? [privacyC.el, guidelinesC.el, indemnityC.el]
    : []),
};
// Reset privacy to unread so all three warn on first validation pass.
privacyC.checkbox.disabled = true;
privacyC.checkbox.checked = false;
if (components.validateApplyDocumentAcceptance(unreadApplyForm) !== false
    || privacyC.warn.hidden || guidelinesC.warn.hidden || indemnityC.warn.hidden
    || !privacyC.warn.textContent.includes("privacy policy")
    || !guidelinesC.warn.textContent.includes("community guidelines")
    || !indemnityC.warn.textContent.includes("Indemnity form")) {
  failures++;
  console.error("FAIL validateApplyDocumentAcceptance should warn under all three unread documents");
} else console.log("ok  validateApplyDocumentAcceptance warns under unread Apply documents");
privacyC.checkbox.disabled = false;
privacyC.checkbox.checked = true;
guidelinesC.checkbox.disabled = true;
guidelinesC.checkbox.checked = false;
indemnityC.checkbox.disabled = true;
indemnityC.checkbox.checked = false;
if (components.validateApplyDocumentAcceptance(unreadApplyForm) !== false
    || !privacyC.warn.hidden
    || guidelinesC.warn.hidden
    || indemnityC.warn.hidden) {
  failures++;
  console.error("FAIL validateApplyDocumentAcceptance should keep accepted docs clear and warn the rest");
} else console.log("ok  validateApplyDocumentAcceptance clears accepted docs and warns the rest");
if ((integratedAppSource.match(/components\.validateApplyDocumentAcceptance\(form\)/g) || []).length < 2) {
  failures++;
  console.error("FAIL Apply submit handlers must call validateApplyDocumentAcceptance");
} else console.log("ok  Apply submit handlers call validateApplyDocumentAcceptance");

// applyDocumentAcceptance: returns false when no container is paired (Profile trigger)
const orphanTrigger = { closest: () => null };
if (components.applyDocumentAcceptance(orphanTrigger) !== false) {
  failures++;
  console.error("FAIL applyDocumentAcceptance should return false when no container is found");
} else console.log("ok  applyDocumentAcceptance returns false for orphan triggers");

// --- modal CSS classes present (Task 3) ---
const stylesSource = readFileSync(resolve(__dirnameSmoke, "styles.css"), "utf8");
for (const cls of [
  ".modal-backdrop",
  ".modal-dialog",
  ".modal-header",
  ".modal-doc",
  ".modal-doc-body",
  ".modal-doc-ack",
  ".modal-link",
  ".check input[disabled] + span",
]) {
  if (!stylesSource.includes(cls)) {
    failures++;
    console.error(`FAIL styles.css missing rule for "${cls}"`);
  }
}
if (!stylesSource.includes(".modal-doc-body.doc-provisional::after")) {
  failures++;
  console.error("FAIL modal document watermark should be scoped to provisional documents");
}
if (stylesSource.includes(".modal-doc-body::after {")) {
  failures++;
  console.error("FAIL modal document watermark should not apply to every document body");
}
console.log("ok  styles.css contains all modal-related class definitions");

// --- HYROX payment system: reserve -> mark -> collector confirm (Task 2) ---
const islandEccSession = allUpcoming.find(
  (s) => s.activityId === "hyrox-quarry-bay" && !data.sessionStarted(s)
);
if (!islandEccSession) throw new Error("expected an upcoming Island ECC session");
const before = store.spotsLeft(islandEccSession);
const reservationNow = islandEccOpenNow(islandEccSession);
const r1 = store.reserveSession(signIn.user.id, islandEccSession, reservationNow);
if (r1.status !== "reserved") throw new Error("new booking should be reserved");
if (r1.payDeadlineAt !== data.islandEccNextPayDeadline(islandEccSession.dateISO, reservationNow))
  throw new Error("reservation deadline should follow the checkpoint rule");
const after = store.spotsLeft(islandEccSession);
if (after !== before - 1) throw new Error(`reserved spot not held (${before} -> ${after})`);
const islandEccPayHtml = views.viewPay(r1.id);
assert.match(islandEccPayHtml, /10\/F, Island ECC, Quarry Bay/,
  "Island ECC direct payment must retain its venue wording");
assert.match(islandEccPayHtml, /I’ve paid/,
  "Island ECC direct payment must retain the mark-paid control");
console.log(`ok  reservation holds a spot ${before} -> ${after}`);
const unpaidHistoryHtml = await views.viewAccount("history");
if (!unpaidHistoryHtml.includes("HK$180 to be paid") || unpaidHistoryHtml.includes("paid HK$180")) {
  throw new Error("History must label an unpaid paid-session reservation as HK$180 to be paid");
}
console.log("ok  History distinguishes an unpaid paid-session reservation");
let dup = null;
try { store.reserveSession(signIn.user.id, islandEccSession); } catch (e) { dup = e; }
if (!dup) throw new Error("double reservation should be rejected");
console.log("ok  double booking rejected");
const otherIslandEccSlot = allUpcoming.find(
  (session) => session.activityId === "hyrox-quarry-bay-early"
    && session.dateISO === islandEccSession.dateISO
);
if (!otherIslandEccSlot) throw new Error("expected the second Island ECC slot on the same Saturday");
assert.throws(
  () => store.reserveSession(signIn.user.id, otherIslandEccSlot, reservationNow),
  /Choose one Island ECC HYROX slot per Saturday/,
  "members must not reserve both Island ECC slots on one Saturday"
);
assert.throws(
  () => store.joinWaitlist(signIn.user.id, otherIslandEccSlot.id, reservationNow),
  /Choose one Island ECC HYROX slot per Saturday/,
  "members must not book one Island ECC slot and queue for the other"
);
console.log("ok  one Island ECC booking or queue commitment per Saturday");
{
  const lockedSaturday = "2026-10-24";
  const lockedLate = store.getSession(`hyrox-quarry-bay-${lockedSaturday}`);
  const lockedEarly = store.getSession(`hyrox-quarry-bay-early-${lockedSaturday}`);
  if (!lockedLate || !lockedEarly) throw new Error("expected locked Island ECC sessions");
  const preservedHold = store.getBooking(r1.id);
  const preservedDeadline = preservedHold?.payDeadlineAt;
  if (preservedHold) preservedHold.payDeadlineAt = Date.parse("2099-12-31T23:59:59+08:00");
  const beforeOpen = data.islandEccSignupOpensAt(lockedSaturday) - 1;
  assert.throws(
    () => store.reserveSession(signIn.user.id, lockedLate, beforeOpen),
    new RegExp(data.ISLAND_ECC_SIGNUP_LOCKED_ERROR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.throws(
    () => store.joinWaitlist(signIn.user.id, lockedLate.id, beforeOpen),
    /HYROX sign-up opens Monday at 6 PM HKT/,
  );
  const openAt = data.islandEccSignupOpensAt(lockedSaturday);
  store.signIn("admin@example.test");
  const lockedHold = store.reserveSession(store.currentUser().id, lockedLate, openAt);
  assert.equal(lockedHold.payDeadlineAt, data.islandEccNextPayDeadline(lockedSaturday, openAt));
  assert.throws(
    () => store.reserveSession(store.currentUser().id, lockedEarly, openAt),
    /Choose one Island ECC HYROX slot per Saturday/,
  );
  store.signIn(signIn.user.email);
  const lateActivity = store.getActivity("hyrox-quarry-bay");
  const previousLateCapacity = lateActivity.capacity;
  lateActivity.capacity = 1;
  let promoted;
  try {
    assert.equal(store.spotsLeft(store.getSession(lockedLate.id)), 0, "same-slot waitlist requires a full Island ECC session");
    store.signIn("member@example.test");
    store.joinWaitlist("fixture-member", lockedLate.id, openAt);
    store.signIn(signIn.user.email);
    store.sweepCheckpoints(data.islandEccPaymentDeadlineAt(lockedSaturday) + 1);
    assert.equal(store.getBooking(lockedHold.id).status, "expired");
    promoted = store.userReservationFor("fixture-member", lockedLate.id);
  } finally {
    lateActivity.capacity = previousLateCapacity;
  }
  assert.ok(promoted, "waitlist member should be promoted into a reserved booking");
  assert.equal(promoted.payDeadlineAt, data.islandEccLeftoverPayByAt(lockedSaturday));

  const friday18 = data.islandEccMemberReminderAt(lockedSaturday);
  store.sweepCheckpoints(friday18);
  assert.equal(
    store.notificationsFor("fixture-member")
      .filter((n) => n.kind === "operational_island_ecc_payment_reminder").length,
    1,
  );
  const collector = store.collectorFor(lockedLate.id);
  assert.ok(collector, "expected an on-duty collector");
  assert.equal(
    store.notificationsFor(collector.id)
      .filter((n) => n.kind === "operational_island_ecc_collector_finalize_reminder").length,
    1,
  );
  store.sweepCheckpoints(friday18 + 60 * 1000);
  assert.equal(
    store.notificationsFor("fixture-member")
      .filter((n) => n.kind === "operational_island_ecc_payment_reminder").length,
    1,
  );
  store.sweepCheckpoints(data.islandEccLeftoverPayByAt(lockedSaturday) + 1);
  assert.equal(store.getBooking(promoted.id).status, "expired");

  const markedSaturday = "2026-10-31";
  const markedSession = store.getSession(`hyrox-quarry-bay-${markedSaturday}`);
  const markedHold = store.reserveSession(signIn.user.id, markedSession, data.islandEccSignupOpensAt(markedSaturday));
  store.markBookingPaid(markedHold.id, "PayMe", "MARKED-HOLD");
  store.sweepCheckpoints(data.islandEccPaymentDeadlineAt(markedSaturday) + 1);
  assert.equal(store.getBooking(markedHold.id).status, "reserved");
  markedHold.userId = "__smoke-marked-hold-cleanup__";

  const nudgeSaturday = "2026-11-07";
  const nudgeSession = store.getSession(`hyrox-quarry-bay-${nudgeSaturday}`);
  store.signIn("member@example.test");
  store.reserveSession("fixture-member", nudgeSession, data.islandEccSignupOpensAt(nudgeSaturday));
  store.signIn(signIn.user.email);
  const nudgeCollector = store.collectorFor(nudgeSession.id);
  const nudgeAt = data.islandEccCollectorFinalizeNudgeAt(nudgeSaturday);
  const nudgeBefore = store.notificationsFor(nudgeCollector.id)
    .filter((n) => n.kind === "operational_island_ecc_collector_finalize_nudge").length;
  store.sweepCheckpoints(nudgeAt);
  assert.equal(
    store.notificationsFor(nudgeCollector.id)
      .filter((n) => n.kind === "operational_island_ecc_collector_finalize_nudge").length,
    nudgeBefore + 1,
  );
  store.sweepCheckpoints(nudgeAt + 1);
  assert.equal(
    store.notificationsFor(nudgeCollector.id)
      .filter((n) => n.kind === "operational_island_ecc_collector_finalize_nudge").length,
    nudgeBefore + 1,
  );

  const confirmedSaturday = "2026-11-14";
  const confirmedLate = store.getSession(`hyrox-quarry-bay-${confirmedSaturday}`);
  const confirmedEarly = store.getSession(`hyrox-quarry-bay-early-${confirmedSaturday}`);
  store.signIn("admin@example.test");
  store.reserveSession("fixture-member", confirmedLate, data.islandEccSignupOpensAt(confirmedSaturday));
  store.confirmGymBooking(confirmedLate.id, "Island ECC confirmed");
  store.confirmGymBooking(confirmedEarly.id, "Island ECC confirmed");
  store.signIn(signIn.user.email);
  const confirmedCollector = store.collectorFor(confirmedLate.id);
  const confirmedBefore = store.notificationsFor(confirmedCollector.id)
    .filter((n) => n.kind === "operational_island_ecc_collector_finalize_nudge").length;
  store.sweepCheckpoints(data.islandEccCollectorFinalizeNudgeAt(confirmedSaturday));
  assert.equal(
    store.notificationsFor(confirmedCollector.id)
      .filter((n) => n.kind === "operational_island_ecc_collector_finalize_nudge").length,
    confirmedBefore,
  );
  assert.equal(
    data.nextPayDeadline(lockedSaturday, data.islandEccPaymentDeadlineAt(lockedSaturday)),
    data.finalCheckpointFor(lockedSaturday),
  );
  const restoredHold = store.getBooking(r1.id);
  if (restoredHold && preservedDeadline != null) restoredHold.payDeadlineAt = preservedDeadline;
  console.log("ok  Island ECC Monday lock, Thursday expiry, and Friday local sweeps");
}
{
  const lockedUi = store.getSession("hyrox-quarry-bay-2026-12-05");
  const lockedDetail = views.viewActivity(lockedUi.id);
  assert.match(lockedDetail, /Opens Monday at 6 PM/);
  assert.doesNotMatch(lockedDetail, /Book &amp; pay|Book & pay/);
  assert.doesNotMatch(lockedDetail, /form-reserve/);
  assert.doesNotMatch(lockedDetail, /join-waitlist/);
  const lockedSunday = data.sundayOf(data.parseISO(lockedUi.dateISO));
  const currentSunday = data.sundayOf(data.todayLocal());
  views.scheduleState.weekOffset = Math.round(
    (lockedSunday.getTime() - currentSunday.getTime()) / (7 * 24 * 60 * 60 * 1000),
  );
  views.scheduleState.selected = lockedUi.dateISO;
  views.scheduleState.filter = "all";
  assert.match(views.viewSchedule(), /Opens Monday at 6 PM/);
  const otherDetail = views.viewActivity(otherIslandEccSlot.id);
  assert.match(otherDetail, /already registered this Saturday|Opens Monday at 6 PM/);
  assert.doesNotMatch(otherDetail, /Book &amp; pay|Book & pay/);
  assert.doesNotMatch(otherDetail, /join-waitlist/);
  {
    const waitlistSaturday = "2026-11-21";
    const waitlistSession = store.getSession(`hyrox-quarry-bay-${waitlistSaturday}`);
    if (!waitlistSession) throw new Error("expected a later Island ECC session for waitlist UI");
    const waitlistActivity = store.getActivity("hyrox-quarry-bay");
    const previousCapacity = waitlistActivity.capacity;
    const openAt = data.islandEccSignupOpensAt(waitlistSaturday);
    const realNow = Date.now;
    try {
      store.signIn("admin@example.test");
      store.reserveSession(store.currentUser().id, waitlistSession, openAt);
      waitlistActivity.capacity = 1;
      store.signIn(signIn.user.email);
      assert.equal(store.spotsLeft(store.getSession(waitlistSession.id)), 0);
      Date.now = () => openAt;
      const fullDetail = views.viewActivity(waitlistSession.id);
      assert.match(fullDetail, /Join waitlist/);
      assert.match(fullDetail, /data-action="join-waitlist"/);
      assert.doesNotMatch(fullDetail, /Book &amp; pay|Book & pay/);
      store.signIn("member@example.test");
      store.joinWaitlist("fixture-member", waitlistSession.id, openAt);
      assert.equal(store.waitlistPosition("fixture-member", waitlistSession.id), 1);
      assert.match(views.viewActivity(waitlistSession.id), /You’re #1 on the waitlist/);
      store.signIn(signIn.user.email);
    } finally {
      Date.now = realNow;
      waitlistActivity.capacity = previousCapacity;
    }
  }
  const realNow = Date.now;
  const previousUser = store.currentUser()?.email;
  try {
    store.signIn("admin@example.test");
    Date.now = () => data.islandEccSignupOpensAt("2026-12-05");
    const thursdayCheckout = views.viewCheckout("hyrox-quarry-bay-2026-12-05");
    assert.equal(typeof thursdayCheckout, "string");
    assert.match(thursdayCheckout, /Thursday 6 PM/);
    Date.now = () => data.islandEccPaymentDeadlineAt("2026-12-05");
    const fridayCheckout = views.viewCheckout("hyrox-quarry-bay-2026-12-05");
    assert.equal(typeof fridayCheckout, "string");
    assert.match(fridayCheckout, /Friday 9 PM/);
  } finally {
    Date.now = realNow;
    if (previousUser) store.signIn(previousUser);
  }
  console.log("ok  Island ECC Monday lock and exclusive-slot copy");
}
store.markBookingPaid(r1.id, "PayMe", "REF123");
if (!store.getBooking(r1.id).paymentMarkedAt) throw new Error("payment not marked");
const tinaNotes = store.notificationsFor("fixture-admin");
const localPaymentNotification = tinaNotes.find((n) => n.kind === "payment-marked");
if (!localPaymentNotification)
  throw new Error("collector should be notified of a marked payment");
const markedHistoryHtml = await views.viewAccount("history");
if (!markedHistoryHtml.includes("paid HK$180") || markedHistoryHtml.includes("HK$180 to be paid")) {
  throw new Error("History must label a payment-marked paid-session booking as paid HK$180");
}
console.log("ok  member marks paid -> collector notified and History shows paid amount");

// Local notifications cross the same store seam as Supabase rows. Preserve
// local copy/identity while adapting unread state, destination, and time for
// the Inbox; marking the rendered row read must survive a localStorage reload.
localPaymentNotification.title = "Payment marked";
localPaymentNotification.message = localPaymentNotification.body;
store.signIn("admin@example.test");
const localNotificationRows = await store.listMyNotifications();
const localInboxRow = localNotificationRows.find((row) => row.id === localPaymentNotification.id);
if (!localInboxRow
    || localInboxRow.kind !== localPaymentNotification.kind
    || localInboxRow.title !== localPaymentNotification.title
    || localInboxRow.message !== localPaymentNotification.message
    || localInboxRow.body !== localPaymentNotification.body) {
  throw new Error("local notification seam must preserve id, kind, title, message, and body");
}
if (localInboxRow.read_at !== null
    || localInboxRow.destination !== localPaymentNotification.link
    || localInboxRow.created_at !== new Date(localPaymentNotification.createdAt).toISOString()) {
  throw new Error("local notification seam must normalize unread state, destination, and creation time");
}
const localUnreadBeforeClick = localNotificationRows.filter((row) => !row.read_at).length;
if (localUnreadBeforeClick < 1) {
  throw new Error("local notification count must include the unread row");
}
const localInboxHtml = await views.viewNotifications(new Date(), localNotificationRows);
if (!localInboxHtml.includes(`data-notification-id="${localPaymentNotification.id}"`)
    || !localInboxHtml.includes(`data-destination="${localPaymentNotification.link}"`)) {
  throw new Error("local Inbox must render the unread row with its exact destination");
}
await store.markNotificationRead(localPaymentNotification.id);
const persistedNotificationState = JSON.parse(localStorage.getItem("itc.prototype.v1"));
const persistedNotificationRecord = persistedNotificationState.notifications.find(
  (row) => row.id === localPaymentNotification.id
);
if (persistedNotificationRecord?.read !== true
    || Object.hasOwn(persistedNotificationRecord || {}, "read_at")
    || Object.hasOwn(persistedNotificationRecord || {}, "destination")
    || Object.hasOwn(persistedNotificationRecord || {}, "created_at")) {
  throw new Error("local mark-read must persist only the existing local notification shape");
}
store.load();
const persistedLocalRows = await store.listMyNotifications();
const persistedLocalRow = persistedLocalRows.find((row) => row.id === localPaymentNotification.id);
if (!persistedLocalRow?.read_at) {
  throw new Error("clicking a local notification must persist its existing read flag");
}
{
  const unreadIdsBefore = new Set(
    localNotificationRows.filter((row) => !row.read_at).map((row) => row.id)
  );
  const stillUnreadOriginal = persistedLocalRows.filter(
    (row) => unreadIdsBefore.has(row.id) && !row.read_at
  );
  if (stillUnreadOriginal.length !== unreadIdsBefore.size - 1) {
    throw new Error("local notification count must drop by one after the clicked row persists read");
  }
}
const localInboxAfterClick = await views.viewNotifications(new Date(), persistedLocalRows);
if (localInboxAfterClick.includes(`data-notification-id="${localPaymentNotification.id}"`)) {
  throw new Error("the clicked local notification must hide from the unread-only Inbox");
}
console.log("ok  local notification Inbox, count, destination, and click persistence");
const conf = store.confirmBookingPayment(r1.id);
store.signIn(signIn.user.email);
if (conf.booking.status !== "confirmed") throw new Error("collector confirm should confirm");
if (conf.receipt.method !== "PayMe") throw new Error("receipt should record the method");
if (!store.receiptForBooking(r1.id)) throw new Error("receipt should attach to the booking");
console.log("ok  collector confirms -> booking confirmed + receipt (PayMe)");
const booking = conf.booking, receipt = conf.receipt;
const bookedActivityLink = `href="#/activity/${booking.sessionId}"`;
const myWeekStart = data.sundayOf(data.todayLocal());
const myWeekEndISO = data.isoDate(data.addDays(myWeekStart, 6));
const myWeekStartISO = data.isoDate(myWeekStart);
const bookingInMyWeek = booking.snapshot.dateISO >= myWeekStartISO
  && booking.snapshot.dateISO <= myWeekEndISO;
const approvedHome = views.viewHome();
if (!approvedHome.includes("My Week")) {
  throw new Error("approved Home must show My Week");
}
if (bookingInMyWeek) {
  if (!approvedHome.includes(booking.snapshot.name) || !approvedHome.includes(bookedActivityLink)) {
    throw new Error("approved Home must show this week's confirmed booking in My Week");
  }
} else if (approvedHome.includes(bookedActivityLink)) {
  throw new Error("approved My Week must exclude confirmed bookings outside the current Sun–Sat week");
}
for (const session of allUpcoming.filter((item) => item.id !== booking.sessionId)) {
  if (approvedHome.includes(`href="#/activity/${session.id}"`)) {
    throw new Error("approved My Week must exclude unbooked sessions");
  }
}
for (const status of ["reserved", "deferred", "cancelled", "attended"]) {
  try {
    booking.status = status;
    if (views.viewHome().includes(bookedActivityLink)) {
      throw new Error(`approved My Week must exclude ${status} bookings`);
    }
  } finally {
    booking.status = "confirmed";
  }
}
const futureSnapshotDateISO = booking.snapshot.dateISO;
const futureSnapshotStartTime = booking.snapshot.startTime;
try {
  booking.snapshot.dateISO = "2000-01-01";
  booking.snapshot.startTime = "00:00";
  if (views.viewHome().includes(bookedActivityLink)) {
    throw new Error("approved My Week must exclude confirmed bookings whose snapshot has started");
  }
} finally {
  booking.snapshot.dateISO = futureSnapshotDateISO;
  booking.snapshot.startTime = futureSnapshotStartTime;
}
if (bookingInMyWeek && !views.viewHome().includes(bookedActivityLink)) {
  throw new Error("confirmed future booking fixture must be restored after My Week mutations");
}
{
  // A confirmed booking next week must not appear even inside the 14-day set.
  const nextWeekSession = allUpcoming.find((session) =>
    session.kind === "paid"
    && session.id !== booking.sessionId
    && session.dateISO > myWeekEndISO
    && session.dateISO !== booking.snapshot.dateISO
    && !data.sessionStarted(session));
  if (nextWeekSession) {
    const nextWeekReservation = store.reserveSession(signIn.user.id, nextWeekSession.id, islandEccOpenNow(nextWeekSession));
    store.markBookingPaid(nextWeekReservation.id, "PayMe", "NEXTWEEK");
    store.signIn("admin@example.test");
    store.confirmBookingPayment(nextWeekReservation.id);
    store.signIn(signIn.user.email);
    const nextWeekLink = `href="#/activity/${nextWeekSession.id}"`;
    const homeThisWeek = views.viewHome();
    if (homeThisWeek.includes(nextWeekLink)) {
      throw new Error("approved My Week must exclude confirmed bookings outside the current Sun–Sat week");
    }
    if (bookingInMyWeek && !homeThisWeek.includes(bookedActivityLink)) {
      throw new Error("approved My Week must still show this week's confirmed booking");
    }
    // Detach the fixture so later Profile booking-count checks still see one row.
    const nextWeekBooking = store.getBooking(nextWeekReservation.id);
    const nextWeekReceipt = store.receiptForBooking(nextWeekReservation.id);
    if (nextWeekBooking) nextWeekBooking.userId = "__smoke-my-week-cleanup__";
    if (nextWeekReceipt) nextWeekReceipt.userId = "__smoke-my-week-cleanup__";
  }
}
const islandEccBookingHtml = await check("booking confirmation", () => views.viewBooking(booking.id));
const islandEccReceiptHtml = await check("receipt", () => views.viewReceipt(receipt.id));
assert.match(islandEccBookingHtml, /View receipt/,
  "Island ECC direct booking must retain its receipt control");
assert.match(islandEccBookingHtml, /Create private invite/,
  "Island ECC direct booking must retain its replacement control");
assert.match(islandEccReceiptHtml, /ITC HYROX/,
  "Island ECC direct receipt must remain renderable");
const memberActivityWithAvatars = await check("activity (member, booked)", () => views.viewActivity(paid.id, {
  avatarRows: [{
    profileId: "member-visible-only-to-resolver",
    displayName: "Alex T.",
    url: "https://project.supabase.co/storage/v1/object/sign/profile-avatars/member/avatar.jpg?token=attendee",
    source: "custom",
    state: "active",
    expiresAt: "2099-01-01T00:00:00.000Z",
  }],
}));
if (!memberActivityWithAvatars.includes("Alex T.") || !memberActivityWithAvatars.includes("attendee-avatar")) {
  throw new Error("approved Activity Details must render resolved attendee avatar/name rows");
}
if (memberActivityWithAvatars.includes("member-visible-only-to-resolver") ||
    memberActivityWithAvatars.includes('data-action="avatar-hide"')) {
  throw new Error("member attendee rows must not expose profile IDs or moderation controls");
}
const memberActivityFallback = views.viewActivity(paid.id, { avatarRows: null });
if (!memberActivityFallback.includes("Who’s coming") || /object_path|pending_object|google_object/.test(memberActivityFallback)) {
  throw new Error("attendee resolver failure must retain safe attendee copy without internal paths");
}
const memberActivityEmptyAvatars = views.viewActivity(paid.id, {
  attendeeNames: ["Riley R."],
  avatarRows: [],
});
if (!memberActivityEmptyAvatars.includes("Riley R.") || memberActivityEmptyAvatars.includes("No confirmed bookings yet")) {
  throw new Error("empty avatar rows must fall back to attendee names for Who's coming");
}
const lunchRsvp = allUpcoming.find((session) => session.activityId === "lunch" && !data.sessionStarted(session));
if (lunchRsvp) {
  const mismatchedCountHtml = views.viewActivity(lunchRsvp.id, {
    attendeeNames: ["Seles L."],
    avatarRows: [],
  });
  if (!mismatchedCountHtml.includes("Seles L.") || !mismatchedCountHtml.includes("1 going")) {
    throw new Error("RSVP activity must align going count with Who's coming roster length");
  }
}
const memberActivityNamesUnavailable = views.viewActivity(paid.id, {
  attendeeNames: null,
  avatarRows: [],
});
if (!memberActivityNamesUnavailable.includes("temporarily unavailable")) {
  throw new Error("null attendee names with empty avatars must show the unavailable copy");
}
store.signOut();
if ((await store.getSessionAvatars(paid.id)).length !== 0) {
  throw new Error("signed-out local attendee adapter must not return booked-member rows");
}
if (!store.signIn("test@example.com").ok) throw new Error("member fixture must sign back in after attendee authorization test");

// the booked class is badged on Home "My week" and on the Schedule row;
// "My week" shows booked sessions only, so unbooked ones stay out
const homeBooked = views.viewHome();
if (bookingInMyWeek) {
  if (!homeBooked.includes("Booked") || !homeBooked.includes("Island ECC")) {
    failures++;
    console.error('FAIL home "My week" does not show the booked session');
  } else console.log('ok  home "My week" shows the booked session');
  const bookedDayLabel = data.fmtDate(data.parseISO(booking.snapshot.dateISO));
  if (!homeBooked.includes('class="week-day-head"') || !homeBooked.includes(bookedDayLabel)) {
    failures++;
    console.error('FAIL home "My week" must show a day header for the booked session');
  } else console.log('ok  home "My week" groups the booked session under a day header');
} else {
  if (homeBooked.includes(bookedActivityLink)) {
    failures++;
    console.error('FAIL home "My week" must exclude a booked session outside this Sun–Sat week');
  } else console.log('ok  home "My week" excludes a booked session outside this Sun–Sat week');
}
if (homeBooked.includes("BFT Causeway Bay") || homeBooked.includes("Midtown28 Fitness") || homeBooked.includes("Just show up")) {
  failures++;
  console.error('FAIL home "My week" shows sessions the member has not booked');
} else console.log('ok  home "My week" hides unbooked sessions');
const WEEK_MS = 7 * 24 * 3600 * 1000;
views.scheduleState.weekOffset = Math.round(
  (data.sundayOf(data.parseISO(paid.dateISO)) - data.sundayOf(data.todayLocal())) / WEEK_MS
);
views.scheduleState.selected = paid.dateISO;
if (!views.viewSchedule().includes("Booked")) {
  failures++;
  console.error("FAIL schedule does not badge the booked session");
} else console.log("ok  schedule badges booked session");
if ((await views.viewAccount()).includes(">Upcoming<")) {
  failures++;
  console.error("FAIL Profile still repeats the upcoming bookings list");
} else console.log("ok  Profile drops redundant upcoming list");

// donor ID skipped at signup ("Not applicable" above) can be added later;
// it lives inside Membership Details, not on the Profile card face
store.updateDonorId(signIn.user.id, "IECC-99999");
if (store.currentUser().donorId !== "IECC-99999") throw new Error("donor ID not saved");
if ((await views.viewAccount()).includes("IECC-99999")) {
  failures++;
  console.error("FAIL donor ID should not appear on the Profile card face");
} else console.log("ok  Profile card face carries no donor details");
if (!(await views.viewAccount("donor")).includes("IECC-99999")) {
  failures++;
  console.error("FAIL donor ID missing from legacy donor route's Membership Details content");
} else console.log("ok  donor ID shows in Membership Details");
store.updateDonorId(signIn.user.id, "wong 1234");
if (store.currentUser().donorId !== "WONG-1234") {
  failures++;
  console.error("FAIL donor ID should be stored uppercase with a hyphen");
} else console.log("ok  donor ID stored uppercase with hyphen");
await store.updateMyMembershipDetails({
  mobile: store.currentUser().phone,
  age_over_18: "yes",
  emergency_name: store.currentUser().emergencyName,
  emergency_relationship: store.currentUser().emergencyRelationship,
  emergency_phone: store.currentUser().emergencyPhone,
  heard_source: store.currentUser().heard,
  preferred_name: store.currentUser().preferredName,
  donorId: "chui 8879",
});
if (store.currentUser().donorId !== "CHUI-8879") {
  failures++;
  console.error("FAIL Membership Details save should normalize and persist Donor ID");
} else console.log("ok  Membership Details save includes Donor ID");

// The stats and linked pages use the same canonical booking collection, so
// each stat must equal the number of cards rendered by its destination.
const countBookingCards = (html) => (html.match(/class="card booking-card"/g) || []).length;
const statCount = (html, href) => {
  const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`href="${escapedHref}"[^>]*>\\s*<strong>(\\d+)</strong>`));
  return match ? Number(match[1]) : null;
};
const bookingProfileHtml = await views.viewAccount();
const allBookingsHtml = await views.viewAccount("bookings");
const attendedBookingsHtml = await views.viewAccount("bookings", "attended");
const legacyHistoryHtml = await views.viewAccount("history");
const paymentsAndReceiptsHtml = await views.viewAccount("payments");
const memberNotificationHtml = await views.viewNotifications(new Date(), await store.listMyNotifications());
const retiredMemberPattern = /BFT Causeway Bay|Midtown28|Midtown 28|BFT \+ Midtown Pool|venue allocation|switch queue|Wait for Midtown/i;
for (const [surface, html] of [
  ["Home", views.viewHome()],
  ["Schedule", views.viewSchedule()],
  ["Profile", bookingProfileHtml],
  ["Bookings", allBookingsHtml],
  ["History", legacyHistoryHtml],
  ["Payments & Receipts", paymentsAndReceiptsHtml],
  ["Booking", islandEccBookingHtml],
  ["Receipt", islandEccReceiptHtml],
  ["Notifications", memberNotificationHtml],
]) {
  assert.doesNotMatch(html, retiredMemberPattern, `${surface} must not render retired pool copy`);
}
console.log("ok  member surfaces omit retired pool copy and keep Island ECC controls");
for (const [label, html] of [
  ["bookings", allBookingsHtml],
  ["attended bookings", attendedBookingsHtml],
  ["legacy history", legacyHistoryHtml],
]) {
  try {
    assertProfileSubpageHierarchy(html, "Bookings");
  } catch (err) {
    failures++;
    console.error(`FAIL profile > ${label} hierarchy: ${err.message}`);
  }
}
if (!allBookingsHtml.includes("All bookings") || !allBookingsHtml.includes("Upcoming")) {
  failures++;
  console.error("FAIL Bookings link should render the grouped all-bookings view");
}
if (!attendedBookingsHtml.includes("Attended sessions will appear here.")) {
  failures++;
  console.error("FAIL Attended link should render the attended-only view");
}
if (statCount(bookingProfileHtml, "#/account/bookings") !== countBookingCards(allBookingsHtml)) {
  failures++;
  console.error("FAIL Bookings neon count should match its linked booking cards");
}
if (statCount(bookingProfileHtml, "#/account/bookings/attended") !== countBookingCards(attendedBookingsHtml)) {
  failures++;
  console.error("FAIL Attended neon count should match its linked booking cards");
}
try {
  booking.status = "attended";
  const attendedProfile = await views.viewAccount();
  const attendedPage = await views.viewAccount("bookings", "attended");
  if (statCount(attendedProfile, "#/account/bookings/attended") !== 1
      || countBookingCards(attendedPage) !== 1) {
    failures++;
    console.error("FAIL positive Attended count should match its linked card");
  }
  booking.status = "cancelled";
  const cancelledProfile = await views.viewAccount();
  const cancelledPage = await views.viewAccount("bookings");
  if (statCount(cancelledProfile, "#/account/bookings") !== 1
      || countBookingCards(cancelledPage) !== 1
      || !cancelledPage.includes("Cancelled")) {
    failures++;
    console.error("FAIL paid cancellation should count once and remain visible in Bookings");
  }
} finally {
  booking.status = "confirmed";
}
if (!legacyHistoryHtml.includes("All bookings")) {
  failures++;
  console.error("FAIL legacy History route should render the canonical Bookings view");
} else console.log("ok  Profile stats and linked booking views share matching counts");

// --- Seeded member view ---
installLocalFixtures(); store.signIn("member@example.test");
await check("account (seeded member)", () => views.viewAccount());
const memberAcct = await views.viewAccount();
// fixture-member has donorId TEST-1234; the legacy donor route now lands on
// the combined Membership Details content.
if (!(await views.viewAccount("donor")).includes("TEST-1234")) {
  failures++;
  console.error("FAIL seeded member donor ID not shown in Membership Details");
} else console.log("ok  seeded member donor ID shown in Membership Details");
if (memberAcct.includes("TEST-1234")) {
  failures++;
  console.error("FAIL donor ID should not appear on the Profile card face");
} else console.log("ok  seeded member card faces carry no donor details");
// Seeded receipts (ITC-2026-0048) are removed; Payments shows receipts created during the test.
if ((await views.viewAccount("payments")).includes("ITC-2026-0048")) {
  failures++;
  console.error("FAIL seeded receipts should not be present in fresh state");
} else console.log("ok  no demo receipts are present");
if (!memberAcct.includes("Indemnity confirmed on")) {
  failures++;
  console.error("FAIL seeded member should have indemnity confirmed");
} else console.log("ok  seeded member indemnity confirmed");
if (!memberAcct.includes('class="kicker">Profile</div>') || memberAcct.includes("Member Profile") || memberAcct.includes("’s training")) {
  failures++;
  console.error('FAIL Profile header should read "Profile" with no name headline');
} else console.log('ok  Profile header reads "Profile"');
if (memberAcct.includes("member@example.test")) {
  failures++;
  console.error("FAIL email should not appear on the Profile face");
} else console.log("ok  Profile face carries no contact details");
if (!(await views.viewAccount("details")).includes("member@example.test")) {
  failures++;
  console.error("FAIL email missing from Membership Details sub-page");
} else console.log("ok  email lives on Membership Details sub-page");
installLocalFixtures({ withMemberBooking: true });
store.signIn("member@example.test");
await check("home (member)", () => views.viewHome());
const memberHome = views.viewHome();
const fixtureMember = store.currentUser();
const fixtureBookings = store.bookingsForUser(fixtureMember.id);
const fixtureSnap = fixtureBookings[0]?.snapshot;
const bookedMarker = fixtureSnap?.location ?? "BFT Causeway Bay";
const otherMarker = "Midtown28 Fitness";
const fixtureInMyWeek = Boolean(
  fixtureSnap?.dateISO
  && fixtureSnap.dateISO >= myWeekStartISO
  && fixtureSnap.dateISO <= myWeekEndISO
  && !data.sessionStarted(fixtureSnap)
);
if (fixtureInMyWeek) {
  if (!memberHome.includes(bookedMarker) || memberHome.includes(otherMarker)) {
    failures++;
    console.error(`FAIL "My week" should show only the member's booked HYROX (${bookedMarker})`);
  } else console.log(`ok  "My week" shows only the member's booked session (${bookedMarker})`);
} else if (memberHome.includes(bookedMarker)) {
  failures++;
  console.error(`FAIL "My week" must exclude a started or out-of-week fixture booking (${bookedMarker})`);
} else console.log(`ok  "My week" excludes a started or out-of-week fixture booking`);
// Community prayer requests: v23 prayer migration followed by v24 retirement.
const v22PrayerSnapshot = JSON.parse(mem.get("itc.prototype.v1"));
v22PrayerSnapshot.version = 22;
v22PrayerSnapshot.sessionUserId = null;
v22PrayerSnapshot.prayers = [
  { id: "legacy-prayer-a", request: "Historical prayer A" },
  { id: "legacy-prayer-b", request: "Historical prayer B", createdAt: 1234 },
];
mem.set("itc.prototype.v1", JSON.stringify(v22PrayerSnapshot));
const migratedPrayerState = store.load();
assert.equal(migratedPrayerState.version, 30);
assert.deepEqual(migratedPrayerState.prayers.map((row) => row.id), [
  "legacy-prayer-a",
  "legacy-prayer-b",
]);
assert.deepEqual(migratedPrayerState.prayers.map((row) => row.request), [
  "Historical prayer A",
  "Historical prayer B",
]);
for (const row of migratedPrayerState.prayers) {
  assert.equal(row.status, "new");
  assert.equal(row.anonymousToLeaders, false);
  assert.equal(Number.isFinite(row.createdAt), true);
  assert.equal(Number.isFinite(row.updatedAt), true);
  assert.equal(row.closedAt, null);
  assert.equal(row.withdrawnAt, null);
}

installLocalFixtures();
store.signOut();
await assert.rejects(
  () => store.submitPrayerRequest({ request: "Please pray" }),
  /approved member/i,
);
await assert.rejects(() => store.listMyPrayerRequests(), /approved member/i);

{
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.users.push(
    { id: "prayer-other", role: "member", status: "approved", fullName: "Other Member", email: "prayer-other@example.test" },
    { id: "prayer-pending", role: "pending", status: "pending", fullName: "Pending Member", email: "prayer-pending@example.test" },
    { id: "prayer-declined", role: "declined", status: "declined", fullName: "Declined Member", email: "prayer-declined@example.test" },
    { id: "prayer-super-alias", role: "superadmin", status: "approved", fullName: "Alias Super Admin", email: "prayer-super-alias@example.test" },
    { id: "prayer-super", role: "super_admin", status: "approved", fullName: "Super Admin", email: "prayer-super@example.test" },
  );
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
}
for (const [email, state] of [
  ["prayer-pending@example.test", "pending"],
  ["prayer-declined@example.test", "declined"],
]) {
  store.signIn(email);
  const gatedPrayerHtml = await views.viewCommunity("prayers");
  assert.match(gatedPrayerHtml, /approved member/i,
    `${state} user must see the approved-member Prayer gate`);
  assert.match(gatedPrayerHtml,
    /We pray for each other — injuries, exams, work, family, anything\./,
    `${state} Prayer gate must retain the public prayer description`);
  assert.match(gatedPrayerHtml,
    /<a class="btn ghost mt16" href="#\/account">View Profile<\/a>/,
    `${state} Prayer gate must offer the signed-in Profile CTA`);
  assert.doesNotMatch(gatedPrayerHtml, /id="form-prayer"|My Prayer Requests|prayer-request-list/,
    `${state} user must not see the Prayer form or history`);
  await assert.rejects(
    () => store.submitPrayerRequest({ request: "Blocked prayer" }),
    /approved member/i,
  );
  await assert.rejects(() => store.listMyPrayerRequests(), /approved member/i);
}

// The approved-member view must map every status and action without exposing
// stale withdrawn text or trusting request content as HTML.
const prayerViewBaseline = mem.get("itc.prototype.v1");
const prayerViewState = JSON.parse(prayerViewBaseline);
prayerViewState.prayers = [
  {
    id: "prayer-view-new", ownerId: "fixture-member",
    request: "<script>Unsafe & history</script>", anonymousToLeaders: false,
    status: "new", createdAt: Date.parse("2026-08-05T02:00:00.000Z"),
    updatedAt: Date.parse("2026-08-05T02:00:00.000Z"), closedAt: null, withdrawnAt: null,
  },
  {
    id: "prayer-view-prayed", ownerId: "fixture-member",
    request: "Prayed request", anonymousToLeaders: true,
    status: "prayed_for", createdAt: Date.parse("2026-08-04T02:00:00.000Z"),
    updatedAt: Date.parse("2026-08-05T02:00:00.000Z"), closedAt: null, withdrawnAt: null,
  },
  {
    id: "prayer-view-closed", ownerId: "fixture-member",
    request: "Closed request", anonymousToLeaders: false,
    status: "closed", createdAt: Date.parse("2026-08-03T02:00:00.000Z"),
    updatedAt: Date.parse("2026-08-05T02:00:00.000Z"),
    closedAt: Date.parse("2026-08-05T02:00:00.000Z"), withdrawnAt: null,
  },
  {
    id: "prayer-view-new-oldest", ownerId: "prayer-other",
    request: "Oldest new request", anonymousToLeaders: false,
    status: "new", createdAt: Date.parse("2026-08-01T02:00:00.000Z"),
    updatedAt: Date.parse("2026-08-01T02:00:00.000Z"), closedAt: null, withdrawnAt: null,
  },
  {
    id: "prayer-view-prayed-newer", ownerId: "prayer-other",
    request: "Newer prayed request", anonymousToLeaders: false,
    status: "prayed_for", createdAt: Date.parse("2026-08-06T02:00:00.000Z"),
    updatedAt: Date.parse("2026-08-06T03:00:00.000Z"), closedAt: null, withdrawnAt: null,
  },
  {
    id: "prayer-view-closed-newest", ownerId: "prayer-other",
    request: "Newest closed request", anonymousToLeaders: false,
    status: "closed", createdAt: Date.parse("2026-08-06T02:00:00.000Z"),
    updatedAt: Date.parse("2026-08-06T03:00:00.000Z"),
    closedAt: Date.parse("2026-08-06T03:00:00.000Z"), withdrawnAt: null,
  },
  {
    id: "prayer-view-withdrawn", ownerId: "fixture-member",
    request: "ERASED WITHDRAWN SECRET", anonymousToLeaders: true,
    status: "withdrawn", createdAt: Date.parse("2026-08-02T02:00:00.000Z"),
    updatedAt: Date.parse("2026-08-05T02:00:00.000Z"), closedAt: null,
    withdrawnAt: Date.parse("2026-08-05T02:00:00.000Z"),
  },
];
mem.set("itc.prototype.v1", JSON.stringify(prayerViewState));
store.load();
store.signIn("member@example.test");
assert.deepEqual(await views.viewAdmin("prayers"), { redirect: "#/account" },
  "non-Admins must not render the Admin prayer queue");
store.signIn("admin@example.test");
const adminPrayerHtml = await views.viewAdmin("prayers");
const prayerTabOrder = [
  'href="#/admin/activities"',
  'href="#/admin/prayers"',
  'href="#/admin/giving"',
].map((marker) => adminPrayerHtml.indexOf(marker));
assert.ok(prayerTabOrder.every((index) => index >= 0)
  && prayerTabOrder[0] < prayerTabOrder[1]
  && prayerTabOrder[1] < prayerTabOrder[2],
"Admin Prayer Requests tab must appear between Activities and Giving");
for (const heading of ["New", "Prayed for"]) {
  assert.match(adminPrayerHtml, new RegExp(`<h2[^>]*>${heading}<\\/h2>`),
    `Admin Prayer queue must render the ${heading} group`);
}
assert.ok(adminPrayerHtml.indexOf("Oldest new request") < adminPrayerHtml.indexOf("&lt;script&gt;Unsafe"),
  "New Admin prayer requests must render oldest first");
assert.ok(adminPrayerHtml.indexOf("Prayed request") < adminPrayerHtml.indexOf("Newer prayed request"),
  "Prayed-for Admin requests must render oldest first");
assert.ok(adminPrayerHtml.indexOf("Newest closed request") < adminPrayerHtml.indexOf("Closed request"),
  "Closed Admin prayer requests must render newest first");
assert.match(adminPrayerHtml, /Other Member/,
  "identified Admin prayer requests must show the member display name");
const adminPrayerCards = adminPrayerHtml.match(/<article\b[\s\S]*?<\/article>/g) || [];
const adminPrayerCardFor = (request) => adminPrayerCards.find((card) => card.includes(request)) || "";
const anonymousAdminPrayerCard = adminPrayerCardFor("Prayed request");
assert.match(anonymousAdminPrayerCard, /Anonymous member/);
assert.doesNotMatch(anonymousAdminPrayerCard,
  /fixture-member|member@example\.test|data-(?:owner|user)/i,
  "anonymous Admin prayer markup must contain no owner UUID, email, or identity data attribute");
assert.doesNotMatch(adminPrayerHtml, /ERASED WITHDRAWN SECRET|prayer-view-withdrawn/,
  "withdrawn requests must never render in the Admin queue");
assert.doesNotMatch(adminPrayerHtml, /<(?:textarea|input)\b/i,
  "Admin prayer cards must not expose request-edit controls");
assert.match(adminPrayerHtml, /<details[^>]*admin-prayer-closed[\s\S]*<h2[^>]*>Closed/,
  "Closed Admin prayers must render in a secondary disclosure");
const closedPrayerSummary = adminPrayerHtml.match(
  /<details[^>]*admin-prayer-closed[^>]*>\s*<summary>([\s\S]*?)<\/summary>/
)?.[1] || "";
assert.match(
  closedPrayerSummary,
  /^\s*<h2>Closed\s*<span class="badge neutral" aria-label="\d+ prayer requests?">\d+<\/span>\s*<\/h2>\s*$/,
  "Closed Prayer summary must use one heading-compatible child with an accessible count",
);
assert.match(adminPrayerCardFor("Oldest new request"), /Mark as prayed for[\s\S]*>Close</,
  "new Admin requests must expose both legal next states");
assert.doesNotMatch(adminPrayerCardFor("Prayed request"), /Mark as prayed for/);
assert.match(adminPrayerCardFor("Prayed request"), />Close<\/button>/);
assert.doesNotMatch(adminPrayerCardFor("Newest closed request"), /data-action=/,
  "closed Admin requests must expose no status controls");
store.signIn("member@example.test");
const memberPrayerHtml = await views.viewCommunity("prayers");
for (const marker of [
  'id="form-prayer"', 'maxlength="2000"', 'name="anonymousToLeaders"',
  "Hide my identity from ITC leaders",
  "Requests are shared privately with ITC Admins and are never posted publicly.",
  "My Prayer Requests", "New", "Prayed for", "Closed", "Withdrawn", "5 Aug 2026",
  "&lt;script&gt;Unsafe &amp; history&lt;/script&gt;", "Shared with my identity",
  "Identity hidden from ITC leaders",
]) {
  assert.match(memberPrayerHtml, new RegExp(marker), `approved Prayer missing ${marker}`);
}
assert.doesNotMatch(memberPrayerHtml, /name="name"|Prototype:|ERASED WITHDRAWN SECRET/);
const memberPrayerCards = memberPrayerHtml.match(/<article\b[\s\S]*?<\/article>/g) || [];
const withdrawnMemberPrayerCard = memberPrayerCards.find((card) => card.includes(">Withdrawn</span>")) || "";
assert.ok(withdrawnMemberPrayerCard.includes(
  `<time datetime="${Date.parse("2026-08-05T02:00:00.000Z")}">5 Aug 2026</time>`
), "withdrawn member history must prefer the withdrawal timestamp");
assert.equal(
  withdrawnMemberPrayerCard.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  "5 Aug 2026 Withdrawn",
  "withdrawn history must render only its withdrawal timestamp and status",
);
assert.doesNotMatch(withdrawnMemberPrayerCard,
  /ERASED WITHDRAWN SECRET|Request text|identity|data-action/i,
  "malformed withdrawn text, former privacy state, prose, and actions must not render");
assert.doesNotMatch(memberPrayerHtml, /name="anonymousToLeaders"[^>]*checked/,
  "anonymity checkbox must default unchecked");
assert.equal((memberPrayerHtml.match(/data-action="close-prayer-request"/g) || []).length, 2,
  "close must appear only for New and Prayed for requests");
assert.equal((memberPrayerHtml.match(/data-action="withdraw-prayer-request"/g) || []).length, 3,
  "withdraw must appear for every non-withdrawn request");
for (const email of ["admin@example.test", "prayer-super-alias@example.test", "prayer-super@example.test"]) {
  store.signIn(email);
  assert.match(await views.viewCommunity("prayers"), /id="form-prayer"/,
    `${email} must receive approved Prayer access`);
}
mem.set("itc.prototype.v1", prayerViewBaseline);
store.load();

store.signIn("member@example.test");
await assert.rejects(
  () => store.submitPrayerRequest({ request: "   " }),
  /between 1 and 2,000 characters/i,
);
await assert.rejects(
  () => store.submitPrayerRequest({ request: "x".repeat(2001) }),
  /between 1 and 2,000 characters/i,
);
const identifiedPrayer = await store.submitPrayerRequest({
  request: "  Please pray for recovery.  ",
  anonymousToLeaders: false,
});
assert.equal(identifiedPrayer.request, "Please pray for recovery.");
assert.equal(identifiedPrayer.status, "new");
assert.equal("ownerId" in identifiedPrayer, false);
assert.equal("userId" in identifiedPrayer, false);
const anonymousPrayer = await store.submitPrayerRequest({
  request: "A private concern",
  anonymousToLeaders: true,
});
const memberPrayerRows = await store.listMyPrayerRequests();
assert.equal(memberPrayerRows.length, 2);
assert.deepEqual(memberPrayerRows.map((row) => row.id), [anonymousPrayer.id, identifiedPrayer.id]);
assert.equal(memberPrayerRows.some((row) => row.id === "legacy-prayer-a"), false,
  "ownerless legacy rows must not attach to member history");

store.signIn("prayer-other@example.test");
assert.deepEqual(await store.listMyPrayerRequests(), []);
await assert.rejects(
  () => store.setMyPrayerRequestState(identifiedPrayer.id, "close"),
  /not found|own prayer request/i,
);

store.signIn("admin@example.test");
let adminPrayerRows = await store.listAdminPrayerRequests();
assert.equal(
  adminPrayerRows.find((row) => row.id === anonymousPrayer.id).displayName,
  "Anonymous member",
);
assert.equal(
  adminPrayerRows.find((row) => row.id === identifiedPrayer.id).displayName,
  "Test Member",
);
for (const row of adminPrayerRows) {
  assert.equal("ownerId" in row, false);
  assert.equal("userId" in row, false);
}
for (const legacyId of ["legacy-prayer-a", "legacy-prayer-b"]) {
  assert.equal(adminPrayerRows.find((row) => row.id === legacyId)?.displayName, "Anonymous member");
}
assert.equal(
  (await store.setAdminPrayerRequestStatus(identifiedPrayer.id, "prayed_for")).status,
  "prayed_for",
);
assert.equal(
  (await store.setAdminPrayerRequestStatus(identifiedPrayer.id, "closed")).status,
  "closed",
);
await assert.rejects(
  () => store.setAdminPrayerRequestStatus(identifiedPrayer.id, "closed"),
  /current state/i,
);
await assert.rejects(
  () => store.setAdminPrayerRequestStatus(anonymousPrayer.id, "withdrawn"),
  /prayed_for or closed/i,
);

const adminOwnedPrayer = await store.submitPrayerRequest({ request: "Admin-owned prayer" });
assert.equal((await store.listMyPrayerRequests()).some((row) => row.id === adminOwnedPrayer.id), true);
await store.setMyPrayerRequestState(adminOwnedPrayer.id, "withdraw");
for (const email of ["prayer-super-alias@example.test", "prayer-super@example.test"]) {
  store.signIn(email);
  const superOwned = await store.submitPrayerRequest({ request: `Prayer from ${email}` });
  assert.equal((await store.listMyPrayerRequests()).some((row) => row.id === superOwned.id), true);
  await store.setMyPrayerRequestState(superOwned.id, "withdraw");
}

store.signIn("member@example.test");
const memberClosed = await store.setMyPrayerRequestState(anonymousPrayer.id, "close");
assert.equal(memberClosed.status, "closed");
assert.equal(Number.isFinite(memberClosed.closedAt), true);
const withdrawnClosed = await store.setMyPrayerRequestState(anonymousPrayer.id, "withdraw");
assert.equal(withdrawnClosed.status, "withdrawn");
assert.equal(withdrawnClosed.request, null);
assert.equal(withdrawnClosed.closedAt, null);
assert.equal(Number.isFinite(withdrawnClosed.withdrawnAt), true);
const withdrawnAdminClosed = await store.setMyPrayerRequestState(identifiedPrayer.id, "withdraw");
assert.equal(withdrawnAdminClosed.request, null);
await assert.rejects(
  () => store.setMyPrayerRequestState(identifiedPrayer.id, "withdraw"),
  /already withdrawn/i,
);

store.signIn("admin@example.test");
adminPrayerRows = await store.listAdminPrayerRequests();
assert.equal(adminPrayerRows.some((row) => row.id === anonymousPrayer.id), false);
assert.equal(adminPrayerRows.some((row) => row.id === identifiedPrayer.id), false);
assert.equal(adminPrayerRows.some((row) => row.id === adminOwnedPrayer.id), false);
console.log("ok  Prayer page gates access and renders private member history safely");
console.log("ok  prayer requests migrate and enforce local role, ownership, redaction, and transition parity");

// --- ICS generation ---
const fellowship = await views.viewCommunity("fellowship");
assert.ok(fellowship.includes("services are at 9:30 AM, 11:30 AM and 3:30 PM."),
  "fellowship copy must show all Sunday service times");
assert.ok(!fellowship.includes("service starts 10:30 AM"),
  "fellowship copy must not retain the old 10:30 AM service start");
assert.ok(!fellowship.includes("Draft content — fellowship details to be confirmed with ITC leadership."),
  "fellowship page must not show internal draft-status copy");
console.log("ok  fellowship lists all Sunday service times");

const ics = data.buildICS({
  ...free,
  id: "calendar-test",
  name: "Session, with ITC",
  dateISO: "2026-09-30",
  time: "09:30",
  durationMin: 60,
  location: "Tamar Park; Hong Kong",
  blurb: "Bring water;\nMeet at the gate",
});
assert.match(ics, /METHOD:PUBLISH/, "ICS must publish an event the calendar can add");
assert.match(ics, /BEGIN:VEVENT/, "ICS must contain an event");
assert.match(ics, /DTSTAMP:\d{8}T\d{6}Z/,
  "ICS must include a calendar event creation timestamp");
assert.match(ics, /DTSTART:20260930T013000Z/,
  "ICS start must be an absolute UTC instant for a 9:30 AM HKT event");
assert.match(ics, /DTEND:20260930T023000Z/,
  "ICS end must be an absolute UTC instant");
assert.match(ics, /SUMMARY:Session\\, with ITC — Island Training Club/,
  "ICS text fields must escape commas");
assert.match(ics, /LOCATION:Tamar Park\\; Hong Kong/,
  "ICS text fields must escape semicolons");
assert.match(ics, /DESCRIPTION:Bring water\\;\\nMeet at the gate/,
  "ICS descriptions must escape punctuation and line breaks");
if (!ics.endsWith("\r\n")) throw new Error("ICS must end with a CRLF");
const longIcs = data.buildICS({
  ...free,
  id: "calendar-folding-test",
  dateISO: "2026-09-30",
  time: "09:30",
  blurb: "Session details ".repeat(12),
});
assert.ok(
  longIcs.split("\r\n").filter(Boolean)
    .every((line) => new TextEncoder().encode(line).length <= 75),
  "long ICS lines must be folded at the RFC 5545 octet limit",
);
console.log("ok  ICS generation");

const appCalendarSource = readFileSync(resolve(__dirnameSmoke, "js/app.js"), "utf8");
assert.match(appCalendarSource, /navigator\.canShare/,
  "calendar export must detect Safari's file-sharing path");
assert.match(appCalendarSource, /navigator\.share/,
  "calendar export must offer a file-sharing fallback");
assert.match(appCalendarSource, /if \(!b\.sessionId\)/,
  "calendar export must not create an event before a HYROX venue is assigned");
assert.doesNotMatch(appCalendarSource, /snapshot\.time \|\| snapshot\.startTime \|\| "00:00"/,
  "calendar export must not invent midnight for an unassigned booking");
assert.match(appCalendarSource, /function appleCalendarClient/,
  "calendar export must detect Safari when file sharing is unavailable");
assert.match(appCalendarSource, /window\.location\.assign\(url\)/,
  "Safari must open the calendar preview instead of forcing a file download");
assert.match(appCalendarSource, /document\.body\.appendChild\(a\)/,
  "calendar download links must be attached before clicking");
assert.match(appCalendarSource, /setTimeout\(\(\) => \{[\s\S]*?URL\.revokeObjectURL\(url\);[\s\S]*?a\.remove\(\);/,
  "calendar Blob URLs must be revoked after the browser has consumed them");
console.log("ok  Safari calendar delivery safeguards are present");

// --- v7 migration: legacy hyphen-less donor IDs get repaired on load ---
store.resetLocalData();
{
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.version = 6;
  raw.users = [
    { id: "legacy-member", role: "member", status: "approved", fullName: "Legacy", email: "legacy1@example.test", donorId: "CHUI08879" },
    { id: "legacy-admin", role: "admin", status: "approved", fullName: "Legacy Admin", email: "legacy2@example.test", donorId: "not a real id" },
  ];
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
  const allUsers = store.allUsers();
  const fixed = allUsers.find((u) => u.id === "legacy-member")?.donorId;
  if (fixed !== "CHUI-08879") {
    failures++;
    console.error(`FAIL v7 migration should repair CHUI08879 -> CHUI-08879, got ${fixed}`);
  } else console.log("ok  v7 migration inserts the missing hyphen");
  const cleared = allUsers.find((u) => u.id === "legacy-admin")?.donorId;
  if (cleared !== null) {
    failures++;
    console.error(`FAIL v7 migration should clear unrecognizable donor ID, got ${cleared}`);
  } else console.log("ok  v7 migration clears unrecognizable donor ID");
}

// Every accepted historical schema version must run its original migration
// chain before the exact v24 retirement step, preserving non-pool state.
for (let version = 9; version <= 23; version++) {
  const fixture = structuredClone(freshV27State);
  fixture.version = version;
  fixture.activities.push(structuredClone(historicalBftActivity), {
    ...structuredClone(historicalBftActivity), id: "hyrox-midtown", location: "Midtown28 Fitness",
  });
  fixture.bookings.push({
    id: `retired-${version}`, sessionId: "hyrox-bft-2099-01-03", cycleId: null,
    snapshot: { name: "ITC HYROX", dateISO: "2099-01-03" },
  }, {
    id: `ecc-${version}`, sessionId: "hyrox-quarry-bay-2099-01-03", cycleId: null,
    snapshot: { name: "ITC HYROX", dateISO: "2099-01-03" },
  }, {
    id: `unrelated-${version}`, sessionId: "event-hyrox-bft-party-2099-01-03", cycleId: null,
    snapshot: { name: "Unrelated", dateISO: "2099-01-03" },
  });
  fixture.activities.push({
    id: "event-hyrox-bft-party", name: "Unrelated", kind: "free", published: true,
  });
  localStorage.setItem("itc.prototype.v1", JSON.stringify(fixture));
  const migrated = store.load();
  assert.equal(migrated.version, 30, `v${version} fixture must reach v27`);
  assert.equal(migrated.bookings.some((row) => row.id === `retired-${version}`), false);
  assert.ok(migrated.bookings.some((row) => row.id === `ecc-${version}`));
  assert.ok(migrated.bookings.some((row) => row.id === `unrelated-${version}`));
}
console.log("ok  every v9-v23 fixture reaches v27 with Island ECC and unrelated records intact");

// v14 Swimming migration remains part of the accepted v13-to-v27 chain.
// Repair only exact historical defaults; preserve every Admin customization.
{
  const historicalSwimmingV13 = structuredClone(freshV27State);
  historicalSwimmingV13.version = 13;
  const historicalWater = historicalSwimmingV13.activities.find(
    (activity) => activity.id === "water"
  );
  Object.assign(historicalWater, {
    location: "Victoria Park Swimming Pool",
    mapsQuery: "Victoria Park Swimming Pool, Hong Kong",
    photo: "../assets/itc/main.webp",
  });
  localStorage.setItem("itc.prototype.v1", JSON.stringify(historicalSwimmingV13));
  const repaired = store.load();
  assert.equal(repaired.version, 30, "the historical Swimming fixture must reach v27");
  assert.deepEqual(
    Object.fromEntries(["location", "mapsQuery", "photo"].map((field) => [
      field,
      repaired.activities.find((activity) => activity.id === "water")?.[field],
    ])),
    {
      location: "TBC",
      mapsQuery: "",
      photo: "../assets/itc/water.webp",
    },
    "v14 must repair exact historical Swimming defaults before v24",
  );

  const customizedSwimmingV13 = structuredClone(freshV27State);
  customizedSwimmingV13.version = 13;
  const customizedWater = customizedSwimmingV13.activities.find(
    (activity) => activity.id === "water"
  );
  Object.assign(customizedWater, {
    location: "Custom Pool",
    mapsQuery: "Custom Pool, Hong Kong",
    photo: "../assets/itc/custom-pool.webp",
  });
  localStorage.setItem("itc.prototype.v1", JSON.stringify(customizedSwimmingV13));
  const preserved = store.load();
  assert.equal(preserved.version, 30, "the customized Swimming fixture must reach v27");
  assert.deepEqual(
    Object.fromEntries(["location", "mapsQuery", "photo"].map((field) => [
      field,
      preserved.activities.find((activity) => activity.id === "water")?.[field],
    ])),
    {
      location: "Custom Pool",
      mapsQuery: "Custom Pool, Hong Kong",
      photo: "../assets/itc/custom-pool.webp",
    },
    "v14 must preserve Admin-customized Swimming values through v24",
  );
}
console.log("ok  v14 Swimming defaults repair and Admin customizations survive the v13-to-v27 chain");

// --- Generic Socials preview: rolling seven-day selector ---
store.resetLocalData();
installLocalFixtures();
store.signIn("admin@example.test");
{
  const todayHktISO = data.todayHktISO();
  const today = data.parseISO(todayHktISO);
  const datePlus = (days) => data.isoDate(data.addDays(today, days));
  assert.equal(datePlus(0), todayHktISO,
    "generic Social fixtures must use the HKT calendar date, not the host-local date");
  await store.createOneOffEvent({
    name: "Already Started Social",
    dateISO: datePlus(0),
    time: "00:00",
    durationMin: 90,
    location: "Central",
    mapsQuery: "Central, Hong Kong",
    category: "Socials",
    price: 0,
    capacity: 20,
  });
  const earliestSocial = await store.createOneOffEvent({
    name: "Community Breakfast",
    dateISO: datePlus(1),
    time: "08:00",
    durationMin: 90,
    location: "Central",
    mapsQuery: "Central, Hong Kong",
    category: "Socials",
    price: 0,
    capacity: 20,
  });
  await store.createOneOffEvent({
    name: "Community Dinner",
    dateISO: datePlus(2),
    time: "19:00",
    durationMin: 90,
    location: "Wan Chai",
    mapsQuery: "Wan Chai, Hong Kong",
    category: "Socials",
    price: 0,
    capacity: 20,
  });
  await store.createOneOffEvent({
    name: "Strength Workshop",
    dateISO: datePlus(1),
    time: "07:00",
    durationMin: 60,
    location: "Central",
    mapsQuery: "Central, Hong Kong",
    category: "Strength",
    price: 0,
    capacity: 20,
  });
  await store.createOneOffEvent({
    name: "Next Week Social",
    dateISO: datePlus(7),
    time: "08:00",
    durationMin: 90,
    location: "Central",
    mapsQuery: "Central, Hong Kong",
    category: "Socials",
    price: 0,
    capacity: 20,
  });
  const nextSocial = store.nextSocialSession();
  if (!nextSocial || nextSocial.id !== earliestSocial.id) {
    throw new Error("nextSocialSession should skip started socials and select the earliest rolling-window social");
  }
  console.log("ok  Socials selector skips started events and ignores later/non-Socials events");
}

// Isolate both rolling-window edges so an earlier fixture cannot make either
// assertion pass without evaluating the seven-day candidate itself.
{
  const RealDateForSocialBoundary = globalThis.Date;
  const fixedNow = "2026-08-05T02:00:00.000Z"; // 10:00 HKT
  globalThis.Date = class extends RealDateForSocialBoundary {
    constructor(...args) {
      super(...(args.length ? args : [fixedNow]));
    }
    static now() {
      return RealDateForSocialBoundary.parse(fixedNow);
    }
    static parse(value) {
      return RealDateForSocialBoundary.parse(value);
    }
    static UTC(...args) {
      return RealDateForSocialBoundary.UTC(...args);
    }
  };
  const resetWithoutSocials = () => {
    store.resetLocalData();
    installLocalFixtures();
    const boundaryState = JSON.parse(mem.get("itc.prototype.v1"));
    boundaryState.activities = boundaryState.activities
      .filter((activity) => activity.category !== "Socials");
    boundaryState.oneOffEvents = [];
    mem.set("itc.prototype.v1", JSON.stringify(boundaryState));
    store.load();
    store.signIn("admin@example.test");
  };
  try {
    resetWithoutSocials();
    const exactDaySeven = await store.createOneOffEvent({
      name: "Exact Day Seven Social",
      dateISO: "2026-08-12",
      time: "10:00",
      durationMin: 60,
      location: "Central",
      mapsQuery: "Central, Hong Kong",
      category: "Socials",
      price: 0,
      capacity: 20,
    });
    assert.equal(store.nextSocialSession()?.id, exactDaySeven.id,
      "a Social starting at the exact seven-day HKT instant must be included");

    resetWithoutSocials();
    await store.createOneOffEvent({
      name: "Beyond Day Seven Social",
      dateISO: "2026-08-12",
      time: "10:01",
      durationMin: 60,
      location: "Central",
      mapsQuery: "Central, Hong Kong",
      category: "Socials",
      price: 0,
      capacity: 20,
    });
    assert.equal(store.nextSocialSession(), null,
      "a Social starting beyond the seven-day HKT instant must be excluded");
    console.log("ok  Socials selector isolates exact and beyond-seven HKT boundaries");
  } finally {
    globalThis.Date = RealDateForSocialBoundary;
  }
}
store.resetLocalData();
installLocalFixtures();
{
  const fallbackState = JSON.parse(mem.get("itc.prototype.v1"));
  fallbackState.activities = fallbackState.activities.filter((activity) => activity.category !== "Socials");
  fallbackState.oneOffEvents = [];
  mem.set("itc.prototype.v1", JSON.stringify(fallbackState));
  store.load();
  const fallbackCommunity = await views.viewCommunity();
  if (store.nextSocialSession() !== null || !fallbackCommunity.includes('href="#/schedule"')) {
    throw new Error("Community Pulse should fall back to Schedule when no Socials event starts within seven days");
  }
  console.log("ok  Community Socials preview falls back to Schedule when no event is available");
}
store.resetLocalData();
installLocalFixtures();

// --- One-off events (local mode) ---
store.resetLocalData();
installLocalFixtures();
store.signIn("member@example.test");
try {
  await store.createOneOffEvent({ name: "Nope", dateISO: "2026-09-05", time: "10:00", durationMin: 60, location: "Somewhere" });
  throw new Error("members must not create one-off events");
} catch (err) {
  if (!/admin/i.test(err.message)) throw new Error(`expected admin guard, got: ${err.message}`);
}
store.signIn("admin@example.test");
{
  const oneOffDate = (daysAhead) => data.isoDate(data.addDays(data.parseISO(data.todayHktISO()), daysAhead));
  const paidEvent = await store.createOneOffEvent({
    name: "HYROX Race Day Send-off", dateISO: oneOffDate(1), time: "10:00",
    durationMin: 90, location: "Kai Tak", mapsQuery: "", category: "HYROX",
    price: 250, capacity: 12,
  });
  if (!paidEvent.oneOff || paidEvent.kind !== "paid" || !paidEvent.id.startsWith("event-"))
    throw new Error("paid one-off event should be flagged, priced and event-prefixed");
  if (!store.upcomingSessions(30).some((s) => s.id === paidEvent.id))
    throw new Error("one-off event should appear in upcoming sessions");
  if (!store.getSession(paidEvent.id)) throw new Error("getSession must resolve one-off events");
  const eventHtml = views.viewActivity(paidEvent.id);
  if (!eventHtml.includes("Book & pay") || !eventHtml.includes("HK$250"))
    throw new Error("paid one-off activity page should offer booking");
  const freeEvent = await store.createOneOffEvent({
    name: "Community Picnic", dateISO: oneOffDate(2), time: "15:00",
    durationMin: 120, location: "Tamar Park", category: "Other",
  });
  assert.deepEqual({
    kind: freeEvent.kind,
    requiresRsvp: freeEvent.requiresRsvp,
    capacity: freeEvent.capacity,
  }, {
    kind: "free",
    requiresRsvp: true,
    capacity: null,
  }, "local zero-price one-offs must remain uncapped free RSVP sessions");
  const freeEventHtml = views.viewActivity(freeEvent.id);
  if (!freeEventHtml.includes("Free · No booking needed"))
    throw new Error("free one-off should render the free banner");
  const freeCancelledEvent = await store.createOneOffEvent({
    name: "Cancelled Community Social", dateISO: oneOffDate(3), time: "15:00",
    durationMin: 90, location: "Tamar Park", category: "Socials",
  });
  store.cancelSessionWeek(freeCancelledEvent.id, "Weather warning");
  const freeCancellationHtml = views.viewActivity(freeCancelledEvent.id);
  if (!freeCancellationHtml.includes("Stay tuned for the next available social.")
      || freeCancellationHtml.includes("Paid bookings were moved to the next available session — check your account."))
    throw new Error("free cancellation Activity Details must render the exact social follow-up copy");
  const adminActivitiesHtml = await views.viewAdmin("activities");
  const freeOneOffCard = adminActivitiesHtml.slice(
    adminActivitiesHtml.lastIndexOf('<div class="card mt16', adminActivitiesHtml.indexOf(freeEvent.name)),
    adminActivitiesHtml.indexOf('</div></div>', adminActivitiesHtml.indexOf(freeEvent.name)) + 12,
  );
  assert.match(freeOneOffCard, /0 going/,
    "an active zero-price one-off Admin card must display its RSVP count");
  assert.match(freeOneOffCard, new RegExp(`id="form-cancel-week"[^>]*data-session="${freeEvent.id}"`),
    "an active zero-price one-off Admin card must expose per-occurrence cancellation");
  const cancelledOneOffCard = adminActivitiesHtml.slice(
    adminActivitiesHtml.lastIndexOf('<div class="card mt16', adminActivitiesHtml.indexOf(freeCancelledEvent.name)),
    adminActivitiesHtml.indexOf('</div></div>', adminActivitiesHtml.indexOf(freeCancelledEvent.name)) + 12,
  );
  assert.match(cancelledOneOffCard, /Session cancelled by ITC — Weather warning/);
  assert.match(cancelledOneOffCard,
    new RegExp(`data-action="repost-rsvp"[^>]*data-session="${freeCancelledEvent.id}"[^>]*>Reopen event<`),
    "a cancelled future zero-price one-off must expose Reopen event");
  if (!adminActivitiesHtml.includes("One-off Events")
      || !adminActivitiesHtml.includes("form-one-off-event")
      || !adminActivitiesHtml.includes("HYROX Race Day Send-off"))
    throw new Error("Activities tab should list one-off events and the add form");
  const weeklyStart = adminActivitiesHtml.indexOf(">Weekly Event Controls<");
  const oneOffStart = adminActivitiesHtml.indexOf(">One-off Events<");
  const weeklyRegion = weeklyStart === -1 || oneOffStart === -1
    ? ""
    : adminActivitiesHtml.slice(weeklyStart, oneOffStart);
  const oneOffRegion = oneOffStart === -1 ? "" : adminActivitiesHtml.slice(oneOffStart);
  for (const event of [paidEvent, freeEvent]) {
    if (weeklyRegion.includes(event.name) || weeklyRegion.includes(event.id))
      throw new Error(`${event.name} must not receive recurring controls`);
    if (!oneOffRegion.includes(event.name) || !oneOffRegion.includes(event.id))
      throw new Error(`${event.name} must appear only in One-off Events`);
  }
  // Deletion is refused once a booking exists; cancellation still works and
  // voids the booking (no same-activity follow-up session to defer to).
  store.signIn("member@example.test");
  const oneOffBooking = store.reserveSession("fixture-member", paidEvent.id);
  store.signIn("admin@example.test");
  try {
    await store.deleteOneOffEvent(paidEvent.id);
    throw new Error("delete must refuse events with active bookings");
  } catch (err) {
    if (!/cancel the session instead/.test(err.message)) throw err;
  }
  await store.deleteOneOffEvent(freeEvent.id);
  if (store.getSession(freeEvent.id)) throw new Error("deleted free event should be gone");
  store.cancelSessionWeek(paidEvent.id, "Venue unavailable");
  if (store.getBooking(oneOffBooking.id).status !== "cancelled")
    throw new Error("cancelling a one-off should void its reservations");
  if (store.getSession(paidEvent.id)?.cancelled !== true)
    throw new Error("cancelled one-off should read as cancelled");
  console.log("ok  one-off events: create, list, book, delete guard, cancel");
}

// --- Free-event RSVP contract and local cancellation parity ---
store.resetLocalData();
installLocalFixtures();
{
  const member = store.allUsers().find((user) => user.id === "fixture-member");
  const freeSession = store.upcomingSessions(14).find(
    (session) => session.kind === "free" && !data.sessionStarted(session)
  );
  assert.ok(freeSession, "free RSVP contract needs an upcoming free session");
  assert.equal(store.sessionRequiresRsvp(freeSession), true);
  const freeRsvpAction = /data-action="rsvp-(?:join|withdraw)"/;
  store.signIn("member@example.test");
  const freeMemberHtml = views.viewActivity(freeSession.id);
  assert.match(freeMemberHtml, /badge free">Free/);
  assert.match(freeMemberHtml, /Free · No booking needed/);
  assert.match(freeMemberHtml, /RSVP helps the team plan; walk-ins are welcome/);
  assert.match(freeMemberHtml, /data-action="rsvp-join"[^>]*>I’m coming</);
  assert.doesNotMatch(freeMemberHtml, /Book &amp; pay|Book & pay|checkout|spots? left|capacity/i);

  const withdrawn = await store.rsvpSession(member.id, freeSession);
  assert.equal(withdrawn.status, "confirmed");
  const freeGoingHtml = views.viewActivity(freeSession.id);
  assert.match(freeGoingHtml, /You’re going/);
  assert.match(freeGoingHtml, /data-action="rsvp-withdraw"[^>]*>Can’t make it</);
  assert.match(freeGoingHtml, /Who’s coming/);
  assert.match(freeGoingHtml, /Tester M\./);
  assert.match(freeGoingHtml, /attendee-avatar/);
  const freeBookingHtml = views.viewBooking(withdrawn.id);
  assert.match(freeBookingHtml, /You’re going/);
  assert.doesNotMatch(freeBookingHtml, /payment|pay your own bill|View receipt|>Receipt<|checkout|capacity|waitlist/i);
  const freeAccountHtml = await views.viewAccount("bookings");
  assert.match(freeAccountHtml, /· RSVP/);
  assert.doesNotMatch(freeAccountHtml, /paid HK\$0|HK\$0 to be paid/i);
  assert.equal(withdrawn.snapshot.price, 0);
  assert.equal(store.attendeeCountFor(freeSession), 1);
  await store.withdrawRsvp(withdrawn.id);
  assert.doesNotMatch(await views.viewAccount("bookings"), new RegExp(`#/booking/${withdrawn.id}`),
    "withdrawn free RSVPs must not remain in member booking history");
  assert.equal(store.getBooking(withdrawn.id).cancelledSource, "member");
  assert.equal(typeof store.getBooking(withdrawn.id).cancelledAt, "number");

  const active = await store.rsvpSession(member.id, freeSession, withdrawn.createdAt + 1000);
  const nextOccurrence = store.upcomingSessions(28).find(
    (session) => session.activityId === freeSession.activityId && session.id !== freeSession.id
  );
  assert.ok(nextOccurrence, "free cancellation contract needs a later occurrence");
  const bookingCountBeforeCancellation = store.bookingsForUser(member.id).length;
  const cancellationTime = active.createdAt + 1000;
  store.signIn("admin@example.test");
  const activeAdminHtml = await views.viewAdmin("activities");
  const activeCardMarker = activeAdminHtml.indexOf(`data-session="${freeSession.id}"`);
  const activeCardStart = activeAdminHtml.lastIndexOf('<div class="card mt16', activeCardMarker);
  const activeCard = activeAdminHtml.slice(activeCardStart,
    activeAdminHtml.indexOf('</div></div>', activeCardStart) + 12);
  assert.match(activeCard, /1 going/,
    "every upcoming RSVP-enabled free Admin card must display its attendee count");
  assert.match(activeCard,
    new RegExp(`id="form-cancel-week"[^>]*data-session="${freeSession.id}"`),
    "every upcoming RSVP-enabled free Admin card must expose cancellation");
  assert.throws(
    () => store.cancelSessionWeek(freeSession.id, "   \t  ", cancellationTime),
    /reason.*required/i,
    "free-event cancellation must reject a whitespace-only reason"
  );
  assert.equal(store.getSession(freeSession.id).cancelled, undefined,
    "invalid cancellation must not mutate the session override");
  assert.equal(store.getBooking(active.id).status, "confirmed",
    "invalid cancellation must not cancel active RSVPs");
  store.cancelSessionWeek(freeSession.id, "Weather warning", cancellationTime);
  assert.doesNotMatch(views.viewActivity(freeSession.id), freeRsvpAction,
    "cancelled free occurrences must not offer RSVP actions");
  const cancelled = store.getBooking(active.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancelledAt, cancellationTime);
  assert.equal(cancelled.cancelledSource, "session");
  assert.equal(store.bookingsForUser(member.id).length, bookingCountBeforeCancellation,
    "free cancellation must not create a deferred future booking");
  assert.equal(store.getSession(freeSession.id).cancelled, true);
  assert.equal(store.getSession(nextOccurrence.id).cancelled, undefined,
    "free cancellation must affect only the selected occurrence");
  const cancelledAdminHtml = await views.viewAdmin("activities");
  const cancelledCardMarker = cancelledAdminHtml.indexOf(`data-session="${freeSession.id}"`);
  const cancelledCardStart = cancelledAdminHtml.lastIndexOf(
    '<div class="card mt16', cancelledCardMarker
  );
  const cancelledCard = cancelledAdminHtml.slice(cancelledCardStart,
    cancelledAdminHtml.indexOf('</div></div>', cancelledCardStart) + 12);
  assert.match(cancelledCard, /Session cancelled by ITC — Weather warning/,
    "Admin must retain the cancellation state and reason on the selected occurrence");
  assert.match(cancelledCard,
    new RegExp(`data-action="repost-rsvp"[^>]*data-session="${freeSession.id}"[^>]*>Reopen event<`),
    "a cancelled future RSVP-enabled free occurrence must expose Reopen event");
  assert.doesNotMatch(cancelledCard,
    new RegExp(`id="form-cancel-week"[^>]*data-session="${freeSession.id}"`),
    "a cancelled free occurrence must not offer a second cancellation form");
  assert.throws(
    () => store.cancelSessionWeek(freeSession.id, "Duplicate warning", cancellationTime + 1),
    /already cancelled/i,
    "duplicate free-event cancellation must preserve the original cancellation cohort"
  );
  assert.equal(store.notificationsFor(member.id).filter(
    (notification) => notification.kind === "session-cancelled"
      && notification.link === `#/activity/${freeSession.id}`
  ).length, 1, "only the active attendee should receive one cancellation notification");

  await store.repostRsvpEvent(freeSession.id);
  assert.equal(store.getSession(freeSession.id).cancelled, undefined);
  assert.equal(store.getBooking(active.id).status, "cancelled",
    "reopening must leave the old RSVP inactive");
  assert.equal(store.notificationsFor(member.id).filter(
    (notification) => notification.kind === "session-reopened"
      && notification.link === `#/activity/${freeSession.id}`
  ).length, 1, "only session-cancelled attendees should receive one reopening notification");
  store.signIn("member@example.test");
  const freshRsvp = await store.rsvpSession(member.id, freeSession, cancellationTime + 1000);
  assert.equal(freshRsvp.status, "confirmed");
  assert.notEqual(freshRsvp.id, active.id);
  assert.equal(store.attendeeCountFor(freeSession), 1);
  const freeRosterHtml = views.viewActivity(freeSession.id);
  assert.match(freeRosterHtml, /Who’s coming/);
  assert.match(freeRosterHtml, /Tester M\./);
  store.signOut();
  const visitorFreeHtml = views.viewActivity(freeSession.id);
  assert.doesNotMatch(visitorFreeHtml, freeRsvpAction);
  assert.doesNotMatch(visitorFreeHtml, /Tester M\.|attendee-avatar/);
  store.signIn("member@example.test");
  const startedDate = data.addDays(freeSession.date, -7);
  const startedFreeId = `${freeSession.activityId}-${data.isoDate(startedDate)}`;
  assert.doesNotMatch(views.viewActivity(startedFreeId), freeRsvpAction,
    "started free occurrences must not offer RSVP actions");
  store.signIn("admin@example.test");
  assert.throws(
    () => store.cancelSessionWeek(startedFreeId, "Historical cancellation", cancellationTime + 2000),
    /already started/i,
    "post-start free-event cancellation must fail closed"
  );
  assert.equal(store.getSession(startedFreeId).cancelled, undefined,
    "rejected historical cancellation must not create an override");
  console.log("ok  free-event RSVP controls, roster privacy, withdrawal, cancellation and reopening preserve local parity");
}

// Direct or stale local RSVP withdrawals must use the supplied clock against
// the occurrence's Hong Kong start instant and fail closed when its session
// can no longer be resolved.
for (const boundary of [
  { label: "before", offsetMs: -1, rejected: false },
  { label: "at", offsetMs: 0, rejected: true },
  { label: "after", offsetMs: 1, rejected: true },
]) {
  store.resetLocalData();
  installLocalFixtures();
  store.signIn("member@example.test");
  const session = store.upcomingSessions(21).find(
    (item) => item.activityId === "wnt" && !data.sessionStarted(item)
  );
  assert.ok(session, `${boundary.label}-start withdrawal needs an upcoming free RSVP occurrence`);
  const startsAt = data.hktEventStartMs(session.dateISO, session.time);
  const booking = await store.rsvpSession("fixture-member", session.id, startsAt - 1000);
  if (boundary.rejected) {
    await assert.rejects(
      () => store.withdrawRsvp(booking.id, startsAt + boundary.offsetMs),
      /already started/i,
      `withdrawal ${boundary.label} Hong Kong start must fail closed`
    );
    assert.equal(store.getBooking(booking.id).status, "confirmed",
      `rejected ${boundary.label}-start withdrawal must not mutate the booking`);
  } else {
    const withdrawn = await store.withdrawRsvp(booking.id, startsAt + boundary.offsetMs);
    assert.equal(withdrawn.status, "cancelled",
      "withdrawal immediately before Hong Kong start must remain allowed");
  }
}
{
  store.resetLocalData();
  installLocalFixtures();
  store.signIn("member@example.test");
  const session = store.upcomingSessions(21).find(
    (item) => item.activityId === "wnt" && !data.sessionStarted(item)
  );
  assert.ok(session, "missing-session withdrawal needs an upcoming free RSVP occurrence");
  const booking = await store.rsvpSession("fixture-member", session.id);
  const corrupted = JSON.parse(mem.get("itc.prototype.v1"));
  corrupted.bookings.find((item) => item.id === booking.id).sessionId = "missing-session-2099-01-01";
  mem.set("itc.prototype.v1", JSON.stringify(corrupted));
  store.load();
  await assert.rejects(
    () => store.withdrawRsvp(booking.id),
    /session not found/i,
    "withdrawal must fail closed when the booking session is missing"
  );
  assert.equal(store.getBooking(booking.id).status, "confirmed",
    "missing-session withdrawal must not mutate the booking");
}
console.log("ok  local RSVP withdrawal enforces missing-session and HKT start boundaries");

// Direct or stale local Admin cancellation must resolve the occurrence before
// creating an override and enforce the same exact HKT start boundary.
{
  store.resetLocalData();
  installLocalFixtures();
  store.signIn("admin@example.test");
  const before = JSON.parse(mem.get("itc.prototype.v1")).sessionOverrides;
  assert.throws(
    () => store.cancelSessionWeek("missing-session-2099-01-01", "Weather warning"),
    /session not found/i,
    "unknown local cancellation must fail closed"
  );
  assert.deepEqual(JSON.parse(mem.get("itc.prototype.v1")).sessionOverrides, before,
    "unknown local cancellation must not create a ghost override");
}
for (const boundary of [
  { label: "before", offsetMs: -1, rejected: false },
  { label: "at", offsetMs: 0, rejected: true },
  { label: "after", offsetMs: 1, rejected: true },
]) {
  store.resetLocalData();
  installLocalFixtures();
  store.signIn("member@example.test");
  const session = store.upcomingSessions(21).find(
    (item) => item.activityId === "wnt" && !data.sessionStarted(item)
  );
  assert.ok(session, `${boundary.label}-start cancellation needs an upcoming free RSVP occurrence`);
  const startsAt = data.hktEventStartMs(session.dateISO, session.time);
  const booking = await store.rsvpSession("fixture-member", session.id, startsAt - 1000);
  store.signIn("admin@example.test");
  if (boundary.rejected) {
    assert.throws(
      () => store.cancelSessionWeek(session.id, "Weather warning", startsAt + boundary.offsetMs),
      /already started/i,
      `cancellation ${boundary.label} Hong Kong start must fail closed`
    );
    assert.equal(store.getSession(session.id).cancelled, undefined,
      `rejected ${boundary.label}-start cancellation must not create an override`);
    assert.equal(store.getBooking(booking.id).status, "confirmed",
      `rejected ${boundary.label}-start cancellation must not mutate active RSVPs`);
    assert.equal(store.notificationsFor("fixture-member").filter(
      (notification) => notification.kind === "session-cancelled"
        && notification.link === `#/activity/${session.id}`
    ).length, 0, `rejected ${boundary.label}-start cancellation must not notify attendees`);
  } else {
    store.cancelSessionWeek(session.id, "Weather warning", startsAt + boundary.offsetMs);
    assert.equal(store.getSession(session.id).cancelled, true,
      "cancellation immediately before Hong Kong start must remain allowed");
    assert.equal(store.getBooking(booking.id).status, "cancelled");
  }
}

// RSVP capability only permits an explicit finite numeric zero. Persisted
// null/empty prices must not be coerced into the free cancellation path.
for (const malformedPrice of [null, ""]) {
  store.resetLocalData();
  installLocalFixtures();
  store.signIn("admin@example.test");
  const session = await store.createOneOffEvent({
    name: "Malformed price RSVP",
    dateISO: data.isoDate(data.addDays(data.parseISO(data.todayHktISO()), 10)),
    time: "18:00",
    durationMin: 60,
    location: "TBC",
    category: "Other",
    price: 180,
    capacity: 20,
  });
  store.signIn("member@example.test");
  store.reserveSession("fixture-member", session.id);
  const corrupted = JSON.parse(mem.get("itc.prototype.v1"));
  const corruptedEvent = corrupted.oneOffEvents.find((event) => event.id === session.activityId);
  corruptedEvent.requiresRsvp = true;
  corruptedEvent.price = malformedPrice;
  mem.set("itc.prototype.v1", JSON.stringify(corrupted));
  store.load();
  store.signIn("admin@example.test");
  const before = JSON.parse(mem.get("itc.prototype.v1"));
  assert.throws(
    () => store.cancelSessionWeek(session.id, "Weather warning"),
    /RSVP.*price|price.*RSVP/i,
    `RSVP cancellation must reject malformed ${malformedPrice === null ? "null" : "empty"} price`
  );
  const after = JSON.parse(mem.get("itc.prototype.v1"));
  assert.deepEqual(after.sessionOverrides, before.sessionOverrides,
    "malformed RSVP price must not create an override");
  assert.deepEqual(after.bookings, before.bookings,
    "malformed RSVP price must not mutate bookings");
  assert.deepEqual(after.notifications, before.notifications,
    "malformed RSVP price must not create notifications");
}
console.log("ok  local RSVP cancellation rejects unknown, malformed-price, and started occurrences without mutation");

// Persisted prototype state can predate uniqueness guarantees. Cancellation
// repairs every duplicate active row while notifying each profile only once.
{
  store.resetLocalData();
  installLocalFixtures();
  store.signIn("member@example.test");
  const session = store.upcomingSessions(21).find(
    (item) => item.activityId === "wnt" && !data.sessionStarted(item)
  );
  assert.ok(session, "duplicate-RSVP cancellation needs an upcoming free occurrence");
  const booking = await store.rsvpSession("fixture-member", session.id);
  const corrupted = JSON.parse(mem.get("itc.prototype.v1"));
  const persistedBooking = corrupted.bookings.find((item) => item.id === booking.id);
  corrupted.bookings.push({ ...persistedBooking, id: "duplicate-active-rsvp" });
  mem.set("itc.prototype.v1", JSON.stringify(corrupted));
  store.load();
  store.signIn("admin@example.test");
  store.cancelSessionWeek(session.id, "Weather warning");
  assert.deepEqual(
    [booking.id, "duplicate-active-rsvp"].map((id) => store.getBooking(id).status),
    ["cancelled", "cancelled"],
    "cancellation must update every duplicate active RSVP row"
  );
  assert.equal(store.notificationsFor("fixture-member").filter(
    (notification) => notification.kind === "session-cancelled"
      && notification.link === `#/activity/${session.id}`
  ).length, 1, "duplicate active RSVP rows must emit one cancellation notification per profile");
}
console.log("ok  local RSVP cancellation deduplicates corrupted active booking recipients");

// After reopening and a fresh RSVP, notification copy must come from the
// current active row rather than an older cancelled row for the same member.
{
  store.resetLocalData();
  installLocalFixtures();
  store.signIn("member@example.test");
  const session = store.upcomingSessions(21).find(
    (item) => item.activityId === "wnt" && !data.sessionStarted(item)
  );
  assert.ok(session, "active-snapshot cancellation needs an upcoming free RSVP occurrence");
  const startsAt = data.hktEventStartMs(session.dateISO, session.time);
  const older = await store.rsvpSession("fixture-member", session.id, startsAt - 5000);
  store.signIn("admin@example.test");
  store.cancelSessionWeek(session.id, "First warning", startsAt - 4000);
  await store.repostRsvpEvent(session.id);
  store.signIn("member@example.test");
  const current = await store.rsvpSession("fixture-member", session.id, startsAt - 3000);
  const persisted = JSON.parse(mem.get("itc.prototype.v1"));
  persisted.bookings.find((booking) => booking.id === older.id).snapshot.name = "Older cancelled copy";
  persisted.bookings.find((booking) => booking.id === current.id).snapshot.name = "Current active copy";
  persisted.notifications = [];
  mem.set("itc.prototype.v1", JSON.stringify(persisted));
  store.load();
  store.signIn("admin@example.test");
  store.cancelSessionWeek(session.id, "Second warning", startsAt - 2000);
  const notifications = store.notificationsFor("fixture-member").filter(
    (notification) => notification.kind === "session-cancelled"
      && notification.link === `#/activity/${session.id}`
  );
  assert.equal(notifications.length, 1,
    "re-RSVP cancellation must notify the eligible member exactly once");
  assert.match(notifications[0].body, /Current active copy/,
    "cancellation copy must use the current active RSVP snapshot");
  assert.doesNotMatch(notifications[0].body, /Older cancelled copy/,
    "cancellation copy must not use an older cancelled RSVP snapshot");
}
console.log("ok  local RSVP cancellation snapshots active rows before deduplicated fan-out");

// Event-change and cancellation fan-out follows the occurrence's active RSVP
// cohort, not the member directory. A later role downgrade also closes the
// notification channel without preventing the booking audit row being updated.
store.resetLocalData();
installLocalFixtures();
{
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.users.push(
    {
      id: "rsvp-withdrawn", role: "member", status: "approved", fullName: "Withdrawn Member",
      preferredName: "Withdrawn", email: "withdrawn-rsvp@example.test",
      indemnityAcceptedAt: Date.now(), privacyAcceptedAt: Date.now(),
    },
    {
      id: "rsvp-unrelated", role: "member", status: "approved", fullName: "Unrelated Member",
      preferredName: "Unrelated", email: "unrelated-rsvp@example.test",
      indemnityAcceptedAt: Date.now(), privacyAcceptedAt: Date.now(),
    },
    {
      id: "rsvp-pending", role: "member", status: "approved", fullName: "Pending Later",
      preferredName: "Pending", email: "pending-rsvp@example.test",
      indemnityAcceptedAt: Date.now(), privacyAcceptedAt: Date.now(),
    },
    {
      id: "rsvp-declined", role: "member", status: "approved", fullName: "Declined Later",
      preferredName: "Declined", email: "declined-rsvp@example.test",
      indemnityAcceptedAt: Date.now(), privacyAcceptedAt: Date.now(),
    },
  );
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
  const session = store.upcomingSessions(21).find(
    (item) => item.activityId === "wnt" && !data.sessionStarted(item)
  );
  assert.ok(session, "targeted notification test needs an upcoming free RSVP occurrence");

  for (const [email, userId] of [
    ["member@example.test", "fixture-member"],
    ["withdrawn-rsvp@example.test", "rsvp-withdrawn"],
    ["pending-rsvp@example.test", "rsvp-pending"],
    ["declined-rsvp@example.test", "rsvp-declined"],
  ]) {
    store.signIn(email);
    const booking = await store.rsvpSession(userId, session.id);
    if (userId === "rsvp-withdrawn") await store.withdrawRsvp(booking.id);
  }

  const downgraded = JSON.parse(mem.get("itc.prototype.v1"));
  Object.assign(downgraded.users.find((user) => user.id === "rsvp-pending"), {
    role: "pending", status: "pending",
  });
  Object.assign(downgraded.users.find((user) => user.id === "rsvp-declined"), {
    role: "pending", status: "declined",
  });
  mem.set("itc.prototype.v1", JSON.stringify(downgraded));
  store.load();
  store.signIn("admin@example.test");

  const linkedNotes = (userId, kind) => store.notificationsFor(userId).filter(
    (notification) => notification.kind === kind
      && notification.link === `#/activity/${session.id}`
  );
  store.setWeekVenue(session.id, {
    location: "Central Harbourfront", mapsQuery: "Central Harbourfront, Hong Kong",
  });
  store.setWeekVenue(session.id, {
    location: "Central Harbourfront", mapsQuery: "Central Harbourfront, Hong Kong",
  });
  store.setSessionTime(session.id, "20:15");
  store.setSessionTime(session.id, "20:15");

  assert.equal(linkedNotes("fixture-member", "operational_session_venue_updated").length, 1,
    "one effective venue change must shared-notify each approved member exactly once");
  assert.equal(linkedNotes("fixture-member", "operational_session_time_updated").length, 1,
    "one effective time change must notify an active confirmed RSVP exactly once");
  for (const userId of ["rsvp-withdrawn", "rsvp-unrelated"]) {
    assert.equal(linkedNotes(userId, "operational_session_venue_updated").length, 1,
      `${userId} must receive the shared venue change as an approved member`);
  }
  for (const userId of ["rsvp-withdrawn", "rsvp-unrelated", "rsvp-pending", "rsvp-declined"]) {
    assert.equal(linkedNotes(userId, "operational_session_time_updated").length, 0,
      `${userId} must not receive the RSVP time change`);
  }
  for (const userId of ["rsvp-pending", "rsvp-declined"]) {
    assert.equal(linkedNotes(userId, "operational_session_venue_updated").length, 0,
      `${userId} must not receive the shared venue change`);
  }

  store.cancelSessionWeek(session.id, "Lightning warning", Date.now());
  assert.equal(linkedNotes("fixture-member", "session-cancelled").length, 1);
  for (const userId of ["rsvp-withdrawn", "rsvp-unrelated", "rsvp-pending", "rsvp-declined"]) {
    assert.equal(linkedNotes(userId, "session-cancelled").length, 0,
      `${userId} must not receive the RSVP cancellation`);
  }
  await store.repostRsvpEvent(session.id);
  assert.equal(linkedNotes("fixture-member", "session-reopened").length, 1);
  for (const userId of ["rsvp-withdrawn", "rsvp-unrelated", "rsvp-pending", "rsvp-declined"]) {
    assert.equal(linkedNotes(userId, "session-reopened").length, 0,
      `${userId} must not receive the RSVP reopening`);
  }
  const anonymousLinked = JSON.parse(mem.get("itc.prototype.v1")).notifications.filter(
    (notification) => !notification.userId && notification.link === `#/activity/${session.id}`
  );
  assert.equal(anonymousLinked.length, 0, "visitors must never receive in-app occurrence notifications");
  console.log("ok  local RSVP notifications target only the active or cancellation cohort exactly once");
}

// --- RSVP events (local): the recurring post-training lunch ---
store.resetLocalData();
installLocalFixtures();
{
  const lunch = store.upcomingSessions(21).find(
    (s) => s.kind === "rsvp" && !data.sessionStarted(s)
  );
  if (!lunch || lunch.category !== "Socials" || lunch.name !== "Post-Training Lunch")
    throw new Error("local seeds must include the recurring RSVP lunch");
  if (lunch.capacity !== null || store.spotsLeft(lunch) !== null)
    throw new Error("the lunch is uncapped — capacity and spots must be null");
  store.signIn("member@example.test");
  const lunchHtml = views.viewActivity(lunch.id);
  if (!lunchHtml.includes("Count me in") || lunchHtml.includes("Book & pay"))
    throw new Error("RSVP activity should offer Count me in, not checkout");
  const rsvp = await store.rsvpSession("fixture-member", lunch.id);
  if (rsvp.status !== "confirmed" || rsvp.snapshot.price !== 0)
    throw new Error("RSVP should confirm instantly with no payment");
  assert.equal(store.attendeeCountFor(lunch), 1,
    "local RSVP count must include the confirmed booking");
  assert.deepEqual(store.attendeesFor(lunch), ["Tester M."],
    "attendeesFor must preserve attendee name formatting independently of counts");
  const goingHtml = views.viewActivity(lunch.id);
  if (!goingHtml.includes("You're going") || !goingHtml.includes("rsvp-withdraw"))
    throw new Error("RSVP'd member should see the Going state and a withdraw action");
  assert.match(goingHtml, /Who’s coming/);
  assert.match(goingHtml, /Tester M\./);
  store.signOut();
  const visitorLunchHtml = views.viewActivity(lunch.id);
  assert.match(visitorLunchHtml, /Member-only: the attendee list is visible after approval/);
  assert.doesNotMatch(visitorLunchHtml, /Tester M\./);
  store.signIn("member@example.test");
  const bookingPage = views.viewBooking(rsvp.id);
  if (!bookingPage.includes("You’re going") || bookingPage.includes("Can’t make it? Defer")
      || bookingPage.includes("View receipt"))
    throw new Error("RSVP booking page must not offer payment deferral or receipts");
  const checkout = views.viewCheckout(lunch.id);
  if (typeof checkout !== "string" || !checkout.includes("doesn’t exist"))
    throw new Error("RSVP sessions must not render checkout");

  // The exact RSVP notification route, Sunday-first Schedule row, Activity
  // Details banner, and dated card inside grouped Admin controls must agree on
  // the same literal count. Each surface is isolated to this lunch/session ID.
  const rsvpDestination = `#/activity/${lunch.id}`;
  const previousRsvpNotificationFilter = views.notificationFilters.kind;
  let rsvpInboxHtml;
  try {
    views.notificationFilters.kind = "all";
    rsvpInboxHtml = await views.viewNotifications(new Date(), [{
      id: "combined-rsvp-route",
      kind: "operational_rsvp_confirmed",
      title: "RSVP confirmed",
      body: "You are counted in.",
      destination: rsvpDestination,
      read_at: null,
      created_at: "2026-08-05T02:00:00.000Z",
    }]);
  } finally {
    views.notificationFilters.kind = previousRsvpNotificationFilter;
  }
  const rsvpNotificationControl = [...rsvpInboxHtml.matchAll(
    /<button class="notification-row[\s\S]*?<\/button>/g
  )].map((match) => match[0]).find(
    (tag) => tag.includes('data-notification-id="combined-rsvp-route"')
  ) || "";
  if (!rsvpNotificationControl.includes(`data-destination="${rsvpDestination}"`)
      || data.notificationDestination("operational_rsvp_confirmed", rsvpDestination)
        !== rsvpDestination) {
    throw new Error("RSVP notification must render and resolve the exact dated Activity destination");
  }

  const priorCombinedSchedule = { ...views.scheduleState };
  let combinedRsvpScheduleHtml;
  try {
    views.scheduleState.weekOffset = Math.round(
      (data.sundayOf(data.parseISO(lunch.dateISO)) - data.sundayOf(data.todayLocal()))
        / (7 * 86400000)
    );
    views.scheduleState.selected = lunch.dateISO;
    combinedRsvpScheduleHtml = views.viewSchedule();
  } finally {
    Object.assign(views.scheduleState, priorCombinedSchedule);
  }
  const combinedScheduleRowStart = combinedRsvpScheduleHtml.indexOf(
    `href="${rsvpDestination}"`
  );
  const combinedScheduleRowEnd = combinedRsvpScheduleHtml.indexOf(
    "</a>", combinedScheduleRowStart
  );
  const combinedScheduleRow = combinedScheduleRowStart < 0 || combinedScheduleRowEnd < 0
    ? ""
    : combinedRsvpScheduleHtml.slice(combinedScheduleRowStart, combinedScheduleRowEnd);
  if (!combinedScheduleRow.includes('<span class="badge free booked">Going</span>')
      || !combinedScheduleRow.includes('<span class="spots">1 going</span>')) {
    throw new Error("dated Sunday Schedule RSVP row must render the exact confirmed count of 1");
  }
  const combinedScheduleLabels = [...combinedRsvpScheduleHtml.matchAll(
    /data-date="[^"]+">\s*([A-Z][a-z]{2})<strong/g
  )].map((match) => match[1]);
  if (JSON.stringify(combinedScheduleLabels)
      !== JSON.stringify(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])) {
    throw new Error(`combined RSVP Schedule must remain Sunday-first; got ${combinedScheduleLabels.join(" ")}`);
  }
  const combinedActivityHtml = views.viewActivity(lunch.id);
  if (!combinedActivityHtml.includes("1 going — see you there.")) {
    throw new Error("exact RSVP Activity Details must render the confirmed count of 1");
  }

  let combinedAdminHtml;
  try {
    store.signIn("admin@example.test");
    combinedAdminHtml = await views.viewAdmin("activities");
  } finally {
    store.signIn("member@example.test");
  }
  const combinedWeeklyStart = combinedAdminHtml.indexOf(">Weekly Event Controls<");
  const combinedOneOffStart = combinedAdminHtml.indexOf(">One-off Events<", combinedWeeklyStart);
  const combinedWeeklyHtml = combinedWeeklyStart < 0 || combinedOneOffStart < 0
    ? ""
    : combinedAdminHtml.slice(combinedWeeklyStart, combinedOneOffStart);
  const combinedFreeStart = combinedWeeklyHtml.indexOf("Free &amp; RSVP Events");
  const combinedPaidStart = combinedWeeklyHtml.indexOf("Paid Sessions", combinedFreeStart);
  const combinedFreeRsvpHtml = combinedFreeStart < 0 || combinedPaidStart < 0
    ? ""
    : combinedWeeklyHtml.slice(combinedFreeStart, combinedPaidStart);
  const combinedLunchTarget = combinedFreeRsvpHtml.indexOf(`data-session="${lunch.id}"`);
  const combinedLunchCardStart = combinedFreeRsvpHtml.lastIndexOf(
    '<div class="card mt16 free-event-venue-card">', combinedLunchTarget
  );
  const combinedNextFreeCard = combinedFreeRsvpHtml.indexOf(
    '<div class="card mt16 free-event-venue-card">', combinedLunchTarget + 1
  );
  const combinedLunchCard = combinedLunchTarget < 0 || combinedLunchCardStart < 0
    ? ""
    : combinedFreeRsvpHtml.slice(
      combinedLunchCardStart,
      combinedNextFreeCard < 0 ? combinedFreeRsvpHtml.length : combinedNextFreeCard
    );
  if (!combinedWeeklyHtml.includes(">Weekly Event Controls<")
      || !combinedFreeRsvpHtml.includes("Free &amp; RSVP Events")
      || !combinedWeeklyHtml.includes("Paid Sessions")
      || !combinedLunchCard.includes("Post-Training Lunch")
      || !combinedLunchCard.includes('<p class="muted small mt8">1 going</p>')) {
    throw new Error("dated RSVP Admin card must render count 1 inside grouped Weekly Event Controls");
  }
  console.log("ok  RSVP exact route and count agree across Sunday Schedule, Activity, and grouped Admin");

  await store.withdrawRsvp(rsvp.id);
  if (store.getBooking(rsvp.id).status !== "cancelled")
    throw new Error("withdraw should cancel the RSVP booking");
  const repeatedRsvp = await store.rsvpSession("fixture-member", lunch.id, rsvp.createdAt + 1000);
  await store.withdrawRsvp(repeatedRsvp.id);
  repeatedRsvp.snapshot = { dateISO: lunch.dateISO };
  const repeatedRsvpBookingsHtml = await views.viewAccount("bookings");
  if ((repeatedRsvpBookingsHtml.match(/class="card booking-card"/g) || []).length !== 0
      || repeatedRsvpBookingsHtml.includes(`href="#/booking/${repeatedRsvp.id}"`)
      || repeatedRsvpBookingsHtml.includes(`href="#/booking/${rsvp.id}"`)) {
    throw new Error("Bookings must deduplicate and hide withdrawn RSVP records");
  }
  const repeatedRsvpProfileHtml = await views.viewAccount();
  if (statCount(repeatedRsvpProfileHtml, "#/account/bookings") !== 0) {
    throw new Error("Bookings neon count must also exclude withdrawn RSVP records");
  }
  console.log("ok  Bookings and its neon count deduplicate and hide withdrawn RSVPs");
  const schedHtml = views.viewSchedule();
  if (!schedHtml.includes(">Socials<"))
    throw new Error("Schedule should offer a Socials filter chip");
  const badgeHtml = views.viewActivity(lunch.id);
  if (!badgeHtml.includes('badge free">RSVP</span>'))
    throw new Error("unbooked RSVP session badge should read RSVP");
  if (lunch.location !== "TBC")
    throw new Error("lunch venue should seed as TBC until a weekly override is set");
  store.signIn("admin@example.test");
  await store.setWeekVenue(lunch.id, { location: "Cafe Deco, Central", mapsQuery: "Cafe Deco, Central" });
  const overriddenLunch = store.getSession(lunch.id);
  if (overriddenLunch.location !== "Cafe Deco, Central")
    throw new Error("local weekly venue override must apply to the lunch session");
  const adminActsHtml = await views.viewAdmin("activities");
  if (!adminActsHtml.includes("Post-Training Lunch") || !adminActsHtml.includes(">RSVP</span>"))
    throw new Error("Activities list should badge the lunch as RSVP");
  const weeklyControlsRegion = adminActsHtml.split(">Weekly Event Controls<")[1]?.split(">One-off Events<")[0] || "";
  const freeRsvpRegion = weeklyControlsRegion.split("Free &amp; RSVP Events")[1]?.split("Paid Sessions")[0] || "";
  const paidSessionsRegion = weeklyControlsRegion.split("Paid Sessions")[1] || "";
  if (paidSessionsRegion.includes("lunch-") || paidSessionsRegion.includes("Post-Training Lunch"))
    throw new Error("Paid Sessions must stay paid-only — the lunch lives in Free & RSVP Events");
  if (!freeRsvpRegion.includes("Post-Training Lunch") || !freeRsvpRegion.includes("Cancel this week's event"))
    throw new Error("the lunch venue card must offer the per-week cancel control");
  if (freeRsvpRegion.includes("cap"))
    throw new Error("the uncapped lunch must not show a capacity");
  store.signIn("member@example.test");
  store.signOut();
  console.log("ok  RSVP lunch: join, going state, withdraw, Socials filter, no checkout");
}

// --- Reset ---
store.resetLocalData();
console.log("ok  reset");

// --- v10 cleanup: fresh state, no demo UI, no simulated demand, no demo queues/duty ---
{
  const fresh = JSON.parse(mem.get("itc.prototype.v1"));
  if (Array.isArray(fresh.users) && fresh.users.length) {
    failures++;
    console.error("FAIL v10 fresh state must have zero users");
  } else console.log("ok  v10 fresh state has zero users");
  if (Array.isArray(fresh.bookings) && fresh.bookings.length) {
    failures++;
    console.error("FAIL v10 fresh state must have zero bookings");
  } else console.log("ok  v10 fresh state has zero bookings");
  if (Array.isArray(fresh.receipts) && fresh.receipts.length) {
    failures++;
    console.error("FAIL v10 fresh state must have zero receipts");
  } else console.log("ok  v10 fresh state has zero receipts");
  if (!fresh.paymentPayouts || Array.isArray(fresh.paymentPayouts)
      || Object.keys(fresh.paymentPayouts).length) {
    failures++;
    console.error("FAIL v14 fresh state must have an empty UUID-keyed payout map");
  } else console.log("ok  v14 fresh state has an empty UUID-keyed payout map");
  if (!Array.isArray(fresh.oneOffEvents) || fresh.oneOffEvents.length) {
    failures++;
    console.error("FAIL fresh state must have an empty one-off events list");
  } else console.log("ok  fresh state has an empty one-off events list");
  if (!fresh.activities.some((a) => a.id === "lunch" && a.kind === "rsvp" && a.category === "Socials")) {
    failures++;
    console.error("FAIL fresh state must seed the recurring RSVP lunch");
  } else console.log("ok  fresh state seeds the recurring RSVP lunch");
  if (Array.isArray(fresh.activities)) {
    for (const a of fresh.activities) {
      if ("baseBooked" in a) {
        failures++;
        console.error(`FAIL v10 fresh state activity ${a.id} must not carry baseBooked`);
      }
    }
  }
  // No seed collectors or duty assignments in fresh state
  if (fresh.duty && Object.keys(fresh.duty).length > 0) {
    failures++;
    console.error("FAIL v10 fresh state must not carry demo duty assignments");
  } else console.log("ok  v10 fresh state has no demo duty");
  if (fresh.queues && Object.keys(fresh.queues).length > 0) {
    failures++;
    console.error("FAIL v10 fresh state must not carry seed queue entries");
  } else console.log("ok  v10 fresh state has no seed queues");
  const accountHtml = await views.viewAccount();
  for (const removed of ["demo-signin", "reset-demo", "one-tap demo", "seeded email"]) {
    if (accountHtml.toLowerCase().includes(removed)) {
      failures++;
      console.error(`FAIL Account still renders removed demo content: ${removed}`);
    }
  }
  for (const email of ["super@example.test", "admin@example.test", "member@example.test",
    "marco@example.test", "jenny@example.test"]) {
    if (accountHtml.includes(email)) {
      failures++;
      console.error(`FAIL Account still exposes demo email ${email}`);
    }
  }
}

// --- v10 mixed migration: known demo records removed, genuine records preserved ---
{
  store.resetLocalData();
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.version = 9;
  raw.users = [
    { id: "u-super", role: "superadmin", status: "approved", fullName: "Demo Super", email: "owner@itc.hk" },
    { id: "u-admin", role: "admin", status: "approved", fullName: "Demo Admin", email: "admin@itc.hk" },
    { id: "u-member", role: "member", status: "approved", fullName: "Demo Member", email: "member@itc.hk" },
    { id: "real-member", role: "member", status: "approved", fullName: "Real Member", email: "real@example.test" },
  ];
  raw.sessionUserId = "u-member";
  raw.bookings = [
    { id: "b-seed-1", userId: "u-member" },
    { id: "b-user-1", userId: "real-member" },
  ];
  raw.receipts = [
    { id: "r-seed-1", bookingId: "b-seed-1", userId: "u-member" },
    { id: "r-user-1", bookingId: "b-user-1", userId: "real-member" },
  ];
  raw.queues = {
    "hyrox-2026-09-05": {
      waitlist: [
        { userId: "u-member", joinedAt: 1 },
        { userId: "real-member", joinedAt: 2 },
      ],
      interest: ["u-member", "real-member"],
    },
  };
  raw.duty = {
    "2026-08-15": { userId: "u-admin", setAt: 1 },
    "2026-08-22": { userId: "real-member", setAt: 1 },
  };
  raw.activities[0].baseBooked = 7;
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
  const migrated = JSON.parse(mem.get("itc.prototype.v1"));
  if (!migrated.users.some((u) => u.id === "real-member")) {
    failures++;
    console.error("FAIL v10 migration must keep genuine users");
  } else console.log("ok  v10 migration keeps genuine users");
  for (const demoId of ["u-super", "u-admin", "u-member"]) {
    if (migrated.users.some((u) => u.id === demoId)) {
      failures++;
      console.error(`FAIL v10 migration must remove demo user ${demoId}`);
    }
  }
  if (migrated.bookings.some((b) => b.id === "b-seed-1")) {
    failures++;
    console.error("FAIL v10 migration must remove demo-owned bookings");
  } else console.log("ok  v10 migration removes demo-owned bookings");
  if (!migrated.bookings.some((b) => b.id === "b-user-1")) {
    failures++;
    console.error("FAIL v10 migration must keep genuine bookings");
  } else console.log("ok  v10 migration keeps genuine bookings");
  // The old migration first repairs the legacy queue identity; v24 then
  // removes that exact retired BFT session even when it contains genuine users.
  const q = migrated.queues?.["hyrox-bft-2026-09-05"];
  if (q !== undefined) {
    failures++;
    console.error("FAIL v24 migration must remove the retired BFT queue");
  } else console.log("ok  v24 migration removes the repaired retired-session queue");
  // Duty reassignment for removed demo collector, but genuine duty survives.
  if (migrated.duty?.["2026-08-15"]?.userId === "u-admin") {
    failures++;
    console.error("FAIL v10 migration must clear duty assignments for removed demo users");
  } else console.log("ok  v10 migration clears demo duty assignments");
  if (migrated.duty?.["2026-08-22"]?.userId !== "real-member") {
    failures++;
    console.error("FAIL v10 migration must keep genuine duty assignments");
  } else console.log("ok  v10 migration keeps genuine duty assignments");
  if (migrated.activities.some((a) => "baseBooked" in a)) {
    failures++;
    console.error("FAIL v10 migration must strip baseBooked from every activity");
  } else console.log("ok  v10 migration strips simulated demand");
  if (migrated.sessionUserId !== null) {
    failures++;
    console.error("FAIL v10 migration must clear session tied to a removed demo user");
  } else console.log("ok  v10 migration clears removed session");
  if (migrated.version !== 30) {
    failures++;
    console.error(`FAIL integrated migration must advance version to 25, got ${migrated.version}`);
  } else console.log("ok  integrated migration advances genuine v9 state to v27");
}

{
  store.resetLocalData();
  const v13 = JSON.parse(mem.get("itc.prototype.v1"));
  v13.version = 13;
  v13.users = [{
    id: "real-v13-member",
    role: "member",
    status: "approved",
    fullName: "Real Member",
    email: "real-v13@example.test",
    indemnityAcceptedAt: 123456789,
  }];
  mem.set("itc.prototype.v1", JSON.stringify(v13));
  store.load();
  const v14 = JSON.parse(mem.get("itc.prototype.v1"));
  const migratedUser = v14.users.find((user) => user.id === "real-v13-member");
  if (v14.version !== 30 || !migratedUser) throw new Error("v27 migration lost the genuine member");
  for (const field of ["indemnitySignature", "indemnitySignedAt", "indemnityFormVersion", "emergencyRelationship"]) {
    if (!(field in migratedUser) || migratedUser[field] !== null) {
      throw new Error(`v14 migration should initialize ${field} to null`);
    }
  }
  if (migratedUser.indemnityAcceptedAt !== 123456789) {
    throw new Error("v14 migration must preserve indemnityAcceptedAt");
  }
  if (store.isIndemnityCurrent(migratedUser)) {
    throw new Error("timestamp-only v13 acceptance must be stale in v14");
  }
  console.log("ok  v14 migration preserves legacy acceptance and initializes consent fields");
}

// --- HYROX pooled local registration engine retirement ----------------------
{
  const v21 = store.resetLocalData();
  v21.version = 21;
  const preservedBooking = {
    id: "v21-booking", userId: "fixture-member", sessionId: "hyrox-bft-2099-01-03",
    cycleId: "hyrox-pool-2099-01-03", status: "confirmed",
    paymentMarkedAt: 4100, paidAt: 4200, paidMethod: "PayMe", paymentRef: "ITC-42",
    allocatedAt: 4300, allocationSource: "preference",
    snapshot: { name: "ITC HYROX", dateISO: "2099-01-03", price: 100 },
  };
  v21.bookings = [structuredClone(preservedBooking)];
  localStorage.setItem("itc.prototype.v1", JSON.stringify(v21));
  const migrated = store.load();
  assert.equal(migrated.version, 30);
  assert.equal(migrated.bookings.some((booking) => booking.id === preservedBooking.id), false,
    "v22 attendance compatibility must run before v24 removes the pooled booking");
  console.log("ok  v21 pooled booking reaches and is retired by v27");
}

// --- Admin payment/attendance state seam -----------------------------------
{
  store.resetLocalData();
  installLocalFixtures();
  const paidSessions = store.upcomingSessions(70).filter((session) =>
    session.activityId === "hyrox-quarry-bay"
      && !session.cancelled && !data.sessionStarted(session)
  );
  if (paidSessions.length < 3) throw new Error("attendance tests need three future paid sessions");

  store.signIn("member@example.test");
  const dueBooking = store.reserveSession("fixture-member", paidSessions[0].id, islandEccOpenNow(paidSessions[0]));
  const awaitingBooking = store.reserveSession("fixture-member", paidSessions[1].id, islandEccOpenNow(paidSessions[1]));
  store.markBookingPaid(awaitingBooking.id, "FPS", "ATTEND-AWAITING");
  const paidBooking = store.reserveSession("fixture-member", paidSessions[2].id, islandEccOpenNow(paidSessions[2]));
  store.markBookingPaid(paidBooking.id, "PayMe", "ATTEND-PAID");
  store.signIn("admin@example.test");
  const confirmation = store.confirmBookingPayment(paidBooking.id);
  const receiptBefore = structuredClone(confirmation.receipt);

  const rosterRaw = JSON.parse(localStorage.getItem("itc.prototype.v1"));
  rosterRaw.users.push(
    { id: "roster-due", role: "member", status: "approved", fullName: "Due Member", preferredName: "Due", email: "due-private@example.test", phone: "+852 6111 1001", donorId: "DUE-1001" },
    { id: "roster-awaiting", role: "member", status: "approved", fullName: "Claim Member", preferredName: "Claim", email: "claim-private@example.test", phone: "+852 6222 2002", donorId: "CLAI-2002" },
    { id: "roster-paid", role: "member", status: "approved", fullName: "Paid Member", preferredName: "Paid", email: "paid-private@example.test", phone: "+852 6333 3003", donorId: "PAID-3003" },
    { id: "roster-expected", role: "member", status: "approved", fullName: "Expected Member", preferredName: "Expected", email: "expected-private@example.test", phone: "+852 6444 4004", donorId: "EXPE-4004" },
  );
  rosterRaw.queues[paidSessions[0].id] = {
    waitlist: [{ userId: "roster-paid", joinedAt: 1 }, { userId: "roster-due", joinedAt: 2 }], interest: [],
  };
  rosterRaw.bookings.push(
    { id: "roster-due-booking", userId: "roster-due", sessionId: paidSessions[0].id, status: "reserved", paymentMarkedAt: null, attendedAt: null, attendedBy: null, snapshot: { name: "ITC HYROX", dateISO: paidSessions[0].dateISO, time: paidSessions[0].time, price: 180 } },
    { id: "roster-awaiting-booking", userId: "roster-awaiting", sessionId: paidSessions[0].id, status: "reserved", paymentMarkedAt: 10, paymentRef: "PRIVATE-REF", attendedAt: null, attendedBy: null, snapshot: { name: "ITC HYROX", dateISO: paidSessions[0].dateISO, time: paidSessions[0].time, price: 180 } },
    { id: "roster-paid-booking", userId: "roster-paid", sessionId: paidSessions[0].id, status: "attended", paymentMarkedAt: 10, paidAt: 20, attendedAt: 30, attendedBy: "fixture-admin", snapshot: { name: "ITC HYROX", dateISO: paidSessions[0].dateISO, time: paidSessions[0].time, price: 180 } },
    { id: "roster-expected-booking", userId: "roster-expected", sessionId: paidSessions[0].id, status: "confirmed", paymentMarkedAt: 10, paidAt: 20, attendedAt: null, attendedBy: null, snapshot: { name: "ITC HYROX", dateISO: paidSessions[0].dateISO, time: paidSessions[0].time, price: 180 } },
  );
  localStorage.setItem("itc.prototype.v1", JSON.stringify(rosterRaw));
  const originalLoadNow = Date.now;
  try {
    Date.now = () => data.islandEccSignupOpensAt(paidSessions[0].dateISO);
    store.load();
  } finally {
    Date.now = originalLoadNow;
  }
  const rosterAdminHtml = await views.viewAdmin("payments");
  const rosterStart = rosterAdminHtml.indexOf(`data-payment-roster="${paidSessions[0].id}"`);
  const rosterEnd = rosterAdminHtml.indexOf(`<!-- payment-roster-end:${paidSessions[0].id} -->`, rosterStart);
  const rosterHtml = rosterStart < 0 ? "" : rosterAdminHtml.slice(
    rosterStart, rosterEnd < 0 ? undefined : rosterEnd
  );
  for (const marker of [
    "Payment roster", "Payment due", "Awaiting confirmation", "Paid",
    "Due Member", "Claim Member", "Paid Member", "Expected Member",
    'data-payment-state="payment_due"',
    'data-payment-state="awaiting_confirmation"',
    'data-payment-state="paid"',
  ]) assert.ok(rosterHtml.includes(marker), `Admin payment roster missing ${marker}`);
  for (const secret of [
    "due-private@example.test", "claim-private@example.test", "paid-private@example.test",
    "expected-private@example.test", "+852 6111 1001", "+852 6222 2002",
    "+852 6333 3003", "+852 6444 4004",
    "DUE-1001", "CLAI-2002", "PAID-3003", "EXPE-4004", "PRIVATE-REF",
  ]) assert.equal(rosterHtml.includes(secret), false, `Admin name roster leaked ${secret}`);
  const financialHtml = rosterHtml.split('data-queue-title="Session waitlist"')[0];
  const sessionWaitlistHtml = rosterHtml.split('data-queue-title="Session waitlist"')[1];
  assert.ok(sessionWaitlistHtml.indexOf("Paid Member") < sessionWaitlistHtml.indexOf("Due Member"));
  for (const name of ["Due Member", "Claim Member", "Paid Member", "Expected Member"]) {
    assert.equal((financialHtml.match(new RegExp(name, "g")) || []).length, 1,
      `${name} must occur once in its financial group`);
  }

  const attendanceTimes = store.attendanceWindowForSession(paidSessions[0], 0);
  const originalDateNow = Date.now;
  try {
    Date.now = () => attendanceTimes.opensAt - 1;
    const beforeWindowHtml = await views.viewAdmin("payments");
    assert.match(beforeWindowHtml, /Expected arrivals/);
    assert.match(beforeWindowHtml, /Check-in opens 15 minutes before the session/);
    assert.doesNotMatch(beforeWindowHtml, /data-action="attendance-toggle"/);

    Date.now = () => attendanceTimes.opensAt;
    const openWindowHtml = await views.viewAdmin("payments");
    assert.match(openWindowHtml, /1 arrived · 1 still expected/);
    assert.match(openWindowHtml, /data-action="attendance-toggle"[^>]*data-booking="roster-expected-booking"[^>]*data-arrived="1"/);
    assert.match(openWindowHtml, /data-action="attendance-toggle"[^>]*data-booking="roster-paid-booking"[^>]*data-arrived="0"/);
    assert.match(openWindowHtml, />Mark Arrived<\/button>/);
    assert.match(openWindowHtml, />Undo<\/button>/);

    Date.now = () => attendanceTimes.closesAt;
    const closingBoundaryHtml = await views.viewAdmin("payments");
    assert.match(closingBoundaryHtml, /data-action="attendance-toggle"/);

    Date.now = () => attendanceTimes.closesAt + 1;
    const lockedWindowHtml = await views.viewAdmin("payments");
    assert.match(lockedWindowHtml, /Attendance locked/);
    assert.match(lockedWindowHtml, /Expected Member/);
    assert.match(lockedWindowHtml, /Paid Member/);
    assert.doesNotMatch(lockedWindowHtml, /data-action="attendance-toggle"/);
  } finally {
    Date.now = originalDateNow;
  }

  const rosterStates = store.paymentRosterBookings()
    .filter((booking) => [dueBooking.id, awaitingBooking.id, paidBooking.id].includes(booking.id))
    .map((booking) => store.paymentStateForBooking(booking));
  assert.deepEqual(rosterStates, ["payment_due", "awaiting_confirmation", "paid"]);
  assert.deepEqual(
    store.attendanceBookingsForSession(paidSessions[2].id).map((booking) => booking.status),
    ["confirmed"],
  );

  const window = store.attendanceWindowForSession(paidSessions[2], 0);
  store.signIn("member@example.test");
  await assert.rejects(
    () => store.setBookingAttendance(paidBooking.id, true, window.opensAt),
    /Approved Admin access required/,
  );
  store.signIn("admin@example.test");
  await assert.rejects(
    () => store.setBookingAttendance(dueBooking.id, true, window.opensAt),
    /confirmed-paid/,
  );
  await assert.rejects(
    () => store.setBookingAttendance(awaitingBooking.id, true, window.opensAt),
    /confirmed-paid/,
  );
  await assert.rejects(
    () => store.setBookingAttendance(paidBooking.id, true, window.opensAt - 1),
    /outside the check-in window/,
  );

  const arrived = await store.setBookingAttendance(paidBooking.id, true, window.opensAt);
  assert.equal(arrived.status, "attended");
  assert.equal(arrived.attendedAt, window.opensAt);
  assert.equal(arrived.attendedBy, "fixture-admin");
  assert.equal(store.paymentStateForBooking(arrived), "paid");
  assert.deepEqual(store.receiptForBooking(paidBooking.id), receiptBefore,
    "attendance must preserve the issued receipt");
  assert.equal(store.activeBookingsForSession(paidSessions[2].id).some((booking) => booking.id === paidBooking.id), true,
    "Arrived remains active for paid attendee counts and names");
  assert.equal(store.heldBookingsForSession(paidSessions[2].id).some((booking) => booking.id === paidBooking.id), true,
    "Arrived remains held for paid capacity");
  assert.equal(store.userBookingFor("fixture-member", paidSessions[2].id)?.id, paidBooking.id,
    "Arrived remains the member's paid booking");
  assert.equal(store.attendeesFor(paidSessions[2]).includes("Tester M."), true,
    "Arrived remains in the protected local attendee-name list");
  const repeated = await store.setBookingAttendance(paidBooking.id, true, window.opensAt + 1);
  assert.equal(repeated.attendedAt, window.opensAt);
  assert.equal(repeated.attendedBy, "fixture-admin");

  store.signIn("member@example.test");
  const attendedProfile = await views.viewAccount();
  const attendedPage = await views.viewAccount("bookings", "attended");
  assert.match(attendedProfile, /href="#\/account\/bookings\/attended"[^>]*>\s*<strong>1<\/strong>/);
  assert.equal((attendedPage.match(/class="card booking-card"/g) || []).length, 1);
  store.signIn("admin@example.test");

  const expected = await store.setBookingAttendance(paidBooking.id, false, window.opensAt + 2);
  assert.equal(expected.status, "confirmed");
  assert.equal(expected.attendedAt, null);
  assert.equal(expected.attendedBy, null);
  const closingMark = await store.setBookingAttendance(paidBooking.id, true, window.closesAt);
  assert.equal(closingMark.status, "attended", "the exact closing boundary must remain open");
  await store.setBookingAttendance(paidBooking.id, false, window.closesAt);
  await assert.rejects(
    () => store.setBookingAttendance(paidBooking.id, true, window.closesAt + 1),
    /outside the check-in window/,
  );

  const raw = JSON.parse(localStorage.getItem("itc.prototype.v1"));
  raw.bookings.push({
    id: "attendance-unallocated", userId: "fixture-member", sessionId: null,
    cycleId: "attendance-cycle", status: "confirmed", paymentMarkedAt: 1,
    paidAt: 2, attendedAt: null, attendedBy: null,
    snapshot: { name: "ITC HYROX", dateISO: paidSessions[2].dateISO, price: 180 },
  });
  localStorage.setItem("itc.prototype.v1", JSON.stringify(raw));
  store.load();
  assert.equal(store.getBooking("attendance-unallocated")?.cycleId, "attendance-cycle",
    "an arbitrary non-pool cycle ID must not retire an otherwise unrelated booking");
  await assert.rejects(
    () => store.setBookingAttendance("attendance-unallocated", true, window.opensAt),
    /assigned session/,
  );

  store.signIn("member@example.test");
  const rsvpSession = store.upcomingSessions(70).find((session) =>
    session.kind === "rsvp" && !session.cancelled && !data.sessionStarted(session)
  );
  if (!rsvpSession) throw new Error("attendance tests need a future RSVP session");
  const rsvpBooking = await store.rsvpSession("fixture-member", rsvpSession.id);
  store.signIn("admin@example.test");
  assert.equal(store.paymentRosterBookings().some((booking) => booking.id === rsvpBooking.id), false,
    "free RSVP bookings must not enter financial rosters");
  await assert.rejects(
    () => store.setBookingAttendance(rsvpBooking.id, true,
      store.attendanceWindowForSession(rsvpSession, 0).opensAt),
    /paid sessions only/,
  );

  const cancelledRaw = JSON.parse(localStorage.getItem("itc.prototype.v1"));
  cancelledRaw.sessionOverrides[paidSessions[2].id] = { cancelled: "Attendance test" };
  localStorage.setItem("itc.prototype.v1", JSON.stringify(cancelledRaw));
  store.load();
  await assert.rejects(
    () => store.setBookingAttendance(paidBooking.id, true, window.opensAt),
    /Session is cancelled/,
  );
  console.log("ok  local attendance selectors and mutation enforce paid Admin timing rules");
}

// --- Install neutral fixtures for local authenticated paths (no demo seeds) ---
function installLocalFixtures({ withMemberBooking = false } = {}) {
  const clean = JSON.parse(mem.get("itc.prototype.v1"));
  const preserved = (clean.users || []).filter((u) =>
    !["fixture-admin", "fixture-member", "fixture-super"].includes(u.id)
  );
  clean.sessionUserId = "fixture-admin";
  clean.users = [
    ...preserved,
    {
      id: "fixture-admin", role: "admin", status: "approved", fullName: "Test Admin",
      preferredName: "Admin", email: "admin@example.test", phone: "+852 5000 0001",
      emergencyName: "Test Contact", emergencyRelationship: "Sibling", emergencyPhone: "+852 5000 9001", heard: "Test fixture",
      isMinor: false, appliedAt: Date.now() - 86400000, indemnityAcceptedAt: Date.now() - 86400000,
      indemnitySignature: "Test Admin", indemnitySignedAt: data.isoDate(data.todayLocal()), indemnityFormVersion: "v1",
      privacyAcceptedAt: Date.now() - 86400000, whatsappReminders: false, emailReceipts: false,
      communityNews: false,
    },
    {
      id: "fixture-member", role: "member", status: "approved", fullName: "Test Member",
      preferredName: "Tester", email: "member@example.test", phone: "+852 5000 0002",
      emergencyName: "Test Contact", emergencyRelationship: "Sibling", emergencyPhone: "+852 5000 9002", heard: "Test fixture",
      mediaConsent: true, donorId: "TEST-1234", isMinor: false,
      appliedAt: Date.now() - 172800000, indemnityAcceptedAt: Date.now() - 172800000,
      indemnitySignature: "Test Member", indemnitySignedAt: data.isoDate(data.todayLocal()), indemnityFormVersion: "v1",
      privacyAcceptedAt: Date.now() - 172800000, whatsappReminders: false,
      emailReceipts: false, communityNews: false,
    },
  ];
  if (withMemberBooking) {
    const upcoming = store.upcomingSessions(14);
    const fixtureMemberSession = upcoming.find((s) => s.activityId === "hyrox-quarry-bay" && !data.sessionStarted(s));
    if (fixtureMemberSession) {
      clean.bookings = [
        ...(clean.bookings || []),
        {
          id: "fixture-booking", userId: "fixture-member", sessionId: fixtureMemberSession.id,
          status: "confirmed", createdAt: Date.now(),
          snapshot: {
            name: fixtureMemberSession.name, kind: fixtureMemberSession.kind,
            dateISO: fixtureMemberSession.dateISO, time: fixtureMemberSession.time,
            durationMin: fixtureMemberSession.durationMin, location: fixtureMemberSession.location,
            price: fixtureMemberSession.price,
          },
        },
      ];
    }
  }
  mem.set("itc.prototype.v1", JSON.stringify(clean));
  store.load();
}

// --- Integrated Giving + shape-aware v13 contracts ---
for (const marker of [
  'case "giving"', 'case "giving-amount"', 'case "giving-confirm"',
  'case "campaign-publish"', 'case "campaign-close"', 'case "form-campaign"',
]) {
  if (!integratedAppSource.includes(marker)) {
    failures++;
    console.error(`FAIL integrated Giving router missing ${marker}`);
  }
}
assert.equal(typeof views.viewRetiredSession, "function",
  "member routes must expose the neutral retired-session view");
assert.match(views.viewRetiredSession(), />This session is no longer available\.<\/h2>/,
  "the retired-session view must use the approved neutral copy exactly");
for (const [kind, id] of [
  ["activity", "hyrox-bft-2099-01-03"],
  ["hyrox", "hyrox-pool-2099-01-03"],
]) {
  assert.equal(store.isRetiredHyroxMemberRoute(kind, id), true,
    `${kind}/${id} must resolve to the retired route state`);
}
assert.equal(store.isRetiredHyroxMemberRoute("activity", "hyrox-quarry-bay-2099-01-03"), false,
  "Island ECC deep links must remain active");
assert.equal(store.isRetiredHyroxMemberRoute("activity", "unknown-session"), false,
  "unknown deep links must keep the ordinary not-found contract");
for (const retiredRouteView of [
  views.viewActivity("hyrox-bft-2099-01-03"),
  views.viewRetiredSession("hyrox-pool-2099-01-03"),
]) {
  assert.match(retiredRouteView, /This session is no longer available\./,
    "known retired member deep links must render the neutral state");
  assert.doesNotMatch(retiredRouteView, /Island ECC|notification|redirect/i,
    "retired deep links must not redirect or imply a notification");
}
for (const retiredMarker of [
  "views.viewHyroxRegistration(arg)", "views.viewHyroxCycle(arg)",
  'case "form-hyrox-reserve":', "store.reserveHyroxCycle(",
  'case "select-hyrox-venue":', 'case "join-hyrox-switch-queue":',
  'case "leave-hyrox-switch-queue":', 'case "join-interest":', 'case "leave-interest":',
  'case "hyrox-allocation-close":', 'case "form-hyrox-payment-reject":',
  'case "form-cancel-hyrox-cycle":',
]) {
  assert.equal(integratedAppSource.includes(retiredMarker), false,
    `retired member pool route/action remains: ${retiredMarker}`);
}
assert.equal(integratedViewSource.includes("retired-pool-booking"), false,
  "production views must not hard-code a test-only retired booking ID");
assert.equal(integratedAppSource.includes("retired-pool-booking"), false,
  "production routing must not hard-code a test-only retired booking ID");
for (const api of ["viewHyroxCycle", "viewHyroxRegistration"]) {
  assert.equal(typeof views[api], "undefined", `retired pooled view remains exported: ${api}`);
}
for (const api of [
  "reserveHyroxCycle", "joinHyroxCycleWaitlist", "leaveHyroxCycleQueue",
  "selectHyroxCycleVenue", "joinHyroxVenueSwitchQueue", "leaveHyroxVenueSwitchQueue",
  "joinInterest", "leaveInterest", "interestPosition",
]) {
  assert.equal(typeof store[api], "undefined", `retired member pool action remains exported: ${api}`);
}
const retiredMemberCopy = /BFT Causeway Bay|Midtown28|Midtown 28|BFT \+ Midtown Pool|venue allocation|switch queue|Wait for Midtown/i;
for (const [surface, html] of [
  ["visitor Home", views.viewHome()],
  ["Schedule", views.viewSchedule()],
  ["retired activity", views.viewActivity("hyrox-bft-2099-01-03")],
]) {
  assert.doesNotMatch(html, retiredMemberCopy, `${surface} must not render retired pool copy`);
}

for (const api of [
  "updateMyDonorId", "campaigns", "activeGivingCampaign", "listGivingCampaigns",
  "getActiveGivingCampaign", "saveGivingCampaign", "publishGivingCampaign",
  "closeGivingCampaign", "campaignRaised", "donationsForUser", "recordDonation",
]) {
  if (typeof store[api] !== "function") {
    failures++;
    console.error(`FAIL integrated Giving store missing ${api}`);
  }
}

// Exercise the approved-member amount/FPS/thanks/history path and role gates.
const givingFixture = {
  version: 13, sessionUserId: "giving-admin", activities: structuredClone(data.SEED_ACTIVITIES),
  users: [
    { id: "giving-admin", role: "admin", status: "approved", fullName: "Giving Admin", email: "giving-admin@example.test" },
    { id: "giving-member", role: "member", status: "approved", fullName: "Giving Member", email: "giving-member@example.test" },
    { id: "giving-other", role: "member", status: "approved", fullName: "Giving Other", email: "giving-other@example.test" },
    { id: "giving-pending", role: "pending", status: "pending", fullName: "Giving Pending", email: "giving-pending@example.test" },
    { id: "giving-declined", role: "pending", status: "declined", fullName: "Giving Declined", email: "giving-declined@example.test" },
  ],
  bookings: [], receipts: [], campaigns: [], donations: [], prayers: [], notifications: [],
  sessionOverrides: {}, queues: {}, duty: {},
};
mem.set("itc.prototype.v1", JSON.stringify(givingFixture));
store.load();

// Payment access belongs at the state seam, including mutations called
// without rendering their gated controls first.
const paymentGateSession = store.upcomingSessions(14).find(
  (session) => session.kind === "paid" && !data.sessionStarted(session)
);
if (!paymentGateSession) throw new Error("Payment seam checks need an upcoming paid session");
for (const blockedId of ["giving-pending", "giving-declined", "missing-member"]) {
  for (const mutate of [
    () => store.reserveSession(blockedId, paymentGateSession),
    () => store.joinWaitlist(blockedId, paymentGateSession.id),
    () => store.leaveWaitlist(blockedId, paymentGateSession.id),
  ]) {
    try {
      mutate();
      throw new Error(`${blockedId} Payment mutation should be rejected`);
    } catch (err) {
      if (!/Approved member access required/.test(err.message)) throw err;
    }
  }
}
const authoritySessions = store.upcomingSessions(42).filter(
  (session) => session.kind === "paid" && !data.sessionStarted(session)
);
const cancelledAuthoritySession = authoritySessions.find((session) => session.id !== paymentGateSession.id);
const tamperAuthoritySession = authoritySessions.find(
  (session) => session.id !== paymentGateSession.id && session.id !== cancelledAuthoritySession?.id
);
if (!cancelledAuthoritySession || !tamperAuthoritySession) {
  throw new Error("reservation authority regression needs three upcoming paid sessions");
}
store.cancelSessionWeek(cancelledAuthoritySession.id, "Authority regression cancellation");
store.signIn("giving-member@example.test");
try {
  store.reserveSession("giving-member", {
    ...cancelledAuthoritySession, cancelled: false, price: 1, capacity: 999,
  });
  throw new Error("forged uncancelled session should not bypass authoritative cancellation");
} catch (err) {
  if (!/Session is cancelled/.test(err.message)) throw err;
}
try {
  store.reserveSession("giving-member", { id: "unknown-weekly-session", kind: "paid", price: 1, capacity: 999 });
  throw new Error("unknown session ID should not reserve");
} catch (err) {
  if (!/Unknown session/.test(err.message)) throw err;
}
const freeAuthoritySession = store.upcomingSessions(14).find((session) => session.kind === "free");
try {
  store.reserveSession("giving-member", { ...freeAuthoritySession, kind: "paid", price: 1, capacity: 999 });
  throw new Error("forged paid session should not bypass authoritative eligibility");
} catch (err) {
  if (!/Session is not paid/.test(err.message)) throw err;
}
const tamperReservation = store.reserveSession("giving-member", {
  ...tamperAuthoritySession, price: 1, capacity: 999,
}, islandEccOpenNow(tamperAuthoritySession));
const authoritativeTamperSession = store.getSession(tamperAuthoritySession.id);
if (tamperReservation.snapshot.price !== authoritativeTamperSession.price
    || tamperReservation.snapshot.capacity !== authoritativeTamperSession.capacity) {
  throw new Error("reservation snapshot must use authoritative price and capacity");
}
if (!store.releaseReservation(tamperReservation.id)) {
  throw new Error("tamper regression cleanup should release the reservation");
}
const beforeFullFixture = JSON.parse(mem.get("itc.prototype.v1"));
for (let i = 0; i < authoritativeTamperSession.capacity; i++) {
  beforeFullFixture.bookings.push({
    id: `authority-full-${i}`, userId: `authority-user-${i}`,
    sessionId: authoritativeTamperSession.id, status: "confirmed", createdAt: Date.now(),
    snapshot: { price: authoritativeTamperSession.price, capacity: authoritativeTamperSession.capacity },
  });
}
mem.set("itc.prototype.v1", JSON.stringify(beforeFullFixture));
store.load();
store.signIn("giving-member@example.test");
{
  const fullTarget = store.getSession(tamperAuthoritySession.id);
  let remaining = store.spotsLeft(fullTarget);
  if (remaining > 0) {
    const extra = JSON.parse(mem.get("itc.prototype.v1"));
    for (let i = 0; i < remaining; i++) {
      extra.bookings.push({
        id: `authority-full-extra-${i}`, userId: `authority-user-extra-${i}`,
        sessionId: tamperAuthoritySession.id, status: "confirmed", createdAt: Date.now(),
        snapshot: { price: fullTarget.price, capacity: fullTarget.capacity },
      });
    }
    mem.set("itc.prototype.v1", JSON.stringify(extra));
    store.load();
    store.signIn("giving-member@example.test");
  }
}
try {
  store.reserveSession(
    "giving-member",
    { ...tamperAuthoritySession, capacity: 999 },
    islandEccOpenNow(tamperAuthoritySession),
  );
  throw new Error("forged capacity should not bypass an authoritatively full session");
} catch (err) {
  if (!/Session is full/.test(err.message)) throw err;
}
beforeFullFixture.bookings = beforeFullFixture.bookings.filter(
  (booking) => !booking.id.startsWith("authority-full-")
);
mem.set("itc.prototype.v1", JSON.stringify(beforeFullFixture));
store.load();
store.signIn("giving-member@example.test");
const approvedReservation = store.reserveSession("giving-member", paymentGateSession.id, islandEccOpenNow(paymentGateSession));
if (approvedReservation.sessionId !== paymentGateSession.id || approvedReservation.status !== "reserved") {
  throw new Error("approved member should reserve a normal authoritative session by ID");
}
console.log("ok  reservations resolve authoritative sessions and reject forged/unknown input");
store.joinWaitlist("giving-member", "authz-waitlist-session");
const assertPaymentImpersonationRejected = (label, mutate) => {
  try {
    mutate();
    throw new Error(`${label} Payment impersonation should be rejected`);
  } catch (err) {
    if (!/Approved actor access required|Approved Admin access required|Payment mutation not authorized/.test(err.message)) throw err;
  }
};
for (const actor of [
  { label: "pending", email: "giving-pending@example.test" },
  { label: "declined", email: "giving-declined@example.test" },
  { label: "approved non-admin", email: "giving-other@example.test" },
  { label: "signed-out", email: null },
]) {
  if (actor.email) store.signIn(actor.email);
  else store.signOut();
  for (const mutate of [
    () => store.reserveSession("giving-member", paymentGateSession),
    () => store.markBookingPaid(approvedReservation.id, "FPS", `IMPERSONATED-${actor.label}`),
    () => store.joinWaitlist("giving-member", `authz-join-waitlist-${actor.label}`),
    () => store.leaveWaitlist("giving-member", "authz-waitlist-session"),
  ]) assertPaymentImpersonationRejected(actor.label, mutate);
}
if (store.getBooking(approvedReservation.id).paymentMarkedAt
    || store.waitlistPosition("giving-member", "authz-waitlist-session") !== 1) {
  throw new Error("rejected Payment impersonation must not mutate state");
}
store.signIn("giving-admin@example.test");
givingFixture.users.find((user) => user.id === "giving-member").status = "declined";
mem.set("itc.prototype.v1", JSON.stringify({
  ...JSON.parse(mem.get("itc.prototype.v1")),
  users: givingFixture.users,
}));
const reloadAtPaymentGateTime = () => {
  const originalNow = Date.now;
  try {
    Date.now = () => data.islandEccSignupOpensAt(paymentGateSession.dateISO);
    store.load();
  } finally {
    Date.now = originalNow;
  }
};
reloadAtPaymentGateTime();
try {
  store.markBookingPaid(approvedReservation.id, "FPS", "BLOCKED-PAYMENT");
  throw new Error("declined reservation owner should not mark payment paid");
} catch (err) {
  if (!/Approved member access required/.test(err.message)) throw err;
}
givingFixture.users.find((user) => user.id === "giving-member").status = "approved";
mem.set("itc.prototype.v1", JSON.stringify({
  ...JSON.parse(mem.get("itc.prototype.v1")),
  users: givingFixture.users,
}));
reloadAtPaymentGateTime();
store.signIn("giving-member@example.test");
if (!store.markBookingPaid(approvedReservation.id, "FPS", "APPROVED-PAYMENT")) {
  throw new Error("approved booking owner should retain self-service payment access");
}
try {
  store.confirmBookingPayment(approvedReservation.id);
  throw new Error("approved booking owner must not self-confirm payment");
} catch (err) {
  if (!/Approved Admin access required/.test(err.message)) throw err;
}
if (store.getBooking(approvedReservation.id).status !== "reserved"
    || store.receiptForBooking(approvedReservation.id)) {
  throw new Error("rejected self-confirmation must not issue a receipt");
}
for (const actor of [
  { label: "pending", email: "giving-pending@example.test" },
  { label: "declined", email: "giving-declined@example.test" },
  { label: "approved non-admin", email: "giving-other@example.test" },
  { label: "signed-out", email: null },
]) {
  if (actor.email) store.signIn(actor.email);
  else store.signOut();
  assertPaymentImpersonationRejected(
    `${actor.label} confirmation`,
    () => store.confirmBookingPayment(approvedReservation.id)
  );
}
store.signIn("giving-admin@example.test");
const authorizedConfirmation = store.confirmBookingPayment(
  approvedReservation.id, Date.now(), "arbitrary-collector-id"
);
if (!authorizedConfirmation) {
  throw new Error("Admin should confirm payment for an approved affected profile");
}
if (authorizedConfirmation.booking.confirmedBy !== "giving-admin") {
  throw new Error("payment confirmation must derive confirmedBy from the authenticated Admin");
}
const deferTarget = store.deferTargetsFor(authorizedConfirmation.booking)[0];
if (!deferTarget) throw new Error("authorization regression needs a deferral target");
store.signIn("giving-other@example.test");
for (const mutate of [
  () => store.deferBooking(approvedReservation.id, deferTarget.id),
  () => store.cancelBooking(approvedReservation.id),
  () => store.setSessionTime(paymentGateSession.id, "11:00"),
  () => store.setSessionNotice(paymentGateSession.id, "Unauthorized note"),
  () => store.setVenueTBC(paymentGateSession.id, true),
  () => store.setDuty("giving-other", paymentGateSession.dateISO),
  () => store.updateCollectorPayouts("giving-other", { paymeLink: "bad", fpsPhone: "bad" }),
  () => store.confirmGymBooking(paymentGateSession.id, "Unauthorized"),
]) {
  try {
    mutate();
    throw new Error("non-Admin cross-user/operational Payment mutation should be rejected");
  } catch (err) {
    if (!/Approved Admin access required|Payment mutation not authorized/.test(err.message)) throw err;
  }
}
store.signIn("giving-member@example.test");
try {
  store.cancelBooking(approvedReservation.id);
  throw new Error("booking owner must not use the Admin cancellation/refund seam");
} catch (err) {
  if (!/Approved Admin access required/.test(err.message)) throw err;
}
const movedByOwner = store.deferBooking(approvedReservation.id, deferTarget.id);
if (movedByOwner.userId !== "giving-member" || movedByOwner.status !== "confirmed") {
  throw new Error("approved booking owner should be able to defer their booking");
}
const movedDate = store.getSession(movedByOwner.sessionId)?.dateISO;
const releaseSession = store.upcomingSessions(28).find((session) =>
  session.kind === "paid" && !data.sessionStarted(session) && !session.cancelled
  && session.id !== movedByOwner.sessionId
  && session.dateISO !== movedDate
);
if (!releaseSession) throw new Error("authorization regression needs a release session");
const ownerReservation = store.reserveSession("giving-member", releaseSession, islandEccOpenNow(releaseSession));
store.signIn("giving-other@example.test");
try {
  store.releaseReservation(ownerReservation.id);
  throw new Error("non-owner member must not release another member's reservation");
} catch (err) {
  if (!/Payment mutation not authorized/.test(err.message)) throw err;
}
store.signIn("giving-member@example.test");
if (!store.releaseReservation(ownerReservation.id)
    || store.getBooking(ownerReservation.id).status !== "cancelled") {
  throw new Error("approved booking owner should be able to release their reservation");
}
store.signIn("giving-admin@example.test");
if (!store.cancelBooking(movedByOwner.id)
    || store.receiptForBooking(movedByOwner.id)?.status !== "refunded") {
  throw new Error("Admin cancellation should cancel and refund a confirmed booking");
}
store.setSessionTime(paymentGateSession.id, "11:00");
store.setSessionNotice(paymentGateSession.id, "Admin note");
store.setVenueTBC(paymentGateSession.id, true);
store.confirmGymBooking(paymentGateSession.id, "Confirmed by Admin", Date.now());
const administeredSession = store.getSession(paymentGateSession.id);
if (administeredSession.time !== "11:00" || !administeredSession.notice
    || !administeredSession.venueTBC || !administeredSession.gymConfirmedAt) {
  throw new Error("approved Admin should retain weekly session operations");
}
store.leaveWaitlist("giving-member", "authz-waitlist-session");
console.log("ok  Payment seams enforce self-service/Admin boundaries and derive confirmation identity");

const givingFpsId = `FPS<&"'>`;
const givingCampaign = await store.saveGivingCampaign({
  title: "Member campaign", description: "Support the community.", goalHKD: 1000,
  fpsId: givingFpsId, fpsPayee: "Island Training Club",
});
await store.publishGivingCampaign(givingCampaign.id);
store.signIn("giving-member@example.test");
const memberGivingHtml = await views.viewGiving();
if (!/form-giving|Give via FPS/.test(memberGivingHtml)) throw new Error("approved members must access Giving transfer controls");
views.givingState.step = 2;
views.givingState.amount = 250;
views.givingState.name = "Giving Member";
const givingCopyReference = `GIVE-<&"'>`;
views.givingState.ref = givingCopyReference;
views.givingState.campaignId = givingCampaign.id;
const givingFpsHtml = await views.viewGiving();
for (const marker of [
  "FPS ID", "Payee", "HK$250",
  'data-action="copy-fps"', 'aria-label="Copy FPS ID"',
  'data-action="copy-reference"', 'aria-label="Copy Giving reference"',
  "Open your banking app", "pay using the FPS ID", "Paste the FPS ID",
]) {
  if (!givingFpsHtml.includes(marker)) throw new Error(`same-device Giving FPS UI missing ${marker}`);
}
if (/QR|scan|bank deep.link/i.test(givingFpsHtml)) {
  throw new Error("Giving FPS flow must not show QR or universal deep-link claims");
}
assertFpsCopyBindings(givingFpsHtml, [
  {
    action: "copy-fps", kind: "id", label: "FPS ID",
    value: givingFpsId, escaped: "FPS&lt;&amp;&quot;&#39;&gt;",
  },
  {
    action: "copy-reference", kind: "giving-reference", label: "Reference",
    value: givingCopyReference, escaped: "GIVE-&lt;&amp;&quot;&#39;&gt;",
  },
], "Giving FPS screen");
console.log("ok  Giving shows same-device FPS ID + reference copy guidance without QR claims");
views.givingState.ref = "GIVE-TEST";
await store.updateMyDonorId("member-1234");
if (store.currentUser().donorId !== "MEMBER-1234") throw new Error("Giving donor ID must normalize and persist");
const gift = store.recordDonation({ userId: "giving-member", name: "Giving Member", amount: 250, ref: "GIVE-TEST", campaignId: givingCampaign.id });
if (gift.status !== "pending" || store.campaignRaised(givingCampaign) !== 250 || !store.donationsForUser("giving-member").length) {
  throw new Error("Giving amount/FPS/history persistence failed");
}
const derivedGift = store.recordDonation({ name: "Derived Owner", amount: 100, ref: "GIVE-DERIVED", campaignId: givingCampaign.id });
if (derivedGift.userId !== "giving-member") throw new Error("Giving must derive donation ownership from currentUser().id");
for (const badUserId of ["giving-admin", null, ""]) {
  try {
    store.recordDonation({ userId: badUserId, name: "Wrong Owner", amount: 10, ref: `WRONG-${badUserId}`, campaignId: givingCampaign.id });
    throw new Error(`Giving should reject caller userId ${JSON.stringify(badUserId)}`);
  } catch (err) {
    if (!/Donation owner must match the approved member/.test(err.message)) throw err;
  }
}
console.log("ok  Giving donation ownership is derived and caller IDs must match");
store.signOut();
try {
  store.recordDonation({ name: "No Identity", amount: 10, ref: "NO-IDENTITY", campaignId: givingCampaign.id });
  throw new Error("Giving should reject absent identity");
} catch (err) {
  if (!/Approved member access required/.test(err.message)) throw err;
}
store.signIn("giving-member@example.test");
views.givingState.step = 3;
views.givingState.name = "Giving Member";
views.givingState.amount = 250;
views.givingState.ref = "GIVE-TEST";
views.givingState.campaignId = givingCampaign.id;
if (!(await views.viewGiving()).includes("Thank you, Giving")) throw new Error("Giving thank-you step missing");
for (const email of ["giving-pending@example.test", "giving-declined@example.test"]) {
  store.signIn(email);
  const locked = await views.viewGiving();
  if (!locked.includes("approved ITC members") || locked.includes("FPS ID")) throw new Error(`${email} must be gated from Giving`);
  try {
    store.recordDonation({ userId: store.currentUser().id, name: "Blocked", amount: 10, ref: `BLOCKED-${email}` });
    throw new Error(`${email} must not record gifts`);
  } catch (err) {
    if (!/Approved member access required/.test(err.message)) throw err;
  }
}
store.signIn("giving-admin@example.test");
await store.closeGivingCampaign(givingCampaign.id);
if (await store.getActiveGivingCampaign()) throw new Error("closed campaigns must not remain active");
const emptyGivingHtml = await views.viewGiving();
if (!emptyGivingHtml.includes("No active Giving campaign at the moment")
    || !emptyGivingHtml.includes("Check back soon for the next opportunity to support the ITC community.")) {
  throw new Error("closed campaigns must render the exact Giving empty state");
}
console.log("ok  Giving access, donor ID, campaign, FPS, thanks, history, and close flow");

const sourceSnapshots = [
  { version: 9, prayers: [{ id: "p-real" }] },
  {
    version: 10,
    paymentPayouts: null,
    queues: {
      real: {
        waitlist: [{ userId: "real-user", joinedAt: 123 }],
        interest: ["real-user"],
      },
    },
    duty: { "2026-08-08": { userId: "real-user" } },
  },
  { version: 11, paymentPayouts: [], notifications: [{ id: "n-real", userId: "real-user" }] },
  {
    version: 12,
    paymentPayouts: { "real-admin": { paymeLink: "https://payme.example/real", fpsPhone: "+852 6000 0000" } },
    campaigns: [{ id: "c-real", title: "Member campaign" }],
    donations: [{ id: "d-real", userId: "real-user" }],
  },
];
for (const fixture of sourceSnapshots) {
  const snapshot = {
    version: fixture.version,
    sessionUserId: null,
    users: [], activities: structuredClone(data.SEED_ACTIVITIES), bookings: [], receipts: [],
    ...fixture,
  };
  mem.set("itc.prototype.v1", JSON.stringify(snapshot));
  store.load();
  const migrated = JSON.parse(mem.get("itc.prototype.v1"));
  const serialized = JSON.stringify(migrated);
  const suppliedIds = JSON.stringify(fixture).match(/[pcnd]-real|real-user/g) || [];
  const payoutMapValid = migrated.paymentPayouts
    && typeof migrated.paymentPayouts === "object"
    && !Array.isArray(migrated.paymentPayouts);
  const suppliedPayoutsPreserved = fixture.version !== 12
    || migrated.paymentPayouts["real-admin"]?.fpsPhone === "+852 6000 0000";
  if (migrated.version !== 30 || suppliedIds.some((id) => !serialized.includes(id))
      || !payoutMapValid || !suppliedPayoutsPreserved) {
    failures++;
    console.error(`FAIL genuine v${fixture.version} fixture must reach v27 intact`);
  } else console.log(`ok  genuine v${fixture.version} fixture reaches v27 intact`);
}

for (const invalidCounter of [null, -1, 1.5, "broken"]) {
  mem.set("itc.prototype.v1", JSON.stringify({
    version: 13,
    activities: structuredClone(data.SEED_ACTIVITIES),
    users: [], bookings: [], receipts: [],
    receiptCounter: invalidCounter,
  }));
  store.load();
  const repairedCounter = JSON.parse(mem.get("itc.prototype.v1")).receiptCounter;
  if (!Number.isInteger(repairedCounter) || repairedCounter < 0) {
    throw new Error(`v13 must normalize invalid receiptCounter ${JSON.stringify(invalidCounter)}`);
  }
}
console.log("ok  v13 normalizes invalid receiptCounter shapes");

// Migration acceptance must prove resulting behavior, not only retained IDs.
// This v12 snapshot deliberately omits receiptCounter, then exercises the real
// reserve -> mark paid -> Admin confirm path that issues a receipt.
const receiptMigrationFixture = {
  version: 12,
  sessionUserId: "receipt-member",
  activities: structuredClone(data.SEED_ACTIVITIES),
  users: [
    { id: "receipt-admin", role: "admin", status: "approved", fullName: "Receipt Admin", email: "receipt-admin@example.test" },
    { id: "receipt-member", role: "member", status: "approved", fullName: "Receipt Member", email: "receipt-member@example.test" },
  ],
  bookings: [], receipts: [], campaigns: [], donations: [], prayers: [], notifications: [],
  sessionOverrides: {}, queues: {}, duty: {},
};
mem.set("itc.prototype.v1", JSON.stringify(receiptMigrationFixture));
store.load();
const receiptSession = store.upcomingSessions(14).find(
  (session) => session.kind === "paid" && !data.sessionStarted(session)
);
if (!receiptSession) throw new Error("post-migration receipt check needs an upcoming paid session");
const migratedReservation = store.reserveSession("receipt-member", receiptSession, islandEccOpenNow(receiptSession));
store.markBookingPaid(migratedReservation.id, "FPS", "MIGRATED-RECEIPT", Date.now());
store.signIn("receipt-admin@example.test");
const migratedConfirmation = store.confirmBookingPayment(migratedReservation.id, Date.now());
const migratedReceiptState = JSON.parse(mem.get("itc.prototype.v1"));
if (!migratedConfirmation?.receipt
    || !/^ITC-\d{4}-\d{4,}$/.test(migratedConfirmation.receipt.number)
    || migratedConfirmation.receipt.number.includes("NaN")
    || !Number.isInteger(migratedReceiptState.receiptCounter)
    || migratedReceiptState.receiptCounter < 0) {
  throw new Error("post-migration receipt issuance must use a valid normalized counter");
}
console.log("ok  v13 migration normalizes receiptCounter before real receipt issuance");

// --- Free-event venue overrides (Task 3) ---
store.resetLocalData();
installLocalFixtures();
// Add a second Admin and a pending user to exercise actor + non-member exclusions.
{
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.users.push({
    id: "fixture-other-admin", role: "superadmin", status: "approved",
    fullName: "Test Other Admin", preferredName: "Other",
    email: "other-admin@example.test",
    isMinor: false, appliedAt: Date.now() - 86400000,
    indemnityAcceptedAt: Date.now() - 86400000,
    privacyAcceptedAt: Date.now() - 86400000,
    whatsappReminders: false, emailReceipts: false, communityNews: false,
  });
  raw.users.push({
    id: "fixture-pending-user", role: "pending", status: "pending",
    fullName: "Test Pending", preferredName: "Pending",
    email: "pending-user@example.test",
    isMinor: false, appliedAt: Date.now() - 3600000,
    whatsappReminders: false, emailReceipts: false, communityNews: false,
  });
  raw.users.push({
    id: "fixture-unrelated-member", role: "member", status: "approved",
    fullName: "Test Unrelated", preferredName: "Unrelated",
    email: "unrelated@example.test",
    isMinor: false, appliedAt: Date.now() - 7200000,
    indemnityAcceptedAt: Date.now() - 7200000,
    privacyAcceptedAt: Date.now() - 7200000,
    whatsappReminders: false, emailReceipts: false, communityNews: false,
  });
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
}
const wntSession = store.upcomingSessions(21).find(
  (s) => s.activityId === "wnt" && !data.sessionStarted(s)
);
if (!wntSession) throw new Error("expected an upcoming wnt session for venue tests");
store.signIn("admin@example.test");

// A visible partial override must notify the active RSVP cohort even while
// the map remains unresolved. A non-actor RSVP Admin gets the audit row instead
// of a second attendee row; an ordinary member gets the attendee row.
const partialSwimmingSession = store.upcomingSessions(21).find(
  (s) => s.activityId === "water" && !data.sessionStarted(s)
);
if (!partialSwimmingSession) throw new Error("expected an upcoming Swimming session for partial venue tests");
store.signIn("member@example.test");
const partialMemberBooking = await store.rsvpSession("fixture-member", partialSwimmingSession.id);
store.signIn("other-admin@example.test");
const partialAdminBooking = await store.rsvpSession("fixture-other-admin", partialSwimmingSession.id);
store.signIn("admin@example.test");
store.setWeekVenue(partialSwimmingSession.id, {
  location: "Victoria Park Swimming Pool",
  mapsQuery: "",
});
const partialSwimming = store.getSession(partialSwimmingSession.id);
const partialSwimmingOverride = store.weekVenueOverride(partialSwimmingSession.id);
const partialVenueNotesFor = (userId) => store.notificationsFor(userId).filter(
  (n) => n.kind === "operational_session_venue_updated"
    && n.link === `#/activity/${partialSwimmingSession.id}`
);
const partialMemberNotes = partialVenueNotesFor("fixture-member");
const partialAdminNotes = partialVenueNotesFor("fixture-other-admin");
if (partialSwimming.location !== "Victoria Park Swimming Pool" || partialSwimming.mapsQuery) {
  throw new Error("a location-only Swimming override must render its visible location without a map");
}
if (partialSwimmingOverride.venueMemberNotifiedAt || partialMemberNotes.length !== 0) {
  throw new Error("a location-only partial override must not shared-notify until maps query is usable");
}
if (partialAdminNotes.length !== 1
    || partialAdminNotes[0]?.title !== "Session venue updated"
    || partialAdminNotes[0]?.body !== `Test Admin set the venue for ${partialSwimmingSession.id} to Victoria Park Swimming Pool.`) {
  throw new Error("a non-actor RSVP Admin must receive exactly one audit venue notification");
}
store.setWeekVenue(partialSwimmingSession.id, {
  location: "Victoria Park Swimming Pool",
  mapsQuery: "",
});
if (partialVenueNotesFor("fixture-member").length !== 0
    || partialVenueNotesFor("fixture-other-admin").length !== 1) {
  throw new Error("an exact partial venue repeat must not notify any recipient again");
}
store.signIn("other-admin@example.test");
await store.withdrawRsvp(partialAdminBooking.id);
store.signIn("member@example.test");
await store.withdrawRsvp(partialMemberBooking.id);
store.signIn("admin@example.test");

// Legacy free-event venueTBC flags must be superseded by both direct reset
// and save-then-reset so the recurring default becomes visible again.
const recurringRun = store.getActivity("run");
store.saveActivity({
  ...recurringRun,
  location: "Recurring Run Venue",
  mapsQuery: "Recurring Run Venue, Hong Kong",
});
const legacyRunSession = store.upcomingSessions(21).find(
  (s) => s.activityId === "run" && !data.sessionStarted(s)
);
if (!legacyRunSession) throw new Error("expected an upcoming Run session for legacy venueTBC tests");
store.setVenueTBC(legacyRunSession.id, true);
store.setWeekVenue(legacyRunSession.id, { location: null, mapsQuery: null });
let restoredLegacyRun = store.getSession(legacyRunSession.id);
if (restoredLegacyRun.location !== "Recurring Run Venue" || restoredLegacyRun.venueTBC) {
  throw new Error("reset must supersede a legacy venueTBC flag and restore the recurring venue");
}
store.setVenueTBC(legacyRunSession.id, true);
store.setWeekVenue(legacyRunSession.id, {
  location: "Dated Run Venue",
  mapsQuery: "Dated Run Venue, Hong Kong",
});
store.setWeekVenue(legacyRunSession.id, { location: null, mapsQuery: null });
restoredLegacyRun = store.getSession(legacyRunSession.id);
if (restoredLegacyRun.location !== "Recurring Run Venue" || restoredLegacyRun.venueTBC) {
  throw new Error("save then reset must not expose a legacy venueTBC flag");
}

store.setWeekVenue(wntSession.id, { location: null, mapsQuery: null });
store.signIn("member@example.test");
await store.rsvpSession("fixture-member", wntSession.id);
const wntTbcDetail = views.viewActivity(wntSession.id);
if (!wntTbcDetail.includes("Meeting point to be confirmed — check back before Wednesday. Bring water and a friend.")) {
  throw new Error("WNT TBC detail must include the complete meeting-point note");
}
store.signIn("admin@example.test");
store.setWeekVenue(wntSession.id, {
  location: "Central Harbourfront — 7pm sharp",
  mapsQuery: "Central Harbourfront, Hong Kong",
});
const decorated = store.getSession(wntSession.id);
if (decorated.location !== "Central Harbourfront — 7pm sharp"
    || decorated.mapsQuery !== "Central Harbourfront, Hong Kong"
    || decorated.venueTBC) {
  throw new Error("weekly venue must decorate the dated free session");
}
store.signIn("member@example.test");
const wntConfirmedDetail = views.viewActivity(wntSession.id);
if (!wntConfirmedDetail.includes("Bring water and a friend.")
    || wntConfirmedDetail.includes("Meeting point to be confirmed")) {
  throw new Error("confirmed WNT detail must remove the TBC meeting-point wording");
}
store.signIn("admin@example.test");
const wntActivity = store.getActivity("wnt");
store.saveActivity({ ...wntActivity, memberNote: "Meet by the red flag." });
if (store.getSession(wntSession.id).memberNote !== "Meet by the red flag.") {
  throw new Error("custom WNT leader notes must not be overwritten by venue text");
}
store.saveActivity({ ...wntActivity, memberNote: "Meeting point to be confirmed — check back before Wednesday. Bring water." });
const venueNotesFor = (userId, sessionId) => store.notificationsFor(userId).filter(
  (n) => n.kind === "operational_session_venue_updated"
    && n.link === `#/activity/${sessionId}`
);
const memberNotes = venueNotesFor("fixture-member", wntSession.id);
const otherAdminNotes = venueNotesFor("fixture-other-admin", wntSession.id);
const actorNotes = venueNotesFor("fixture-admin", wntSession.id);
const pendingNotes = venueNotesFor("fixture-pending-user", wntSession.id);
const unrelatedNotes = venueNotesFor("fixture-unrelated-member", wntSession.id);
if (memberNotes.length !== 1) {
  throw new Error("first confirmation must notify each member exactly once");
}
if (memberNotes[0]?.title !== "Venue confirmed") {
  throw new Error("first confirmation shared title must be Venue confirmed");
}
if (actorNotes.length !== 1) {
  throw new Error("acting admin must receive the shared venue notification");
}
if (actorNotes[0]?.title !== "Venue confirmed"
    || actorNotes[0]?.body !== memberNotes[0]?.body) {
  throw new Error("acting admin shared row must match member copy");
}
if (otherAdminNotes.length !== 1) {
  throw new Error("other admin must receive audit notification on actual save");
}
if (otherAdminNotes[0]?.title !== "Session venue updated") {
  throw new Error("other admin must receive the audit title");
}
if (pendingNotes.length) {
  throw new Error("pending profile must not receive venue notifications");
}
if (unrelatedNotes.length !== 1 || unrelatedNotes[0]?.title !== "Venue confirmed") {
  throw new Error("first confirmation must shared-notify every approved member");
}
const memberDestination = memberNotes[0];
if (memberDestination?.link !== `#/activity/${wntSession.id}`) {
  throw new Error("member notification must point at the dated activity route");
}
for (const notification of [...memberNotes, ...otherAdminNotes]) {
  if (Object.hasOwn(notification, "read_at")
      || Object.hasOwn(notification, "destination")
      || Object.hasOwn(notification, "created_at")) {
    throw new Error("local venue notifications must persist only the existing local notification shape");
  }
}
if (memberDestination?.body !== `Wednesday Night Training on ${wntSession.dateISO} is at Central Harbourfront — 7pm sharp. Check the activity page for details.`) {
  throw new Error(`member venue copy must use the activity display name; got: ${memberDestination?.body}`);
}
if (otherAdminNotes[0]?.body !== `Test Admin set the venue for ${wntSession.id} to Central Harbourfront — 7pm sharp.`) {
  throw new Error(`admin venue copy must identify the actor; got: ${otherAdminNotes[0]?.body}`);
}
// No-op save must not notify anyone.
store.setWeekVenue(wntSession.id, {
  location: "Central Harbourfront — 7pm sharp",
  mapsQuery: "Central Harbourfront, Hong Kong",
});
if (venueNotesFor("fixture-member", wntSession.id).length !== 1
    || venueNotesFor("fixture-admin", wntSession.id).length !== 1
    || venueNotesFor("fixture-other-admin", wntSession.id).length !== 1) {
  throw new Error("no-op save must not duplicate venue notifications");
}

// Later edit: shared to members + actor (Venue updated); audit to other admins.
store.setWeekVenue(wntSession.id, {
  location: "Wan Chai Promenade — 7pm sharp",
  mapsQuery: "Wan Chai Promenade, Hong Kong",
});
const memberAfterEdit = venueNotesFor("fixture-member", wntSession.id);
const actorAfterEdit = venueNotesFor("fixture-admin", wntSession.id);
const otherAfterEdit = venueNotesFor("fixture-other-admin", wntSession.id);
if (memberAfterEdit.length !== 2) {
  throw new Error("subsequent edits must re-notify members");
}
if (!memberAfterEdit.some((note) => note.title === "Venue updated")) {
  throw new Error("later shared title must be Venue updated");
}
if (actorAfterEdit.length !== 2
    || !actorAfterEdit.some((note) => note.title === "Venue updated")) {
  throw new Error("acting admin must receive later shared Venue updated");
}
if (otherAfterEdit.length !== 2) {
  throw new Error("second save must notify other Admins again");
}

// Reset: audit only; preserve venueMemberNotifiedAt for title choice.
store.setWeekVenue(wntSession.id, { location: null, mapsQuery: null });
const resetDecorated = store.getSession(wntSession.id);
if (resetDecorated.location === "Central Harbourfront — 7pm sharp"
    || resetDecorated.mapsQuery === "Central Harbourfront, Hong Kong") {
  throw new Error("reset should restore the activity-template venue values");
}
if (venueNotesFor("fixture-member", wntSession.id).length !== 2
    || venueNotesFor("fixture-admin", wntSession.id).length !== 2) {
  throw new Error("reset must not shared-notify members or actor");
}
if (venueNotesFor("fixture-other-admin", wntSession.id).length !== 3) {
  throw new Error("reset must audit other Admins");
}
if (!store.weekVenueOverride(wntSession.id)?.venueMemberNotifiedAt) {
  throw new Error("reset must preserve venueMemberNotifiedAt");
}
{
  const resetDetail = views.viewActivity(wntSession.id);
  if (resetDetail.includes('id="activity-map"') || resetDetail.includes("Loading map")) {
    throw new Error("reset to TBC/default must remove the interactive map");
  }
  if (resetDetail.includes("Get directions")) {
    throw new Error("reset to TBC/default must remove Get directions on free events");
  }
}

// Reconfirmation after reset: shared Venue updated again.
store.setWeekVenue(wntSession.id, {
  location: "Causeway Bay Promenade — 7pm sharp",
  mapsQuery: "Causeway Bay Promenade, Hong Kong",
});
if (venueNotesFor("fixture-member", wntSession.id).length !== 3) {
  throw new Error("reconfirmation after reset must shared-notify members again");
}
if (venueNotesFor("fixture-admin", wntSession.id).length !== 3) {
  throw new Error("reconfirmation after reset must shared-notify acting admin again");
}
if (venueNotesFor("fixture-other-admin", wntSession.id).length !== 4) {
  throw new Error("reconfirmation after reset must audit other Admins");
}
const reconfirmMemberNotes = venueNotesFor("fixture-member", wntSession.id);
if (reconfirmMemberNotes.filter((note) => note.title === "Venue updated").length < 2) {
  throw new Error("reconfirmation shared title must be Venue updated");
}
const weekOverride = store.weekVenueOverride(wntSession.id);
if (weekOverride.location !== "Causeway Bay Promenade — 7pm sharp"
    || weekOverride.mapsQuery !== "Causeway Bay Promenade, Hong Kong") {
  throw new Error("weekVenueOverride must expose the latest saved values");
}

// Use four weeks so this test still has three future Wednesdays after the
// current week's WNT has already started.
const tamarSession = store.upcomingSessions(28).find(
  (s) => s.activityId === "wnt" && s.id !== wntSession.id && !data.sessionStarted(s)
);
if (!tamarSession) throw new Error("expected another upcoming WNT for dated meeting-point tests");
store.setWeekVenue(tamarSession.id, {
  location: "Tamar Park",
  mapsQuery: "Tamar Park",
  meetingLat: 22.2825,
  meetingLng: 114.1659,
});
let tamarDecorated = store.getSession(tamarSession.id);
if (tamarDecorated.meetingLat !== 22.2825 || tamarDecorated.meetingLng !== 114.1659) {
  throw new Error("dated Tamar point must decorate the session");
}
let tamarOverride = store.weekVenueOverride(tamarSession.id);
if (tamarOverride.meetingLat !== 22.2825 || tamarOverride.meetingLng !== 114.1659) {
  throw new Error("Admin override read must retain the dated Tamar point");
}
const otherWnt = store.upcomingSessions(28).find(
  (s) => s.activityId === "wnt"
    && s.id !== wntSession.id && s.id !== tamarSession.id
    && !data.sessionStarted(s)
);
if (!otherWnt || "meetingLat" in store.getSession(otherWnt.id)) {
  throw new Error("dated Tamar point must not leak into another WNT occurrence");
}
const memberBeforeMove = venueNotesFor("fixture-member", tamarSession.id).length;
const adminBeforeMove = venueNotesFor("fixture-other-admin", tamarSession.id).length;
const actorBeforeMove = venueNotesFor("fixture-admin", tamarSession.id).length;
store.setWeekVenue(tamarSession.id, {
  location: "Tamar Park",
  mapsQuery: "Tamar Park",
  meetingLat: 22.2827,
  meetingLng: 114.1661,
});
if (venueNotesFor("fixture-member", tamarSession.id).length !== memberBeforeMove) {
  throw new Error("coordinate-only edit must not repeat member fan-out");
}
if (venueNotesFor("fixture-admin", tamarSession.id).length !== actorBeforeMove) {
  throw new Error("coordinate-only edit must not shared-notify the acting admin");
}
if (venueNotesFor("fixture-other-admin", tamarSession.id).length !== adminBeforeMove + 1) {
  throw new Error("coordinate-only edit must create one Admin audit notification");
}
store.setWeekVenue(tamarSession.id, {
  location: "Island ECC 9/F",
  mapsQuery: "Island ECC",
  meetingLat: 22.2827,
  meetingLng: 114.1661,
});
tamarDecorated = store.getSession(tamarSession.id);
if ("meetingLat" in tamarDecorated || "meetingLng" in tamarDecorated) {
  throw new Error("non-Tamar save must clear stale meeting coordinates");
}
for (const point of [
  { meetingLat: 22.28, meetingLng: null },
  { meetingLat: 91, meetingLng: 114.16 },
]) {
  try {
    store.setWeekVenue(tamarSession.id, {
      location: "Tamar Park", mapsQuery: "Tamar Park", ...point,
    });
    throw new Error("invalid Tamar point must fail");
  } catch (err) {
    if (err.message !== "Choose a valid meeting point.") throw err;
  }
}
store.setWeekVenue(tamarSession.id, {
  location: null, mapsQuery: null, meetingLat: null, meetingLng: null,
});
if ("meetingLat" in store.getSession(tamarSession.id)) {
  throw new Error("venue reset must remove the dated meeting point");
}
console.log("ok  local WNT override persists, clears, validates, and resets meeting coordinates");

store.setWeekVenue(wntSession.id, {
  location: "Island ECC 11/F", mapsQuery: "Island ECC",
});
let venueDetail = views.viewActivity(wntSession.id);
if (!venueDetail.includes("island-ecc-11.jpg")
    || !venueDetail.includes("The Well · 11/F Island ECC")
    || venueDetail.includes('id="activity-map"')) {
  throw new Error("11/F WNT detail must render only the 11/F guide");
}
store.setWeekVenue(wntSession.id, {
  location: "Island ECC 9/F", mapsQuery: "Island ECC",
});
venueDetail = views.viewActivity(wntSession.id);
if (!venueDetail.includes("island-ecc-9.jpg")
    || !venueDetail.includes("Kid’s Club Hall · 9/F Island ECC")
    || venueDetail.includes('id="activity-map"')) {
  throw new Error("9/F WNT detail must render only the 9/F guide");
}
store.setWeekVenue(wntSession.id, {
  location: "Tamar Park", mapsQuery: "Tamar Park",
  meetingLat: 22.2825, meetingLng: 114.1659,
});
venueDetail = views.viewActivity(wntSession.id);
if (!venueDetail.includes('data-map-lat="22.2825"')
    || !venueDetail.includes('data-map-lng="114.1659"')
    || !venueDetail.includes("destination=22.2825%2C114.1659")) {
  throw new Error("Tamar detail and directions must use the exact dated point");
}
store.setWeekVenue(wntSession.id, {
  location: "Causeway Bay Promenade — 7pm sharp",
  mapsQuery: "Causeway Bay Promenade, Hong Kong",
});
console.log("ok  WNT Activity Details selects ECC guides and exact Tamar directions");

// View: free event with a mapsQuery renders the inline map host + Get directions.
const freeDetail = views.viewActivity(wntSession.id);
if (!freeDetail.includes('id="activity-map"')
    || !freeDetail.includes("Loading map")
    || !freeDetail.includes("data-marker-label=")
    || !freeDetail.includes("Get directions")) {
  throw new Error("mapped free event must render the inline map host and directions");
}
const noMapsSession = store.upcomingSessions(21)
  .filter((s) => s.activityId === "wnt" && !data.sessionStarted(s))
  .find((s) => s.id !== wntSession.id);
if (!noMapsSession) throw new Error("expected a second upcoming wnt session for the no-map case");
store.setVenueTBC(noMapsSession.id, true);
const tbcDetail = views.viewActivity(noMapsSession.id);
if (tbcDetail.includes('id="activity-map"')) {
  throw new Error("free events without mapsQuery must not render the inline map");
}
{
  const today = data.todayLocal();
  const currentSunday = data.sundayOf(today);
  const sessionSunday = data.sundayOf(data.parseISO(noMapsSession.dateISO));
  const weekOffset = Math.round(
    (sessionSunday.getTime() - currentSunday.getTime()) / (7 * 24 * 60 * 60 * 1000)
  );
  views.scheduleState.weekOffset = weekOffset;
  views.scheduleState.selected = noMapsSession.dateISO;
  views.scheduleState.filter = "all";
  const tbcSchedule = views.viewSchedule();
  if (tbcSchedule.includes("TBC · Venue TBC") || tbcSchedule.includes("Venue TBC · TBC")) {
    throw new Error("TBC schedule rows must not duplicate venue TBC labels");
  }
  if (!tbcSchedule.includes(`href="#/activity/${noMapsSession.id}"`)) {
    throw new Error("expected TBC session row on its schedule day");
  }
}
store.setWeekVenue(noMapsSession.id, {
  location: "TBC",
  mapsQuery: "Causeway Bay Promenade, Hong Kong",
});
{
  const leftoverMapsDetail = views.viewActivity(noMapsSession.id);
  if (leftoverMapsDetail.includes('id="activity-map"')
      || leftoverMapsDetail.includes("Get directions")) {
    throw new Error("typed TBC must not keep interactive map or directions from leftover mapsQuery");
  }
}
const hyroxDetailSample = store.upcomingSessions(21).find((s) => s.activityId === "hyrox-quarry-bay" && !data.sessionStarted(s));
const hyroxDetail = views.viewActivity(hyroxDetailSample.id);
if (!hyroxDetail.includes("Get directions") || hyroxDetail.includes('id="activity-map"')) {
  throw new Error("Island ECC HYROX must expose Get directions without the inline map");
}
// Admin Activities separates recurring defaults from one-off free-session venue overrides.
const swimmingSession = store.upcomingSessions(21).find(
  (s) => s.activityId === "water" && !data.sessionStarted(s)
);
if (!swimmingSession) throw new Error("expected an upcoming swimming session for admin IA checks");
const swimmingNotesBeforeCompletion = venueNotesFor("fixture-member", swimmingSession.id).length;
store.signIn("member@example.test");
await store.rsvpSession("fixture-member", swimmingSession.id);
store.signIn("admin@example.test");
store.setWeekVenue(swimmingSession.id, {
  location: "Victoria Park Swimming Pool",
  mapsQuery: "Victoria Park Swimming Pool, Hong Kong",
});
const completedSwimmingOverride = store.weekVenueOverride(swimmingSession.id);
const completedSwimmingNotes = venueNotesFor("fixture-member", swimmingSession.id);
const completedSwimmingNote = completedSwimmingNotes.find(
  (note) => note.title === "Venue confirmed"
    && note.body === `ITC Swimming on ${swimmingSession.dateISO} is at Victoria Park Swimming Pool. Check the activity page for details.`
);
if (!completedSwimmingOverride.venueMemberNotifiedAt
    || completedSwimmingNotes.length <= swimmingNotesBeforeCompletion) {
  throw new Error("completing a partial Swimming override must shared-notify members");
}
if (!completedSwimmingNote) {
  throw new Error("Swimming member copy must use its display name and confirmed-venue semantics");
}
store.signIn("admin@example.test");
store.setWeekVenue(wntSession.id, {
  location: "Tamar Park", mapsQuery: "Tamar Park",
  meetingLat: 22.2825, meetingLng: 114.1659,
});
const activitiesHtml = await views.viewAdmin("activities");
const hyroxAdminHtml = await views.viewAdmin("payments");
if (!activitiesHtml.includes("Recurring Activity Defaults")
    || !activitiesHtml.includes("Only this session")
    || !activitiesHtml.includes("Google Maps search")
    || !activitiesHtml.includes("Save Weekly Venue")
    || !activitiesHtml.includes("Reset to Recurring Default")
    || !activitiesHtml.includes("Meeting point · Only this session")
    || !activitiesHtml.includes('name="meetingLat" value="22.2825"')
    || !activitiesHtml.includes('name="meetingLng" value="114.1659"')) {
  throw new Error("Activities must separate recurring defaults and render the dated WNT picker");
}
if (!activitiesHtml.includes("Current venue: <strong>Victoria Park Swimming Pool</strong>")
    || !activitiesHtml.includes("Recurring default: <strong>TBC</strong>")) {
  throw new Error("Activities must show distinct current and recurring venues for overridden Swimming");
}
if (activitiesHtml.includes("BFT Causeway Bay (BFT)")
    || activitiesHtml.includes("Midtown28 Fitness (Midtown)")) {
  throw new Error("Admin Activities must not append redundant HYROX venue suffixes");
}
if (activitiesHtml.includes("confirmed in-app")
    || activitiesHtml.includes("awaiting payment")
    || activitiesHtml.includes("Not open")) {
  throw new Error("Activities must not contain HYROX booking/payment status");
}
if (hyroxAdminHtml.includes("BFT Causeway Bay (BFT)")
    || hyroxAdminHtml.includes("Midtown28 Fitness (Midtown)")) {
  throw new Error("Admin Payments must not append redundant HYROX venue suffixes");
}
if ((activitiesHtml.match(/>Weekly Event Controls</g) || []).length !== 1
    || !activitiesHtml.includes("Free &amp; RSVP Events")
    || !activitiesHtml.includes("Paid Sessions")) {
  throw new Error("Activities should group weekly controls by free/RSVP and paid sessions");
}
const paidControlsSource = integratedViewSource
  .split("function adminPaidSessionControls()")[1]?.split("function adminFinalizeGym()")[0] || "";
const freeControlsSource = integratedViewSource
  .split("function adminFreeEventControls()")[1]?.split("function adminWeeklyEventControls()")[0] || "";
if (!paidControlsSource.includes('<div class="empty mt8">No upcoming paid sessions.</div>')) {
  throw new Error("Paid Sessions must retain its concise empty-group state");
}
if (!freeControlsSource.includes('<div class="empty mt8">No upcoming free or RSVP events.</div>')) {
  throw new Error("Free & RSVP Events must retain its concise empty-group state");
}
if (activitiesHtml.includes(">Weekly Venue Overrides<")
    || activitiesHtml.includes(">Weekly Session Overrides<")) {
  throw new Error("legacy weekly override headings should be removed");
}
const weeklyControlsStart = activitiesHtml.indexOf(">Weekly Event Controls<");
const oneOffEventsStart = activitiesHtml.indexOf(">One-off Events<");
const weeklyControlsHtml = weeklyControlsStart === -1 || oneOffEventsStart === -1
  ? ""
  : activitiesHtml.slice(weeklyControlsStart, oneOffEventsStart);
for (const marker of [
  'data-action="form-week-venue"',
  'data-action="reset-week-venue"',
  "Cancel this week's event",
  'id="form-session-time"',
  'id="form-session-notice"',
  'data-action="venue-tbc-toggle"',
  'id="form-cancel-week"',
]) {
  if (!weeklyControlsHtml.includes(marker)) {
    throw new Error(`Weekly Event Controls must preserve ${marker}`);
  }
}
if (!/\d+ going/.test(weeklyControlsHtml)) {
  throw new Error("Weekly Event Controls must preserve the RSVP count");
}
if (!(activitiesHtml.indexOf("Recurring Activity Defaults") < weeklyControlsStart
    && weeklyControlsStart < oneOffEventsStart)
    || !/aria-labelledby="paid-sessions-title">[\s\S]*<\/section>\s*<\/details>\s*<details class="admin-section mt24">\s*<summary><h2>One-off Events<\/h2>/.test(activitiesHtml)) {
  throw new Error("One-off Events must remain a separate section after Weekly Event Controls");
}
const recurringDefaultsHtml = activitiesHtml.slice(
  activitiesHtml.indexOf("Recurring Activity Defaults"),
  weeklyControlsStart === -1 ? undefined : weeklyControlsStart,
);
const recurringDayTimes = [...recurringDefaultsHtml.matchAll(
  /<time>(Sun|Mon|Tue|Wed|Thu|Fri|Sat)<small>(\d{2}:\d{2})<\/small><\/time>/g
)].map((match) => `${match[1]} ${match[2]}`);
assert.deepEqual(
  recurringDayTimes,
  ["Mon 19:30", "Tue 19:30", "Wed 19:30", "Sat 09:15", "Sat 10:30", "Sat 12:45"],
  "Recurring Activity Defaults must sort by weekday, then start time"
);
if (!activitiesHtml.includes("Admin Tools") || activitiesHtml.includes("Club Operations")) {
  throw new Error("Admin heading must read Admin Tools");
}
if (!activitiesHtml.includes('<details class="admin-section') || !activitiesHtml.includes("<summary>")) {
  throw new Error("Activities sections must collapse behind their headers");
}
if (hyroxAdminHtml.includes("Weekly Event Controls")
    || hyroxAdminHtml.includes('data-action="form-week-venue"')) {
  throw new Error("Payments must not contain weekly event controls");
}
if (!hyroxAdminHtml.includes(">Payments</a>")
    || hyroxAdminHtml.includes(">HYROX</a>")
    || hyroxAdminHtml.includes("Payments / Ops")) {
  throw new Error("the final Admin tab must be Payments");
}
store.signOut();
// Members cannot set a weekly venue.
store.signIn("member@example.test");
try {
  store.setWeekVenue(wntSession.id, {
    location: "Should not save",
    mapsQuery: "Should not save",
  });
  throw new Error("members must not be allowed to set a weekly venue");
} catch (err) {
  if (!err.message.toLowerCase().includes("admin")) {
    throw new Error(`member actor error should explain admin requirement, got: ${err.message}`);
  }
}
// The remaining Island ECC HYROX session keeps the fixed-venue guard.
const hyroxSample = store.upcomingSessions(21).find(
  (s) => s.activityId === "hyrox-quarry-bay" && !data.sessionStarted(s)
);
if (!hyroxSample) throw new Error("expected an upcoming hyrox session for the guard test");
try {
  store.setWeekVenue(hyroxSample.id, {
    location: "Should not save",
    mapsQuery: "Should not save",
  });
  throw new Error("HYROX venues must not be overridable");
} catch (err) {
  if (err.message !== "Activity venue is fixed.") {
    throw new Error(`HYROX error should match spec, got: ${err.message}`);
  }
}
console.log("ok  free-event weekly venue state, fan-out, dedupe, and HYROX guard");

// --- WNT venue-specific guidance ---
const venue = await import("./js/venue.js");
const sameVenueValue = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: ${JSON.stringify(actual)}`);
  }
};
if (venue.normalizeVenueLocation("  ISLAND ECC 11 / F ") !== "island ecc 11/f") {
  throw new Error("11/F venue formatting must canonicalize");
}
if (venue.normalizeVenueLocation("Island ECC 9F") !== "island ecc 9/f") {
  throw new Error("9F venue formatting must canonicalize");
}
if (venue.normalizeVenueLocation("Tamar Park, Admiralty") !== "tamar park") {
  throw new Error("Tamar alias must canonicalize");
}
if (venue.normalizeVenueLocation("Tamar Street") === "tamar park") {
  throw new Error("unrelated Tamar text must not specialize");
}
sameVenueValue(
  venue.normalizeMeetingPoint("22.2816182", "114.1655613"),
  { lat: 22.2816182, lng: 114.1655613 },
  "valid meeting point"
);
for (const [lat, lng] of [[null, 114], [91, 114], [22, -181], ["x", 114]]) {
  if (venue.normalizeMeetingPoint(lat, lng) !== null) {
    throw new Error(`invalid meeting point accepted: ${lat},${lng}`);
  }
}
sameVenueValue(venue.venuePresentationFor({
  id: "wnt-2026-09-02", activityId: "wnt", location: "Island ECC 11/F",
  mapsQuery: "Island ECC", markerLabel: "WNT · 2 Sep · 7:30 PM",
}), {
  kind: "image",
  src: "../assets/itc/venues/island-ecc-11.jpg",
  alt: "Route to The Well on 11/F at Island ECC",
  caption: "The Well · 11/F Island ECC",
  fallbackQuery: "Island ECC",
}, "11/F image presentation");
sameVenueValue(venue.venuePresentationFor({
  id: "wnt-2026-09-09", activityId: "wnt", location: "Island ECC 9F",
  mapsQuery: "Island ECC", markerLabel: "WNT · 9 Sep · 7:30 PM",
}), {
  kind: "image",
  src: "../assets/itc/venues/island-ecc-9.jpg",
  alt: "Route to Kid’s Club Hall on 9/F at Island ECC",
  caption: "Kid’s Club Hall · 9/F Island ECC",
  fallbackQuery: "Island ECC",
}, "9/F image presentation");
sameVenueValue(venue.venuePresentationFor({
  id: "wnt-2026-09-16", activityId: "wnt", location: "Tamar Park",
  mapsQuery: "Tamar Park", markerLabel: "WNT · 16 Sep · 7:30 PM",
}), {
  kind: "coordinates", lat: 22.2816182, lng: 114.1655613,
  markerLabel: "WNT · 16 Sep · 7:30 PM",
}, "default Tamar presentation");
sameVenueValue(venue.venuePresentationFor({
  id: "run-2026-09-14", activityId: "run", location: "Island ECC 9/F",
  mapsQuery: "Island ECC", markerLabel: "Run",
}), { kind: "geocode", query: "Island ECC", markerLabel: "Run" },
"non-WNT generic presentation");
for (const path of [
  "../assets/itc/venues/island-ecc-11.jpg",
  "../assets/itc/venues/island-ecc-9.jpg",
]) {
  if (!existsSync(resolve(__dirnameSmoke, path))) throw new Error(`missing venue guide: ${path}`);
}
console.log("ok  WNT venue resolver selects ECC images, Tamar point, and generic fallback");

// --- Inline free-event venue map (Task 5) ---
const map = await import("./js/map.js");
if (JSON.stringify(map.parseGeocodeCache('{"Central":{"lat":22.281,"lon":114.159}}'))
  !== JSON.stringify({ Central: { lat: 22.281, lon: 114.159 } })) {
  throw new Error("parseGeocodeCache should read valid entries");
}
if (JSON.stringify(map.parseGeocodeCache("not-json")) !== "{}") {
  throw new Error("parseGeocodeCache should drop invalid JSON");
}
if (JSON.stringify(map.parseGeocodeCache('{"Bad":{"lat":"NaN","lon":114}}')) !== "{}") {
  throw new Error("parseGeocodeCache should drop non-finite coords");
}
if (JSON.stringify(map.normalizeGeocodeResult([{ lat: "22.281", lon: "114.159" }]))
  !== JSON.stringify({ lat: 22.281, lon: 114.159 })) {
  throw new Error("normalizeGeocodeResult should coerce string coordinates");
}
if (map.normalizeGeocodeResult([]) !== null) {
  throw new Error("normalizeGeocodeResult should reject empty arrays");
}
if (map.normalizeGeocodeResult([{ lat: "x", lon: "114" }]) !== null) {
  throw new Error("normalizeGeocodeResult should reject non-finite coordinates");
}

// Exact meeting-point maps must bypass Nominatim and use the dated point.
const originalDocument = globalThis.document;
const originalLeaflet = globalThis.L;
const exactSetViews = [];
const exactMarkers = [];
globalThis.document = {
  createElement: () => ({ textContent: "", children: [], appendChild(child) { this.children.push(child); } }),
};
globalThis.L = {
  map: () => ({ setView(coords, zoom) { exactSetViews.push([coords, zoom]); } }),
  tileLayer: () => ({ addTo() {} }),
  marker: (coords) => ({
    addTo() { exactMarkers.push(coords); return this; },
    bindPopup() {},
  }),
};
const exactMapHost = {
  id: "activity-map",
  dataset: {
    mapLat: "22.2825", mapLng: "114.1659", markerLabel: "WNT meeting point",
  },
  isConnected: true,
  innerHTML: "<p>Loading map…</p>",
};
const exactMounted = await map.mountActivityMap(exactMapHost, {
  fetchImpl: async () => { throw new Error("exact map must not geocode"); },
  loadLeaflet: async () => {},
});
globalThis.document = originalDocument;
globalThis.L = originalLeaflet;
if (!exactMounted
    || JSON.stringify(exactSetViews) !== JSON.stringify([[[22.2825, 114.1659], 15]])
    || JSON.stringify(exactMarkers) !== JSON.stringify([[22.2825, 114.1659]])) {
  throw new Error(`exact map must mount at the dated point without geocoding: mounted=${exactMounted} views=${JSON.stringify(exactSetViews)} markers=${JSON.stringify(exactMarkers)}`);
}

// mountActivityMap must start geocoding and Leaflet loading concurrently.
let releaseGeocode;
const geocodeGate = new Promise((resolve) => { releaseGeocode = resolve; });
const starts = [];
const concurrentHost = {
  id: "activity-map",
  dataset: {
    mapsQuery: "task-5-concurrency-imaginary-place",
    markerLabel: "ITC Swimming",
  },
  isConnected: true,
  innerHTML: "<p>Loading map…</p>",
};
mem.set("itc.geocode.v1", "{}");
const concurrentMount = map.mountActivityMap(concurrentHost, {
  fetchImpl: async () => {
    starts.push("geocode");
    await geocodeGate;
    return { ok: true, json: async () => [] };
  },
  loadLeaflet: async () => { starts.push("leaflet"); },
});
await Promise.resolve();
const startedConcurrently = JSON.stringify(starts) === JSON.stringify(["geocode", "leaflet"]);
releaseGeocode();
const concurrentResult = await concurrentMount;
if (!startedConcurrently) {
  throw new Error(`geocoding and Leaflet must start concurrently; saw ${JSON.stringify(starts)}`);
}
if (concurrentResult !== false) {
  throw new Error("empty geocode result must still resolve to false");
}

// mountActivityMap must resolve to false and render fallback when no result is found.
const mapHost = {
  id: "activity-map",
  dataset: { mapsQuery: "nowhere-imaginary-place", markerLabel: "Test session" },
  isConnected: true,
  innerHTML: "<p>Loading map\u2026</p>",
};
mem.set("itc.geocode.v1", "{}");
let emptyResultLoaderStarted = false;
const mountedMissing = await map.mountActivityMap(mapHost, {
  fetchImpl: async () => ({
    ok: true,
    json: async () => [],
  }),
  loadLeaflet: async () => { emptyResultLoaderStarted = true; },
});
if (mountedMissing !== false) {
  throw new Error("missing geocode must not mount a map");
}
if (!emptyResultLoaderStarted) {
  throw new Error("the concurrent Leaflet loader must start even when geocoding returns empty");
}
if (!/Couldn.t find the venue on the map/.test(mapHost.innerHTML)
  || !/tap Get directions instead/.test(mapHost.innerHTML)) {
  throw new Error(`fallback copy not rendered: ${mapHost.innerHTML}`);
}

// Leaflet loading rejection is independent from an empty geocode result and
// must settle on the same fallback.
const rejectedLoaderQuery = "loader-rejection-imaginary-place";
mem.set("itc.geocode.v1", JSON.stringify({
  [rejectedLoaderQuery]: { lat: 22.281, lon: 114.159 },
}));
const rejectedLoaderHost = {
  id: "activity-map",
  dataset: { mapsQuery: rejectedLoaderQuery, markerLabel: "Rejected loader" },
  isConnected: true,
  innerHTML: "<p>Loading map…</p>",
};
const rejectedLoaderResult = await map.mountActivityMap(rejectedLoaderHost, {
  loadLeaflet: async () => { throw new Error("simulated Leaflet loader rejection"); },
});
if (rejectedLoaderResult !== false
    || !/Couldn.t find the venue on the map/.test(rejectedLoaderHost.innerHTML)) {
  throw new Error("Leaflet loader rejection must return false with fallback copy");
}

// Leaflet may load successfully and still throw while constructing the map.
// That rendering exception must not be reported as a successful mount.
const renderingExceptionQuery = "rendering-exception-imaginary-place";
mem.set("itc.geocode.v1", JSON.stringify({
  [renderingExceptionQuery]: { lat: 22.282, lon: 114.16 },
}));
const renderingExceptionHost = {
  id: "activity-map",
  dataset: { mapsQuery: renderingExceptionQuery, markerLabel: "Rendering exception" },
  isConnected: true,
  innerHTML: "<p>Loading map…</p>",
};
const previousLeafletGlobal = globalThis.L;
globalThis.L = {
  map() { throw new Error("simulated Leaflet rendering exception"); },
};
const renderingExceptionResult = await map.mountActivityMap(renderingExceptionHost, {
  loadLeaflet: async () => {},
});
globalThis.L = previousLeafletGlobal;
if (renderingExceptionResult !== false
    || !/Couldn.t find the venue on the map/.test(renderingExceptionHost.innerHTML)) {
  throw new Error("Leaflet rendering exceptions must return false with fallback copy");
}
console.log("ok  inline free-event map renders fallback for lookup, loader, and rendering failures");

// Manual HYROX replacement lifecycle: local mode preserves payer ownership
// until an approved member is claimed and an Admin confirms the handover.
installLocalFixtures({ withMemberBooking: true });
const replacementFixture = JSON.parse(mem.get("itc.prototype.v1"));
replacementFixture.users.push({
  id: "replacement-member", role: "member", status: "approved", fullName: "Replacement Member",
  preferredName: "Replacement", email: "replacement@example.test",
});
mem.set("itc.prototype.v1", JSON.stringify(replacementFixture));
store.load();
store.signIn("member@example.test");
const replacementBooking = store.getBooking("fixture-booking");
assert.ok(replacementBooking, "replacement lifecycle needs a confirmed HYROX booking");
const payerId = replacementBooking.userId;
const payerPaymentRef = replacementBooking.paymentRef;
const replacementRequest = await store.createReplacementRequest(replacementBooking.id, Date.now());
assert.equal(replacementRequest.status, "pending");
assert.ok(replacementRequest.inviteToken);
assert.equal(store.replacementInviteForToken(replacementRequest.inviteToken).inviteToken, undefined);
const pendingBookingHtml = views.viewBooking(replacementBooking.id);
assert.match(pendingBookingHtml, /Share via WhatsApp/);
assert.match(pendingBookingHtml, /wa\.me/);
assert.match(pendingBookingHtml, /I can’t attend — arrange a replacement/);
await assert.rejects(
  () => store.createReplacementRequest(replacementBooking.id, Date.now()),
  /already active/i,
);
store.signIn("replacement@example.test");
const pendingInviteHtml = await views.viewReplacementInvite(replacementRequest.inviteToken);
assert.match(pendingInviteHtml, /Accept replacement/);
assert.doesNotMatch(pendingInviteHtml, /@example/);
const acceptedReplacement = await store.acceptReplacement(replacementRequest.inviteToken, Date.now());
assert.equal(acceptedReplacement.status, "accepted");
assert.equal(store.getBooking(replacementBooking.id).replacementUserId, null,
  "accepted replacement must not change the attendee before Admin confirmation");
store.signIn("admin@example.test");
const pendingAdminRequests = await store.replacementRequestsForAdmin();
assert.equal(pendingAdminRequests.length, 1);
assert.equal(pendingAdminRequests[0].status, "accepted");
assert.equal(pendingAdminRequests[0].originalDisplayName, "Tester");
assert.equal(pendingAdminRequests[0].replacementDisplayName, "Replacement");
assert.equal("inviteToken" in pendingAdminRequests[0], false);
assert.equal("email" in pendingAdminRequests[0], false);
assert.equal("paymentReference" in (pendingAdminRequests[0].snapshot || {}), false);
assert.equal("privateSecret" in (pendingAdminRequests[0].snapshot || {}), false);
const pendingAdminPayments = await views.viewAdmin("payments");
assert.match(pendingAdminPayments, /Pending Admin confirmation/);
assert.match(pendingAdminPayments, /Replacement/);
assert.match(pendingAdminPayments, /Confirm replacement/);
assert.match(pendingAdminPayments, /Reject replacement/);
store.signIn("member@example.test");
const memberAdminView = await views.viewAdmin("payments");
assert.deepEqual(memberAdminView, { redirect: "#/account" });
store.signIn("replacement@example.test");
await assert.rejects(
  () => store.acceptReplacement(replacementRequest.inviteToken, Date.now()),
  /no longer available/i,
);
store.signIn("admin@example.test");
const confirmedReplacement = await store.decideReplacement(
  replacementRequest.id, true, null, Date.now()
);
assert.equal(confirmedReplacement.status, "confirmed");
const confirmedBooking = store.getBooking(replacementBooking.id);
assert.equal(confirmedBooking.userId, payerId, "replacement must preserve payer ownership");
assert.equal(confirmedBooking.paymentRef, payerPaymentRef, "replacement must preserve payment reference");
assert.equal(confirmedBooking.replacementUserId, "replacement-member");
assert.equal(store.effectiveAttendeeId(confirmedBooking), "replacement-member");
assert.deepEqual(store.attendeesFor(store.getSession(confirmedBooking.sessionId)), ["Replacement M."]);
store.signIn("replacement@example.test");
const confirmedReplacementSession = store.getSession(confirmedBooking.sessionId);
const replacementOtherSlot = store.upcomingSessions(21).find((session) =>
  data.ISLAND_ECC_HYROX_ACTIVITY_IDS.has(session.activityId)
    && session.dateISO === confirmedReplacementSession.dateISO
    && session.id !== confirmedReplacementSession.id
);
assert.ok(replacementOtherSlot, "replacement guard needs the other Island ECC slot");
assert.throws(
  () => store.reserveSession("replacement-member", confirmedReplacementSession.id, islandEccOpenNow(confirmedReplacementSession)),
  /Choose one Island ECC HYROX slot per Saturday/,
  "a confirmed replacement attendee must not reserve the same Island ECC slot again"
);
assert.throws(
  () => store.reserveSession("replacement-member", replacementOtherSlot.id, islandEccOpenNow(replacementOtherSlot)),
  /Choose one Island ECC HYROX slot per Saturday/,
  "a confirmed replacement attendee must not reserve the other Island ECC slot"
);
assert.match(views.viewBooking(replacementBooking.id), /You’re booked in/);
assert.match(views.viewBooking(replacementBooking.id), /HK\$180/);
assert.equal(store.receiptsForUser("replacement-member").length, 0);
assert.equal(store.replacementAuditForRequest(replacementRequest.id).length, 3);
store.signIn("admin@example.test");
assert.equal(
  (await store.decideReplacement(replacementRequest.id, true, null, Date.now())).status,
  "confirmed",
  "repeated Admin confirmation must be idempotent",
);
console.log("ok  local HYROX replacement claim, audit, confirmation, and payer preservation");

store.signIn("member@example.test");
const confirmedBookingHtml = views.viewBooking(replacementBooking.id);
assert.match(confirmedBookingHtml, /Replacement confirmed/);
assert.match(confirmedBookingHtml, /payer and receipt owner/);
assert.doesNotMatch(confirmedBookingHtml, /Create private invite/);
assert.equal(
  views.replacementShareUrl(
    "invite token/with details",
    "https://testing.itc.example/app/?auth_callback=1#/booking/original"
  ),
  "https://testing.itc.example/app/#/replacement/invite%20token%2Fwith%20details",
  "WhatsApp replacement shares must use a complete clickable app URL without query data",
);
assert.equal(views.replacementShareUrl("invite-token", "not a URL"), "#/replacement/invite-token");
const confirmedInviteHtml = await views.viewReplacementInvite(replacementRequest.inviteToken);
assert.match(confirmedInviteHtml, /Replacement confirmed/);
assert.doesNotMatch(confirmedInviteHtml, new RegExp(replacementRequest.inviteToken));
store.signOut();
assert.match(await views.viewReplacementInvite(replacementRequest.inviteToken), /Sign in to view this invite/);
console.log("ok  replacement route preserves sign-in gate, privacy, and confirmed-member copy");

{
  if (!store.signIn("member@example.test").ok) {
    failures++;
    console.error("FAIL session reminder sweep needs the fixture member");
  } else {
    const reminderMember = store.currentUser();
    const rsvpSession = store.upcomingSessions(21).find((session) => store.sessionRequiresRsvp(session) && !data.sessionStarted(session)
      && !store.userBookingFor(reminderMember.id, session.id));
    if (!reminderMember || !rsvpSession) {
      failures++;
      console.error("FAIL session reminder sweep needs a signed-in member and upcoming RSVP session");
    } else {
      const beforeCount = store.notificationsFor(reminderMember.id)
        .filter((note) => note.kind === "operational_session_reminder_tomorrow").length;
      const booking = await store.rsvpSession(reminderMember.id, rsvpSession);
      const dayBefore = data.sessionReminderTomorrowAt(rsvpSession.dateISO) + 60 * 1000;
      store.sweepSessionReminders(dayBefore);
      store.sweepSessionReminders(dayBefore);
      const tomorrowNotes = store.notificationsFor(reminderMember.id)
        .filter((note) => note.kind === "operational_session_reminder_tomorrow");
      if (!booking || tomorrowNotes.length !== beforeCount + 1) {
        failures++;
        console.error("FAIL session reminders must send one tomorrow ping for an RSVP");
      } else console.log("ok  session reminders send one tomorrow ping");
      await store.updateMyPrivacyPreferences({
        session_alerts: false,
        email_receipts: !!reminderMember.emailReceipts,
        community_news: !!reminderMember.communityNews,
        hyrox_payment_reminders: reminderMember.hyroxPaymentReminders !== false,
        web_push_ops: !!reminderMember.webPushOps,
      });
      const morningAt = data.sessionReminderMorningAt(rsvpSession.dateISO) + 60 * 1000;
      store.sweepSessionReminders(morningAt);
      const morningNotes = store.notificationsFor(reminderMember.id)
        .filter((note) => note.kind === "operational_session_reminder_morning");
      if (morningNotes.length) {
        failures++;
        console.error("FAIL opted-out session reminders must not send the morning ping");
      } else console.log("ok  session reminder opt-out skips the morning ping");
      if (booking?.id) await store.withdrawRsvp(booking.id);
    }
  }
}

{
  installLocalFixtures();
  store.signIn("member@example.test");
  const optedIn = store.currentUser();
  await store.updateMyPrivacyPreferences({
    session_alerts: optedIn.sessionAlerts !== false,
    email_receipts: true,
    community_news: !!optedIn.communityNews,
    hyrox_payment_reminders: optedIn.hyroxPaymentReminders !== false,
    web_push_ops: !!optedIn.webPushOps,
  });
  const paidSession = store.upcomingSessions(21).find((session) =>
    session.kind === "paid" && !data.sessionStarted(session)
    && !store.userBookingFor(optedIn.id, session.id));
  if (!paidSession) {
    failures++;
    console.error("FAIL email receipt send needs a future paid session");
  } else {
    const hold = store.reserveSession(optedIn.id, paidSession.id, islandEccOpenNow(paidSession));
    store.markBookingPaid(hold.id, "PayMe", "EMAIL-RECEIPT");
    store.signIn("admin@example.test");
    const issued = store.confirmBookingPayment(hold.id);
    if (issued?.receipt?.emailSentTo !== "member@example.test" || !issued?.receipt?.emailSentAt) {
      failures++;
      console.error("FAIL opted-in email receipts must record send to the membership email");
    } else console.log("ok  opted-in email receipts record send to the membership email");
  }
  installLocalFixtures();
  store.signIn("member@example.test");
  const optedOut = store.currentUser();
  const otherSession = store.upcomingSessions(21).find((session) =>
    session.kind === "paid" && !data.sessionStarted(session)
    && !store.userBookingFor(optedOut.id, session.id));
  if (!otherSession) {
    failures++;
    console.error("FAIL email receipt opt-out needs a future paid session");
  } else {
    const hold = store.reserveSession(optedOut.id, otherSession.id, islandEccOpenNow(otherSession));
    store.markBookingPaid(hold.id, "PayMe", "EMAIL-RECEIPT-OFF");
    store.signIn("admin@example.test");
    const issued = store.confirmBookingPayment(hold.id);
    if (issued?.receipt?.emailSentTo || issued?.receipt?.emailSentAt) {
      failures++;
      console.error("FAIL opted-out email receipts must not record a send");
    } else console.log("ok  opted-out email receipts skip send");
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll smoke tests passed.");
process.exit(failures ? 1 : 0);
