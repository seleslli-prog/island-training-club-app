// ==========================================================================
// ITC prototype — state store.
// localStorage-backed stand-in for the future backend. Every domain action
// (signup, approval, booking, payment, cancellation, admin edits) goes
// through this module so swapping in a real API later touches one file.
// ==========================================================================

import {
  SEED_ACTIVITIES,
  ISLAND_ECC_HYROX_ACTIVITY_IDS,
  compareSessionsByStart,
  sessionsInRange,
  sessionStarted,
  hktEventStartMs,
  parseISO,
  findSession,
  todayHktISO,
  todayLocal,
  isoDate,
  saturdayOnOrAfter,
  fmtDate,
  fmtTime,
  nextPayDeadline,
  islandEccSignupOpen,
  islandEccNextPayDeadline,
  islandEccMemberReminderAt,
  islandEccCollectorFinalizeNudgeAt,
  ISLAND_ECC_SIGNUP_LOCKED_ERROR,
  uid,
  normalizeDonorId,
  donorIdProblem,
} from "./data.js";
import { config, supabase, isLive } from "./config.js";
import { INDEMNITY_VERSION } from "./documents.js";
import { normalizeAvatarPresentation } from "./avatar.js";
import {
  isRetiredHyroxActivityId,
  isRetiredHyroxCycleId,
  isRetiredHyroxSession,
  isRetiredHyroxBooking,
  isRetiredHyroxReceipt,
  isRetiredHyroxNotification,
  isRetiredHyroxLegacyRouteId,
} from "./hyrox-retirement.js";
import { normalizeMeetingPoint, normalizeVenueLocation, hasConfirmedVenue } from "./venue.js";
import { announcementPlainText, assertSafeAnnouncementMarkdown } from "./announcement-markdown.js";
import * as liveOps from "./operations.js";

const STORAGE_KEY = "itc.prototype.v1";
const APPLY_DEVICE_KEY = "itc.device.id";
const APPLY_DRAFT_KEY = "itc.apply.draft.v1"; // legacy single-draft key
const APPLY_DRAFTS_KEY = "itc.apply.drafts.v2";
const APPLY_DRAFT_VERSION = 2;
const UNCLAIMED_DRAFT_OWNER = "__unclaimed__";
const LAST_ROUTE_KEY = "itc.last-route.v1";
const LAST_ROUTE_VERSION = 1;
const STATE_VERSION = 28;

const ROUTE_ID = "[A-Za-z0-9._~-]+";
const RESTORABLE_ROUTE_PATTERNS = [
  /^#\/(?:home|schedule|giving|notifications|apply)$/,
  /^#\/community(?:\/(?:prayers|fellowship|meals|announcements|about))?$/,
  /^#\/account(?:\/(?:details(?:\/edit)?|indemnity|agreements|donor|payments|privacy(?:\/edit)?|notifications(?:\/edit)?|bookings(?:\/attended)?|history))?$/,
  new RegExp(`^#/(?:activity|checkout|pay|booking|receipt)/${ROUTE_ID}$`),
  new RegExp(`^#/hyrox/${ROUTE_ID}(?:/register)?$`),
  new RegExp(`^#/replacement/${ROUTE_ID}$`),
  /^#\/admin(?:\/(?:members|activities|prayers|giving|payments))?$/,
  new RegExp(`^#/admin/(?:activity|campaign)/${ROUTE_ID}$`),
];

// Live-mode (Supabase) session cache. Avoids hammering the DB on every
// page load. The TTL is short so role flips and welcome notifications
// surface promptly after the admin takes an action.
let liveProfile = null;
let liveUser = null;
let liveProfileFetchedAt = 0;
let liveGivingCampaign = null;
let livePublishedAnnouncements = [];
// Supabase remains the identity directory. Payment Ops caches live profiles
// in memory only; device-local persistence stores UUID-keyed operations.
let livePaymentDirectory = new Map();
const liveReplacementTokens = new Map();
const livePendingReplacementStates = new Map();
const LIVE_PROFILE_TTL_MS = 30_000;
const AVATAR_CACHE_EXPIRY_SKEW_MS = 30_000;
const AVATAR_APPROVED_ROLES = new Set(["member", "admin", "superadmin", "super_admin"]);
let ownAvatarCache = null;
let ownAvatarRequest = null;
let avatarRequestGeneration = 0;
const sessionAvatarCache = new Map();
let adminAvatarCache = null;

let state = null;

function retirementSession(id) {
  if (!id) return null;
  if (isLive()) return liveOps.getLiveSession(id) || liveOps.liveRetiredSessionStub?.(id) || null;
  return findSession(state?.activities || [], id)
    || state?.oneOffEvents?.find((event) => `${event.id}-${event.dateISO}` === id)
    || null;
}

function retirementBooking(id) {
  if (!id) return null;
  if (isLive()) return liveOps.liveBookingById(id) || liveOps.liveRetiredBookingStub?.(id) || null;
  return state?.bookings?.find((booking) => booking.id === id) || null;
}

const bookingIsRetired = (booking) =>
  isRetiredHyroxBooking(booking, retirementSession);
const receiptIsRetired = (receipt) =>
  isRetiredHyroxReceipt(receipt, retirementBooking);
const retiredTargetError = () => new Error("This session is no longer available.");
const retirementBoundaryActive = () => isLive() || Number(state?.version || 0) >= 24;

function assertActiveSessionTarget(sessionOrId) {
  if (!retirementBoundaryActive()) return;
  const canonicalSession = typeof sessionOrId === "object"
    ? sessionOrId
    : retirementSession(sessionOrId);
  const unloadedLegacyRoute = typeof sessionOrId === "string"
    && !canonicalSession
    && isRetiredHyroxLegacyRouteId(sessionOrId);
  if (isRetiredHyroxSession(canonicalSession) || unloadedLegacyRoute) {
    throw retiredTargetError();
  }
}

function assertActiveBookingTarget(bookingOrId) {
  if (!retirementBoundaryActive()) return;
  const booking = typeof bookingOrId === "object"
    ? bookingOrId
    : retirementBooking(bookingOrId);
  if (bookingIsRetired(booking)) throw retiredTargetError();
}

export function isRetiredHyroxMemberRoute(kind, id) {
  if (!retirementBoundaryActive()) return false;
  if (isRetiredHyroxLegacyRouteId(id)) return true;
  const routeKind = String(kind || "");
  const routeId = String(id || "");
  if (["booking", "pay"].includes(routeKind)) return bookingIsRetired(retirementBooking(routeId));
  if (routeKind === "receipt") {
    if (isLive() && liveOps.isLiveRetiredReceiptId(routeId)) return true;
    const receipt = isLive()
      ? liveOps.liveReceiptById(routeId)
      : state?.receipts?.find((row) => row.id === routeId);
    return receiptIsRetired(receipt);
  }
  return false;
}

export function isRetiredHyroxHashRoute(route) {
  const value = String(route || "");
  const direct = value.match(/^#\/(activity|checkout|pay|booking|receipt)\/([^/?#]+)$/);
  if (direct) return isRetiredHyroxMemberRoute(direct[1], direct[2]);
  const cycle = value.match(/^#\/hyrox\/([^/?#]+)(?:\/register)?$/);
  return Boolean(cycle && isRetiredHyroxMemberRoute("hyrox", cycle[1]));
}

export function isRestorableRoute(route) {
  return typeof route === "string"
    && route.length <= 240
    && RESTORABLE_ROUTE_PATTERNS.some((pattern) => pattern.test(route));
}

function routeOwner(userId) {
  return userId ? `user:${String(userId)}` : "visitor";
}

export function rememberLastRoute(route, userId = null) {
  if (!isRestorableRoute(route)) return false;
  try {
    localStorage.setItem(LAST_ROUTE_KEY, JSON.stringify({
      version: LAST_ROUTE_VERSION,
      owner: routeOwner(userId),
      route,
    }));
    return true;
  } catch {
    return false;
  }
}

export function lastRouteFor(userId = null) {
  try {
    const raw = localStorage.getItem(LAST_ROUTE_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record?.version !== LAST_ROUTE_VERSION || !isRestorableRoute(record?.route)) {
      localStorage.removeItem(LAST_ROUTE_KEY);
      return null;
    }
    return record.owner === routeOwner(userId) ? record.route : null;
  } catch {
    try { localStorage.removeItem(LAST_ROUTE_KEY); } catch {}
    return null;
  }
}

export function clearLastRoute() {
  try { localStorage.removeItem(LAST_ROUTE_KEY); } catch {}
}

export function startupRoute(currentHash, userId = null) {
  const explicitRoute = typeof currentHash === "string" ? currentHash.trim() : "";
  return explicitRoute || lastRouteFor(userId) || "#/home";
}

export function shouldRedirectPendingApplicant({ role, hasApplication, route } = {}) {
  return role === "pending"
    && !hasApplication
    && !["#/apply", "#/community/prayers"].includes(route)
    && !isRetiredHyroxHashRoute(route);
}

function freshState() {
  return {
    version: STATE_VERSION,
    sessionUserId: null,
    activities: structuredClone(SEED_ACTIVITIES),
    users: [],
    bookings: [],
    receipts: [],
    receiptCounter: 49,
    paymentPayouts: {},
    campaigns: [],
    donations: [],
    prayers: [],
    oneOffEvents: [],
    sessionOverrides: {},
    queues: {},
    hyroxCycles: {},
    hyroxCycleQueues: {},
    replacementRequests: [],
    replacementAudit: [],
    notifications: [],
    announcements: [],
    duty: {},
    islandEccWeekOps: {},
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = raw ? JSON.parse(raw) : freshState();
  } catch {
    state = freshState();
  }
  migrate();
  sweepCheckpoints();
  save();
  return state;
}

export async function hydrateLiveOperations({ ensureWindow = false, force = false } = {}) {
  if (!isLive()) return null;
  if (ensureWindow) {
    try {
      await liveOps.ensureLiveSessionWindow();
    } catch (err) {
      console.warn("ensureLiveSessionWindow failed", err);
    }
  }
  let authenticated = false;
  try {
    const { data } = await supabase.auth.getSession();
    authenticated = Boolean(data?.session);
  } catch {
    authenticated = false;
  }
  await liveOps.hydrateOperationalState({ force, authenticated });
  await liveOps.startOperationalRealtime();
  if (authenticated) {
    try {
      await refreshLivePublishedAnnouncements();
    } catch (err) {
      console.warn("refreshLivePublishedAnnouncements failed", err);
    }
  } else {
    livePublishedAnnouncements = [];
  }
  return liveOps.operationalStateStatus();
}

function normalizeReceiptCounter() {
  if (Number.isInteger(state.receiptCounter) && state.receiptCounter >= 0) return;
  const highestIssued = state.receipts.reduce((highest, receipt) => {
    const match = String(receipt?.number || "").match(/-(\d+)$/);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, -1);
  state.receiptCounter = Math.max(49, highestIssued + 1);
}

// One-time, versioned migrations for persisted state that predates a
// seed-data revision. Each step runs once per version so admin edits made
// afterwards are not reverted on the next load.
function retireLocalHyroxPool() {
  const sessionForId = (id) => findSession(state.activities, String(id || ""));
  const retiredSessionIds = new Set();
  const retiredCycleIds = new Set();
  const collectSessionId = (id) => {
    const value = String(id || "");
    if (isRetiredHyroxLegacyRouteId(value)) retiredSessionIds.add(value);
  };
  const collectRecordSession = (record) => {
    if (!record || typeof record !== "object") return;
    const sessionId = record.sessionId ?? record.session_id;
    if (isRetiredHyroxSession(record) && sessionId) {
      retiredSessionIds.add(String(sessionId));
    }
    collectSessionId(sessionId);
  };

  const collectCycleId = (id) => {
    const value = String(id || "");
    if (isRetiredHyroxCycleId(value)) retiredCycleIds.add(value);
  };
  const cycleIdFor = (record) => record?.cycleId ?? record?.hyrox_cycle_id;

  for (const id of Object.keys(state.queues)) collectSessionId(id);
  for (const id of Object.keys(state.sessionOverrides)) collectSessionId(id);
  for (const [key, cycle] of Object.entries(state.hyroxCycles)) {
    const childSessionIds = [
      cycle?.bftSessionId ?? cycle?.bft_session_id,
      cycle?.midtownSessionId ?? cycle?.midtown_session_id,
    ].filter(Boolean);
    for (const id of childSessionIds) collectSessionId(id);
    if (isRetiredHyroxCycleId(key)
        || isRetiredHyroxCycleId(cycle?.id)
        || isRetiredHyroxSession(cycle)
        || childSessionIds.some((id) => isRetiredHyroxLegacyRouteId(id))) {
      retiredCycleIds.add(String(key));
      if (cycle?.id) retiredCycleIds.add(String(cycle.id));
    }
  }
  for (const collection of [
    state.bookings,
    state.receipts,
    state.replacementRequests,
    state.replacementAudit,
    state.notifications,
    Object.values(state.duty),
  ]) {
    for (const record of collection) {
      collectRecordSession(record);
      collectCycleId(cycleIdFor(record));
    }
  }

  const bookingById = new Map(state.bookings.map((booking) => [booking.id, booking]));
  const bookingTargetsPool = (booking) => Boolean(booking) && (
    isRetiredHyroxBooking(booking, sessionForId)
    || retiredCycleIds.has(String(cycleIdFor(booking) || ""))
    || retiredSessionIds.has(String(booking.sessionId ?? booking.session_id ?? ""))
  );
  const retiredBookingIds = new Set(
    state.bookings.filter(bookingTargetsPool).map((booking) => booking.id)
  );
  const requestTargetsPool = (request) => Boolean(request) && (
    retiredCycleIds.has(String(cycleIdFor(request) || ""))
    || isRetiredHyroxSession(request)
    || retiredSessionIds.has(String(request.sessionId ?? request.session_id ?? ""))
    || retiredBookingIds.has(request.bookingId ?? request.booking_id)
  );
  const retiredRequests = state.replacementRequests.filter(requestTargetsPool);
  const retiredRequestIds = new Set(retiredRequests.map((request) => request.id));
  const retiredInviteTokens = new Set(
    retiredRequests.map((request) => request.inviteToken).filter(Boolean)
  );
  const bookingForId = (id) => bookingById.get(id) || null;
  const recordTargetsPool = (record) => Boolean(record) && (
    retiredCycleIds.has(String(cycleIdFor(record) || ""))
    || isRetiredHyroxActivityId(record.activityId ?? record.activity_id)
    || retiredSessionIds.has(String(record.sessionId ?? record.session_id ?? ""))
    || retiredBookingIds.has(record.bookingId ?? record.booking_id)
    || retiredRequestIds.has(record.requestId ?? record.request_id)
  );
  const receiptTargetsPool = (receipt) =>
    isRetiredHyroxReceipt(receipt, bookingForId) || recordTargetsPool(receipt);
  const retiredReceiptIds = new Set(
    state.receipts.filter(receiptTargetsPool).map((receipt) => receipt.id)
  );
  const routeTargetsPool = (value) => {
    const match = String(value || "").match(
      /^#\/(activity|checkout|hyrox|booking|pay|receipt|replacement)\/([^/?#]+)(?:\/register)?$/
    );
    if (!match) return false;
    const [, route, id] = match;
    if (["activity", "checkout", "hyrox"].includes(route)) {
      return isRetiredHyroxLegacyRouteId(id);
    }
    if (["booking", "pay"].includes(route)) return retiredBookingIds.has(id);
    if (route === "receipt") return retiredReceiptIds.has(id);
    return retiredInviteTokens.has(id);
  };

  // The local acceptance producer used only a generic Admin link. Classify
  // before pruning requests/bookings; an unmatched HYROX-only review is not
  // proof of active provenance. Retired evidence wins timestamp ambiguity.
  const retiredReviewNoticeIds = new Set(state.notifications.filter((notice) => {
    if (notice.kind !== "hyrox-replacement-review") return false;
    const matches = state.replacementRequests.filter((request) =>
      request.acceptedAt != null && request.acceptedAt === notice.createdAt);
    if (matches.some(requestTargetsPool)) return true;
    return !matches.length || matches.some((request) => {
      const booking = bookingForId(request.bookingId);
      const session = sessionForId(booking?.sessionId);
      return !session || isRetiredHyroxSession(session);
    });
  }).map((notice) => notice.id));

  state.activities = state.activities.filter(
    (activity) => !isRetiredHyroxActivityId(activity.id)
  );
  for (const collection of [state.queues, state.sessionOverrides]) {
    for (const id of Object.keys(collection)) {
      if (retiredSessionIds.has(id)) delete collection[id];
    }
  }
  state.receipts = state.receipts.filter((receipt) => !receiptTargetsPool(receipt));
  state.replacementRequests = state.replacementRequests.filter(
    (request) => !requestTargetsPool(request)
  );
  state.replacementAudit = state.replacementAudit.filter(
    (entry) => !recordTargetsPool(entry)
  );
  state.notifications = state.notifications.filter((notification) =>
    !retiredReviewNoticeIds.has(notification.id)
    && !isRetiredHyroxNotification(notification, bookingForId)
    && !recordTargetsPool(notification)
    && !retiredReceiptIds.has(notification.receiptId ?? notification.receipt_id)
    && !routeTargetsPool(notification.destination)
    && !routeTargetsPool(notification.link)
  );
  for (const [key, assignment] of Object.entries(state.duty)) {
    if (recordTargetsPool(assignment)) delete state.duty[key];
  }
  state.bookings = state.bookings.filter((booking) => !retiredBookingIds.has(booking.id));
  state.hyroxCycles = {};
  state.hyroxCycleQueues = {};
}

function migrate() {
  // Persisted prototypes may predate individual collections or contain null
  // values. Normalize every collection before a legacy step or early return.
  for (const key of ["users", "activities", "bookings", "receipts", "campaigns", "donations", "prayers", "notifications", "oneOffEvents"]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  if (!state.queues || typeof state.queues !== "object" || Array.isArray(state.queues)) {
    state.queues = {};
  }
  if (!state.sessionOverrides || typeof state.sessionOverrides !== "object"
    || Array.isArray(state.sessionOverrides)) {
    state.sessionOverrides = {};
  }
  if (!state.duty || typeof state.duty !== "object" || Array.isArray(state.duty)) state.duty = {};
  if (!state.paymentPayouts || typeof state.paymentPayouts !== "object"
      || Array.isArray(state.paymentPayouts)) state.paymentPayouts = {};
  if (!state.hyroxCycles || typeof state.hyroxCycles !== "object"
      || Array.isArray(state.hyroxCycles)) state.hyroxCycles = {};
  if (!state.hyroxCycleQueues || typeof state.hyroxCycleQueues !== "object"
      || Array.isArray(state.hyroxCycleQueues)) state.hyroxCycleQueues = {};
  if (!Array.isArray(state.replacementRequests)) state.replacementRequests = [];
  if (!Array.isArray(state.replacementAudit)) state.replacementAudit = [];
  // v14 carries forward the additive UUID-keyed operations map for every
  // accepted v9-v13 snapshot.
  for (const user of state.users) {
    if (!user?.id || state.paymentPayouts[user.id] || (!user.paymeLink && !user.fpsPhone)) continue;
    state.paymentPayouts[user.id] = {
      paymeLink: String(user.paymeLink ?? "").trim(),
      fpsPhone: String(user.fpsPhone ?? "").trim(),
    };
  }
  normalizeReceiptCounter();
  for (const booking of state.bookings) {
    booking.replacementUserId ??= null;
    booking.replacementConfirmedAt ??= null;
    booking.replacementConfirmedBy ??= null;
    booking.cancelledAt ??= null;
    booking.cancelledSource ??= null;
  }
  for (const activity of state.activities) {
    if (!["wnt", "run", "water"].includes(activity.id)) continue;
    activity.requiresRsvp = true;
    activity.price = 0;
    activity.capacity = null;
  }
  for (const activity of state.activities) {
    if (!ISLAND_ECC_HYROX_ACTIVITY_IDS.has(activity.id)) continue;
    if (String(activity.photo || "").endsWith("hyrox.webp")) {
      activity.photo = "../assets/itc/itc-hyrox-mood.webp";
    }
  }
  for (const event of state.oneOffEvents) {
    if (event.kind !== "free") continue;
    event.requiresRsvp = true;
    event.price = 0;
    event.capacity = null;
  }

  const v = state.version || 0;
  if (v >= STATE_VERSION) return;
  if (v < 27) {
    // v27: Island ECC offers two independently capacitated Saturday slots.
    // Preserve the existing id for the later slot so every stored reference
    // survives, and only rewrite exact former defaults.
    const lateSlot = state.activities.find((activity) => activity.id === "hyrox-quarry-bay");
    if (lateSlot?.time === "11:00") lateSlot.time = "10:30";
    if (!state.activities.some((activity) => activity.id === "hyrox-quarry-bay-early")) {
      const earlySlot = SEED_ACTIVITIES.find(
        (activity) => activity.id === "hyrox-quarry-bay-early"
      );
      if (earlySlot) state.activities.push(structuredClone(earlySlot));
    }
    const todayISO = todayHktISO();
    for (const booking of state.bookings) {
      if (booking.sessionId?.startsWith("hyrox-quarry-bay-")
          && !booking.sessionId.startsWith("hyrox-quarry-bay-early-")
          && booking.snapshot?.dateISO >= todayISO
          && booking.snapshot?.time === "11:00") {
        booking.snapshot.time = "10:30";
      }
    }
    for (const [sessionId, override] of Object.entries(state.sessionOverrides)) {
      if (sessionId.startsWith("hyrox-quarry-bay-")
          && !sessionId.startsWith("hyrox-quarry-bay-early-")
          && sessionDateOf(sessionId) >= todayISO
          && override?.time === "11:00") {
        override.time = "10:30";
      }
    }
  }
  if (v < 19) {
    // v19: all Quarry Bay session capacity is expanded to 30, including
    // sessions already materialized in local state.
    for (const activity of state.activities) {
      if (ISLAND_ECC_HYROX_ACTIVITY_IDS.has(activity.id)) activity.capacity = 30;
    }
  }
  if (v < 18) {
    // v18: Quarry Bay's member-facing venue uses the recognizable Island ECC
    // name while directions use an unambiguous Hong Kong maps query. Only
    // exact prior values are replaced so later Admin edits remain intact.
    const quarryBay = state.activities.find((activity) => activity.id === "hyrox-quarry-bay");
    if (quarryBay?.location === "10/F, 633 King's Road, Quarry Bay, Hong Kong") {
      quarryBay.location = "10/F, Island ECC, Quarry Bay";
    }
    if (quarryBay?.mapsQuery === "10/F, 633 King's Road, Quarry Bay, Hong Kong") {
      quarryBay.mapsQuery = "Island ECC, Quarry Bay, Hong Kong";
    }
    for (const booking of state.bookings) {
      if (booking.sessionId?.startsWith("hyrox-quarry-bay-")
          && booking.snapshot?.location === "10/F, 633 King's Road, Quarry Bay, Hong Kong") {
        booking.snapshot.location = "10/F, Island ECC, Quarry Bay";
      }
    }
  }
  if (v < 17) {
    // v17: the BFT activity gets an explicit canonical id and Quarry Bay
    // joins as a third recurring HYROX session. Rewrite every device-local
    // session reference so existing bookings and operational state survive.
    const renameBftSessionId = (value) =>
      typeof value === "string" && /^hyrox-\d{4}-\d{2}-\d{2}$/.test(value)
        ? value.replace(/^hyrox-/, "hyrox-bft-")
        : value;
    const legacyBft = state.activities.find((activity) => activity.id === "hyrox");
    const canonicalBft = state.activities.find((activity) => activity.id === "hyrox-bft");
    if (legacyBft && !canonicalBft) legacyBft.id = "hyrox-bft";
    else if (legacyBft) state.activities = state.activities.filter((activity) => activity !== legacyBft);
    for (const id of ["hyrox-bft", "hyrox-quarry-bay-early", "hyrox-quarry-bay"]) {
      if (!state.activities.some((activity) => activity.id === id)) {
        const seed = SEED_ACTIVITIES.find((activity) => activity.id === id);
        if (seed) state.activities.push(structuredClone(seed));
      }
    }
    for (const booking of state.bookings) {
      booking.sessionId = renameBftSessionId(booking.sessionId);
      booking.deferredTo = renameBftSessionId(booking.deferredTo);
    }
    for (const receipt of state.receipts) {
      receipt.sessionId = renameBftSessionId(receipt.sessionId);
    }
    for (const collection of [state.queues, state.sessionOverrides]) {
      for (const [legacyId, value] of Object.entries(collection)) {
        const canonicalId = renameBftSessionId(legacyId);
        if (canonicalId === legacyId) continue;
        if (!(canonicalId in collection)) collection[canonicalId] = value;
        delete collection[legacyId];
      }
    }
    for (const notification of state.notifications) {
      for (const field of ["link", "destination"]) {
        if (typeof notification[field] === "string") {
          notification[field] = notification[field].replace(
            /([/#])hyrox-(\d{4}-\d{2}-\d{2})(?=$|[/?#])/g,
            "$1hyrox-bft-$2"
          );
        }
      }
    }
  }
  if (v < 22) {
    // v22: attendance is additive. Existing financial, allocation and booking
    // state is preserved while the two new audit fields start empty.
    for (const booking of state.bookings) {
      if (!Object.prototype.hasOwnProperty.call(booking, "attendedAt")) booking.attendedAt = null;
      if (!Object.prototype.hasOwnProperty.call(booking, "attendedBy")) booking.attendedBy = null;
    }
  }
  if (v < 23) {
    // v23: historical device-only prayers stay on this device while gaining
    // the fields required by the private member/Admin workflow.
    state.prayers = state.prayers.map((row) => ({
      ...row,
      status: ["new", "prayed_for", "closed", "withdrawn"].includes(row.status)
        ? row.status : "new",
      anonymousToLeaders: row.anonymousToLeaders === true,
      createdAt: Number.isFinite(Number(row.createdAt)) ? Number(row.createdAt) : Date.now(),
      updatedAt: Number.isFinite(Number(row.updatedAt))
        ? Number(row.updatedAt)
        : Number.isFinite(Number(row.createdAt)) ? Number(row.createdAt) : Date.now(),
      closedAt: row.status === "closed" ? row.closedAt ?? row.updatedAt ?? row.createdAt ?? Date.now() : null,
      withdrawnAt: row.status === "withdrawn" ? row.withdrawnAt ?? row.updatedAt ?? Date.now() : null,
      request: row.status === "withdrawn" ? null : String(row.request ?? "").trim(),
    }));
  }
  if (v < 21) {
    // v21: Friday venue-choice and venue-finalization reminders are additive
    // cycle checkpoints; existing bookings and allocations remain intact.
    for (const cycle of Object.values(state.hyroxCycles || {})) {
      if (!Object.prototype.hasOwnProperty.call(cycle, "venueChoiceReminderSentAt")) {
        cycle.venueChoiceReminderSentAt = null;
      }
      if (!Object.prototype.hasOwnProperty.call(cycle, "venueFinalizationReminderSentAt")) {
        cycle.venueFinalizationReminderSentAt = null;
      }
    }
  }
  if (v < 20) {
    // v20: HYROX payment reminders are enabled by default and each cycle
    // tracks the separate collector reminder independently of member notices.
    for (const user of state.users) {
      if (!Object.prototype.hasOwnProperty.call(user, "hyroxPaymentReminders")) {
        user.hyroxPaymentReminders = true;
      }
    }
    for (const cycle of Object.values(state.hyroxCycles || {})) {
      if (!Object.prototype.hasOwnProperty.call(cycle, "collectorPaymentReminderSentAt")) {
        cycle.collectorPaymentReminderSentAt = null;
      }
    }
  }
  if (v < 19) {
    // v19: pooled HYROX cycles and their weekly/venue-switch queues are
    // additive local collections. Existing sessions, bookings and receipts
    // remain untouched until a cycle explicitly references them.
    if (!state.hyroxCycles || Array.isArray(state.hyroxCycles)) state.hyroxCycles = {};
    if (!state.hyroxCycleQueues || Array.isArray(state.hyroxCycleQueues)) state.hyroxCycleQueues = {};
  }
  if (v < 20) {
    // v20: manual HYROX replacement requests are additive. The booking owner
    // remains payer/receipt owner; replacement fields affect identity only
    // after an Admin confirms the handover.
    if (!Array.isArray(state.replacementRequests)) state.replacementRequests = [];
    if (!Array.isArray(state.replacementAudit)) state.replacementAudit = [];
    for (const booking of state.bookings) {
      booking.replacementUserId ??= null;
      booking.replacementConfirmedAt ??= null;
      booking.replacementConfirmedBy ??= null;
    }
  }
  if (v < 16) {
    // v16: the recurring post-training lunch (RSVP kind, Meals category)
    // joins the seed activities. Existing states get it appended without
    // touching admin edits.
    if (Array.isArray(state.activities) && !state.activities.some((a) => a.id === "lunch")) {
      const lunch = SEED_ACTIVITIES.find((a) => a.id === "lunch");
      if (lunch) state.activities.push(structuredClone(lunch));
    }
  }
  if (v < 15) {
    // v15: admin-created one-off events live in state.oneOffEvents
    // (activity-shaped entries with oneOff + dateISO). The collection
    // normalization above guarantees the array; this step only documents
    // the version boundary.
    if (!Array.isArray(state.oneOffEvents)) state.oneOffEvents = [];
  }
  if (v < 2) {
    // v2: Sunday Trail Run removed; HYROX moved to Sat 11:15 at Causeway Bay
    // BFT (HK$180) and a second Saturday session added at Midtown 28 (11:00).
    state.activities = state.activities.filter(
      (a) => ![
        "trail", "hyrox", "hyrox-bft", "hyrox-midtown",
        "hyrox-quarry-bay-early", "hyrox-quarry-bay",
      ].includes(a.id)
    );
    state.activities.push(
      ...SEED_ACTIVITIES.filter((a) => a.category === "HYROX").map((a) =>
        structuredClone(a)
      )
    );
  }
  if (v < 3) {
    // v3: Run Club moved to Mon 7:30 PM with venue TBC; Water Sports Evening
    // renamed ITC Swimming at 7:30 PM. Activities are replaced in place
    // from the current activity configuration.
    const seedAct = new Map(SEED_ACTIVITIES.map((a) => [a.id, a]));
    state.activities = state.activities.map((a) =>
      a.id === "run" || a.id === "water"
        ? structuredClone(seedAct.get(a.id))
        : a
    );
  }
  if (v < 4) {
    // v4: HYROX venue renamed "Causeway Bay BFT" -> "BFT Causeway Bay"
    // (activity location + any booking snapshots carrying the old string).
    // Only exact old-string matches are rewritten so admin edits made
    // since are preserved.
    const hyrox = state.activities.find((a) => a.id === "hyrox-bft" || a.id === "hyrox");
    if (hyrox && hyrox.location === "Causeway Bay BFT") {
      hyrox.location = "BFT Causeway Bay";
    }
    for (const b of state.bookings) {
      if (b.snapshot?.location === "Causeway Bay BFT") {
        b.snapshot.location = "BFT Causeway Bay";
      }
    }
  }
  if (v < 5) {
    // v5: Wednesday Night Training venue changed to TBC (location, maps
    // query, member note). Only exact old-seed matches are rewritten so
    // admin edits made since are preserved; booking snapshots get the
    // same treatment.
    const wnt = state.activities.find((a) => a.id === "wnt");
    if (wnt && wnt.location === "Tamar Park, Admiralty") {
      wnt.location = "TBC";
      wnt.mapsQuery = "";
      wnt.memberNote =
        "Meeting point to be confirmed — check back before Wednesday. Bring water.";
    }
    for (const b of state.bookings) {
      if (b.snapshot?.location === "Tamar Park, Admiralty") {
        b.snapshot.location = "TBC";
      }
    }
  }
  if (v < 6) {
    // v6: indemnity acceptance is now tracked per member; approved seed
    // members predate the requirement and are backfilled, everyone else
    // accepts from Profile > Indemnity. Exact-sentinel match only.
    for (const id of ["u-super", "u-admin", "u-member"]) {
      const u = state.users.find((x) => x.id === id);
      if (u && u.indemnityAcceptedAt === undefined) {
        u.indemnityAcceptedAt = u.appliedAt;
      }
    }
  }
  if (v < 7) {
    // v7: donor IDs saved before the LASTNAME-NNNN(N) format rule existed
    // may be missing the hyphen (CHUI08879) or use another separator, and
    // would display that way in Profile > Donor Profile. Repair what is
    // recognizable to the canonical form; clear the rest so the member
    // re-enters it through the validated form.
    for (const u of state.users) {
      if (!u.donorId) continue;
      const repaired = normalizeDonorId(
        String(u.donorId).trim().replace(/^([A-Za-z]+)(\d{4,5})$/, "$1-$2")
      );
      u.donorId = repaired && !donorIdProblem(repaired) ? repaired : null;
    }
  }
  if (v < 8) {
    // v8: prayer requests (Community > Prayers) are stored locally.
    // (No-op: collection normalization above initializes the array.)
  }
  if (v < 9) {
    // v9: HYROX capacities corrected to the real gym bookings (BFT 20,
    // Midtown 12). Payment-system state introduced: per-week session
    // overrides, waitlist/interest queues, duty roster, notifications.
    // (Collection normalization above initializes the structures.)
    for (const a of state.activities) {
      if ((a.id === "hyrox-bft" || a.id === "hyrox") && a.capacity === 18) a.capacity = 20;
      if (a.id === "hyrox-midtown" && a.capacity === 18) a.capacity = 12;
    }
  }
  if (v < 13) {
    // v13 reconciles genuine v9-v12 state with Payment's historical demo
    // cleanup. Exact-sentinel match only —
    // every genuine user, application, booking, receipt, queue entry,
    // duty assignment, and notification is preserved. Demo demand on
    // activities is removed so capacity reflects real confirmed bookings
    // only. Collector payout details seeded for demo accounts are also
    // stripped; Admin can add real payout details when they set up duty.
    const demoIds = new Set(["u-super", "u-admin", "u-member", "u-pend-1", "u-pend-2"]);
    const demoEmails = new Set([
      "owner@itc.hk",
      "admin@itc.hk",
      "member@itc.hk",
      "marco.santos@example.com",
      "jenny.wu@example.com",
    ]);
    const removedUserIds = new Set(demoIds);
    state.users = state.users.filter((user) => {
      const matches = demoIds.has(user.id)
        || demoEmails.has(String(user.email ?? "").trim().toLowerCase());
      if (matches) removedUserIds.add(user.id);
      return !matches;
    });
    if (removedUserIds.has(state.sessionUserId)) state.sessionUserId = null;

    const removedBookingIds = new Set();
    state.bookings = state.bookings.filter((booking) => {
      const remove = removedUserIds.has(booking.userId);
      if (remove) removedBookingIds.add(booking.id);
      return !remove;
    });
    state.receipts = state.receipts.filter(
      (receipt) => !removedUserIds.has(receipt.userId)
        && !removedBookingIds.has(receipt.bookingId)
    );

    // Queue and notification entries referencing removed demo users are
    // stripped; unmatched ones survive.
    const filterByUserId = (entries) =>
      (Array.isArray(entries) ? entries : []).filter((entry) => {
        const userId = entry && typeof entry === "object" ? entry.userId : entry;
        return !removedUserIds.has(userId);
      });
    for (const [sessionId, q] of Object.entries(state.queues || {})) {
      state.queues[sessionId] = {
        waitlist: filterByUserId(q?.waitlist),
        interest: filterByUserId(q?.interest),
      };
    }
    for (const n of state.notifications || []) {
      if (removedUserIds.has(n.userId) || removedUserIds.has(n.actorId)) {
        n.removedByCleanup = true;
      }
    }
    state.notifications = state.notifications.filter((n) => !n.removedByCleanup);

    // Duty roster entries pointing at removed demo collectors are cleared;
    // genuine assignments survive.
    if (state.duty && typeof state.duty === "object") {
      for (const [date, slot] of Object.entries(state.duty)) {
        if (slot && removedUserIds.has(slot.userId)) {
          delete state.duty[date];
        }
      }
    }

    for (const activity of state.activities) delete activity.baseBooked;

    // Giving's only known seeded transactions are removed by exact ID.
    // Campaigns and every unmatched donation remain untouched.
    const seedDonationIds = new Set(["d-seed-1", "d-seed-2"]);
    state.donations = state.donations.filter((donation) => !seedDonationIds.has(donation.id));
  }
  if (v < 9) {
    // v9: remove only the exact identities shipped by the historical local
    // demo. Matching by normalized email also catches records whose IDs were
    // changed locally. Everything not owned by those identities is retained.
    const demoIds = new Set(["u-super", "u-admin", "u-member", "u-pend-1", "u-pend-2"]);
    const demoEmails = new Set([
      "owner@itc.hk",
      "admin@itc.hk",
      "member@itc.hk",
      "marco.santos@example.com",
      "jenny.wu@example.com",
    ]);
    const users = Array.isArray(state.users) ? state.users : [];
    const removedUserIds = new Set(demoIds);
    state.users = users.filter((user) => {
      const matches = demoIds.has(user.id)
        || demoEmails.has(String(user.email ?? "").trim().toLowerCase());
      if (matches) removedUserIds.add(user.id);
      return !matches;
    });
    if (removedUserIds.has(state.sessionUserId)) state.sessionUserId = null;

    const bookings = Array.isArray(state.bookings) ? state.bookings : [];
    const removedBookingIds = new Set();
    state.bookings = bookings.filter((booking) => {
      const remove = removedUserIds.has(booking.userId);
      if (remove) removedBookingIds.add(booking.id);
      return !remove;
    });
    const receipts = Array.isArray(state.receipts) ? state.receipts : [];
    state.receipts = receipts.filter(
      (receipt) => !removedUserIds.has(receipt.userId)
        && !removedBookingIds.has(receipt.bookingId)
    );
    const activities = Array.isArray(state.activities) ? state.activities : [];
    for (const activity of activities) delete activity.baseBooked;
    state.activities = activities;
  }
  if (v < 14) {
    for (const user of state.users) {
      for (const field of [
        "indemnitySignature",
        "indemnitySignedAt",
        "indemnityFormVersion",
        "emergencyRelationship",
      ]) {
        if (!Object.prototype.hasOwnProperty.call(user, field)) user[field] = null;
      }
    }
    const water = state.activities.find((activity) => activity.id === "water");
    if (water) {
      if (["Victoria Park", "Victoria Park Swimming Pool"].includes(water.location)) {
        water.location = "TBC";
      }
      if (["Victoria Park, Hong Kong", "Victoria Park Swimming Pool, Hong Kong", "TBC"].includes(water.mapsQuery)) {
        water.mapsQuery = "";
      }
      if (water.photo === "../assets/itc/main.webp") {
        water.photo = "../assets/itc/water.webp";
      }
    }

    const midtown = state.activities.find((activity) => activity.id === "hyrox-midtown");
    if (midtown?.location === "Midtown 28") midtown.location = "Midtown28 Fitness";
    if (midtown?.mapsQuery === "Midtown 28, Hong Kong") {
      midtown.mapsQuery = "Midtown28 Fitness, Hong Kong";
    }
    for (const booking of state.bookings) {
      if (booking.snapshot?.location === "Midtown 28") {
        booking.snapshot.location = "Midtown28 Fitness";
      }
    }
  }
  if (v < 24) {
    // v24: retire the device-local BFT/Midtown shared pool after every older
    // migration has run. Relationship fields and exact legacy route IDs are
    // authoritative; arbitrary BFT/Midtown substrings are never classified.
    retireLocalHyroxPool();
  }
  if (v < 25) {
    if (!Array.isArray(state.announcements)) state.announcements = [];
  }
  if (v < 26) {
    // v26: web push for operational booking/payment/venue is opt-in (default off).
    // Preference only — no service worker or send path in this version.
    for (const user of state.users || []) {
      if (!Object.prototype.hasOwnProperty.call(user, "webPushOps")) {
        user.webPushOps = false;
      }
    }
  }
  if (v < 28) {
    if (!state.islandEccWeekOps || typeof state.islandEccWeekOps !== "object"
        || Array.isArray(state.islandEccWeekOps)) {
      state.islandEccWeekOps = {};
    }
    const now = Date.now();
    const todayISO = todayHktISO(now);
    for (const booking of state.bookings || []) {
      if (booking.status !== "reserved" || booking.paymentMarkedAt) continue;
      const dateISO = booking.snapshot?.dateISO;
      if (!dateISO || dateISO < todayISO) continue;
      const activityId = String(booking.sessionId || "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
      if (!ISLAND_ECC_HYROX_ACTIVITY_IDS.has(activityId)) continue;
      booking.payDeadlineAt = islandEccNextPayDeadline(dateISO, now);
    }
  }
  state.version = STATE_VERSION;
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetLocalData() {
  localStorage.removeItem(STORAGE_KEY);
  return load();
}

export function paymentStateForBooking(booking) {
  if (!booking) return null;
  if (booking.status === "reserved") {
    return booking.paymentMarkedAt != null ? "awaiting_confirmation" : "payment_due";
  }
  return booking.status === "confirmed" || booking.status === "attended" ? "paid" : null;
}

export function attendanceWindowForSession(session, now = Date.now()) {
  const start = hktEventStartMs(session.dateISO, session.time);
  const opensAt = start - 15 * 60_000;
  const closesAt = start + Number(session.durationMin) * 60_000 + 24 * 60 * 60_000;
  return {
    opensAt,
    closesAt,
    state: now < opensAt ? "upcoming" : now <= closesAt ? "open" : "locked",
  };
}

// --- Session / auth ----------------------------------------------------------

export function currentUser() {
  if (isLive()) return liveUser;
  if (!state.sessionUserId) return null;
  return state.users.find((u) => u.id === state.sessionUserId) ?? null;
}

// Payment records may be changed by their approved owner or by an approved
// Admin/Super Admin performing an operational flow. In live mode currentUser()
// is the cached Supabase profile; affected members are not copied into local
// identity state, so an approved Admin may operate on their UUID-owned record.
const PAYMENT_ADMIN_ROLES = new Set(["admin", "superadmin", "super_admin"]);
const normalizePaymentUser = (profile) => {
  if (!profile) return null;
  const role = profile.role === "super_admin" ? "superadmin" : profile.role;
  const fullName = profile.fullName || profile.full_name || profile.email || "ITC Member";
  return {
    id: profile.id,
    email: profile.email,
    fullName,
    preferredName: profile.preferredName || null,
    role,
    status: profile.status || (role === "pending" || role === "declined" ? role : "approved"),
  };
};

function paymentUserById(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;
  if (!isLive()) return state.users.find((user) => user.id === id) ?? null;
  const actor = currentUser();
  return livePaymentDirectory.get(id) ?? (actor?.id === id ? normalizePaymentUser(actor) : null);
}

function requireApprovedPaymentOwner(userId) {
  const owner = paymentUserById(userId);
  if (!owner || owner.status !== "approved") {
    throw new Error("Approved member access required");
  }
  return owner;
}

function requirePaymentAdminActor() {
  const actor = currentUser();
  if (!actor || actor.status !== "approved" || !PAYMENT_ADMIN_ROLES.has(actor.role)) {
    throw new Error("Approved Admin access required");
  }
  return actor;
}

function requireAuthorizedPaymentOwner(userId) {
  const id = String(userId || "").trim();
  const actor = currentUser();
  if (!actor || actor.status !== "approved") {
    throw new Error("Approved actor access required");
  }
  if (actor.id !== id && !PAYMENT_ADMIN_ROLES.has(actor.role)) {
    throw new Error("Payment mutation not authorized");
  }
  return requireApprovedPaymentOwner(id);
}

export function signIn(email) {
  const user = state.users.find(
    (u) => u.email.toLowerCase() === String(email).trim().toLowerCase()
  );
  if (!user) return { ok: false, reason: "not-found" };
  if (user.status === "declined") {
    state.sessionUserId = user.id;
    save();
    return { ok: true, user, declined: true };
  }
  state.sessionUserId = user.id;
  save();
  return { ok: true, user };
}

export function signOut() {
  clearAvatarCache();
  state.sessionUserId = null;
  save();
}

// --- Membership application drafts --------------------------------------------

export function getApplyDeviceId() {
  try {
    let id = localStorage.getItem(APPLY_DEVICE_KEY);
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() || uid("device");
      localStorage.setItem(APPLY_DEVICE_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

function isValidApplyDraft(draft, deviceId) {
  return !!draft
    && [1, APPLY_DRAFT_VERSION].includes(draft.version)
    && draft.deviceId === deviceId
    && Number.isFinite(draft.savedAt)
    && draft.fields
    && typeof draft.fields === "object"
    && !Array.isArray(draft.fields);
}

function draftOwnerKey(profileId) {
  return profileId == null || profileId === ""
    ? UNCLAIMED_DRAFT_OWNER
    : String(profileId);
}

function readApplyDraftMap() {
  const deviceId = getApplyDeviceId();
  if (!deviceId) return {};
  try {
    const raw = localStorage.getItem(APPLY_DRAFTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const out = {};
        for (const [key, draft] of Object.entries(parsed)) {
          if (!isValidApplyDraft(draft, deviceId)) continue;
          out[key] = { ...draft, version: APPLY_DRAFT_VERSION, profileId: key === UNCLAIMED_DRAFT_OWNER ? null : key };
        }
        return out;
      }
    }
  } catch {
    try { localStorage.removeItem(APPLY_DRAFTS_KEY); } catch {}
  }

  // Migrate the legacy single-draft key into the per-account map once.
  try {
    const legacyRaw = localStorage.getItem(APPLY_DRAFT_KEY);
    if (!legacyRaw) return {};
    const legacy = JSON.parse(legacyRaw);
    localStorage.removeItem(APPLY_DRAFT_KEY);
    if (!isValidApplyDraft(legacy, deviceId)) return {};
    const key = draftOwnerKey(legacy.profileId);
    const map = {
      [key]: {
        ...legacy,
        version: APPLY_DRAFT_VERSION,
        profileId: key === UNCLAIMED_DRAFT_OWNER ? null : key,
      },
    };
    localStorage.setItem(APPLY_DRAFTS_KEY, JSON.stringify(map));
    return map;
  } catch {
    try { localStorage.removeItem(APPLY_DRAFT_KEY); } catch {}
    return {};
  }
}

function writeApplyDraftMap(map) {
  const keys = Object.keys(map);
  if (!keys.length) {
    try { localStorage.removeItem(APPLY_DRAFTS_KEY); } catch {}
    try { localStorage.removeItem(APPLY_DRAFT_KEY); } catch {}
    return;
  }
  localStorage.setItem(APPLY_DRAFTS_KEY, JSON.stringify(map));
  try { localStorage.removeItem(APPLY_DRAFT_KEY); } catch {}
}

export function getApplyDraft({ profileId = null } = {}) {
  const map = readApplyDraftMap();
  return map[draftOwnerKey(profileId)] || null;
}

export function saveApplyDraft({ fields = {}, profileId = null } = {}) {
  try {
    const deviceId = getApplyDeviceId();
    if (!deviceId) return null;
    const actorId = profileId || currentUser()?.id || null;
    const key = draftOwnerKey(actorId);
    const map = readApplyDraftMap();
    const existing = map[key];
    const draft = {
      version: APPLY_DRAFT_VERSION,
      deviceId,
      profileId: actorId || null,
      savedAt: Date.now(),
      fields: { ...(existing?.fields || {}), ...fields },
    };
    map[key] = draft;
    writeApplyDraftMap(map);
    return draft;
  } catch {
    return null;
  }
}

export function clearApplyDraft({ profileId = null } = {}) {
  try {
    if (profileId == null) {
      writeApplyDraftMap({});
      return;
    }
    const map = readApplyDraftMap();
    delete map[String(profileId)];
    // Unclaimed leftovers are browser-shared and unsafe next to a signed-in
    // account, so drop them whenever that account cleans up its own draft.
    delete map[UNCLAIMED_DRAFT_OWNER];
    writeApplyDraftMap(map);
  } catch {}
}

// --- Signup / approval ---------------------------------------------------------

function normalizeEmergencyContact({
  emergencyName,
  emergencyRelationship,
  emergencyPhone,
} = {}) {
  const name = String(emergencyName || "").trim();
  const relationship = String(emergencyRelationship || "").trim();
  const phone = String(emergencyPhone || "").trim();
  if (!name || !relationship || !phone) {
    throw new Error("Enter emergency contact name, relationship and phone");
  }
  return { name, relationship, phone };
}

function normalizeIndemnityAcceptance({
  signature,
  signedAt,
  emergencyName,
  emergencyRelationship,
  emergencyPhone,
  formVersion = INDEMNITY_VERSION,
} = {}) {
  const normalizedSignature = String(signature || "").trim();
  const normalizedSignedAt = String(signedAt || "").trim();
  const emergency = normalizeEmergencyContact({
    emergencyName,
    emergencyRelationship,
    emergencyPhone,
  });
  if (normalizedSignature.length < 2) {
    throw new Error("Type your full name as your signature");
  }
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(normalizedSignedAt)
    && isoDate(parseISO(normalizedSignedAt)) === normalizedSignedAt;
  if (!validDate) throw new Error("Enter a valid signing date");
  if (normalizedSignedAt > todayHktISO()) {
    throw new Error("Signing date cannot be in the future");
  }
  if (formVersion !== INDEMNITY_VERSION) {
    throw new Error("The Indemnity has changed. Reload and review the current document");
  }
  return {
    signature: normalizedSignature,
    signedAt: normalizedSignedAt,
    emergencyName: emergency.name,
    emergencyRelationship: emergency.relationship,
    emergencyPhone: emergency.phone,
    formVersion: INDEMNITY_VERSION,
  };
}

export function isIndemnityCurrent(user) {
  if (!user?.indemnityAcceptedAt || user.indemnityFormVersion !== INDEMNITY_VERSION) return false;
  if (String(user.indemnitySignature || "").trim().length < 2) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(user.indemnitySignedAt || ""))) return false;
  return !!String(user.emergencyName || "").trim()
    && !!String(user.emergencyRelationship || "").trim()
    && !!String(user.emergencyPhone || "").trim();
}

export function applyForMembership(form) {
  const email = String(form.email).trim().toLowerCase();
  if (state.users.some((u) => u.email.toLowerCase() === email)) {
    return { ok: false, reason: "duplicate" };
  }
  if (!form.indemnity) throw new Error("Read and accept the Indemnity");
  const acceptance = normalizeIndemnityAcceptance({
    signature: form.indemnitySignature,
    signedAt: form.indemnitySignedAt,
    emergencyName: form.emergencyName,
    emergencyRelationship: form.emergencyRelationship,
    emergencyPhone: form.emergencyPhone,
  });
  const acceptedAt = Date.now();
  const user = {
    id: uid("u"),
    role: "pending",
    status: "pending",
    fullName: form.fullName.trim(),
    preferredName: form.preferredName.trim(),
    email,
    phone: form.phone.trim(),
    ageConfirmed: !!form.ageConfirmed,
    emergencyName: acceptance.emergencyName,
    emergencyRelationship: acceptance.emergencyRelationship,
    emergencyPhone: acceptance.emergencyPhone,
    heard: form.heard.trim(),
    mediaConsent: !!form.mediaConsent,
    donorId: normalizeDonorId(form.donorId),
    indemnityAcceptedAt: acceptedAt,
    indemnitySignature: acceptance.signature,
    indemnitySignedAt: acceptance.signedAt,
    indemnityFormVersion: acceptance.formVersion,
    appliedAt: Date.now(),
  };
  state.users.push(user);
  state.sessionUserId = user.id; // applicant keeps public-level access while pending
  save();
  return { ok: true, user };
}

export function pendingApplicants() {
  return state.users
    .filter((u) => u.status === "pending")
    .sort((a, b) => a.appliedAt - b.appliedAt);
}

export function approveApplicant(userId) {
  const user = state.users.find((u) => u.id === userId);
  if (!user || user.status !== "pending") return;
  user.status = "approved";
  user.role = "member";
  save();
}

export function declineApplicant(userId) {
  const user = state.users.find((u) => u.id === userId);
  if (!user || user.status !== "pending") return;
  user.status = "declined";
  user.role = "pending";
  save();
}

export function setRole(userId, role) {
  const user = state.users.find((u) => u.id === userId);
  if (!user || user.status !== "approved") return;
  user.role = role;
  save();
}

// Donor ID is optional at sign-up; members who skipped it (or answered
// "not applicable", which normalizes to null) can add it later from Profile.
export function updateDonorId(userId, raw) {
  const user = state.users.find((u) => u.id === userId);
  if (!user) return null;
  user.donorId = normalizeDonorId(raw);
  save();
  return user.donorId;
}

export async function updateMyDonorId(raw) {
  const donorId = normalizeDonorId(raw);
  if (!donorId || donorIdProblem(donorId)) throw new Error("Enter a valid Donor ID");
  if (!isLive() || !supabase) {
    const user = currentUser();
    if (!user) throw new Error("Not signed in");
    user.donorId = donorId;
    save();
    return donorId;
  }
  const cu = await getCurrentUser();
  if (!cu) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("applications")
    .update({ donor_id: donorId })
    .eq("profile_id", cu.id)
    .select("donor_id")
    .single();
  if (error) throw error;
  return data.donor_id;
}

export function acceptIndemnity(userId, payload) {
  const user = state.users.find((candidate) => candidate.id === userId);
  if (!user) return null;
  const acceptance = normalizeIndemnityAcceptance({
    ...payload,
    emergencyName: user.emergencyName,
    emergencyPhone: user.emergencyPhone,
  });
  user.indemnityAcceptedAt = Date.now();
  user.indemnitySignature = acceptance.signature;
  user.indemnitySignedAt = acceptance.signedAt;
  user.indemnityFormVersion = acceptance.formVersion;
  user.emergencyRelationship = acceptance.emergencyRelationship;
  save();
  return user.indemnityAcceptedAt;
}

// --- Activities & sessions -------------------------------------------------------

export function activities() {
  return state.activities;
}

export function getActivity(id) {
  return state.activities.find((a) => a.id === id) ?? null;
}

export function saveActivity(draft) {
  requirePaymentAdminActor();
  if (retirementBoundaryActive() && isRetiredHyroxActivityId(draft?.id)) {
    throw retiredTargetError();
  }
  const existing = state.activities.find((a) => a.id === draft.id);
  const record = {
    ...draft,
    photo: existing?.photo || draft.photo || "../assets/itc/main.webp",
    price: draft.kind === "paid" ? Number(draft.price) || 0 : undefined,
    capacity: draft.kind === "paid" ? Number(draft.capacity) || 0 : undefined,
    durationMin: Number(draft.durationMin) || 60,
    weekday: Number(draft.weekday),
  };
  if (existing) {
    Object.assign(existing, record);
    save();
    return { id: existing.id, created: false };
  }
  const id = draft.id || uid("act");
  state.activities.push({ ...record, id });
  save();
  return { id, created: true };
}

export function allUsers() {
  return state.users;
}

export async function listPaymentUsers() {
  requirePaymentAdminActor();
  if (!isLive() || !supabase) return state.users;
  const profiles = await listProfiles();
  livePaymentDirectory = new Map(
    profiles.map(normalizePaymentUser).filter(Boolean).map((user) => [user.id, user])
  );
  const actor = currentUser();
  if (actor && !livePaymentDirectory.has(actor.id)) {
    livePaymentDirectory.set(actor.id, normalizePaymentUser(actor));
  }
  return [...livePaymentDirectory.values()];
}

export function pendingPaymentBookings() {
  if (isLive()) {
    const list = liveOps.livePendingBookings();
    return list.slice().sort((a, b) => (a.dateISO || "").localeCompare(b.dateISO || ""));
  }
  requirePaymentAdminActor();
  return state.bookings
    .filter((booking) => booking.status === "reserved" && booking.paymentMarkedAt)
    .sort((a, b) => a.snapshot.dateISO.localeCompare(b.snapshot.dateISO));
}

export function paymentRosterBookings() {
  requirePaymentAdminActor();
  const bookings = isLive() ? liveOps.listLiveBookings() : state.bookings;
  return bookings.filter((booking) => {
    const session = booking.sessionId ? getSession(booking.sessionId) : null;
    const price = session?.price ?? booking.snapshot?.price;
    return Number(price) > 0 && paymentStateForBooking(booking);
  });
}

export function attendanceBookingsForSession(sessionId) {
  requirePaymentAdminActor();
  const session = getSession(sessionId);
  if (!session || session.kind !== "paid" || session.cancelled) return [];
  const bookings = isLive()
    ? liveOps.liveBookingsForSession(sessionId)
    : state.bookings.filter((booking) => booking.sessionId === sessionId);
  return bookings.filter((booking) =>
    booking.status === "confirmed" || booking.status === "attended"
  );
}

export async function setBookingAttendance(bookingId, arrived, now = Date.now()) {
  assertActiveBookingTarget(bookingId);
  const actor = requirePaymentAdminActor();
  if (typeof arrived !== "boolean") throw new Error("Attendance state is required.");
  const booking = getBooking(bookingId);
  if (!booking) throw new Error("Booking not found.");
  if (isLive()) return liveOps.liveSetOperationalAttendance(bookingId, arrived);
  if (!booking.sessionId) throw new Error("Attendance requires an assigned session.");
  const session = getSession(booking.sessionId);
  if (!session) throw new Error("Assigned session not found.");
  if (session.cancelled) throw new Error("Session is cancelled.");
  if (session.kind !== "paid" || Number(session.price) <= 0) {
    throw new Error("Attendance check-in is for paid sessions only.");
  }
  if (booking.status !== "confirmed" && booking.status !== "attended") {
    throw new Error("Only confirmed-paid bookings can be checked in.");
  }
  if (attendanceWindowForSession(session, now).state !== "open") {
    throw new Error("Attendance is outside the check-in window.");
  }
  if ((arrived && booking.status === "attended")
      || (!arrived && booking.status === "confirmed")) return booking;
  booking.status = arrived ? "attended" : "confirmed";
  booking.attendedAt = arrived ? now : null;
  booking.attendedBy = arrived ? actor.id : null;
  save();
  return booking;
}

export function activeBookingsForSession(sessionId) {
  if (isLive()) {
    return liveOps.liveConfirmedBookingsForSession(sessionId);
  }
  return state.bookings.filter(
    (b) => b.sessionId === sessionId && (b.status === "confirmed" || b.status === "attended")
  );
}

export function spotsLeft(session) {
  if (!session) return null;
  if (session.kind === "free") return null;
  if (session.capacity == null) return null; // uncapped (e.g. the RSVP lunch)
  if (isLive()) {
    return Math.max(0, session.capacity - liveOps.liveHeldBookingsForSession(session.id).length);
  }
  return Math.max(0, session.capacity - heldBookingsForSession(session.id).length);
}

export function sessionRequiresRsvp(session) {
  return Boolean(session?.requiresRsvp || session?.kind === "rsvp");
}

export function attendeeCountFor(session) {
  if (!session?.id || (session.kind !== "paid" && !sessionRequiresRsvp(session))) return 0;
  const bookingCount = activeBookingsForSession(session.id).length;
  if (isLive()) {
    const exactCount = liveOps.liveRsvpCountFor(session.id);
    // Count-table rows can lag hydrated bookings; never under-report what we
    // already know from confirmed bookings in memory.
    if (exactCount !== null) return Math.max(exactCount, bookingCount);
  }
  return bookingCount;
}

export function attendeesFor(session) {
  if (!session?.id || (session.kind !== "paid" && !sessionRequiresRsvp(session))) return [];
  const names = [];
  for (const b of activeBookingsForSession(session.id)) {
    const u = isLive()
      ? paymentUserById(effectiveAttendeeId(b))
      : state.users.find((x) => x.id === effectiveAttendeeId(b));
    if (u) names.push(`${u.preferredName || u.fullName} ${u.fullName.split(" ").pop()[0]}.`);
  }
  return names;
}

export async function attendeeNamesFor(sessionId) {
  if (!sessionId) return [];
  assertActiveSessionTarget(sessionId);
  if (isLive()) return liveOps.liveAttendeeNamesForSession(sessionId);
  const session = getSession(sessionId);
  return session ? attendeesFor(session) : [];
}

// --- Booking & payment ------------------------------------------------------------
// Exported mutation policy at this backend seam:
// - Member self-service (or Admin on the owner's behalf): reserve, mark paid,
//   release, defer, and queue join/leave.
// - Admin operations: confirm/cancel payments, activity and weekly-session
//   administration, duty assignment, payout editing, and gym confirmation.
// - Automatic maintenance only: checkpoint expiry, queue promotion/cascade,
//   and operational notifications stay private so callers cannot bypass the
//   actor-authorized exports above.

export function userBookingFor(userId, sessionId) {
  if (isLive()) {
    return liveOps.liveBookingsForUser(userId).find(
      (b) => b.sessionId === sessionId && (b.status === "confirmed" || b.status === "attended")
    ) || null;
  }
  return state.bookings.find(
    (b) => b.userId === userId && b.sessionId === sessionId
      && (b.status === "confirmed" || b.status === "attended")
  );
}

export function bookingsForUser(userId) {
  if (isLive()) {
    return liveOps.liveBookingsForUser(userId)
      .filter((booking) => !bookingIsRetired(booking)).slice().sort(
        (a, b) => (b.dateISO || "").localeCompare(a.dateISO || "")
      );
  }
  return state.bookings
    .filter((booking) => booking.userId === userId
      && (!retirementBoundaryActive() || !bookingIsRetired(booking)))
    .sort((a, b) => b.snapshot.dateISO.localeCompare(a.snapshot.dateISO));
}

export function receiptsForUser(userId) {
  if (isLive()) {
    return liveOps.liveReceiptsForUser(userId).filter((receipt) => !receiptIsRetired(receipt));
  }
  return state.receipts
    .filter((receipt) => receipt.userId === userId
      && (!retirementBoundaryActive() || !receiptIsRetired(receipt)))
    .sort((a, b) => b.issuedAt - a.issuedAt);
}

export function getBooking(id) {
  const booking = retirementBooking(id);
  return booking && (!retirementBoundaryActive() || !bookingIsRetired(booking)) ? booking : null;
}

export function replacementRequestForBooking(bookingId) {
  if (isLive()) {
    if (bookingIsRetired(retirementBooking(bookingId))) {
      livePendingReplacementStates.delete(bookingId);
      liveReplacementTokens.delete(bookingId);
      return null;
    }
    const request = liveOps.liveReplacementRequestForBooking?.(bookingId) ?? null;
    const pending = livePendingReplacementStates.get(bookingId) || null;
    if (pending && request?.requestId !== pending.requestId) return pending;
    if (request && !bookingIsRetired(request)) {
      livePendingReplacementStates.delete(bookingId);
      return request;
    }
    return pending;
  }
  return state.replacementRequests
    .filter((request) => request.bookingId === bookingId
      && (!retirementBoundaryActive()
        || (!bookingIsRetired(request) && !bookingIsRetired(retirementBooking(request.bookingId)))))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] ?? null;
}

// One authoritative read per attempt: never retry a successful create RPC.
// A failed/missing invite result leaves the memory-only overlay in place so the
// owner can explicitly retry without minting another invite or token.
export async function refreshReplacementRequest(bookingId) {
  const booking = getBooking(bookingId);
  if (!booking) replacementRequestError("Booking not found.");
  requireAuthorizedPaymentOwner(booking.userId);
  if (isLive()) {
    try {
      const token = liveReplacementTokens.get(bookingId);
      if (!token) throw new Error("Private invite unavailable.");
      const hash = await liveOps.hashReplacementToken(token);
      await liveOps.liveRefreshReplacementRequest(
        bookingId, livePendingReplacementStates.get(bookingId)?.requestId, hash,
      );
    } catch {
      if (!livePendingReplacementStates.has(bookingId)) {
        throw new Error("Replacement details unavailable. Please retry refresh.");
      }
    }
  }
  return replacementRequestForBooking(bookingId);
}

export function replacementInviteTokenForBooking(bookingId) {
  if (isLive()) return liveReplacementTokens.get(bookingId) || null;
  return replacementRequestForBooking(bookingId)?.inviteToken || null;
}

export function replacementRequestByToken(token) {
  const value = String(token || "").trim();
  if (!value) return null;
  if (isLive()) return liveOps.liveReplacementRequestByToken?.(value) ?? null;
  return state.replacementRequests.find((request) => request.inviteToken === value) ?? null;
}

export function effectiveAttendeeId(booking) {
  return booking?.replacementUserId || booking?.userId || null;
}

export function replacementEligible(booking, now = Date.now()) {
  if (!booking?.userId) return { ok: false, reason: "missing-owner" };
  if (booking.status !== "confirmed") return { ok: false, reason: "not-confirmed" };
  if (booking.replacementUserId) return { ok: false, reason: "already-replaced" };
  const snapshot = booking.snapshot || {};
  const isHyrox = snapshot.kind === "paid"
    && (String(snapshot.name || "").toUpperCase().includes("HYROX")
      || String(booking.sessionId || "").startsWith("hyrox-"));
  if (!isHyrox) return { ok: false, reason: "not-paid-hyrox" };
  const session = booking.sessionId ? getSession(booking.sessionId) : null;
  if (session?.cancelled) return { ok: false, reason: "cancelled" };
  const startsAt = hktEventStartMs(snapshot.dateISO, snapshot.time);
  if (!Number.isFinite(startsAt) || startsAt <= now) return { ok: false, reason: "started" };
  const expiresAt = Math.min(startsAt, now + 24 * 60 * 60 * 1000);
  return { ok: true, expiresAt };
}

export function replacementInviteForToken(token) {
  if (isLive()) return null;
  const request = replacementRequestByToken(token);
  if (!request) return null;
  const { inviteToken, ...redacted } = request;
  return redacted;
}

export function replacementAuditForRequest(requestId) {
  if (isLive()) return [];
  return state.replacementAudit.filter((entry) => entry.requestId === requestId);
}

export async function replacementRequestsForAdmin() {
  requirePaymentAdminActor();
  if (isLive()) {
    return (await liveOps.liveListReplacementRequests()).filter((request) =>
      ["pending", "accepted", "confirmed", "rejected"].includes(request.status)
    );
  }
  return state.replacementRequests
    .filter((request) => ["pending", "accepted", "confirmed", "rejected"].includes(request.status))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map((request) => {
      const original = state.users.find((user) => user.id === request.originalUserId);
      const replacement = state.users.find((user) => user.id === request.replacementUserId);
      const booking = state.bookings.find((item) => item.id === request.bookingId);
      return {
        requestId: request.id,
        bookingId: request.bookingId,
        status: request.status,
        originalDisplayName: original?.preferredName || original?.fullName || "ITC member",
        replacementDisplayName: replacement?.preferredName || replacement?.fullName || null,
        sessionId: booking?.sessionId || null,
        cycleId: booking?.cycleId || null,
        snapshot: booking?.snapshot ? {
          name: booking.snapshot.name || null,
          dateISO: booking.snapshot.dateISO || null,
          time: booking.snapshot.time || null,
          location: booking.snapshot.location || null,
          price: booking.snapshot.price ?? null,
        } : null,
        createdAt: request.createdAt || null,
        expiresAt: request.expiresAt || null,
        acceptedAt: request.acceptedAt || null,
        confirmedAt: request.confirmedAt || null,
        decisionReason: request.decisionReason || null,
      };
    });
}

function replacementActor() {
  const actor = currentUser();
  if (!actor || actor.status !== "approved") throw new Error("Approved membership required.");
  return actor;
}

function replacementIsHyrox(booking) {
  return booking?.snapshot?.kind === "paid"
    && (String(booking.snapshot?.name || "").toUpperCase().includes("HYROX")
      || String(booking.sessionId || "").startsWith("hyrox-"));
}

function replacementDuplicateForUser(userId, booking) {
  return state.bookings.some((candidate) => candidate.id !== booking.id
    && (candidate.replacementUserId || candidate.userId) === userId
    && ["reserved", "confirmed", "attended"].includes(candidate.status)
    && replacementIsHyrox(candidate)
    && candidate.snapshot?.dateISO === booking.snapshot?.dateISO);
}

function replacementConflictForUser(userId, booking) {
  const session = getSession(booking?.sessionId);
  return replacementDuplicateForUser(userId, booking)
    || hasOtherIslandEccCommitment(userId, session, { includeQueues: true });
}

function recordReplacementAudit(request, action, actorId, reason = null, now = Date.now()) {
  state.replacementAudit.push({
    id: uid("replacement-audit"),
    requestId: request.id,
    bookingId: request.bookingId,
    action,
    originalUserId: request.originalUserId,
    replacementUserId: request.replacementUserId || null,
    actorUserId: actorId || null,
    reason,
    createdAt: now,
  });
}

function replacementRequestError(message) {
  throw new Error(message);
}

export async function createReplacementRequest(bookingId, now = Date.now()) {
  const booking = getBooking(bookingId);
  if (!booking) replacementRequestError("Booking not found.");
  const eligibility = replacementEligible(booking, now);
  if (!eligibility.ok) replacementRequestError("This booking cannot arrange a replacement.");
  if (isLive()) {
    requireAuthorizedPaymentOwner(booking.userId);
    const active = replacementRequestForBooking(bookingId);
    if (active?.cachePending || ["pending", "accepted"].includes(active?.status)) {
      replacementRequestError("A replacement invite is already active for this booking.");
    }
    const token = globalThis.crypto?.randomUUID?.() || uid("replacement-invite");
    const hash = await liveOps.hashReplacementToken(token);
    const request = await liveOps.liveCreateReplacementRequest(bookingId, hash, eligibility.expiresAt);
    if (request?.retired) throw retiredTargetError();
    liveReplacementTokens.set(bookingId, token);
    if (request?.cachePending) {
      const pending = {
        requestId: request.requestId || null,
        bookingId,
        status: "pending",
        createdAt: now,
        expiresAt: eligibility.expiresAt,
        cachePending: true,
      };
      livePendingReplacementStates.set(bookingId, pending);
      const reconciled = await refreshReplacementRequest(bookingId);
      return { ...reconciled, inviteToken: token };
    }
    livePendingReplacementStates.delete(bookingId);
    return { ...request, inviteToken: token };
  }
  requireAuthorizedPaymentOwner(booking.userId);
  if (currentUser()?.id !== booking.userId) replacementRequestError("Payment mutation not authorized");
  const active = replacementRequestForBooking(booking.id);
  if (active && ["pending", "accepted"].includes(active.status)) {
    replacementRequestError("A replacement invite is already active for this booking.");
  }
  const request = {
    id: uid("replacement-request"),
    bookingId: booking.id,
    originalUserId: booking.userId,
    replacementUserId: null,
    inviteToken: uid("replacement-invite"),
    status: "pending",
    createdAt: now,
    expiresAt: eligibility.expiresAt,
    acceptedAt: null,
    acceptedBy: null,
    declinedAt: null,
    declinedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    rejectedAt: null,
    rejectedBy: null,
    confirmedAt: null,
    confirmedBy: null,
    decisionReason: null,
  };
  state.replacementRequests.push(request);
  recordReplacementAudit(request, "created", booking.userId, null, now);
  save();
  return request;
}

export async function acceptReplacement(token, now = Date.now()) {
  if (isLive()) {
    const hash = await liveOps.hashReplacementToken(token);
    const request = await liveOps.liveAcceptReplacement(hash);
    if (request?.retired) throw retiredTargetError();
    return request;
  }
  const actor = replacementActor();
  const request = replacementRequestByToken(token);
  if (!request || request.status !== "pending") replacementRequestError("This replacement invite is no longer available.");
  if (request.expiresAt <= now) {
    request.status = "expired";
    request.decisionReason = "Invite expired.";
    recordReplacementAudit(request, "expired", actor.id, request.decisionReason, now);
    save();
    replacementRequestError("This replacement invite has expired.");
  }
  if (actor.id === request.originalUserId) replacementRequestError("The original member cannot accept their own replacement invite.");
  const booking = getBooking(request.bookingId);
  if (!booking || !replacementEligible(booking, now).ok
      || replacementConflictForUser(actor.id, booking)) {
    replacementRequestError("This booking is no longer available for replacement.");
  }
  request.status = "accepted";
  request.replacementUserId = actor.id;
  request.acceptedAt = now;
  request.acceptedBy = actor.id;
  recordReplacementAudit(request, "accepted", actor.id, null, now);
  notify(request.originalUserId, "hyrox-replacement-accepted",
    "An approved member accepted your replacement invite. ITC must confirm the handover before the attendee changes.",
    `#/booking/${request.bookingId}`);
  state.users.filter((user) => ["admin", "super_admin"].includes(user.role)
    && user.status === "approved").forEach((user) => notify(
      user.id, "hyrox-replacement-review",
      "A HYROX replacement needs Admin confirmation.", "#/admin/ops"));
  save();
  return request;
}

export async function declineReplacement(token, now = Date.now()) {
  if (isLive()) {
    const hash = await liveOps.hashReplacementToken(token);
    const request = await liveOps.liveDeclineReplacement(hash);
    if (request?.retired) throw retiredTargetError();
    return request;
  }
  const actor = replacementActor();
  const request = replacementRequestByToken(token);
  if (!request || request.status !== "pending") replacementRequestError("This replacement invite is no longer available.");
  if (request.expiresAt <= now) replacementRequestError("This replacement invite has expired.");
  request.status = "declined";
  request.declinedAt = now;
  request.declinedBy = actor.id;
  recordReplacementAudit(request, "declined", actor.id, null, now);
  notify(request.originalUserId, "hyrox-replacement-declined",
    "The approved member declined your replacement invite.", `#/booking/${request.bookingId}`);
  save();
  return request;
}

export async function cancelReplacement(requestId, now = Date.now()) {
  if (isLive()) {
    const request = await liveOps.liveCancelReplacement(requestId);
    if (request?.retired) throw retiredTargetError();
    for (const [bookingId, pending] of livePendingReplacementStates) {
      if (pending.requestId !== requestId) continue;
      livePendingReplacementStates.delete(bookingId);
      liveReplacementTokens.delete(bookingId);
    }
    return request;
  }
  const request = state.replacementRequests.find((item) => item.id === requestId);
  if (!request) return null;
  requireAuthorizedPaymentOwner(request.originalUserId);
  if (currentUser()?.id !== request.originalUserId) replacementRequestError("Payment mutation not authorized");
  if (request.status !== "pending") replacementRequestError("Only an unclaimed replacement invite can be cancelled.");
  request.status = "cancelled";
  request.cancelledAt = now;
  request.cancelledBy = request.originalUserId;
  recordReplacementAudit(request, "cancelled", request.originalUserId, null, now);
  save();
  return request;
}

export async function decideReplacement(requestId, confirm, reason = null, now = Date.now()) {
  if (isLive()) {
    requirePaymentAdminActor();
    const request = await liveOps.liveDecideReplacement(requestId, confirm, reason);
    if (request?.retired) throw retiredTargetError();
    return request;
  }
  const actor = requirePaymentAdminActor();
  const request = state.replacementRequests.find((item) => item.id === requestId);
  if (!request) replacementRequestError("Replacement request not found.");
  if (request.status === "confirmed" && confirm) return request;
  if (request.status === "rejected" && !confirm) return request;
  if (confirm) {
    if (request.status !== "accepted") replacementRequestError("Only an accepted replacement can be confirmed.");
    if (request.expiresAt <= now) replacementRequestError("This replacement request has expired.");
    const booking = getBooking(request.bookingId);
    if (!booking || !replacementEligible(booking, now).ok
        || replacementConflictForUser(request.replacementUserId, booking)) {
      replacementRequestError("This booking is no longer available for replacement.");
    }
    booking.replacementUserId = request.replacementUserId;
    booking.replacementConfirmedAt = now;
    booking.replacementConfirmedBy = actor.id;
    request.status = "confirmed";
    request.confirmedAt = now;
    request.confirmedBy = actor.id;
    request.decisionReason = reason || null;
    recordReplacementAudit(request, "confirmed", actor.id, request.decisionReason, now);
    notify(request.originalUserId, "hyrox-replacement-confirmed",
      "ITC confirmed the replacement. You remain the payer and receipt owner; the approved member is now the attendee.",
      `#/booking/${request.bookingId}`);
    notify(request.replacementUserId, "hyrox-replacement-confirmed",
      "ITC confirmed your HYROX replacement. Check the session details before attending.",
      `#/booking/${request.bookingId}`);
  } else {
    if (!["pending", "accepted"].includes(request.status)) return request;
    request.status = "rejected";
    request.rejectedAt = now;
    request.rejectedBy = actor.id;
    request.decisionReason = reason || "Admin rejected the replacement request.";
    recordReplacementAudit(request, "rejected", actor.id, request.decisionReason, now);
    notify(request.originalUserId, "hyrox-replacement-rejected",
      "ITC did not confirm the replacement. Your original booking remains unchanged.",
      `#/booking/${request.bookingId}`);
    if (request.replacementUserId) notify(request.replacementUserId, "hyrox-replacement-rejected",
      "ITC did not confirm this replacement request. The original booking remains unchanged.",
      `#/booking/${request.bookingId}`);
  }
  save();
  return request;
}

export function effectiveAttendeeForBooking(booking) {
  if (isLive()) return paymentUserById(effectiveAttendeeId(booking));
  return state.users.find((user) => user.id === effectiveAttendeeId(booking)) || null;
}

export function getReceipt(id) {
  const receipt = isLive()
    ? liveOps.liveReceiptById(id)
    : state.receipts.find((row) => row.id === id);
  return receipt && (!retirementBoundaryActive() || !receiptIsRetired(receipt)) ? receipt : null;
}

export function receiptForBooking(bookingId) {
  if (retirementBoundaryActive() && bookingIsRetired(retirementBooking(bookingId))) return null;
  const receipt = isLive()
    ? liveOps.liveReceiptForBooking(bookingId)
    : state.receipts.find((row) => row.bookingId === bookingId);
  return receipt && (!retirementBoundaryActive() || !receiptIsRetired(receipt)) ? receipt : null;
}

function notify(userId, kind, body, link) {
  state.notifications.push({ id: uid("n"), userId, kind, body, link, read: false, createdAt: Date.now() });
}

function canReceiveRsvpNotification(userId) {
  const user = state.users.find((candidate) => candidate.id === userId);
  return user?.status === "approved"
    && ["member", "admin", "superadmin", "super_admin"].includes(user.role);
}

function activeRsvpNotificationRecipients(sessionId) {
  return [...new Set(state.bookings
    .filter((booking) => booking.sessionId === sessionId && booking.status === "confirmed")
    .map((booking) => booking.userId)
    .filter(canReceiveRsvpNotification))];
}

export function notificationsFor(userId) {
  return state.notifications
    .filter((notification) => notification.userId === userId
      && (!retirementBoundaryActive()
        || !isRetiredHyroxNotification(notification, retirementBooking)))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function heldBookingsForSession(sessionId) {
  if (isLive()) return liveOps.liveHeldBookingsForSession(sessionId);
  return state.bookings.filter(
    (b) => b.sessionId === sessionId
      && (b.status === "reserved" || b.status === "confirmed" || b.status === "attended")
  );
}

export function userReservationFor(userId, sessionId) {
  if (isLive()) {
    return liveOps.liveBookingsForUser(userId).find(
      (b) => b.sessionId === sessionId && b.status === "reserved"
    ) || null;
  }
  return state.bookings.find(
    (b) => b.userId === userId && b.sessionId === sessionId && b.status === "reserved"
  ) ?? null;
}

export function sessionDateOf(sessionId) {
  const m = sessionId.match(/-(\d{4}-\d{2}-\d{2})$/);
  return m ? m[1] : null;
}

function receiptNumber() {
  normalizeReceiptCounter();
  const counter = state.receiptCounter;
  state.receiptCounter += 1;
  return `ITC-${new Date().getFullYear()}-${String(counter).padStart(4, "0")}`;
}

function snapshotFor(session) {
  return {
    name: session.name, kind: session.kind, dateISO: session.dateISO,
    time: session.time, durationMin: session.durationMin,
    location: session.location, price: session.price ?? null,
    capacity: session.capacity ?? null,
  };
}

function isIslandEccHyroxSession(session) {
  return ISLAND_ECC_HYROX_ACTIVITY_IDS.has(session?.activityId);
}

function hasOtherIslandEccCommitment(userId, session, { includeQueues = false } = {}) {
  if (!isIslandEccHyroxSession(session)) return false;
  const hasBooking = state.bookings.some((booking) => {
    if ((booking.replacementUserId || booking.userId) !== userId
        || !["reserved", "confirmed", "attended"].includes(booking.status)) return false;
    const bookedSession = getSession(booking.sessionId);
    return isIslandEccHyroxSession(bookedSession)
      && bookedSession.dateISO === session.dateISO;
  });
  if (hasBooking || !includeQueues) return hasBooking;
  return Object.entries(state.queues).some(([sessionId, queue]) => {
    if (sessionId === session.id || sessionDateOf(sessionId) !== session.dateISO) return false;
    const queuedSession = getSession(sessionId);
    return isIslandEccHyroxSession(queuedSession)
      && [...(queue?.waitlist || []), ...(queue?.interest || [])]
        .some((entry) => entry.userId === userId);
  });
}

export function islandEccSignupLocked(session, now = Date.now()) {
  return isIslandEccHyroxSession(session) && !islandEccSignupOpen(session.dateISO, now);
}

export function islandEccOtherSlotTaken(session, userId = currentUser()?.id) {
  if (!userId || !isIslandEccHyroxSession(session)) return false;
  if (userBookingFor(userId, session.id) || userReservationFor(userId, session.id)) return false;
  return hasOtherIslandEccCommitment(userId, session, { includeQueues: true });
}

// Reserve a spot without paying. The spot is held until the next payment
// checkpoint (Thu 6 PM, then Fri 2 PM, then a 2-hour last-minute window).
export function reserveSession(userId, sessionOrId, now = Date.now()) {
  assertActiveSessionTarget(sessionOrId);
  if (isLive()) {
    const sessionId = typeof sessionOrId === "string" ? sessionOrId : sessionOrId?.id;
    return liveOps.liveReserveSession(sessionId);
  }
  requireAuthorizedPaymentOwner(userId);
  return reserveApprovedSession(userId, sessionOrId, now);
}

// Private consequence path for checkpoint and Admin queue promotion. Both
// paths accept only a canonical ID (or an object's ID for caller compatibility)
// and resolve every operational field from authoritative weekly state.
function reserveApprovedSession(userId, sessionOrId, now = Date.now()) {
  requireApprovedPaymentOwner(userId);
  const sessionId = typeof sessionOrId === "string" ? sessionOrId : sessionOrId?.id;
  const session = typeof sessionId === "string" ? getSession(sessionId) : null;
  if (!session) throw new Error("Unknown session");
  if (session.kind !== "paid") throw new Error("Session is not paid");
  if (session.cancelled) throw new Error("Session is cancelled");
  if (sessionStarted(session)) throw new Error("Session has already started");
  if (spotsLeft(session) <= 0) throw new Error("Session is full");
  if (isIslandEccHyroxSession(session) && !islandEccSignupOpen(session.dateISO, now)) {
    throw new Error(ISLAND_ECC_SIGNUP_LOCKED_ERROR);
  }
  if (
    userBookingFor(userId, session.id) || userReservationFor(userId, session.id)
  ) throw new Error("Already booked");
  if (hasOtherIslandEccCommitment(userId, session, { includeQueues: true })) {
    throw new Error("Choose one Island ECC HYROX slot per Saturday.");
  }

  const booking = {
    id: uid("b"),
    userId,
    sessionId: session.id,
    status: "reserved",
    createdAt: now,
    reservedAt: now,
    payDeadlineAt: isIslandEccHyroxSession(session)
      ? islandEccNextPayDeadline(session.dateISO, now)
      : nextPayDeadline(session.dateISO, now),
    paymentMarkedAt: null,
    paidAt: null,
    paidMethod: null,
    paymentRef: null,
    confirmedBy: null,
    deferredTo: null,
    deferredFrom: null,
    reminderSentAt: null,
    attendedAt: null,
    attendedBy: null,
    snapshot: snapshotFor(session),
  };
  state.bookings.push(booking);
  save();
  return booking;
}

// Member taps "I've paid" after sending PayMe/FPS. Lands in the on-duty
// collector's pending list; the spot stays held until they confirm.
export function markBookingPaid(bookingId, method, ref, now = Date.now()) {
  assertActiveBookingTarget(bookingId);
  if (isLive()) {
    const normalized = method === "FPS" ? "fps" : "payme";
    return liveOps.liveMarkBookingPaid(bookingId, normalized, ref);
  }
  const b = getBooking(bookingId);
  if (!b || b.status !== "reserved" || b.paymentMarkedAt) return null;
  requireAuthorizedPaymentOwner(b.userId);
  b.paymentMarkedAt = now;
  b.paidMethod = method === "FPS" ? "FPS" : "PayMe";
  b.paymentRef = String(ref ?? "").trim() || null;
  const collector = collectorFor(b.sessionId);
  if (collector) {
    const who = state.users.find((u) => u.id === b.userId);
    notify(
      collector.id,
      "payment-marked",
      `${who?.preferredName || who?.fullName || "A member"} marked a ${b.paidMethod} payment for ${b.snapshot.name} — ${fmtDate(b.snapshot.dateISO)}. Confirm when it lands.`,
      "#/admin/ops"
    );
  }
  save();
  return b;
}

// Collector confirms the direct-session payment, preserving payer ownership
// while issuing the receipt and enabling the remaining booking lifecycle.
export function confirmBookingPayment(bookingId, now = Date.now()) {
  assertActiveBookingTarget(bookingId);
  if (isLive()) {
    return liveOps.liveApproveBookingPayment(bookingId);
  }
  const b = getBooking(bookingId);
  if (!b || b.status !== "reserved" || !b.paymentMarkedAt) return null;
  const actor = requirePaymentAdminActor();
  requireApprovedPaymentOwner(b.userId);
  b.status = "confirmed";
  b.paidAt = now;
  b.confirmedBy = actor.id;
  const receipt = {
    id: uid("r"),
    number: receiptNumber(),
    bookingId: b.id,
    userId: b.userId,
    amount: b.snapshot.price,
    currency: "HKD",
    method: b.paidMethod || "PayMe",
    status: "paid",
    issuedAt: now,
    sessionId: b.sessionId || null,
    cycleId: null,
    line: `${b.snapshot.name} — ${fmtDate(b.snapshot.dateISO)} ${fmtTime(b.snapshot.time)}`,
  };
  state.receipts.push(receipt);
  queueReceiptEmail(receipt, now);
  notify(b.userId, "payment-confirmed",
    `Payment confirmed — you're booked for ${b.snapshot.name} · ${fmtDate(b.snapshot.dateISO)}.`,
    `#/booking/${b.id}`);
  save();
  return { booking: b, receipt };
}

function queueReceiptEmail(receipt, now = Date.now()) {
  const payer = paymentUserById(receipt.userId)
    || state.users.find((candidate) => candidate.id === receipt.userId);
  if (!payer?.emailReceipts) return;
  const to = String(payer.email || "").trim();
  if (!to.includes("@")) return;
  receipt.emailSentTo = to;
  receipt.emailSentAt = now;
}

// Releasing an unpaid reservation is member self-service; confirmed booking
// cancellation/refund remains an Admin operation while policy is unresolved.
export function releaseReservation(bookingId, now = Date.now()) {
  assertActiveBookingTarget(bookingId);
  if (isLive()) {
    return liveOps.liveReleaseReservation(bookingId);
  }
  const booking = getBooking(bookingId);
  if (!booking || booking.status !== "reserved" || booking.paymentMarkedAt) return null;
  requireAuthorizedPaymentOwner(booking.userId);
  booking.status = "cancelled";
  cascadeSession(booking.sessionId, now);
  save();
  return booking;
}

export function cancelBooking(bookingId) {
  requirePaymentAdminActor();
  const booking = getBooking(bookingId);
  if (!booking || booking.status !== "confirmed") return null;
  booking.status = "cancelled";
  const receipt = receiptForBooking(bookingId);
  if (receipt) receipt.status = "refunded";
  save();
  return booking;
}

// --- Checkpoint sweep & cascade --------------------------------------------
// Deterministic: called internally on load with now = Date.now(). No timers.

function paymentQueueFor(sessionId) {
  if (isLive()) {
    const queue = liveOps.liveQueueForSession(sessionId);
    return {
      waitlist: queue.waitlist.map((q) => ({ userId: q.userId, joinedAt: q.joinedAt })),
      interest: queue.interest.map((q) => ({ userId: q.userId, joinedAt: q.joinedAt })),
    };
  }
  if (!state.queues[sessionId]) {
    state.queues[sessionId] = { waitlist: [], interest: [] };
  }
  return state.queues[sessionId];
}

export function queueFor(sessionId) {
  const queue = paymentQueueFor(sessionId);
  return {
    waitlist: queue.waitlist.map((entry) => typeof entry === "string" ? entry : { ...entry }),
    interest: queue.interest.map((entry) => typeof entry === "string" ? entry : { ...entry }),
  };
}

export function sweepCheckpoints(now = Date.now()) {
  let dirty = false;
  for (const b of state.bookings) {
    if (b.status !== "reserved") continue;
    // A member who already marked "I've paid" is waiting on the collector,
    // not the clock — the collector confirms or releases at the checkpoint.
    const session = getSession(b.sessionId);
    const islandEcc = isIslandEccHyroxSession(session);
    if (!b.paymentMarkedAt && b.payDeadlineAt && now > b.payDeadlineAt) {
      b.status = "expired";
      notify(b.userId, "reservation-expired",
        `Your unpaid spot for ${b.snapshot.name} · ${fmtDate(b.snapshot.dateISO)} expired at the payment deadline — it went to the waitlist.`,
        `#/activity/${b.sessionId}`);
      cascadeSession(b.sessionId, now);
      dirty = true;
      continue;
    }
    if (
      !islandEcc
      && !b.paymentMarkedAt && !b.reminderSentAt && b.payDeadlineAt
      && now > b.payDeadlineAt - 24 * 3600 * 1000 && now < b.payDeadlineAt
    ) {
      b.reminderSentAt = now;
      notify(b.userId, "payment-reminder",
        `Reminder: pay for ${b.snapshot.name} · ${fmtDate(b.snapshot.dateISO)} by the checkpoint or your spot goes to the waitlist.`,
        `#/pay/${b.id}`);
      dirty = true;
    }
    if (
      islandEcc
      && session
      && !b.paymentMarkedAt
      && !b.reminderSentAt
      && session.dateISO >= todayHktISO(now)
      && now >= islandEccMemberReminderAt(session.dateISO)
    ) {
      b.reminderSentAt = now;
      const holder = paymentUserById(b.userId);
      if (holder?.hyroxPaymentReminders !== false) {
        notify(b.userId, "operational_island_ecc_payment_reminder",
          `Pay for ITC HYROX on ${fmtDate(session.dateISO)} by the deadline or the spot goes to the waitlist.`,
          `#/pay/${b.id}`);
      }
      dirty = true;
    }
  }
  if (!state.islandEccWeekOps || typeof state.islandEccWeekOps !== "object"
      || Array.isArray(state.islandEccWeekOps)) {
    state.islandEccWeekOps = {};
    dirty = true;
  }
  const todayISO = todayHktISO(now);
  for (const dateISO of islandEccDatesFromState()) {
    if (dateISO < todayISO) continue;
    if (now < islandEccMemberReminderAt(dateISO)) continue;
    const ops = (state.islandEccWeekOps[dateISO] ||= {});
    const early = getSession(`hyrox-quarry-bay-early-${dateISO}`);
    const late = getSession(`hyrox-quarry-bay-${dateISO}`);
    const collectorSession = early || late;
    const collector = collectorSession ? collectorFor(collectorSession.id) : null;
    if (collector && !ops.collectorFinalizeReminderSentAt) {
      notify(collector.id, "operational_island_ecc_collector_finalize_reminder",
        "Finalize both Island ECC HYROX sessions with Island ECC and the coach.",
        "#/admin/payments");
      ops.collectorFinalizeReminderSentAt = now;
      dirty = true;
    }
    if (now < islandEccCollectorFinalizeNudgeAt(dateISO) || ops.collectorFinalizeNudgeSentAt) {
      continue;
    }
    const needsNudge = [early, late].some((session) => session && !session.cancelled && !session.gymConfirmedAt);
    if (collector && needsNudge) {
      notify(collector.id, "operational_island_ecc_collector_finalize_nudge",
        "Still not finalized — please confirm with Island ECC and the coach if possible.",
        "#/admin/payments");
      ops.collectorFinalizeNudgeSentAt = now;
      dirty = true;
    }
  }
  if (dirty) save();
}

function islandEccDatesFromState() {
  const dates = new Set();
  const consider = (sessionId) => {
    if (!sessionId) return;
    const session = getSession(sessionId);
    if (isIslandEccHyroxSession(session)) dates.add(session.dateISO);
  };
  for (const booking of state.bookings) consider(booking.sessionId);
  for (const sessionId of Object.keys(state.queues || {})) consider(sessionId);
  for (const sessionId of Object.keys(state.sessionOverrides || {})) consider(sessionId);
  return dates;
}

function cascadeSession(sessionId, now = Date.now()) {
  const session = getSession(sessionId);
  if (!session || session.cancelled) return;
  const q = paymentQueueFor(sessionId);
  while (spotsLeft(session) > 0 && q.waitlist.length) {
    const { userId } = q.waitlist.shift();
    try {
      const booking = reserveApprovedSession(userId, session, now);
      notify(userId, "waitlist-promoted",
        `A spot opened for ${session.name} · ${fmtDate(session.date)} — you're in! Pay by the checkpoint to keep it.`,
        `#/pay/${booking.id}`);
    } catch {
      // member already holds this session somehow — skip to next in line
    }
  }
  save();
}

// --- Direct-session waitlists ---------------------------------------------

function joinQueue(userId, sessionId, kind, now = Date.now()) {
  requireAuthorizedPaymentOwner(userId);
  const session = getSession(sessionId);
  if (isIslandEccHyroxSession(session) && !islandEccSignupOpen(session.dateISO, now)) {
    throw new Error(ISLAND_ECC_SIGNUP_LOCKED_ERROR);
  }
  if (userBookingFor(userId, sessionId) || userReservationFor(userId, sessionId))
    throw new Error("Already booked");
  if (hasOtherIslandEccCommitment(userId, session, { includeQueues: true })) {
    throw new Error("Choose one Island ECC HYROX slot per Saturday.");
  }
  if (kind === "waitlist" && session && spotsLeft(session) > 0) {
    throw new Error("Session is not full.");
  }
  const q = paymentQueueFor(sessionId);
  for (const list of [q.waitlist, q.interest]) {
    if (list.some((e) => e.userId === userId)) throw new Error("Already in a queue for this session");
  }
  q[kind].push({ userId, joinedAt: Date.now() });
  save();
  return q[kind].length;
}

function leaveQueue(userId, sessionId, kind) {
  requireAuthorizedPaymentOwner(userId);
  const q = paymentQueueFor(sessionId);
  q[kind] = q[kind].filter((e) => e.userId !== userId);
  save();
}

function queuePosition(userId, sessionId, kind) {
  const idx = paymentQueueFor(sessionId)[kind].findIndex((e) => e.userId === userId);
  return idx === -1 ? null : idx + 1;
}

export function joinWaitlist(userId, sessionId, now = Date.now()) {
  assertActiveSessionTarget(sessionId);
  if (isLive()) {
    return liveOps.liveJoinQueue(sessionId, "waitlist");
  }
  return joinQueue(userId, sessionId, "waitlist", now);
}
export function leaveWaitlist(userId, sessionId) {
  assertActiveSessionTarget(sessionId);
  if (isLive()) {
    const session = liveOps.getLiveSession(sessionId);
    const entry = (session && liveOps.liveQueueForSession(sessionId).waitlist.find((q) => q.userId === userId))
      || null;
    if (entry) return liveOps.liveLeaveQueue(entry.id);
    return null;
  }
  return leaveQueue(userId, sessionId, "waitlist");
}
export function waitlistPosition(userId, sessionId) {
  if (isLive()) {
    const queue = liveOps.liveQueueForSession(sessionId).waitlist;
    const idx = queue.findIndex((q) => q.userId === userId);
    return idx === -1 ? null : idx + 1;
  }
  return queuePosition(userId, sessionId, "waitlist");
}
// Session template + per-week override (cancelled, time, venueTBC, notice...).
export function getSession(sessionId) {
  if (isLive()) {
    const live = liveOps.getLiveSession(sessionId);
    return live && !isRetiredHyroxSession(live) ? applyWntLeaderNote({ ...live }) : null;
  }
  const s = findSession(state.activities, sessionId);
  if (retirementBoundaryActive() && isRetiredHyroxSession(s)) return null;
  if (!s) {
    const event = state.oneOffEvents.find((e) => `${e.id}-${e.dateISO}` === sessionId);
    if (!event) return null;
    return decorateSession(oneOffSessionFor(event));
  }
  return decorateSession(s);
}

const WNT_TBC_NOTE = "Meeting point to be confirmed — check back before Wednesday. Bring water and a friend.";
const WNT_CONFIRMED_NOTE = "Bring water and a friend.";
const WNT_CANONICAL_NOTES = new Set([
  "Meeting point to be confirmed — check back before Wednesday. Bring water.",
  WNT_TBC_NOTE,
  WNT_CONFIRMED_NOTE,
]);

function decorateSession(s) {
  const o = state.sessionOverrides[s.id];
  const out = { ...s };
  if (!o) return applyWntLeaderNote(out);
  if (o.time) out.time = o.time;
  if (o.cancelled) { out.cancelled = true; out.cancelReason = o.cancelled; }
  if (o.venueTBC) {
    out.venueTBC = true;
    out.location = "TBC";
    out.mapsQuery = "";
    delete out.meetingLat;
    delete out.meetingLng;
  }
  if (o.notice) out.notice = o.notice;
  if (o.gymConfirmedAt) out.gymConfirmedAt = o.gymConfirmedAt;
  if (o.gymNote) out.gymNote = o.gymNote;
  if (!o.venueTBC) {
    if (o.location) out.location = o.location;
    if (o.mapsQuery) out.mapsQuery = o.mapsQuery;
    const point = normalizeMeetingPoint(o.meetingLat, o.meetingLng);
    if (point) Object.assign(out, { meetingLat: point.lat, meetingLng: point.lng });
  }
  if (hasConfirmedVenue(out.location, out.mapsQuery)) out.venueTBC = false;
  return applyWntLeaderNote(out);
}

function applyWntLeaderNote(session) {
  if (session?.activityId !== "wnt" || !WNT_CANONICAL_NOTES.has(String(session.memberNote || ""))) {
    return session;
  }
  return {
    ...session,
    memberNote: hasConfirmedVenue(session.location, session.mapsQuery)
      ? WNT_CONFIRMED_NOTE
      : WNT_TBC_NOTE,
  };
}

export function weekVenueOverride(sessionId) {
  const value = isLive()
    ? liveOps.getLiveVenueOverride(sessionId)
    : state.sessionOverrides[sessionId];
  if (!value) return { location: "", mapsQuery: "", meetingLat: "", meetingLng: "" };
  const notifiedAt = isLive()
    ? value.memberNotifiedAt
    : value.venueMemberNotifiedAt;
  const point = normalizeMeetingPoint(value.meetingLat, value.meetingLng);
  return {
    location: value.location || "",
    mapsQuery: value.mapsQuery || "",
    meetingLat: point?.lat ?? "",
    meetingLng: point?.lng ?? "",
    ...(notifiedAt ? { venueMemberNotifiedAt: notifiedAt } : {}),
  };
}

// --- Next relevant activity (home) ---------------------------------------------------

export function upcomingSessions(days = 14) {
  const todayISO = todayHktISO();
  const today = parseISO(todayISO);
  if (isLive()) {
    const end = new Date(today);
    end.setDate(end.getDate() + days - 1);
    const endISO = isoDate(end);
    return liveOps.listLiveSessions()
      .filter((s) => !isRetiredHyroxSession(s)
        && s.dateISO >= todayISO && s.dateISO <= endISO)
      .map((s) => {
        const decorated = applyWntLeaderNote(s);
        return {
          ...decorated,
          spots: spotsLeft(decorated),
          past: false,
        };
      })
      .sort(compareSessionsByStart);
  }
  const todayStart = today.getTime();
  const horizon = todayStart + days * 24 * 60 * 60 * 1000;
  const oneOffs = state.oneOffEvents
    .map(oneOffSessionFor)
    .filter((s) => s.date.getTime() >= todayStart && s.date.getTime() < horizon)
    .map((s) => {
      const decorated = decorateSession(s);
      return { ...decorated, spots: spotsLeft(decorated), past: false };
    });
  return [...sessionsInRange(state.activities, today, days)
    .filter((session) => !retirementBoundaryActive() || !isRetiredHyroxSession(session))
    .map((s) => {
    const decorated = decorateSession(s);
    return {
      ...decorated,
      spots: spotsLeft(decorated),
      past: false,
    };
  }), ...oneOffs].sort(compareSessionsByStart);
}

export function nextSession() {
  return upcomingSessions(14)[0] ?? null;
}

export function nextSocialSession() {
  const now = Date.now();
  const latest = now + 7 * 24 * 60 * 60 * 1000;
  return upcomingSessions(8).find((session) => {
    if (session.category !== "Socials" || session.cancelled) return false;
    const startMs = hktEventStartMs(session.dateISO, session.time);
    return startMs >= now && startMs <= latest;
  }) ?? null;
}

// --- Community: private prayer requests ----------------------------------------

const PRAYER_APPROVED_ROLES = new Set(["member", "admin", "super_admin"]);
const PRAYER_ADMIN_ROLES = new Set(["admin", "super_admin"]);
const PRAYER_STATUSES = new Set(["new", "prayed_for", "closed", "withdrawn"]);
const PRAYER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRAYER_MESSAGES = {
  submit: "Prayer request could not be sent. Please try again.",
  load: "Prayer requests could not be loaded. Please try again.",
  memberUpdate: "Prayer request could not be updated. Please try again.",
  adminLoad: "Prayer requests could not be loaded for Admin. Please try again.",
  adminUpdate: "Prayer request status could not be updated. Please try again.",
};

const normalizedPrayerRole = (role) => role === "superadmin" ? "super_admin" : role;
const prayerOwnerId = (row) => row?.ownerId ?? row?.userId ?? null;
const prayerField = (row, camel, snake) => row?.[snake] !== undefined ? row[snake] : row?.[camel];

const memberPrayerRow = (row) => ({
  id: row?.id ?? null,
  request: prayerField(row, "request", "request_text") ?? null,
  anonymousToLeaders: prayerField(row, "anonymousToLeaders", "anonymous_to_leaders") === true,
  status: PRAYER_STATUSES.has(row?.status) ? row.status : "new",
  createdAt: prayerField(row, "createdAt", "created_at") ?? null,
  updatedAt: prayerField(row, "updatedAt", "updated_at") ?? null,
  closedAt: prayerField(row, "closedAt", "closed_at") ?? null,
  withdrawnAt: prayerField(row, "withdrawnAt", "withdrawn_at") ?? null,
});

const adminPrayerRow = (row) => ({
  ...memberPrayerRow(row),
  displayName: String(prayerField(row, "displayName", "display_name") || "Anonymous member").trim()
    || "Anonymous member",
});

function requireApprovedPrayerActor() {
  const actor = currentUser();
  const role = normalizedPrayerRole(actor?.role);
  if (!actor || actor.status !== "approved" || !PRAYER_APPROVED_ROLES.has(role)) {
    throw new Error("Approved member access required");
  }
  return actor;
}

function requirePrayerAdminActor() {
  const actor = requireApprovedPrayerActor();
  if (!PRAYER_ADMIN_ROLES.has(normalizedPrayerRole(actor.role))) {
    throw new Error("Approved Admin access required");
  }
  return actor;
}

function validatedPrayerText(request) {
  const trimmed = String(request ?? "").trim();
  const length = Array.from(trimmed).length;
  if (length < 1 || length > 2000) {
    throw new Error("Prayer request must be between 1 and 2,000 characters.");
  }
  return trimmed;
}

function validatedLivePrayerId(requestId) {
  const id = String(requestId ?? "").trim();
  if (!PRAYER_UUID.test(id)) throw new Error("Choose a valid prayer request.");
  return id;
}

async function prayerRpc(name, args, message) {
  try {
    const { data, error } = args === undefined
      ? await supabase.rpc(name)
      : await supabase.rpc(name, args);
    if (error) throw error;
    return data;
  } catch {
    throw new Error(message);
  }
}

function prayerRpcRow(data, normalize, message) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") throw new Error(message);
  return normalize(row);
}

function localAdminPrayerRow(row) {
  const ownerId = prayerOwnerId(row);
  const owner = ownerId ? state.users.find((user) => user.id === ownerId) : null;
  return adminPrayerRow({
    ...row,
    displayName: row.anonymousToLeaders === true || !owner
      ? "Anonymous member"
      : owner.fullName || owner.preferredName || "ITC Member",
  });
}

export async function submitPrayerRequest({ request, anonymousToLeaders = false } = {}) {
  const trimmed = validatedPrayerText(request);
  if (isLive()) {
    const data = await prayerRpc("submit_prayer_request", {
      p_request_text: trimmed,
      p_anonymous_to_leaders: anonymousToLeaders === true,
    }, PRAYER_MESSAGES.submit);
    return prayerRpcRow(data, memberPrayerRow, PRAYER_MESSAGES.submit);
  }

  const actor = requireApprovedPrayerActor();
  const now = Date.now();
  const prayer = {
    id: uid("p"),
    ownerId: actor.id,
    request: trimmed,
    anonymousToLeaders: anonymousToLeaders === true,
    status: "new",
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    withdrawnAt: null,
  };
  state.prayers.push(prayer);
  save();
  return memberPrayerRow(prayer);
}

export async function listMyPrayerRequests() {
  if (isLive()) {
    const data = await prayerRpc("list_my_prayer_requests", undefined, PRAYER_MESSAGES.load);
    return (Array.isArray(data) ? data : []).map(memberPrayerRow);
  }

  const actor = requireApprovedPrayerActor();
  return state.prayers
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => prayerOwnerId(row) === actor.id)
    .sort((a, b) => Number(b.row.createdAt) - Number(a.row.createdAt) || b.index - a.index)
    .map(({ row }) => memberPrayerRow(row));
}

export async function setMyPrayerRequestState(requestId, action) {
  if (!["close", "withdraw"].includes(action)) {
    throw new Error("Prayer request action must be close or withdraw.");
  }
  if (isLive()) {
    const id = validatedLivePrayerId(requestId);
    const data = await prayerRpc("set_my_prayer_request_state", {
      p_request_id: id,
      p_action: action,
    }, PRAYER_MESSAGES.memberUpdate);
    return prayerRpcRow(data, memberPrayerRow, PRAYER_MESSAGES.memberUpdate);
  }

  const actor = requireApprovedPrayerActor();
  const prayer = state.prayers.find((row) =>
    row.id === requestId && prayerOwnerId(row) === actor.id
  );
  if (!prayer) throw new Error("Own prayer request not found.");
  const now = Date.now();
  if (action === "close") {
    if (!["new", "prayed_for"].includes(prayer.status)) {
      throw new Error("Prayer request cannot be closed from its current state.");
    }
    prayer.status = "closed";
    prayer.closedAt = now;
    prayer.withdrawnAt = null;
  } else {
    if (prayer.status === "withdrawn") throw new Error("Prayer request is already withdrawn.");
    prayer.status = "withdrawn";
    prayer.request = null;
    prayer.closedAt = null;
    prayer.withdrawnAt = now;
  }
  prayer.updatedAt = now;
  save();
  return memberPrayerRow(prayer);
}

export async function listAdminPrayerRequests() {
  if (isLive()) {
    const data = await prayerRpc("list_admin_prayer_requests", undefined, PRAYER_MESSAGES.adminLoad);
    return (Array.isArray(data) ? data : []).map(adminPrayerRow);
  }

  requirePrayerAdminActor();
  const order = { new: 1, prayed_for: 2, closed: 3 };
  return state.prayers
    .filter((row) => row.status !== "withdrawn")
    .sort((a, b) => {
      const statusOrder = (order[a.status] || 4) - (order[b.status] || 4);
      if (statusOrder) return statusOrder;
      const createdOrder = a.status === "closed"
        ? Number(b.createdAt) - Number(a.createdAt)
        : Number(a.createdAt) - Number(b.createdAt);
      return createdOrder || String(a.id).localeCompare(String(b.id));
    })
    .map(localAdminPrayerRow);
}

export async function setAdminPrayerRequestStatus(requestId, status) {
  if (!["prayed_for", "closed"].includes(status)) {
    throw new Error("Prayer request status must be prayed_for or closed.");
  }
  if (isLive()) {
    const id = validatedLivePrayerId(requestId);
    const data = await prayerRpc("set_admin_prayer_request_status", {
      p_request_id: id,
      p_status: status,
    }, PRAYER_MESSAGES.adminUpdate);
    return prayerRpcRow(data, adminPrayerRow, PRAYER_MESSAGES.adminUpdate);
  }

  requirePrayerAdminActor();
  const prayer = state.prayers.find((row) => row.id === requestId);
  if (!prayer) throw new Error("Prayer request not found.");
  const valid = prayer.status === "new"
    ? ["prayed_for", "closed"].includes(status)
    : prayer.status === "prayed_for" && status === "closed";
  if (!valid) throw new Error("Prayer request cannot be changed from its current state.");
  const now = Date.now();
  prayer.status = status;
  prayer.updatedAt = now;
  prayer.closedAt = status === "closed" ? now : null;
  save();
  return localAdminPrayerRow(prayer);
}

// --- Duty roster --------------------------------------------------------------
// One collector per week (Saturday date) handles paid-session reconciliation.
// The member's payment screen shows this collector's PayMe/FPS details; duty
// handoffs change the target for new payments.

export function collectorFor(sessionId) {
  // Resolve identity from Supabase's in-memory directory in live mode and
  // compose only UUID-keyed payout operations from local persistence.
  const withPayouts = (user) => user
    ? { ...user, ...payoutDetailsForRead(state.paymentPayouts[user.id]) }
    : null;
  if (isLive()) {
    const dateISO = sessionDateOf(sessionId);
    if (dateISO) {
      const slot = liveOps.liveAssigneeForWeek(dateISO);
      if (slot) {
        const payouts = liveOps.livePayoutFor(slot.userId);
        const directory = livePaymentDirectory.get(slot.userId);
        const assigned = directory || (payouts ? { id: slot.userId, fullName: "On-duty collector", preferredName: null } : null);
        if (assigned) return payouts ? { ...assigned, ...payoutDetailsForRead(payouts) } : assigned;
      }
    }
    const candidates = [...livePaymentDirectory.values()];
    return withPayouts(candidates.find((user) =>
      user.status === "approved" && PAYMENT_ADMIN_ROLES.has(user.role)
    ) ?? null);
  }
  const session = findSession(state.activities, sessionId);
  if (session) {
    const slot = state.duty?.[isoDate(session.date)];
    if (slot?.userId) {
      const assigned = paymentUserById(slot.userId);
      if (assigned && assigned.status === "approved" && PAYMENT_ADMIN_ROLES.has(assigned.role)) {
        return withPayouts(assigned);
      }
      const payouts = state.paymentPayouts[slot.userId];
      if (payouts) {
        return {
          id: slot.userId,
          fullName: "On-duty collector",
          preferredName: null,
          ...payoutDetailsForRead(payouts),
        };
      }
    }
  }
  const candidates = state.users;
  return withPayouts(candidates.find((user) =>
    user.status === "approved" && PAYMENT_ADMIN_ROLES.has(user.role)
  ) ?? null);
}

export function dutyFor(sessionId) {
  if (isLive()) {
    const dateISO = sessionDateOf(sessionId);
    if (!dateISO) return null;
    return liveOps.liveAssigneeForWeek(dateISO);
  }
  return state.duty[sessionDateOf(sessionId)] ?? null;
}

export function setDuty(userId, saturdayISO) {
  if (isLive()) {
    return liveOps.liveSetCollector(saturdayISO, userId);
  }
  requirePaymentAdminActor();
  const target = paymentUserById(userId);
  if (!target || target.status !== "approved" || !PAYMENT_ADMIN_ROLES.has(target.role)) return null;
  state.duty[saturdayISO] = { userId: target.id, setAt: Date.now() };
  save();
  return state.duty[saturdayISO];
}

export function normalizePayMeLink(raw) {
  let value = String(raw ?? "").trim();
  if (!value) return "";
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) value = `https://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter your personal PayMe link.");
  }
  const authority = value.slice(value.indexOf("//") + 2).split(/[\/?#]/, 1)[0];
  const hasExplicitPort = authority.split("@").pop().includes(":");
  const pathname = url.pathname.replace(/\/+$/, "");
  const personalPath = pathname.split("/");
  let routePrefix = "";
  let collectorToken = "";
  try {
    routePrefix = decodeURIComponent(personalPath[1] || "");
    collectorToken = decodeURIComponent(personalPath[2] || "");
  } catch {
    throw new Error("Enter your personal PayMe link from PayMe.");
  }
  const hostname = url.hostname.toLowerCase();
  const validToken = (token) => !!token
    && token.trim() === token
    && !/[\\/]/.test(token);
  const isCurrentPayMeLink = hostname === "payme.hsbc"
    && personalPath.length === 2
    && personalPath[0] === ""
    && validToken(routePrefix);
  const isLegacyPayMeLink = hostname === "payme.hsbc.com.hk"
    && personalPath.length === 3
    && personalPath[0] === ""
    && /^[12]$/.test(routePrefix)
    && validToken(collectorToken);
  if (url.protocol !== "https:"
      || url.username
      || url.password
      || url.port
      || hasExplicitPort
      || (!isCurrentPayMeLink && !isLegacyPayMeLink)) {
    throw new Error("Enter your personal PayMe link from PayMe.");
  }
  url.pathname = pathname;
  return url.toString();
}

function payoutDetailsForRead(payouts) {
  const details = payouts || {};
  let paymeLink = "";
  try {
    paymeLink = normalizePayMeLink(details.paymeLink);
  } catch {
    // Persisted or live legacy values must not break payout views.
  }
  return { ...details, paymeLink };
}

export function collectorPayoutsFor(userId) {
  const profile = paymentUserById(userId);
  const profilePhone = String(profile?.phone || "").trim();
  if (isLive()) {
    const live = liveOps.livePayoutFor(userId);
    if (live) {
      const normalized = payoutDetailsForRead(live);
      return { paymeLink: normalized.paymeLink, fpsPhone: live.fpsPhone || profilePhone };
    }
    return { paymeLink: "", fpsPhone: profilePhone };
  }
  const saved = payoutDetailsForRead(state.paymentPayouts[userId]);
  return {
    paymeLink: "",
    fpsPhone: profilePhone || saved.fpsPhone || "",
    ...saved,
    // Membership Details is the source of truth whenever the local profile
    // has a phone number.
    ...(profilePhone ? { fpsPhone: profilePhone } : {}),
  };
}

export function updateCollectorPayouts(userId, { paymeLink, fpsPhone }) {
  const profile = paymentUserById(userId);
  const profilePhone = String(profile?.phone || "").trim();
  const resolvedFpsPhone = profilePhone || String(fpsPhone ?? "").trim();
  if (isLive()) {
    const normalizedPayMeLink = normalizePayMeLink(paymeLink);
    return liveOps.liveUpdatePayout(userId, normalizedPayMeLink, resolvedFpsPhone)
      .then((result) => {
        state.paymentPayouts[userId] = {
          paymeLink: normalizedPayMeLink,
          fpsPhone: resolvedFpsPhone,
        };
        save();
        return result;
      });
  }
  requirePaymentAdminActor();
  const target = paymentUserById(userId);
  if (!target || target.status !== "approved" || !PAYMENT_ADMIN_ROLES.has(target.role)) return null;
  state.paymentPayouts[target.id] = {
    paymeLink: normalizePayMeLink(paymeLink),
    fpsPhone: profilePhone || String(fpsPhone ?? "").trim(),
  };
  save();
  return collectorPayoutsFor(target.id);
}

// --- Deferral (defer-only policy; no member refunds) ------------------------

export function deferTargetsFor(booking) {
  const from = parseISO(booking.snapshot.dateISO);
  const sourceActivityId = getSession(booking.sessionId)?.activityId;
  if (!sourceActivityId) return [];
  if (isLive()) {
    const sources = liveOps.listLiveSessions();
    return sources
      .filter((s) => s.activityId === sourceActivityId)
      .filter((s) => s.dateISO > booking.snapshot.dateISO && !s.cancelled)
      .filter((s) => !sessionStarted(s))
      .filter((s) => spotsLeft(s) > 0);
  }
  const sourceSessions = state.activities;
  return sessionsInRange(sourceSessions, from, 28)
    .map((s) => getSession(s.id))
    .filter(
      (s) =>
        s && s.activityId === sourceActivityId && s.kind === "paid" && s.id !== booking.sessionId &&
        !s.cancelled && !sessionStarted(s) && spotsLeft(s) > 0
    );
}

export function deferBooking(bookingId, targetSessionId, now = Date.now()) {
  assertActiveBookingTarget(bookingId);
  assertActiveSessionTarget(targetSessionId);
  if (isLive()) {
    return liveOps.liveDeferBooking(bookingId, targetSessionId);
  }
  const b = getBooking(bookingId);
  if (!b || (b.status !== "reserved" && b.status !== "confirmed"))
    throw new Error("Booking cannot be deferred");
  requireAuthorizedPaymentOwner(b.userId);
  const src = getSession(b.sessionId);
  if (src && sessionStarted(src)) throw new Error("Session has already started");
  const target = getSession(targetSessionId);
  if (!target || target.kind !== "paid" || target.cancelled || sessionStarted(target))
    throw new Error("That session is not available");
  if (!src || target.activityId !== src.activityId)
    throw new Error("Target must be a session of the same activity");
  if (spotsLeft(target) <= 0) throw new Error("Session is full");

  const wasPaid = b.status === "confirmed";
  const moved = {
    ...b,
    id: uid("b"),
    sessionId: target.id,
    status: wasPaid ? "confirmed" : "reserved",
    createdAt: now,
    reservedAt: wasPaid ? null : now,
    payDeadlineAt: wasPaid ? null : nextPayDeadline(target.dateISO, now),
    paymentMarkedAt: wasPaid ? b.paymentMarkedAt : null,
    deferredFrom: b.id,
    deferredTo: null,
    snapshot: snapshotFor(target),
  };
  b.status = "deferred";
  b.deferredTo = target.id;
  state.bookings.push(moved);
  const receipt = receiptForBooking(b.id);
  if (receipt) {
    receipt.bookingId = moved.id;
    receipt.line = `${moved.snapshot.name} — ${fmtDate(moved.snapshot.dateISO)} ${fmtTime(moved.snapshot.time)}`;
  }
  const who = state.users.find((u) => u.id === b.userId);
  const collector = collectorFor(target.id);
  if (collector) {
    notify(collector.id, "defer",
      `${who?.preferredName || who?.fullName || "A member"} deferred ${wasPaid ? "a paid booking" : "a reservation"} to ${target.name} · ${fmtDate(target.date)} — headcount updated.`,
      "#/admin/ops");
  }
  notify(b.userId, "deferred",
    `Moved to ${target.name} · ${fmtDate(target.date)}${wasPaid ? " — your payment carried over." : ". Pay by the new checkpoint."}`,
    `#/booking/${moved.id}`);
  cascadeSession(b.sessionId, now); // freed spot goes to the waitlist
  save();
  return moved;
}

// --- Per-week session admin --------------------------------------------------

// --- One-off events -----------------------------------------------------------
// Admin-created single-date events. Live mode stores them in Supabase (an
// inactive template + one session row via RPC); local mode keeps them in
// state.oneOffEvents as activity-shaped entries with a fixed dateISO.

function oneOffSessionFor(event) {
  const date = parseISO(event.dateISO);
  return {
    ...event,
    id: `${event.id}-${event.dateISO}`,
    activityId: event.id,
    date,
  };
}

// --- RSVP events ------------------------------------------------------------
// Price-0 sessions that still need a headcount (e.g. the post-training
// lunch): joining confirms instantly — no reserve/pay/confirm pipeline.

export async function rsvpSession(userId, sessionOrId, now = Date.now()) {
  const sessionId = typeof sessionOrId === "string" ? sessionOrId : sessionOrId?.id;
  if (isLive()) {
    // The reserve RPC branches on price_hkd = 0 and confirms immediately.
    return liveOps.liveReserveSession(sessionId);
  }
  requireAuthorizedPaymentOwner(userId);
  const session = getSession(sessionId);
  if (!session) throw new Error("Unknown session");
  if (!sessionRequiresRsvp(session) || Number(session.price ?? 0) > 0) {
    throw new Error("Session is not an RSVP event");
  }
  if (session.cancelled) throw new Error("Session is cancelled");
  if (sessionStarted(session)) throw new Error("Session has already started");
  const spots = spotsLeft(session);
  if (spots !== null && spots <= 0) throw new Error("Session is full");
  if (userBookingFor(userId, session.id)) throw new Error("Already booked");
  const booking = {
    id: uid("b"),
    userId,
    sessionId: session.id,
    status: "confirmed",
    createdAt: now,
    reservedAt: now,
    payDeadlineAt: now,
    paymentMarkedAt: null,
    paidAt: now,
    paidMethod: null,
    paymentRef: null,
    confirmedBy: null,
    deferredTo: null,
    deferredFrom: null,
    reminderSentAt: null,
    attendedAt: null,
    attendedBy: null,
    cancelledAt: null,
    cancelledSource: null,
    snapshot: snapshotFor(session),
  };
  state.bookings.push(booking);
  save();
  return booking;
}

// Withdrawing an RSVP is member self-service: no money ever moved, so no
// admin involvement is needed (unlike paid confirmed bookings).
export async function withdrawRsvp(bookingId, now = Date.now()) {
  assertActiveBookingTarget(bookingId);
  if (isLive()) {
    return liveOps.liveWithdrawRsvp(bookingId);
  }
  const booking = getBooking(bookingId);
  if (!booking || booking.status !== "confirmed") return null;
  const session = getSession(booking.sessionId);
  if (!session) throw new Error("Session not found.");
  if (!sessionRequiresRsvp(session) || Number(booking.snapshot?.price) > 0) return null;
  requireAuthorizedPaymentOwner(booking.userId);
  const startsAt = hktEventStartMs(session.dateISO, session.time);
  if (!Number.isFinite(startsAt) || startsAt <= now) {
    throw new Error("Session has already started");
  }
  booking.status = "cancelled";
  booking.cancelledAt = now;
  booking.cancelledSource = "member";
  save();
  return booking;
}

export async function createOneOffEvent(fields) {
  const name = String(fields.name ?? "").trim();
  const dateISO = String(fields.dateISO ?? "").trim();
  const time = String(fields.time ?? "").trim();
  const durationMin = Number(fields.durationMin);
  const location = String(fields.location ?? "").trim();
  const mapsQuery = String(fields.mapsQuery ?? "").trim();
  const category = String(fields.category ?? "").trim() || "Other";
  const price = Math.max(0, Number(fields.price) || 0);
  const capacity = price > 0 ? Math.max(1, Number(fields.capacity) || 20) : null;
  if (!name) throw new Error("Enter the event name.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) throw new Error("Pick the event date.");
  if (!time) throw new Error("Pick the start time.");
  if (!Number.isFinite(durationMin) || durationMin <= 0) throw new Error("Enter a positive duration.");
  if (!location) throw new Error("Enter the venue.");
  const payload = {
    name, dateISO, time, durationMin, location, mapsQuery, category, price, capacity,
    requiresRsvp: price === 0,
  };
  if (isLive()) {
    return liveOps.liveCreateEvent(payload);
  }
  requirePaymentAdminActor();
  const event = {
    id: uid("event"),
    oneOff: true,
    dateISO,
    name,
    kind: price > 0 ? "paid" : "free",
    requiresRsvp: price === 0,
    category,
    weekday: parseISO(dateISO).getDay(),
    time,
    durationMin,
    location,
    mapsQuery: mapsQuery || location,
    photo: "../assets/itc/main.webp",
    price,
    capacity: price > 0 ? capacity : null,
    blurb: "",
    memberNote: "",
    published: true,
  };
  state.oneOffEvents.push(event);
  save();
  return oneOffSessionFor(event);
}

export async function repostRsvpEvent(sessionId) {
  assertActiveSessionTarget(sessionId);
  requirePaymentAdminActor();
  const source = getSession(sessionId);
  if (!source || !sessionRequiresRsvp(source) || Number(source.price ?? 0) > 0 || !source.cancelled) {
    throw new Error("Only a cancelled RSVP event can be reposted.");
  }
  if (sessionStarted(source)) throw new Error("The RSVP event has already started.");
  if (isLive()) {
    return liveOps.liveReopenRsvp(sessionId);
  }
  const override = state.sessionOverrides[sessionId];
  const cancelledAt = override.cancelledAt;
  const recipients = new Set(state.bookings
    .filter((booking) => booking.sessionId === sessionId
      && booking.status === "cancelled"
      && booking.cancelledSource === "session"
      && booking.cancelledAt === cancelledAt)
    .map((booking) => booking.userId)
    .filter(canReceiveRsvpNotification));
  for (const userId of recipients) {
    notify(userId, "session-reopened",
      `${source.name} · ${fmtDate(source.date)} has reopened. RSVP again if you're coming.`,
      `#/activity/${sessionId}`);
  }
  delete override.cancelled;
  delete override.cancelledAt;
  if (!Object.keys(override).length) delete state.sessionOverrides[sessionId];
  save();
  return getSession(sessionId);
}

export async function deleteOneOffEvent(sessionId) {
  assertActiveSessionTarget(sessionId);
  if (isLive()) {
    return liveOps.liveDeleteEvent(sessionId);
  }
  requirePaymentAdminActor();
  const event = state.oneOffEvents.find((e) => `${e.id}-${e.dateISO}` === sessionId);
  if (!event) throw new Error("Event not found.");
  const active = state.bookings.filter(
    (b) => b.sessionId === sessionId && (b.status === "reserved" || b.status === "confirmed")
  );
  if (active.length) {
    throw new Error("Event has active bookings — cancel the session instead.");
  }
  state.oneOffEvents = state.oneOffEvents.filter((e) => e.id !== event.id);
  save();
}

export function cancelSessionWeek(sessionId, reason, now = Date.now()) {
  assertActiveSessionTarget(sessionId);
  if (isLive()) {
    return liveOps.liveCancelSession(sessionId, reason);
  }
  requirePaymentAdminActor();
  const cancellationReason = String(reason || "").trim();
  if (!cancellationReason) throw new Error("Cancellation reason is required.");
  const session = getSession(sessionId);
  if (!session) throw new Error("Session not found.");
  const requiresRsvp = sessionRequiresRsvp(session);
  const hasExplicitZeroPrice = typeof session.price === "number"
    && Number.isFinite(session.price)
    && session.price === 0;
  if (requiresRsvp && !hasExplicitZeroPrice) {
    throw new Error("RSVP session price must be an explicit numeric zero.");
  }
  const rsvpOccurrence = requiresRsvp && hasExplicitZeroPrice;
  if (rsvpOccurrence) {
    if (session.cancelled) throw new Error("Session is already cancelled.");
    const startsAt = hktEventStartMs(session.dateISO, session.time);
    if (!Number.isFinite(startsAt) || startsAt <= now) {
      throw new Error("Session has already started.");
    }
  }
  const cancellationSnapshots = new Map();
  if (rsvpOccurrence) {
    for (const booking of state.bookings) {
      if (booking.sessionId !== sessionId || booking.status !== "confirmed"
          || !canReceiveRsvpNotification(booking.userId)
          || cancellationSnapshots.has(booking.userId)) continue;
      cancellationSnapshots.set(booking.userId, booking.snapshot || session);
    }
  }
  const o = (state.sessionOverrides[sessionId] ||= {});
  o.cancelled = cancellationReason;
  if (rsvpOccurrence) o.cancelledAt = now;
  const cancellationCopy = `Session cancelled by ITC — ${o.cancelled}`;
  const cancellationLink = `#/activity/${sessionId}`;
  const venueActivityId = sessionId.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  for (const b of state.bookings.filter((x) => x.sessionId === sessionId)) {
    if (b.status === "confirmed") {
      if (rsvpOccurrence) {
        b.status = "cancelled";
        b.cancelledAt = now;
        b.cancelledSource = "session";
        continue;
      }
      const target = deferTargetsFor(b).find((s) => s.activityId === venueActivityId);
      if (target) {
        deferBooking(b.id, target.id, now);
      } else {
        b.status = "cancelled";
        if (session.category === "HYROX") {
          notify(b.userId, "session-cancelled",
            `ITC cancelled this HYROX session. If you have paid and would like to apply it to a future ITC HYROX session, contact the collector.`,
            cancellationLink);
        } else {
          notify(b.userId, "session-cancelled",
            `${cancellationCopy}. ${b.snapshot.name} · ${fmtDate(b.snapshot.dateISO)} had no future slot available — a leader will sort your credit.`,
            cancellationLink);
        }
      }
    } else if (b.status === "reserved") {
      b.status = "cancelled";
      notify(b.userId, "session-cancelled",
        `${cancellationCopy}. ${b.snapshot.name} · ${fmtDate(b.snapshot.dateISO)} — your unpaid reservation was released.`,
        cancellationLink);
    }
  }
  if (rsvpOccurrence) {
    for (const [userId, snapshot] of cancellationSnapshots) {
      notify(userId, "session-cancelled",
        `${cancellationCopy}. ${snapshot.name} · ${fmtDate(snapshot.dateISO)}.`,
        cancellationLink);
    }
  } else {
    const q = paymentQueueFor(sessionId);
    for (const entry of [...q.waitlist, ...q.interest]) {
      notify(entry.userId, "session-cancelled",
        `${cancellationCopy}. ITC HYROX · ${fmtDate(sessionDateOf(sessionId))} — the waitlist was dissolved.`,
        cancellationLink);
    }
    q.waitlist = [];
    q.interest = [];
  }
  save();
}

export function setSessionTime(sessionId, time) {
  assertActiveSessionTarget(sessionId);
  if (isLive()) {
    return liveOps.liveSetSessionTime(sessionId, time);
  }
  requirePaymentAdminActor();
  const session = getSession(sessionId);
  const nextTime = String(time || "").trim();
  if (!session) throw new Error("Session not found.");
  if (!nextTime) throw new Error("Pick the start time.");
  if (session.time === nextTime) return session;
  (state.sessionOverrides[sessionId] ||= {}).time = nextTime;
  if (sessionRequiresRsvp(session) && Number(session.price ?? 0) === 0) {
    for (const userId of activeRsvpNotificationRecipients(sessionId)) {
      notify(userId, "operational_session_time_updated",
        `${session.name} · ${fmtDate(session.date)} now starts at ${fmtTime(nextTime)}.`,
        `#/activity/${sessionId}`);
    }
  }
  save();
  return getSession(sessionId);
}

export function setVenueTBC(sessionId, on) {
  assertActiveSessionTarget(sessionId);
  if (isLive()) {
    return liveOps.liveSetVenueTBC(sessionId, !!on);
  }
  requirePaymentAdminActor();
  (state.sessionOverrides[sessionId] ||= {}).venueTBC = !!on;
  save();
}

export function setSessionNotice(sessionId, text) {
  assertActiveSessionTarget(sessionId);
  if (isLive()) {
    return liveOps.liveSetSessionNotice(sessionId, text);
  }
  requirePaymentAdminActor();
  (state.sessionOverrides[sessionId] ||= {}).notice = String(text || "").trim() || undefined;
  save();
}

export function confirmGymBooking(sessionId, note, now = Date.now()) {
  assertActiveSessionTarget(sessionId);
  if (isLive()) {
    return liveOps.liveFinalizeGym(sessionId, note);
  }
  requirePaymentAdminActor();
  const override = (state.sessionOverrides[sessionId] ||= {});
  override.gymConfirmedAt = now;
  override.gymNote = String(note || "").trim() || undefined;
  save();
  return override;
}

// Per-week free-event venue overrides. Admin only. Local mode fans out
// notifications and dedupes per member; live mode delegates both to the
// trusted `set_session_venue` RPC.
export function setWeekVenue(sessionId, {
  location, mapsQuery, meetingLat = null, meetingLng = null,
} = {}) {
  assertActiveSessionTarget(sessionId);
  const before = getSession(sessionId);
  const fallbackActivityId = String(sessionId).replace(/-\d{4}-\d{2}-\d{2}$/, "");
  const overrideActivityId = before?.activityId || fallbackActivityId;
  if (!new Set(["wnt", "run", "water", "lunch"]).has(overrideActivityId)) {
    throw new Error("Activity venue is fixed.");
  }
  const cleanLocation = String(location || "").trim();
  const cleanMapsQuery = String(mapsQuery || "").trim();
  const rawPointProvided = ![meetingLat, meetingLng].every(
    (value) => value === null || value === undefined || value === ""
  );
  const normalizedPoint = normalizeMeetingPoint(meetingLat, meetingLng);
  const acceptsPoint = overrideActivityId === "wnt"
    && normalizeVenueLocation(cleanLocation) === "tamar park";
  if (acceptsPoint && rawPointProvided && !normalizedPoint) {
    throw new Error("Choose a valid meeting point.");
  }
  const meetingPoint = acceptsPoint ? normalizedPoint : null;
  if (isLive()) {
    const wasTBC = before?.location === "TBC"
      || !hasConfirmedVenue(before?.location, before?.mapsQuery);
    return liveOps.liveSetWeekVenue(sessionId, {
      location: cleanLocation,
      mapsQuery: cleanMapsQuery,
      meetingLat: meetingPoint?.lat ?? null,
      meetingLng: meetingPoint?.lng ?? null,
      wasTBC,
    });
  }
  if (!before || (before.kind !== "free" && before.kind !== "rsvp")) throw new Error("Session not found.");
  const wasTBC = before.location === "TBC"
    || !hasConfirmedVenue(before.location, before.mapsQuery);
  requirePaymentAdminActor();
  const actor = currentUser();
  const existingOverride = state.sessionOverrides[sessionId];
  const cleared = cleanLocation === "" && cleanMapsQuery === "";
  if (!existingOverride && cleared) {
    return { sessionId, activityId: overrideActivityId, unchanged: true };
  }
  const override = existingOverride || (state.sessionOverrides[sessionId] = {});
  const previousLocation = override.location || "";
  const previousMapsQuery = override.mapsQuery || "";
  const previousPoint = normalizeMeetingPoint(override.meetingLat, override.meetingLng);
  const previousNotified = override.venueMemberNotifiedAt || null;
  const recurring = getActivity(overrideActivityId);
  const effectiveLocation = cleanLocation || recurring?.location || "";
  const effectiveMapsQuery = cleanMapsQuery || recurring?.mapsQuery || "";
  const confirmed = hasConfirmedVenue(effectiveLocation, effectiveMapsQuery);
  const savedUsable = hasConfirmedVenue(cleanLocation, cleanMapsQuery);
  const effectiveVenueChanged = before.location !== effectiveLocation
    || before.mapsQuery !== effectiveMapsQuery
    || (before.meetingLat ?? null) !== (meetingPoint?.lat ?? null)
    || (before.meetingLng ?? null) !== (meetingPoint?.lng ?? null);
  const nextVenueTBC = cleared || confirmed ? false : Boolean(override.venueTBC);
  const pointChanged = (previousPoint?.lat ?? null) !== (meetingPoint?.lat ?? null)
    || (previousPoint?.lng ?? null) !== (meetingPoint?.lng ?? null);
  const changed = previousLocation !== cleanLocation
    || previousMapsQuery !== cleanMapsQuery
    || Boolean(override.venueTBC) !== nextVenueTBC
    || pointChanged;
  if (!changed) {
    return { sessionId, activityId: overrideActivityId, ...override, unchanged: true };
  }
  override.location = cleanLocation || undefined;
  override.mapsQuery = cleanMapsQuery || undefined;
  if (meetingPoint) {
    override.meetingLat = meetingPoint.lat;
    override.meetingLng = meetingPoint.lng;
  } else {
    delete override.meetingLat;
    delete override.meetingLng;
  }
  override.venueTBC = nextVenueTBC;
  override.setAt = Date.now();
  override.setBy = actor?.id || null;
  const destination = `#/activity/${sessionId}`;
  const sessionLabel = `${before.name || recurring?.name || overrideActivityId} on ${before.dateISO}`;
  const usableShared = !cleared && savedUsable;
  const locationMapsChanged = previousLocation !== cleanLocation
    || previousMapsQuery !== cleanMapsQuery;
  // Shared when usable venue text changed (not coordinate-only, not reset).
  const shouldShared = usableShared && locationMapsChanged;
  const firstShared = shouldShared && !previousNotified;
  const sharedTitle = firstShared ? "Venue confirmed" : "Venue updated";

  if (shouldShared) {
    if (!previousNotified) override.venueMemberNotifiedAt = Date.now();
    const sharedBody =
      `${sessionLabel} is at ${cleanLocation}. Check the activity page for details.`;
    const sharedRecipients = new Set();
    for (const user of state.users) {
      if (user?.status !== "approved") continue;
      if (user.role === "member" || (actor && user.id === actor.id)) {
        sharedRecipients.add(user.id);
      }
    }
    for (const userId of sharedRecipients) {
      state.notifications.push({
        id: uid("n"),
        userId,
        kind: "operational_session_venue_updated",
        title: sharedTitle,
        body: sharedBody,
        link: destination,
        read: false,
        createdAt: Date.now(),
      });
    }
  } else {
    override.venueMemberNotifiedAt = previousNotified;
  }

  const actorLabel = actor?.fullName || actor?.preferredName || actor?.email || "Admin";
  for (const user of state.users) {
    if (user?.status !== "approved") continue;
    if (user.role !== "admin" && user.role !== "superadmin" && user.role !== "super_admin") continue;
    if (actor && user.id === actor.id) continue;
    const body = cleared
      ? `${actorLabel} reset the venue for ${sessionId} to the activity default.`
      : `${actorLabel} set the venue for ${sessionId} to ${effectiveLocation}.`;
    state.notifications.push({
      id: uid("n"),
      userId: user.id,
      kind: "operational_session_venue_updated",
      title: "Session venue updated",
      body,
      link: destination,
      read: false,
      createdAt: Date.now(),
    });
  }
  save();
  return { sessionId, activityId: overrideActivityId, ...override };
}

// --- Community announcements (local publish + inbox fan-out) -----------------

const ANNOUNCEMENT_ADMIN_ROLES = new Set(["admin", "super_admin", "superadmin"]);
const communityAnnouncementColumns =
  "id, title, body, photo_url, status, creator_profile_id, published_at, created_at";

function normalizeCommunityAnnouncement(row) {
  if (!row) return null;
  const publishedAt = row.published_at ?? row.publishedAt ?? row.created_at ?? row.createdAt;
  const postedAt = publishedAt ? Date.parse(publishedAt) : NaN;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    photoUrl: row.photo_url ?? row.photoUrl ?? null,
    postedAt: Number.isFinite(postedAt) ? postedAt : Date.now(),
    createdBy: row.creator_profile_id ?? row.createdBy ?? null,
    status: String(row.status || "published").toLowerCase(),
  };
}

async function refreshLivePublishedAnnouncements() {
  if (!isLive() || !supabase) {
    livePublishedAnnouncements = [];
    return livePublishedAnnouncements;
  }
  const { data, error } = await supabase
    .from("community_announcements")
    .select(communityAnnouncementColumns)
    .eq("status", "published")
    .order("published_at", { ascending: false });
  if (error) throw error;
  livePublishedAnnouncements = (data || []).map(normalizeCommunityAnnouncement).filter(Boolean);
  return livePublishedAnnouncements;
}

export async function refreshPublishedAnnouncements() {
  return refreshLivePublishedAnnouncements();
}

export function listPublishedAnnouncements() {
  if (isLive()) return [...livePublishedAnnouncements];
  return [...(state.announcements || [])].sort((a, b) => b.postedAt - a.postedAt);
}

export async function publishAnnouncement({ title, body, photoUrl } = {}) {
  const actor = isLive() ? await getCurrentUser() : currentUser();
  if (!actor || !ANNOUNCEMENT_ADMIN_ROLES.has(actor.role)) {
    throw new Error("Admin only.");
  }
  const cleanTitle = String(title || "").trim();
  const cleanBody = String(body || "").trim();
  if (!cleanTitle) throw new Error("Enter a title");
  if (!cleanBody) throw new Error("Enter announcement body");
  let cleanPhoto = String(photoUrl || "").trim() || null;
  if (cleanPhoto && !/^https:\/\//i.test(cleanPhoto)) {
    throw new Error("Photo URL must be https");
  }
  try {
    assertSafeAnnouncementMarkdown(cleanBody);
  } catch (err) {
    if (String(err?.message || "") === "unsafe announcement markdown") {
      throw new Error("Body cannot include HTML tags");
    }
    throw err;
  }
  if (isLive() && supabase) {
    const { data, error } = await supabase.rpc("publish_community_announcement", {
      p_title: cleanTitle,
      p_body: cleanBody,
      p_photo_url: cleanPhoto,
    });
    if (error) {
      const message = String(error.message || "");
      if (/Enter a title/i.test(message)) throw new Error("Enter a title");
      if (/Enter announcement body/i.test(message)) throw new Error("Enter announcement body");
      if (/Photo URL must be https/i.test(message)) throw new Error("Photo URL must be https");
      if (/Administrator access required/i.test(message)) throw new Error("Admin only.");
      throw new Error("Unable to publish announcement.");
    }
    const row = normalizeCommunityAnnouncement(data);
    if (!row?.id || row.status !== "published") {
      throw new Error("Unable to publish announcement.");
    }
    await refreshLivePublishedAnnouncements();
    return row;
  }
  const row = {
    id: uid("ann"),
    title: cleanTitle,
    body: cleanBody,
    photoUrl: cleanPhoto,
    postedAt: Date.now(),
    createdBy: actor.id,
    status: "published",
  };
  state.announcements.push(row);
  const plain = announcementPlainText(cleanBody);
  const preview = plain.length > 140 ? `${plain.slice(0, 137)}…` : plain;
  const link = "#/community/announcements";
  const sharedBody = `${cleanTitle} — ${preview}`;
  const sharedNotified = new Set();
  const shareAnnouncement = (userId) => {
    if (sharedNotified.has(userId)) return;
    sharedNotified.add(userId);
    state.notifications.push({
      id: uid("n"),
      userId,
      kind: "community_announcement_published",
      title: cleanTitle,
      body: sharedBody,
      link,
      read: false,
      createdAt: Date.now(),
    });
  };
  for (const user of state.users) {
    if (user?.status !== "approved") continue;
    if (user.role === "member" && user.communityNews) {
      shareAnnouncement(user.id);
    }
  }
  shareAnnouncement(actor.id);
  const actorLabel = actor.preferredName || actor.fullName || actor.email || "Admin";
  const auditBody = `${actorLabel} published “${cleanTitle}”.`;
  for (const user of state.users) {
    if (user?.status !== "approved") continue;
    if (!["admin", "super_admin", "superadmin"].includes(user.role)) continue;
    if (user.id === actor.id) continue;
    state.notifications.push({
      id: uid("n"),
      userId: user.id,
      kind: "community_announcement_audit",
      title: "Announcement published",
      body: auditBody,
      link,
      read: false,
      createdAt: Date.now(),
    });
  }
  save();
  return row;
}

// --- Giving (FPS donations) -----------------------------------------------------
// FPS is a push payment from the member's banking app, so the prototype
// records every gift as "pending" until a leader reconciles it against the
// club account — there is no instant confirmation path like card checkout.

export function campaigns() {
  return state.campaigns;
}

export function activeGivingCampaign() {
  return state.campaigns.find((campaign) => campaign.status === "published") ?? null;
}

const ADMIN_CAMPAIGN_ROLES = new Set(["admin", "superadmin", "super_admin"]);
const campaignColumns = "id, title, description, goal_hkd, fps_id, fps_payee, status, creator_profile_id, created_at, updated_at, published_at, closed_at";

function normalizeGivingCampaign(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    goalHKD: Number(row.goal_hkd ?? row.goalHKD),
    fpsId: row.fps_id ?? row.fpsId,
    fpsPayee: row.fps_payee ?? row.fpsPayee,
    status: String(row.status || "").toLowerCase(),
    creatorProfileId: row.creator_profile_id ?? row.creatorProfileId ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    publishedAt: row.published_at ?? row.publishedAt ?? null,
    closedAt: row.closed_at ?? row.closedAt ?? null,
  };
}

function validatedCampaignFields(draft) {
  const title = String(draft?.title || "").trim();
  const description = String(draft?.description || "").trim();
  const rawGoal = draft?.goalHKD ?? draft?.goal_hkd;
  const goalHKD = Number(rawGoal);
  const fpsId = String(draft?.fpsId ?? draft?.fps_id ?? "").trim();
  const fpsPayee = String(draft?.fpsPayee ?? draft?.fps_payee ?? "").trim();
  if (!title) throw new Error("Enter a campaign title.");
  if (!description) throw new Error("Enter a campaign description.");
  if (!Number.isInteger(goalHKD) || goalHKD <= 0) {
    throw new Error("Enter a positive whole-HKD goal.");
  }
  if (!fpsId) throw new Error("Enter the FPS ID.");
  if (!fpsPayee) throw new Error("Enter the FPS payee.");
  return { title, description, goalHKD, fpsId, fpsPayee };
}

async function requireCampaignAdmin() {
  const user = isLive() ? await getCurrentUser() : currentUser();
  if (!user || user.status !== "approved" || !ADMIN_CAMPAIGN_ROLES.has(user.role)) {
    throw new Error("Admin access required.");
  }
  return user;
}

function localCampaignById(id) {
  return state.campaigns.find((campaign) => campaign.id === id) ?? null;
}

export async function listGivingCampaigns() {
  await requireCampaignAdmin();
  if (!isLive() || !supabase) {
    return state.campaigns.map(normalizeGivingCampaign).sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    );
  }
  const { data, error } = await supabase
    .from("giving_campaigns")
    .select(campaignColumns)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(normalizeGivingCampaign);
}

export async function getActiveGivingCampaign({ ownsGeneration = () => true } = {}) {
  const user = isLive() ? await getCurrentUser() : currentUser();
  if (!user || user.status !== "approved") return null;
  if (!isLive() || !supabase) return normalizeGivingCampaign(activeGivingCampaign());
  const { data, error } = await supabase
    .from("giving_campaigns")
    .select(campaignColumns)
    .eq("status", "published")
    .maybeSingle();
  if (error?.code === "PGRST205") {
    if (ownsGeneration()) liveGivingCampaign = null;
    return null;
  }
  if (error) throw error;
  const campaign = normalizeGivingCampaign(data);
  if (ownsGeneration()) liveGivingCampaign = campaign;
  return campaign;
}

export async function saveGivingCampaign(draft) {
  const user = await requireCampaignAdmin();
  const fields = validatedCampaignFields(draft);
  const id = String(draft?.id || "").trim();
  if (!isLive() || !supabase) {
    const existing = id ? localCampaignById(id) : null;
    if (id && !existing) throw new Error("Giving campaign not found.");
    if (existing?.status === "closed") throw new Error("Closed Giving campaigns are immutable.");
    if (!existing && state.campaigns.some((campaign) => campaign.status !== "closed")) {
      throw new Error("Close the current campaign before creating another.");
    }
    const now = new Date().toISOString();
    if (existing) {
      Object.assign(existing, fields, { updatedAt: now });
      save();
      return normalizeGivingCampaign(existing);
    }
    const campaign = {
      id: uid("campaign"),
      ...fields,
      status: "draft",
      creatorProfileId: user.id,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      closedAt: null,
    };
    state.campaigns.push(campaign);
    save();
    return normalizeGivingCampaign(campaign);
  }
  const row = {
    title: fields.title,
    description: fields.description,
    goal_hkd: fields.goalHKD,
    fps_id: fields.fpsId,
    fps_payee: fields.fpsPayee,
  };
  let result;
  if (id) {
    result = await supabase
      .from("giving_campaigns")
      .update(row)
      .eq("id", id)
      .neq("status", "closed")
      .select(campaignColumns)
      .single();
  } else {
    result = await supabase
      .from("giving_campaigns")
      .insert({ ...row, status: "draft", creator_profile_id: user.id })
      .select(campaignColumns)
      .single();
  }
  if (result.error) throw result.error;
  const campaign = normalizeGivingCampaign(result.data);
  if (!campaign?.id || (id && campaign.id !== id) || campaign.status === "closed") {
    throw new Error("Giving campaign save conflict.");
  }
  if (campaign.status === "published") liveGivingCampaign = campaign;
  return campaign;
}

async function transitionGivingCampaign(id, fromStatus, toStatus) {
  await requireCampaignAdmin();
  const campaignId = String(id || "").trim();
  if (!campaignId) throw new Error("Giving campaign not found.");
  if (!isLive() || !supabase) {
    const campaign = localCampaignById(campaignId);
    if (!campaign) throw new Error("Giving campaign not found.");
    if (campaign.status !== fromStatus) throw new Error(`Campaign must be ${fromStatus} before it can be ${toStatus}.`);
    if (toStatus === "published") validatedCampaignFields(campaign);
    const now = new Date().toISOString();
    campaign.status = toStatus;
    campaign.updatedAt = now;
    if (toStatus === "published") campaign.publishedAt = campaign.publishedAt || now;
    if (toStatus === "closed") campaign.closedAt = now;
    save();
    return normalizeGivingCampaign(campaign);
  }
  const { data, error } = await supabase
    .from("giving_campaigns")
    .update({ status: toStatus })
    .eq("id", campaignId)
    .eq("status", fromStatus)
    .select(campaignColumns)
    .single();
  if (error) throw error;
  const campaign = normalizeGivingCampaign(data);
  if (!campaign?.id || campaign.id !== campaignId || campaign.status !== toStatus) {
    throw new Error("Giving campaign transition conflict.");
  }
  liveGivingCampaign = toStatus === "published" ? campaign : null;
  return campaign;
}

export async function publishGivingCampaign(id) {
  const campaign = (await listGivingCampaigns()).find((item) => item.id === id);
  if (!campaign) throw new Error("Giving campaign not found.");
  validatedCampaignFields(campaign);
  if (campaign.status !== "draft") throw new Error("Campaign must be draft before it can be published.");
  return transitionGivingCampaign(id, "draft", "published");
}

export function closeGivingCampaign(id) {
  return transitionGivingCampaign(id, "published", "closed");
}

export function campaignRaised(campaign = activeGivingCampaign()) {
  const campaignId = typeof campaign === "string" ? campaign : campaign?.id;
  if (!campaignId) return 0;
  return state.donations
    .filter((donation) => donation.campaignId === campaignId)
    .reduce((sum, donation) => sum + Number(donation.amount || 0), 0);
}

export function donationsForUser(userId) {
  return state.donations
    .filter((d) => d.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function recordDonation(input = {}) {
  const user = currentUser();
  if (!user || !user.id || user.status !== "approved") {
    throw new Error("Approved member access required");
  }
  if (Object.hasOwn(input, "userId") && input.userId !== user.id) {
    throw new Error("Donation owner must match the approved member");
  }
  const { name, amount, note, ref, campaignId } = input;
  const campaign = campaignId
    ? state.campaigns.find((item) => item.id === campaignId && item.status === "published") ||
      (isLive() && liveGivingCampaign?.id === campaignId ? liveGivingCampaign : null)
    : activeGivingCampaign() || (isLive() ? liveGivingCampaign : null);
  if (!campaign) throw new Error("No active Giving campaign");
  const transferRef = String(ref || "").trim();
  const existing = transferRef
    ? state.donations.find((item) => item.campaignId === campaign.id && item.ref === transferRef)
    : null;
  if (existing) return existing;
  const donation = {
    id: uid("d"),
    userId: user.id,
    name: String(name).trim(),
    amount: Math.round(Number(amount)),
    currency: "HKD",
    campaignId: campaign.id,
    campaignTitle: campaign.title,
    method: "FPS",
    ref: transferRef,
    note: String(note ?? "").trim(),
    status: "pending", // reconciled manually by a leader
    createdAt: Date.now(),
  };
  state.donations.push(donation);
  save();
  return donation;
}

export { isoDate, todayLocal };
// --- Live (Supabase) auth helpers (from canonical Auth baseline) ----
// --- Live (Supabase) auth helpers --------------------------------------------

const initialsAvatar = (profileId = null, state = "active") => ({
  profileId,
  url: null,
  source: "initials",
  state,
  expiresAt: null,
});

const approvedAvatarUser = () => {
  const user = currentUser();
  return user?.status === "approved" && AVATAR_APPROVED_ROLES.has(user.role) ? user : null;
};

const avatarCacheIsFresh = (entry, profileId) => {
  if (!entry || entry.profileId !== profileId) return false;
  const expiry = entry.presentation.expiresAt;
  if (entry.presentation.url && !expiry) return false;
  return !expiry || Date.parse(expiry) > Date.now() + AVATAR_CACHE_EXPIRY_SKEW_MS;
};

const serviceAvatarPresentation = (input, profileId) => {
  if (!input || typeof input !== "object") throw new Error("Invalid profile photo response");
  return { profileId, ...normalizeAvatarPresentation(input) };
};

const cacheOwnAvatar = (presentation, profileId) => {
  const normalized = serviceAvatarPresentation(presentation, profileId);
  ownAvatarCache = { profileId, presentation: normalized };
  avatarRequestGeneration += 1;
  ownAvatarRequest = null;
  return normalized;
};

const avatarFailure = (operation, error) => {
  const status = Number(error?.context?.status || error?.status || 0);
  if (status === 401) {
    clearAvatarCache();
    return new Error("Profile photo access expired. Please sign in again.");
  }
  const messages = {
    load: "Profile photo could not be loaded. Please try again.",
    upload: "Profile photo could not be saved. Please try again.",
    remove: "Profile photo could not be removed. Please try again.",
    google: "Google profile photo could not be refreshed. Please try again.",
    attendees: "Attendee photos could not be loaded. Please try again.",
    admin: "Member photo status could not be loaded. Please try again.",
    moderate: "Profile photo moderation could not be completed. Please try again.",
  };
  return new Error(messages[operation] || messages.load);
};

async function avatarAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) throw avatarFailure("load", { status: 401 });
  return token;
}

async function resolveAvatarsFromFunction(params, operation = "load") {
  const token = await avatarAccessToken();
  let response;
  try {
    const url = new URL("/functions/v1/resolve-profile-avatars", config.url);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: config.anonKey,
      },
      cache: "no-store",
    });
  } catch (error) {
    throw avatarFailure(operation, error);
  }
  if (response.status === 401) throw avatarFailure(operation, { status: 401 });
  if (!response.ok) throw avatarFailure(operation, { status: response.status });
  try {
    return await response.json();
  } catch {
    throw avatarFailure(operation);
  }
}

async function resolveOwnAvatarFromFunction() {
  const payload = await resolveAvatarsFromFunction({ scope: "self" });
  if (!Array.isArray(payload?.avatars) || payload.avatars.length !== 1) {
    throw avatarFailure("load");
  }
  return payload.avatars[0];
}

async function invokeAvatarMutation(operation, options, profileId) {
  const { data, error } = await supabase.functions.invoke("process-profile-avatar", options);
  if (error) throw avatarFailure(operation, error);
  if (!data?.presentation) throw avatarFailure(operation);
  return cacheOwnAvatar(data.presentation, profileId);
}

export function clearAvatarCache() {
  avatarRequestGeneration += 1;
  ownAvatarCache = null;
  ownAvatarRequest = null;
  sessionAvatarCache.clear();
  adminAvatarCache = null;
}

export async function getOwnAvatar({ force = false } = {}) {
  const user = approvedAvatarUser();
  if (!isLive() || !supabase) return initialsAvatar(user?.id ?? null);
  if (!user) {
    clearAvatarCache();
    return initialsAvatar();
  }
  if (!force && avatarCacheIsFresh(ownAvatarCache, user.id)) return ownAvatarCache.presentation;
  if (!force && ownAvatarRequest) return ownAvatarRequest;

  const generation = ++avatarRequestGeneration;
  const request = resolveOwnAvatarFromFunction()
    .then((presentation) => {
      const normalized = serviceAvatarPresentation(presentation, user.id);
      if (generation === avatarRequestGeneration && approvedAvatarUser()?.id === user.id) {
        ownAvatarCache = { profileId: user.id, presentation: normalized };
        return normalized;
      }
      return ownAvatarCache?.profileId === approvedAvatarUser()?.id
        ? ownAvatarCache.presentation
        : initialsAvatar();
    })
    .catch((error) => {
      if (/^Profile photo /.test(error?.message || "")) throw error;
      throw avatarFailure("load", error);
    })
    .finally(() => {
      if (ownAvatarRequest === request) ownAvatarRequest = null;
    });
  ownAvatarRequest = request;
  return request;
}

export async function uploadMyAvatar(jpegBlob) {
  const user = approvedAvatarUser();
  if (!isLive() || !supabase) return initialsAvatar(user?.id ?? null);
  if (!user) throw new Error("Approved membership is required to manage a profile photo.");
  if (!jpegBlob || jpegBlob.type !== "image/jpeg" || jpegBlob.size > 2 * 1024 * 1024) {
    throw new Error("Choose a valid cropped JPEG under 2 MB.");
  }
  const body = new FormData();
  body.append("action", "upload");
  body.append("file", jpegBlob, "profile-avatar.jpg");
  try {
    return await invokeAvatarMutation("upload", { method: "POST", body }, user.id);
  } catch (error) {
    if (/^Profile photo /.test(error?.message || "")) throw error;
    throw avatarFailure("upload", error);
  }
}

export async function removeMyAvatar() {
  const user = approvedAvatarUser();
  if (!isLive() || !supabase) return initialsAvatar(user?.id ?? null);
  if (!user) throw new Error("Approved membership is required to manage a profile photo.");
  try {
    return await invokeAvatarMutation("remove", { method: "DELETE" }, user.id);
  } catch (error) {
    if (/^Profile photo /.test(error?.message || "")) throw error;
    throw avatarFailure("remove", error);
  }
}

export async function syncGoogleAvatar() {
  const user = approvedAvatarUser();
  if (!isLive() || !supabase || !user) return initialsAvatar(user?.id ?? null);
  try {
    return await invokeAvatarMutation(
      "google",
      { method: "POST", body: { action: "sync_google" } },
      user.id,
    );
  } catch (error) {
    if (/sign in again|^Google profile photo /i.test(error?.message || "")) throw error;
    throw avatarFailure("google", error);
  }
}

const avatarRowsExpiry = (rows) => {
  const defaultExpiry = Date.now() + 9 * 60_000;
  return rows.reduce((earliest, row) => {
    if (!row.url) return earliest;
    const expiry = Date.parse(row.expiresAt || "");
    return Math.min(earliest, Number.isFinite(expiry) ? expiry : Date.now());
  }, defaultExpiry);
};

const avatarRowsCacheIsFresh = (entry, profileId) =>
  entry?.profileId === profileId
  && entry.expiresAt > Date.now() + AVATAR_CACHE_EXPIRY_SKEW_MS;

const serviceAvatarRow = (input, { admin = false } = {}) => {
  if (!input || typeof input !== "object" || typeof input.profileId !== "string") return null;
  const presentation = serviceAvatarPresentation(input, input.profileId);
  const row = {
    ...presentation,
    displayName: typeof input.displayName === "string" && input.displayName.trim()
      ? input.displayName.trim()
      : "Member",
  };
  if (!admin) return row;
  return {
    ...row,
    pendingPreviewUrl: typeof input.pendingPreviewUrl === "string" ? input.pendingPreviewUrl : null,
    moderationReason: typeof input.moderationReason === "string" ? input.moderationReason : null,
    moderatedAt: typeof input.moderatedAt === "string" ? input.moderatedAt : null,
  };
};

export async function getSessionAvatars(sessionId, { force = false } = {}) {
  const id = String(sessionId || "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 100) {
    throw new Error("Invalid session for attendee photos.");
  }
  const user = approvedAvatarUser();
  if (!user) return [];
  if (!isLive() || !supabase) {
    const session = getSession(id);
    return session
      ? attendeesFor(session).map((displayName) => ({
        ...initialsAvatar(),
        displayName,
      }))
      : [];
  }
  const cached = sessionAvatarCache.get(id);
  if (!force && avatarRowsCacheIsFresh(cached, user.id)) return cached.rows;
  let payload;
  try {
    payload = await resolveAvatarsFromFunction({ scope: "session", sessionId: id }, "attendees");
  } catch (error) {
    if (/sign in again|^Attendee photos /i.test(error?.message || "")) throw error;
    throw avatarFailure("attendees", error);
  }
  if (!Array.isArray(payload?.avatars)) throw avatarFailure("attendees");
  let rows;
  try {
    rows = payload.avatars.map((row) => serviceAvatarRow(row)).filter(Boolean);
  } catch (error) {
    throw avatarFailure("attendees", error);
  }
  sessionAvatarCache.set(id, {
    profileId: user.id,
    rows,
    expiresAt: avatarRowsExpiry(rows),
  });
  return rows;
}

export async function getAdminAvatarRows({ force = false } = {}) {
  const user = currentUser();
  const isAdmin = user?.status === "approved" && ["admin", "superadmin", "super_admin"].includes(user.role);
  if (!isLive() || !supabase) {
    if (!isAdmin) return [];
    return allUsers().map((member) => ({
      ...initialsAvatar(member.id),
      displayName: member.fullName || member.email || "Member",
      pendingPreviewUrl: null,
      moderationReason: null,
      moderatedAt: null,
    }));
  }
  if (!isAdmin) return [];
  if (!force && avatarRowsCacheIsFresh(adminAvatarCache, user.id)) return adminAvatarCache.rows;
  let payload;
  try {
    payload = await resolveAvatarsFromFunction({ scope: "admin_members" }, "admin");
  } catch (error) {
    if (/sign in again|^Member photo status /i.test(error?.message || "")) throw error;
    throw avatarFailure("admin", error);
  }
  if (!Array.isArray(payload?.rows)) throw avatarFailure("admin");
  let rows;
  try {
    rows = payload.rows.map((row) => serviceAvatarRow(row, { admin: true })).filter(Boolean);
  } catch (error) {
    throw avatarFailure("admin", error);
  }
  adminAvatarCache = {
    profileId: user.id,
    rows,
    expiresAt: avatarRowsExpiry(rows),
  };
  return rows;
}

export async function moderateAvatar(profileId, action, reason = "") {
  const user = currentUser();
  const isAdmin = user?.status === "approved" && ["admin", "superadmin", "super_admin"].includes(user.role);
  if (!isAdmin) throw new Error("Administrator access is required to moderate profile photos.");
  const targetId = String(profileId || "").trim();
  if (!targetId || targetId.length > 100) throw new Error("Choose a valid member photo.");
  if (!["hide", "approve", "reject"].includes(action)) throw new Error("Choose a valid moderation action.");
  const trimmedReason = String(reason || "").trim();
  if (["hide", "reject"].includes(action) && !trimmedReason) {
    throw new Error("A moderation reason is required.");
  }
  if (trimmedReason.length > 300) throw new Error("Moderation reason must be 300 characters or fewer.");
  if (!isLive() || !supabase) return initialsAvatar(targetId, action === "approve" ? "active" : "hidden");
  const body = action === "approve"
    ? { profileId: targetId, action }
    : { profileId: targetId, action, reason: trimmedReason };
  let result;
  try {
    result = await supabase.functions.invoke("moderate-profile-avatar", {
      method: "POST",
      body,
    });
  } catch (error) {
    throw avatarFailure("moderate", error);
  }
  if (result.error || !result.data?.presentation) throw avatarFailure("moderate", result.error);
  try {
    const presentation = serviceAvatarPresentation(result.data.presentation, targetId);
    clearAvatarCache();
    return presentation;
  } catch (error) {
    throw avatarFailure("moderate", error);
  }
}

export async function getCurrentUser() {
  if (!isLive() || !supabase) return currentUser();
  const { data: sessData, error: sessErr } = await supabase.auth.getSession();
  if (sessErr || !sessData.session) {
    clearAvatarCache();
    liveUser = null;
    return null;
  }
  const authUser = sessData.session.user;
  if (liveUser?.id && liveUser.id !== authUser.id) {
    clearAvatarCache();
    liveProfile = null;
    liveProfileFetchedAt = 0;
  }
  if (!liveProfile || Date.now() - liveProfileFetchedAt > LIVE_PROFILE_TTL_MS) {
    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", authUser.id)
      .maybeSingle();
    if (profErr) {
      // Never fail silently — a broken profile read renders a signed-in
      // user as a visitor with no clue why (cf. the 42P17 RLS recursion).
      console.error("profiles fetch failed", profErr);
      return null;
    }
    liveProfile = prof || {
      id: authUser.id,
      email: authUser.email,
      full_name: authUser.user_metadata?.full_name || null,
      avatar_url: authUser.user_metadata?.avatar_url || null,
      role: "pending",
    };
    liveProfileFetchedAt = Date.now();
  }
  const fullName = liveProfile.full_name || liveProfile.email || "ITC Member";
  liveUser = {
    id: liveProfile.id,
    email: liveProfile.email,
    fullName,
    preferredName: fullName.split(" ")[0],
    avatarUrl: liveProfile.avatar_url,
    appliedAt: liveProfile.created_at,
    role: liveProfile.role,
    status:
      liveProfile.role === "pending"
        ? "pending"
        : liveProfile.role === "declined"
          ? "declined"
          : "approved",
    profile: liveProfile,
  };
  livePaymentDirectory.set(liveUser.id, normalizePaymentUser(liveUser));
  if (liveUser.status !== "approved") clearAvatarCache();
  return liveUser;
}

const authCallbackUrl = () => new URL("/app/", window.location.origin).toString();

export async function signInWithGoogle() {
  if (!isLive() || !supabase) {
    throw new Error("signInWithGoogle requires SUPABASE_URL and SUPABASE_ANON_KEY");
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: authCallbackUrl() },
  });
  if (error) throw error;
}

export async function signInWithMagicLink(email) {
  if (!isLive() || !supabase) {
    throw new Error("signInWithMagicLink requires SUPABASE_URL and SUPABASE_ANON_KEY");
  }
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Enter your email address");
  const { error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: authCallbackUrl(),
    },
  });
  if (error) throw error;
  return { ok: true };
}

export async function signOutLive() {
  if (!isLive() || !supabase) return signOut();
  clearAvatarCache();
  liveProfile = null;
  liveUser = null;
  liveProfileFetchedAt = 0;
  livePaymentDirectory = new Map();
  livePublishedAnnouncements = [];
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// --- Admin: user/role management (Supabase) --------------------------------

export async function listProfiles() {
  if (!isLive() || !supabase) return allUsers();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

function indemnityExportRecord({ profile, application = null, local = false }) {
  const role = profile.role === "super_admin" ? "superadmin" : profile.role;
  const acceptedAt = local ? profile.indemnityAcceptedAt || null : application?.waiver_accepted_at || null;
  const signature = local ? profile.indemnitySignature || "" : application?.waiver_signature_text || "";
  const signedAt = local ? profile.indemnitySignedAt || "" : application?.waiver_signed_at || "";
  const formVersion = local ? profile.indemnityFormVersion || "" : application?.waiver_form_version || "";
  const emergencyName = local ? profile.emergencyName || "" : application?.emergency_name || "";
  const emergencyRelationship = local
    ? profile.emergencyRelationship || ""
    : application?.emergency_relationship || "";
  const emergencyPhone = local ? profile.emergencyPhone || "" : application?.emergency_phone || "";
  const normalized = {
    indemnityAcceptedAt: acceptedAt,
    indemnitySignature: signature,
    indemnitySignedAt: signedAt,
    indemnityFormVersion: formVersion,
    emergencyName,
    emergencyRelationship,
    emergencyPhone,
  };
  return {
    id: profile.id,
    fullName: local ? profile.fullName || "" : profile.full_name || profile.email || "ITC Member",
    email: profile.email || "",
    status: profile.status || (role === "pending" || role === "declined" ? role : "approved"),
    role,
    phone: local ? profile.phone || "" : application?.mobile || "",
    emergencyName,
    emergencyRelationship,
    emergencyPhone,
    indemnityStatus: !acceptedAt
      ? "Not accepted"
      : isIndemnityCurrent(normalized)
        ? "Accepted"
        : "Review required",
    indemnitySignature: signature,
    indemnitySignedAt: signedAt,
    indemnityFormVersion: formVersion,
    indemnityAcceptedAt: acceptedAt,
  };
}

export async function listIndemnityRecords() {
  requirePaymentAdminActor();
  if (!isLive() || !supabase) {
    return state.users.map((user) => indemnityExportRecord({ profile: user, local: true }));
  }
  const [{ data: profiles, error: profileError }, { data: applications, error: applicationError }] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at", { ascending: true }),
    supabase.from("applications").select("*").order("submitted_at", { ascending: true }),
  ]);
  if (profileError) throw profileError;
  if (applicationError) throw applicationError;
  const applicationByProfile = new Map((applications || []).map((application) => [application.profile_id, application]));
  return (profiles || []).map((profile) => indemnityExportRecord({
    profile,
    application: applicationByProfile.get(profile.id) || null,
  }));
}

export async function listRoleChanges() {
  if (!isLive() || !supabase) return [];
  const { data, error } = await supabase
    .from("role_changes")
    .select("*, changed_by_profile:changed_by(email, full_name)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function updateProfileRole(profileId, newRole, reason, expectedRole = null) {
  if (!isLive() || !supabase) return setRole(profileId, newRole);
  let query = supabase
    .from("profiles")
    .update({ role: newRole })
    .eq("id", profileId);
  if (expectedRole) query = query.eq("role", expectedRole);
  const { data, error } = await query.select("id, role").single();
  if (error) throw error;
  if (!data || data.id !== profileId || data.role !== newRole) {
    throw new Error("Application decision conflict.");
  }
  // The DB trigger writes role_changes + welcome notification automatically.
  // Persisting `reason` to role_changes.reason requires a small Postgres
  // RPC that sets a session-local config; deferred. ⏳
  if (reason) console.info("role update reason:", reason);
}

// --- Applicant: application form (B; Supabase) ------------------------------

function localApplication(user) {
  return {
    profile_id: user.id,
    mobile: user.phone || "",
    is_minor: !!user.isMinor,
    guardian_name: user.guardianName || null,
    guardian_phone: user.guardianPhone || null,
    emergency_name: user.emergencyName || "",
    emergency_relationship: user.emergencyRelationship || null,
    emergency_phone: user.emergencyPhone || "",
    heard_source: user.heard || "other",
    heard_detail: user.heardDetail || null,
    preferred_name: user.preferredName || null,
    photo_consent: !!user.mediaConsent,
    waiver_accepted_at: user.indemnityAcceptedAt || null,
    waiver_signature_text: user.indemnitySignature || null,
    waiver_signed_at: user.indemnitySignedAt || null,
    waiver_form_version: user.indemnityFormVersion || null,
    privacy_accepted_at: user.privacyAcceptedAt || null,
    guidelines_accepted_at: user.guidelinesAcceptedAt || user.appliedAt || null,
    submitted_at: user.appliedAt || null,
    whatsapp_reminders: !!user.whatsappReminders,
    email_receipts: !!user.emailReceipts,
    community_news: !!user.communityNews,
    hyrox_payment_reminders: user.hyroxPaymentReminders !== false,
    web_push_ops: !!user.webPushOps,
  };
}

function membershipPatch(form) {
  const isMinor = parseAgeOver18(form.age_over_18);
  const guardian = guardianFields(isMinor, form.guardian_name, form.guardian_phone);
  const emergency = normalizeEmergencyContact({
    emergencyName: form.emergency_name,
    emergencyRelationship: form.emergency_relationship,
    emergencyPhone: form.emergency_phone,
  });
  const patch = {
    mobile: String(form.mobile || "").trim(),
    is_minor: isMinor,
    date_of_birth: null,
    guardian_name: guardian.name,
    guardian_phone: guardian.phone,
    emergency_name: emergency.name,
    emergency_relationship: emergency.relationship,
    emergency_phone: emergency.phone,
    heard_source: String(form.heard_source || "").trim(),
    heard_detail: String(form.heard_detail || "").trim() || null,
    preferred_name: String(form.preferred_name || "").trim() || null,
  };
  if (Object.prototype.hasOwnProperty.call(form, "donorId")) {
    const rawDonorId = String(form.donorId || "").trim();
    if (donorIdProblem(rawDonorId)) throw new Error("Enter a valid Donor ID");
    patch.donor_id = rawDonorId ? normalizeDonorId(rawDonorId) : null;
  }
  if (!patch.mobile) throw new Error("Enter mobile number");
  if (!patch.heard_source) throw new Error("Choose how you heard about ITC");
  return patch;
}

function privacyPatch(form) {
  return {
    whatsapp_reminders: !!form.whatsapp_reminders,
    email_receipts: !!form.email_receipts,
    community_news: !!form.community_news,
    hyrox_payment_reminders: !!form.hyrox_payment_reminders,
    web_push_ops: !!form.web_push_ops,
  };
}

export async function fetchApplicationForUser(user) {
  if (!isLive() || !supabase || !user || !user.id) return null;
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getMyApplication() {
  if (!isLive() || !supabase) {
    const user = currentUser();
    return user ? localApplication(user) : null;
  }
  const cu = await getCurrentUser();
  if (!cu) return null;
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("profile_id", cu.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveMyApplication(form) {
  if (!isLive() || !supabase) {
    throw new Error("saveMyApplication requires live mode");
  }
  const cu = await getCurrentUser();
  if (!cu) throw new Error("Not signed in");
  const fullName = String(form.full_name || "").trim();
  if (!fullName) throw new Error("Enter your full name");
  if (fullName.length > 120) throw new Error("Full name must be 120 characters or fewer");
  const isMinor = parseAgeOver18(form.age_over_18);
  const guardian = guardianFields(isMinor, form.guardian_name, form.guardian_phone);
  if (!form.waiver) throw new Error("Read and accept the Indemnity");
  const acceptance = normalizeIndemnityAcceptance({
    signature: form.waiver_signature_text,
    signedAt: form.waiver_signed_at,
    emergencyName: form.emergency_name,
    emergencyRelationship: form.emergency_relationship,
    emergencyPhone: form.emergency_phone,
  });
  const acceptedAt = new Date().toISOString();
  const row = {
    profile_id: cu.id,
    mobile: form.mobile,
    date_of_birth: null,
    is_minor: isMinor,
    guardian_name: guardian.name,
    guardian_phone: guardian.phone,
    emergency_name: acceptance.emergencyName,
    emergency_relationship: acceptance.emergencyRelationship,
    emergency_phone: acceptance.emergencyPhone,
    heard_source: form.heard_source,
    heard_detail: form.heard_detail || null,
    preferred_name: form.preferred_name || null,
    photo_consent: !!form.photo_consent,
    waiver_accepted_at: acceptedAt,
    waiver_signature_text: acceptance.signature,
    waiver_signed_at: acceptance.signedAt,
    waiver_form_version: acceptance.formVersion,
    privacy_accepted_at: acceptedAt,
    guidelines_accepted_at: acceptedAt,
  };
  const { data: savedProfile, error: profileError } = await supabase
    .from("profiles")
    .update({ full_name: fullName })
    .eq("id", cu.id)
    .select("*")
    .single();
  if (profileError) throw profileError;
  if (!savedProfile) throw new Error("Unable to save your full name");
  liveProfile = savedProfile;
  liveProfileFetchedAt = Date.now();
  await getCurrentUser();

  const { error } = await supabase.from("applications").upsert(row);
  if (error) throw error;
  clearApplyDraft({ profileId: cu.id });
}

export async function updateMyMembershipDetails(form) {
  const patch = membershipPatch(form);
  if (!isLive() || !supabase) {
    const user = currentUser();
    if (!user) throw new Error("Not signed in");
    user.phone = patch.mobile;
    user.isMinor = patch.is_minor;
    user.guardianName = patch.guardian_name;
    user.guardianPhone = patch.guardian_phone;
    user.emergencyName = patch.emergency_name;
    user.emergencyRelationship = patch.emergency_relationship;
    user.emergencyPhone = patch.emergency_phone;
    user.heard = patch.heard_source;
    user.heardDetail = patch.heard_detail;
    user.preferredName = patch.preferred_name;
    if (Object.prototype.hasOwnProperty.call(patch, "donor_id")) user.donorId = patch.donor_id;
    save();
    return localApplication(user);
  }
  const cu = await getCurrentUser();
  if (!cu) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("applications")
    .update(patch)
    .eq("profile_id", cu.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateMyPrivacyPreferences(form) {
  const patch = privacyPatch(form);
  if (!isLive() || !supabase) {
    const user = currentUser();
    if (!user) throw new Error("Not signed in");
    user.whatsappReminders = patch.whatsapp_reminders;
    user.emailReceipts = patch.email_receipts;
    user.communityNews = patch.community_news;
    user.hyroxPaymentReminders = patch.hyrox_payment_reminders;
    user.webPushOps = patch.web_push_ops;
    save();
    return localApplication(user);
  }
  const cu = await getCurrentUser();
  if (!cu) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("applications")
    .update(patch)
    .eq("profile_id", cu.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateMyPhotoConsent(form) {
  if (!form.photo_consent) throw new Error("Photo and video consent is required");
  const patch = { photo_consent: true };
  if (!isLive() || !supabase) {
    const user = currentUser();
    if (!user) throw new Error("Not signed in");
    user.mediaConsent = true;
    save();
    return localApplication(user);
  }
  const cu = await getCurrentUser();
  if (!cu) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("applications")
    .update(patch)
    .eq("profile_id", cu.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function acceptMyIndemnity(payload) {
  if (!isLive() || !supabase) {
    const user = currentUser();
    if (!user) throw new Error("Not signed in");
    return acceptIndemnity(user.id, payload);
  }
  const cu = await getCurrentUser();
  if (!cu) throw new Error("Not signed in");
  const app = await getMyApplication();
  if (!app) throw new Error("Application not found");
  const mapped = {
    indemnityAcceptedAt: app.waiver_accepted_at,
    indemnitySignature: app.waiver_signature_text,
    indemnitySignedAt: app.waiver_signed_at,
    indemnityFormVersion: app.waiver_form_version,
    emergencyName: app.emergency_name,
    emergencyRelationship: app.emergency_relationship,
    emergencyPhone: app.emergency_phone,
  };
  if (isIndemnityCurrent(mapped)) return app.waiver_accepted_at;
  const acceptance = normalizeIndemnityAcceptance({
    ...payload,
    emergencyName: app.emergency_name,
    emergencyPhone: app.emergency_phone,
  });
  const waiver_accepted_at = new Date().toISOString();
  const patch = {
    waiver_accepted_at,
    waiver_signature_text: acceptance.signature,
    waiver_signed_at: acceptance.signedAt,
    waiver_form_version: acceptance.formVersion,
    emergency_relationship: acceptance.emergencyRelationship,
  };
  const { data, error } = await supabase
    .from("applications")
    .update(patch)
    .eq("profile_id", cu.id)
    .select()
    .single();
  if (error) throw error;
  return data.waiver_accepted_at;
}

function parseAgeOver18(value) {
  if (value === "yes") return false;
  if (value === "no") return true;
  throw new Error("Choose whether you are 18 or over");
}

function guardianFields(isMinor, name, phone) {
  if (!isMinor) return { name: null, phone: null };
  const guardianName = String(name || "").trim();
  const guardianPhone = String(phone || "").trim();
  if (!guardianName || !guardianPhone) {
    throw new Error("Enter guardian name and phone");
  }
  return { name: guardianName, phone: guardianPhone };
}

// --- Notifications (B; Supabase) -----------------------------------------------
// Live: pending applications joined with their profiles, mapped to the
// shape the admin approvals cards render. Local: the seed applicants.
export async function listPendingApplications() {
  if (!isLive() || !supabase) return pendingApplicants();
  const { data, error } = await supabase
    .from("applications")
    .select("*, profiles(id, email, full_name, role)");
  if (error) throw error;
  return (data || [])
    .filter((a) => a.profiles?.role === "pending")
    .map((a) => ({
      id: a.profiles.id,
      fullName: a.profiles.full_name || a.profiles.email,
      email: a.profiles.email,
      phone: a.mobile,
      emergencyName: a.emergency_name,
      emergencyRelationship: a.emergency_relationship,
      emergencyPhone: a.emergency_phone,
      heard: a.heard_source,
      appliedAt: a.submitted_at,
      isMinor: !!a.is_minor,
      indemnityAcceptedAt: a.waiver_accepted_at,
      indemnitySignature: a.waiver_signature_text,
      indemnitySignedAt: a.waiver_signed_at,
      indemnityFormVersion: a.waiver_form_version,
      mediaConsent: a.photo_consent,
    }));
}

export async function listApprovalCandidates() {
  if (!isLive() || !supabase) {
    return pendingApplicants().map((user) => ({
      ...user,
      applicationSubmitted: true,
    }));
  }
  const [profiles, applications] = await Promise.all([
    listProfiles(),
    listPendingApplications(),
  ]);
  const applicationByProfile = new Map(applications.map((item) => [item.id, item]));
  return profiles
    .filter((profile) => profile.role === "pending")
    .map((profile) => {
      const application = applicationByProfile.get(profile.id);
      return application
        ? { ...application, applicationSubmitted: true }
        : {
            id: profile.id,
            fullName: profile.full_name || profile.email,
            email: profile.email,
            appliedAt: profile.created_at,
            applicationSubmitted: false,
          };
    })
    .sort((a, b) => new Date(a.appliedAt) - new Date(b.appliedAt));
}

export async function decideApplication(profileId, decision) {
  if (!new Set(["member", "declined"]).has(decision)) {
    throw new Error("Invalid application decision.");
  }
  if (!isLive() || !supabase) {
    const candidate = pendingApplicants().find((user) => user.id === profileId);
    if (!candidate) throw new Error("Pending application not found.");
    if (decision === "member") approveApplicant(profileId);
    else declineApplicant(profileId);
    return;
  }
  const candidate = (await listApprovalCandidates()).find((item) => item.id === profileId);
  if (!candidate) throw new Error("Pending application not found.");
  if (!candidate.applicationSubmitted) throw new Error("Application not submitted.");
  await updateProfileRole(profileId, decision, undefined, "pending");
}



function normalizeLocalNotification(notification) {
  const created = new Date(notification?.createdAt);
  const createdAt = Number.isNaN(created.getTime()) ? null : created.toISOString();
  return {
    ...notification,
    body: notification?.body ?? notification?.message ?? "",
    read_at: notification?.read ? (createdAt || new Date(0).toISOString()) : null,
    destination: notification?.link ?? notification?.destination ?? null,
    created_at: createdAt,
  };
}

export async function listMyNotifications() {
  if (!isLive() || !supabase) {
    const user = currentUser();
    return user ? notificationsFor(user.id).map(normalizeLocalNotification) : [];
  }
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).filter((notification) =>
    !isRetiredHyroxNotification(notification, retirementBooking));
}

export async function markNotificationRead(id) {
  if (!isLive() || !supabase) {
    const user = currentUser();
    const notification = state.notifications.find(
      (row) => row.id === id && row.userId === user?.id && !row.read
    );
    if (!notification) throw new Error("Notification update conflict.");
    notification.read = true;
    save();
    const normalized = normalizeLocalNotification(notification);
    return { id: normalized.id, read_at: normalized.read_at };
  }
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null)
    .select("id, read_at")
    .single();
  if (error) throw error;
  if (!data?.id) throw new Error("Notification update conflict.");
  return data;
}

// --- Approval workflow (Supabase) — canonical Auth baseline exports ---
