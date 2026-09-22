// ==========================================================================
// ITC prototype — view renderers.
// Each view returns an HTML string. app.js owns the router, event
// delegation, and DOM mounting. Views read from the store but never mutate
// it directly (mutations live behind data-action handlers in app.js).
// ==========================================================================

import * as store from "./store.js";
import { isLive } from "./config.js";
import * as liveOps from "./operations.js";
import { sessionCancellationCopy } from "./operations.js";
import { avatarMarkup } from "./avatar.js";
import {
  normalizeMeetingPoint,
  normalizeVenueLocation,
  venuePresentationFor,
} from "./venue.js";
import {
  LEADERS,
  CULTURE,
  ANNOUNCEMENTS,
  findSession,
  sessionStarted,
  hktEventStartMs,
  sessionsInRange,
  parseISO,
  mondayOf,
  sundayOf,
  addDays,
  todayHktISO,
  todayLocal,
  isoDate,
  fmtDate,
  fmtDateLong,
  fmtTime,
  fmtMoney,
  weeklyVerse,
  notificationRelativeTime,
  notificationHktTime,
  notificationDestination,
  notificationCategory,
} from "./data.js";

// Auth roles are normalized: live Supabase returns "super_admin"; the
// prototype internally uses "superadmin". The helpers below bridge both.
const isAdminRole = (role) => ["admin", "superadmin", "super_admin"].includes(role);
const isSuperRole = (role) => ["superadmin", "super_admin"].includes(role);
const normalizeRole = (role) => (role === "super_admin" ? "superadmin" : role);
const normalizedRole = (role) => (role === "super_admin" ? "superadmin" : role);
const roleLabel = (role) => role === "superadmin" || role === "super_admin"
  ? "Super Admin"
  : role === "admin" ? "Admin"
  : role === "declined" ? "Declined"
  : role === "pending" ? "Pending"
  : "Member";

// Toggling member filters must only affect the in-memory view state, never
// the persisted store. Tests reset this explicitly where required.
export const adminMemberFilters = { query: "", status: "all", role: "all" };

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);

const todayISO = () => todayHktISO();

export function replacementShareUrl(token, baseHref = globalThis.location?.href) {
  const route = `#/replacement/${encodeURIComponent(String(token || ""))}`;
  if (!baseHref) return route;
  try {
    const url = new URL(baseHref);
    if (!new Set(["http:", "https:"]).has(url.protocol)) return route;
    url.search = "";
    url.hash = route.slice(1);
    return url.href;
  } catch {
    return route;
  }
}

const fmtDay = (ts) =>
  new Date(ts).toLocaleDateString("en-HK", {
    timeZone: "Asia/Hong_Kong",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const fmtMonthYear = (ts) =>
  new Date(ts).toLocaleDateString("en-HK", {
    timeZone: "Asia/Hong_Kong",
    month: "short",
    year: "numeric",
  });

// --- Shared fragments ---------------------------------------------------------

function badgeFor(s, booking = null, reservation = null) {
  if (s.kind === "free") return `<span class="badge free">Free</span>`;
  if (s.kind === "rsvp") {
    return booking
      ? `<span class="badge free">Going</span>`
      : `<span class="badge free">RSVP</span>`;
  }
  if (booking) return `<span class="badge free">Paid</span>`;
  if (reservation?.paymentMarkedAt) return `<span class="badge warn">Awaiting confirmation</span>`;
  if (reservation) return `<span class="badge warn">To be paid</span>`;
  return `<span class="badge paid">${fmtMoney(s.price)}</span>`;
}

function spotsLabel(s, spots = store.spotsLeft(s)) {
  if (spots <= 0) return `<span class="badge neutral">Full</span>`;
  return `<span class="spots">${spots} spot${spots === 1 ? "" : "s"} left</span>`;
}

const fmtDeadline = (ts) =>
  new Date(ts).toLocaleString("en-HK", { weekday: "short", hour: "numeric", minute: "2-digit" });

function hyroxCycleVenues(cycle) {
  return [cycle.bftSessionId, cycle.midtownSessionId].map((id) => store.getSession(id)).filter(Boolean);
}

function hyroxVenuePreferenceLabel(preference) {
  if (preference === "bft") return "BFT Causeway Bay";
  if (preference === "midtown") return "Midtown 28";
  return "Either venue";
}

function hyroxAssignedVenue(cycle, booking, assignedSession) {
  if (assignedSession?.location) return assignedSession.location;
  const cycleSession = cycle && booking.sessionId
    ? hyroxCycleVenues(cycle).find((session) => session.id === booking.sessionId)
    : null;
  if (cycleSession?.location) return cycleSession.location;
  const snapshots = Array.isArray(booking.allocationSnapshot) ? booking.allocationSnapshot : [];
  return snapshots.at(-1)?.venue || snapshots.at(-1)?.location || null;
}

function hyroxCycleStatus(cycle) {
  const now = Date.now();
  if (cycle.registrationState === "cancelled") return { label: "Cancelled", className: "danger" };
  if (now < cycle.registrationOpensAt) return {
    label: "Sign up opens Monday at 6 PM HKT",
    compactLabel: "Opens Mon · 6 PM",
    className: "neutral",
  };
  if (cycle.venuePlan === "bft_only") return { label: "BFT only", className: "free" };
  if (cycle.venuePlan === "both") return { label: cycle.allocationClosedAt ? "Both gyms confirmed" : "Both gyms open", className: "free" };
  if (cycle.registrationState === "reconciling") return { label: "Payment review", className: "warn" };
  return { label: "Registration open", className: "paid" };
}

function hyroxCycleBookingForUser(cycle, viewerBookings = null) {
  const user = store.currentUser();
  if (!user) return null;
  const bookings = Array.isArray(viewerBookings) ? viewerBookings : store.bookingsForUser(user.id);
  return bookings.find((booking) => booking.cycleId === cycle.id
    && ["reserved", "confirmed", "attended"].includes(booking.status)) || null;
}

function hyroxCycleRow(cycle, scheduleModel = null) {
  const status = hyroxCycleStatus(cycle);
  const booking = hyroxCycleBookingForUser(cycle, scheduleModel?.viewerBookings);
  const action = booking
    ? `<span class="badge free">${booking.status === "reserved" ? "Payment due" : booking.status === "attended" ? "Arrived" : "Booked"}</span>`
    : `<span class="badge ${status.className}">${esc(status.compactLabel || status.label)}</span>`;
  const venues = hyroxCycleVenues(cycle)
    .sort((a, b) => a.time.localeCompare(b.time));
  const venueDetails = venues
    .map((venue) => `<span>${esc(venue.location)} · ${esc(fmtTime(venue.time))}</span>`)
    .join("");
  return `<a class="session-row hyrox-cycle-row" href="#/hyrox/${esc(cycle.id)}">
    <time>${esc(fmtTime(venues[0]?.time || "00:00"))}</time>
    <div class="hyrox-cycle-content"><h3>ITC HYROX<br><span>BFT + Midtown Pool</span></h3><p class="hyrox-cycle-venues">${venueDetails}</p></div>
    <div class="row-end">${action}</div>
  </a>`;
}

function hyroxVenueCards(cycle) {
  return hyroxCycleVenues(cycle).map((venue) => `
    <div class="card hyrox-venue-card">
      <span class="kicker">${esc(venue.location)}</span>
      <h3>${esc(fmtTime(venue.time))}</h3>
      <p class="muted small">${venue.capacity} places · ${fmtMoney(venue.price)}</p>
    </div>`).join("");
}

function sessionRow(s, { past, showDate = true, highlight, scheduleModel = null } = {}) {
  // A session the signed-in member has already booked shows a "Booked"
  // badge instead of price/spots, so Home, Schedule and the booking itself
  // all tell the same story. Per-week overrides (cancelled, time, venue
  // TBC, notice, Midtown open/closed) surface here so the Schedule tab
  // mirrors the detail page.
  const user = store.currentUser();
  const modelBookings = scheduleModel?.viewerBookings;
  const bookings = Array.isArray(modelBookings) ? modelBookings : null;
  const booked = user ? (bookings
    ? bookings.find((booking) => booking.sessionId === s.id
      && ["confirmed", "attended"].includes(booking.status)) || null
    : store.userBookingFor(user.id, s.id)) : null;
  const reserved = user ? (bookings
    ? bookings.find((booking) => booking.sessionId === s.id && booking.status === "reserved") || null
    : store.userReservationFor(user.id, s.id)) : null;
  const requiresRsvp = scheduleModel ? Boolean(s.requiresRsvp || s.kind === "rsvp") : store.sessionRequiresRsvp(s);
  const rsvpCount = scheduleModel
    ? Number(scheduleModel.rsvpCounts?.find((row) => row.session_id === s.id)?.going_count || 0)
    : store.attendeeCountFor(s);
  const midtownClosed = scheduleModel
    ? s.kind === "paid" && s.activityId === "hyrox-midtown" && !s.isOpen
    : s.kind === "paid" && store.isMidtown(s) && !store.midtownOpenFor(s);
  let end;
  if (s.cancelled) {
    end = `<span class="badge danger">Cancelled</span>`;
  } else if (booked) {
    end = requiresRsvp
      ? `<span class="badge free booked">Going</span><span class="spots">${rsvpCount} going</span>`
      : `<span class="badge free booked">${booked.status === "attended" ? "Arrived" : "Booked"}</span>`;
  } else if (reserved) {
    end = `<span class="badge warn">Pay by ${fmtDeadline(reserved.payDeadlineAt)}</span>`;
  } else if (s.kind === "rsvp") {
    end = `<span class="badge free">RSVP</span><span class="spots">${rsvpCount} going</span>`;
  } else if (s.kind === "free") {
    end = `<span class="badge free">Free</span><span class="spots">Just show up</span>`;
  } else if (midtownClosed) {
    end = `<span class="badge neutral">Not yet open</span>`;
  } else {
    const spots = scheduleModel
      ? Math.max(0, Number(s.capacity || 0) - Number(scheduleModel.heldBookingCounts?.[s.id] || 0))
      : store.spotsLeft(s);
    end = `${spots > 0 ? `<span class="badge paid">${fmtMoney(s.price)}</span>` : ""}${spotsLabel(s, spots)}`;
  }
  const sub = [
    showDate ? `${esc(fmtDate(s.date))} · ${esc(s.location)}` : esc(s.location),
    s.cancelled ? esc(sessionCancellationCopy(s)) : "",
    s.venueTBC && !s.cancelled ? "Venue TBC" : "",
    s.notice ? esc(s.notice) : "",
  ].filter(Boolean).join(" · ");
  return `
    <a class="session-row${past ? " is-past" : ""}${highlight ? " next" : ""}${s.cancelled ? " is-cancelled" : ""}" href="#/activity/${s.id}">
      <time>${fmtTime(s.time)}</time>
      <div>
        <h3>${esc(s.name)}</h3>
        <p>${sub}</p>
      </div>
      <div class="row-end">${end}</div>
    </a>`;
}

function pendingBanner() {
  return `
    <div class="banner warn mt16">
      <span class="kicker">Application under review</span>
      <p>An ITC leader will review your application. Until then you can browse free activities, leaders and culture — booking unlocks once you’re approved.</p>
    </div>`;
}

function memberOnlyNote(text = "Approved members see more here.") {
  return `<div class="locked-note">🔒 ${esc(text)}</div>`;
}

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 15.3c2.6.3 4.4 1.7 5 4.7"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4.5 21c1-4 4-6 7.5-6s6.5 2 7.5 6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 5.8v5.4c0 4.4 3 7.6 7 9.8 4-2.2 7-5.4 7-9.8V5.8Z"/><path d="m9 11.5 2.2 2.2L15.5 9"/></svg>',
  check: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 12.5 5 5 10-11"/></svg>',
  pin: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg>',
  cal: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5C7 16.5 3.5 13.2 3.5 9.6 3.5 7 5.5 5 8 5c1.6 0 3.1.8 4 2.1.9-1.3 2.4-2.1 4-2.1 2.5 0 4.5 2 4.5 4.6 0 3.6-3.5 6.9-8.5 10.9Z"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 8h13l-1.1 12.5H6.6Z"/><path d="M8.5 10.5V6.8a3.5 3.5 0 0 1 7 0v3.7"/></svg>',
  dollar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5v19"/><path d="M17 6.5H9.75a3.25 3.25 0 0 0 0 6.5h4.5a3.25 3.25 0 0 1 0 6.5H6.5"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5"/><path d="M13.7 20.5a2 2 0 0 1-3.4 0"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.2 2"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>',
};

// --- Bottom nav / avatar --------------------------------------------------------

const NAV_ITEMS = [
  { key: "home", label: "Home", icon: "home", href: "#/home" },
  { key: "schedule", label: "Schedule", icon: "calendar", href: "#/schedule" },
  { key: "community", label: "Community", icon: "people", href: "#/community" },
  { key: "giving", label: "Giving", icon: "heart", href: "#/giving", roles: ["signed-in"] },
  { key: "account", label: "Account", icon: "user", href: "#/account" },
];

export function navHTML(routeKey, user) {
  const isSignedIn = !!user;
  return NAV_ITEMS.filter((i) => !i.roles || (i.roles.includes("signed-in") && isSignedIn))
    .map(
      (i) => `
      <a href="${i.href}" class="${i.key === routeKey ? "active" : ""}" ${i.key === routeKey ? 'aria-current="page"' : ""}>
        ${ICONS[i.icon]}<span>${i.key === "account" && user ? "Profile" : i.label}</span>
      </a>`
    )
    .join("");
}

export function avatarHTML(user, presentation = null) {
  return user
    ? avatarMarkup({
      name: user.fullName,
      presentation,
      size: 36,
      className: "avatar--top",
      decorative: true,
      eager: true,
    })
    : ICONS.user;
}

export function profileAvatarHTML(user, presentation = null, { editable = true } = {}) {
  const avatar = avatarMarkup({
    name: user?.fullName,
    presentation,
    size: 72,
    className: "avatar--profile",
    decorative: true,
    eager: true,
  });
  return editable ? avatar + '<span class="ph-avatar-edit" aria-hidden="true">Edit</span>' : avatar;
}

export function notificationBellHTML(unreadCount = 0, active = false) {
  const visibleCount = unreadCount > 99 ? "99+" : String(unreadCount);
  return `${ICONS.bell}${unreadCount ? `<span class="notification-badge" aria-hidden="true">${visibleCount}</span>` : ""}`;
}

// ============================================================================
// Views
// ============================================================================

function visitorDraftActions() {
  if (!store.getApplyDraft()) return "";
  return `
    <div class="banner mt16" data-draft-resume>
      <p><strong>Continue your application</strong><br><span class="muted small">Your unfinished form is saved on this device.</span></p>
      <div class="actions">
        <a class="btn sm" href="#/apply">Continue your application</a>
        <button class="btn ghost sm" type="button" data-action="discard-draft">Discard</button>
      </div>
    </div>`;
}

export function viewHome(scheduleModel = null) {
  const user = store.currentUser();
  // Same 14-day window bookings are made in — a confirmed booking can never
  // fall out of "My week" (e.g. next Saturday's booking seen on Sat evening).
  const upcoming = scheduleModel?.sessions || store.upcomingSessions(14);
  const weekStart = mondayOf(todayLocal());
  const weekEnd = addDays(weekStart, 6);
  const inThisWeek = (s) => {
    const iso = s.dateISO || (s.snapshot && s.snapshot.dateISO);
    if (!iso) return false;
    const t = parseISO(iso).getTime();
    return t >= weekStart.getTime() && t <= weekEnd.getTime();
  };
  const name = user ? esc(user.preferredName || user.fullName.split(" ")[0]) : null;

  let rows;
  let emptyMsg;
  let weekHeading;
  if (!user) {
    rows = upcoming.filter((session) => session.kind === "free" && inThisWeek(session));
    emptyMsg = "No open sessions this week — check back soon.";
    weekHeading = "This week — open to all";
  } else if (user.status !== "approved") {
    rows = upcoming.filter((session) => session.kind === "free" && inThisWeek(session));
    emptyMsg = "No open sessions this week — check back soon.";
    weekHeading = "My Week";
  } else {
    const bookings = scheduleModel?.viewerBookings || store.bookingsForUser(user.id);
    const sessionsById = new Map(upcoming.map((session) => [session.id, session]));
    const pooledBookings = bookings
      .filter((booking) => booking.cycleId && booking.status === "confirmed")
      .filter((booking) => !booking.sessionId || !sessionStarted(sessionsById.get(booking.sessionId) || booking.snapshot));
    const pooledSessionIds = new Set(pooledBookings.map((booking) => booking.sessionId).filter(Boolean));
    const bookedIds = new Set(
      bookings
        .filter((booking) => booking.status === "confirmed" && !booking.cycleId && !sessionStarted(booking.snapshot))
        .map((booking) => booking.sessionId)
    );
    rows = [...upcoming.filter((session) => bookedIds.has(session.id) && !pooledSessionIds.has(session.id)), ...pooledBookings];
    emptyMsg = `Nothing booked this week yet. <a href="#/schedule" style="color:var(--accent)">Find a session →</a>`;
    weekHeading = "My Week";
  }

  const guest = !user
    ? `
    <div class="card mt24"><div class="card-body">
      <span class="kicker">New to ITC?</span>
      <h3 class="mt8">Everyone is welcome</h3>
      <p class="hero-meta">Free activities are open to all — just show up. Membership is free too; sign in and an ITC leader approves every application before paid booking unlocks.</p>
      ${visitorDraftActions()}
      ${isLive()
        ? `<button class="btn mt16" type="button" data-action="sign-in-google">Continue with Google</button>
          <a class="btn ghost mt8" href="#/account">Use an email link instead</a>`
        : `<a class="btn mt16" href="#/account">Sign in or join</a>`}
      <p class="muted small mt8">New here? You'll be guided through a short application after sign-in.</p>
    </div></div>`
    : "";

  const verse = weeklyVerse();
  const encouragement = `
    <div class="card mt16"><div class="card-body">
      <span class="kicker">Encouragement of the week</span>
      <p class="verse-text">“${esc(verse.text)}”</p>
      <p class="hero-meta">${esc(verse.ref)}</p>
    </div></div>`;

  return `
    <div class="kicker">${esc(fmtDateLong(todayLocal()))} · Hong Kong</div>
    <h1 class="display">${name ? `Good to see you, ${name}.` : "Train together."}</h1>
    ${user && user.status === "pending" ? pendingBanner() : ""}
    ${user ? encouragement : ""}
    ${guest}
    <div class="section-head">
      <h2>${weekHeading}</h2>
      <a href="#/schedule">See more →</a>
    </div>
    <div class="session-list">
      ${rows.length
        ? rows.map((item, i) => item.cycleId ? pooledBookingRow(item, { highlight: i === 0 })
          : sessionRow(item, { highlight: i === 0, scheduleModel })).join("")
        : `<div class="empty">${emptyMsg}</div>`}
    </div>
    <div class="section-head"><h2>The Club</h2><a href="#/community">More →</a></div>
    <a class="card" href="#/community" style="display:block;text-decoration:none">
      <img class="photo" src="../assets/itc/community.webp" alt="ITC community">
      <div class="card-body">
        <h3>Connect and grow with us</h3>
        <p class="hero-meta">Prayers, fellowship, ad-hoc meals and announcements from the church and the community.</p>
      </div>
    </a>`;
}

// --- Schedule ---------------------------------------------------------------------

export const scheduleState = {
  weekOffset: 0,
  selected: null, // ISO date
  filter: "all",
};

// Back to the default view — this week, today, no filter. The router calls
// this when the Schedule tab is entered fresh (back-navigation from an
// activity/checkout page keeps the week and day you were browsing).
export function resetScheduleState() {
  scheduleState.weekOffset = 0;
  scheduleState.selected = null; // viewSchedule re-picks today
  scheduleState.filter = "all";
}

export function scheduleSelectionForWeek(referenceDate = todayLocal(), weekOffset = 0) {
  const weekStart = addDays(sundayOf(referenceDate), weekOffset * 7);
  return isoDate(weekOffset === 0 ? referenceDate : weekStart);
}

const FILTERS = [
  ["all", "All"],
  ["Run", "Run"],
  ["Water", "Water"],
  ["Strength", "Strength"],
  ["HYROX", "HYROX"],
  ["Socials", "Socials"],
];

function matchesFilter(s, filter) {
  if (filter === "all") return true;
  return s.category === filter;
}

export function viewSchedule(scheduleModel = null) {
  const t = todayLocal();
  const weekStart = addDays(sundayOf(t), scheduleState.weekOffset * 7);
  if (!scheduleState.selected) {
    scheduleState.selected = scheduleSelectionForWeek(t, scheduleState.weekOffset);
  }
  const weekSessions = scheduleModel?.sessions || (isLive()
    ? store.upcomingSessions(Math.max(14, scheduleState.weekOffset * 7 + 7))
      .filter((session) => session.dateISO >= isoDate(weekStart) && session.dateISO <= isoDate(addDays(weekStart, 6)))
    : sessionsInRange(store.activities(), weekStart, 7)
      .map((session) => store.getSession(session.id))
      .filter(Boolean));
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const cells = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekStart, i);
    const iso = isoDate(d);
    const has = weekSessions.some((s) => s.dateISO === iso);
    return `
      <button type="button" class="day-cell ${iso === scheduleState.selected ? "active" : ""} ${has ? "has-sessions" : ""}"
        data-action="sched-day" data-date="${iso}">
        ${dayNames[i]}<strong>${d.getDate()}</strong><span class="dot"></span>
      </button>`;
  }).join("");

  const cycle = scheduleModel?.cycles?.find((item) => item.dateISO === scheduleState.selected)
    || store.hyroxCycleForDate(scheduleState.selected);
  const cycleChildIds = cycle ? new Set([cycle.bftSessionId, cycle.midtownSessionId]) : new Set();
  const list = weekSessions
    .filter((s) => s.dateISO === scheduleState.selected)
    .filter((s) => !cycleChildIds.has(s.id))
    .filter((s) => matchesFilter(s, scheduleState.filter));
  const poolItem = cycle && matchesFilter({ category: "HYROX" }, scheduleState.filter)
    ? hyroxCycleRow(cycle, scheduleModel) : "";
  const listHTML = list.length || poolItem
    ? `${poolItem}${list.map((s) => sessionRow(s, { past: sessionStarted(s), showDate: false, scheduleModel })).join("")}`
    : `<div class="empty">No ${scheduleState.filter === "all" ? "" : esc(scheduleState.filter) + " "}sessions on ${esc(fmtDate(scheduleState.selected))}.</div>`;

  return `
    <div class="kicker">Week of ${esc(fmtDateLong(weekStart))}</div>
    <h1 class="display">Find your next session</h1>
    <div class="week-strip">${cells}</div>
    <div class="week-nav">
      <button type="button" data-action="sched-week" data-dir="-1">← Prev week</button>
      <button type="button" data-action="sched-week" data-dir="1">Next week →</button>
    </div>
    <div class="filter-row">
      ${FILTERS.map(
        ([key, label]) => `
        <button type="button" class="chip ${scheduleState.filter === key ? "active" : ""}"
          data-action="sched-filter" data-filter="${key}">${label}</button>`
      ).join("")}
    </div>
    <div class="session-list">${listHTML}</div>`;
}

// --- Activity detail ------------------------------------------------------------------

export function viewHyroxCycle(cycleId) {
  const cycle = store.getHyroxCycle(cycleId);
  if (!cycle) return viewNotFound("That HYROX registration does not exist.");
  const status = hyroxCycleStatus(cycle);
  const user = store.currentUser();
  const approved = user?.status === "approved";
  const booking = hyroxCycleBookingForUser(cycle);
  const open = (cycle.registrationState === "open" || Date.now() >= cycle.registrationOpensAt)
    && Date.now() < cycle.paymentDeadlineAt && cycle.registrationState !== "cancelled";
  const action = cycle.registrationState === "cancelled"
    ? `<div class="banner warn"><span class="kicker">Cancelled</span><p>Session cancelled by ITC — ${esc(cycle.cancelReason || "reason unavailable")}.</p></div>`
    : booking ? `<div class="banner"><p>Your HYROX registration is already in your account.</p><a class="btn sm" href="#/booking/${booking.id}">View booking</a></div>`
      : approved && open ? `<a class="btn" href="#/hyrox/${esc(cycle.id)}/register">Reserve your place</a>`
        : approved ? memberOnlyNote(status.label) : memberOnlyNote(open ? "Approved members can reserve from Monday at 6 PM HKT." : status.label);
  return `<div class="kicker">HYROX · ${esc(fmtDate(cycle.dateISO))}</div>
    <h1 class="display">One weekly pool. Two possible gyms.</h1>
    <p class="lede">Register once for the shared 32-place pool. Your venue is allocated automatically from confirmed payments.</p>
    <div class="hyrox-pool-card"><div class="section-head"><div><span class="kicker">${esc(status.label)}</span><h2>ITC HYROX</h2></div><span class="badge paid">${fmtMoney(hyroxCycleVenues(cycle)[0]?.price || 180)}</span></div>
      <div class="hyrox-venue-options">${hyroxVenueCards(cycle)}</div>
      <div class="hyrox-threshold-rule"><strong>Monday 6 PM HKT</strong><span>Registration opens</span><strong>Thursday 6 PM HKT</strong><span>Standard payment deadline</span><strong>Thursday 7 PM HKT</strong><span>Holder grace ends</span><strong>Friday 9 PM HKT</strong><span>Venue changes close</span></div>
      ${action}
    </div>`;
}

export function viewHyroxRegistration(cycleId) {
  const cycle = store.getHyroxCycle(cycleId);
  if (!cycle) return viewNotFound("That HYROX registration does not exist.");
  const user = store.currentUser();
  if (!user || user.status !== "approved") return `${memberOnlyNote("Approved members can reserve a HYROX place.")}<a class="btn ghost" href="#/account">Go to Profile</a>`;
  const open = (cycle.registrationState === "open" || Date.now() >= cycle.registrationOpensAt)
    && Date.now() < cycle.paymentDeadlineAt;
  if (!open) return viewHyroxCycle(cycleId);
  return `<div class="hyrox-registration">
    <span class="kicker hyrox-kicker">You’re in. · Sat ${esc(fmtDate(cycle.dateISO))}</span>
    <h1 class="display">Pick your home gym.</h1>
    <p class="lede">Two gyms. One epic Saturday. Tell us which one feels right and we’ll do the rest.</p>
    <aside class="hyrox-no-deferral" aria-label="Booking policy">
      <span class="hyrox-no-deferral-icon" aria-hidden="true">${ICONS.shield}</span>
      <p><strong>Once paid, this booking is final</strong> — no refund and no deferral. If you can’t attend, arrange a manual replacement with an approved ITC friend. No refund or payment transfer is processed in the app; an Admin must confirm the handover.</p>
    </aside>
    <form id="form-hyrox-reserve" class="card hyrox-reserve-card" data-cycle="${esc(cycle.id)}">
      <fieldset class="hyrox-preference-grid"><legend>Venue preference</legend>
        <label class="hyrox-radio"><input type="radio" name="preference" value="bft" required>
          <span class="hyrox-radio-card">
            <span class="hyrox-radio-dot" aria-hidden="true"></span>
            <span class="hyrox-radio-text"><span class="hyrox-radio-name">BFT Causeway Bay</span><span class="hyrox-radio-meta">11:15AM · 20 spots</span></span>
          </span>
        </label>
        <label class="hyrox-radio"><input type="radio" name="preference" value="midtown">
          <span class="hyrox-radio-card">
            <span class="hyrox-radio-dot" aria-hidden="true"></span>
            <span class="hyrox-radio-text"><span class="hyrox-radio-name">Midtown 28</span><span class="hyrox-radio-meta">11:00AM · 12 spots</span></span>
          </span>
        </label>
        <label class="hyrox-radio"><input type="radio" name="preference" value="either">
          <span class="hyrox-radio-card">
            <span class="hyrox-radio-dot" aria-hidden="true"></span>
            <span class="hyrox-radio-text"><span class="hyrox-radio-name">Either venue</span><span class="hyrox-radio-meta">Auto-allocate to your nearest gym</span></span>
          </span>
        </label>
      </fieldset>
      <label class="check-row"><input type="checkbox" name="fallbackAcknowledged" required> I understand that my booking will be at BFT at 11:15AM if only BFT opens.</label>
      <div class="hyrox-threshold-rule">
        <p>20 or fewer paid → BFT only.</p>
        <p>More than 20 paid → both gyms.</p>
        <p>Pay by Thursday 6 PM. Venue changes close Friday 9 PM.</p>
      </div>
      <button class="btn hyrox-cta" type="submit">Reserve my spot →</button>
    </form>
  </div>`;
}

function venuePresentationHTML(presentation) {
  if (presentation.kind === "image") return `
    <figure class="venue-guide activity-map-section">
      <img class="venue-guide-image" src="${esc(presentation.src)}"
        alt="${esc(presentation.alt)}" data-venue-image
        data-fallback-query="${esc(presentation.fallbackQuery)}">
      <figcaption>${esc(presentation.caption)}</figcaption>
    </figure>`;
  if (presentation.kind === "coordinates") return `
    <section class="activity-map-section" aria-label="Venue map">
      <div class="activity-map" id="activity-map"
        data-map-lat="${presentation.lat}" data-map-lng="${presentation.lng}"
        data-marker-label="${esc(presentation.markerLabel)}">
        <p class="muted small" role="status">Loading map…</p>
      </div>
    </section>`;
  if (presentation.kind === "geocode") return `
    <section class="activity-map-section" aria-label="Venue map">
      <div class="activity-map" id="activity-map"
        data-maps-query="${esc(presentation.query)}"
        data-marker-label="${esc(presentation.markerLabel)}">
        <p class="muted small" role="status">Loading map…</p>
      </div>
    </section>`;
  return "";
}

export function viewActivity(sessionId, options) {
  const optionsObject = options && typeof options === "object" && !Array.isArray(options);
  const attendeeNames = optionsObject ? options.attendeeNames : options;
  const avatarRows = optionsObject ? options.avatarRows ?? null : null;
  const s = store.getSession(sessionId);
  if (!s) return viewNotFound("That session doesn’t exist.");

  const user = store.currentUser();
  const isMember = user && user.status === "approved"
    && ["member", "admin", "superadmin", "super_admin"].includes(user.role);
  const past = sessionStarted(s);
  const spots = store.spotsLeft(s);
  const booking = user ? store.userBookingFor(user.id, s.id) : null;
  const reservation = user ? store.userReservationFor(user.id, s.id) : null;
  const midtownClosed = s.kind === "paid" && store.isMidtown(s) && !store.midtownOpenFor(s);
  const collector = store.collectorFor(s.id);
  const collectorName = collector ? (collector.preferredName || collector.fullName) : "the on-duty collector";

  let actionBlock = "";
  const markerLabel = `${s.name} · ${fmtDate(s.date)} · ${fmtTime(s.time)}`;
  const venuePresentation = venuePresentationFor({ ...s, markerLabel });
  const showDirections = !s.cancelled && !past
    && (venuePresentation.kind === "coordinates" || Boolean(s.mapsQuery || s.location));
  const directionsLink = showDirections
    ? `<a class="btn ghost" href="${mapsHref(s)}" target="_blank" rel="noopener">Get directions</a>`
    : "";
  const venueVisual = !s.cancelled && !past && s.kind === "free"
    ? venuePresentationHTML(venuePresentation)
    : "";
  if (s.cancelled) {
    const cancellationFollowup = s.kind === "paid"
      ? "Paid bookings were moved to the next available session — check your account."
      : "Stay tuned for the next available social.";
    actionBlock = `
      <div class="banner warn mt16">
        <span class="kicker">Cancelled</span>
        <p>${esc(sessionCancellationCopy(s))}. ${cancellationFollowup}</p>
      </div>`;
  } else if (past) {
    actionBlock = `<div class="banner mt16"><p>This session has already happened. See you at the next one.</p></div>`;
  } else if (store.sessionRequiresRsvp(s)) {
    // RSVP capability controls participation independently of the activity's
    // presentation kind. Free activities retain walk-in framing, while Lunch
    // retains its organizer and pay-your-own-bill copy.
    const goingCount = store.attendeeCountFor(s);
    if (s.kind === "free") {
      const freeBanner = `
        <div class="free-banner">
          ${ICONS.pin}
          <div><strong>Free · No booking needed.</strong><br><span class="muted small">Everyone is welcome — just show up. RSVP helps the team plan; walk-ins are welcome.</span></div>
        </div>`;
      const calendarButton = `<button class="btn ghost" type="button" data-action="ics" data-session="${s.id}">Add to calendar</button>`;
      if (booking && isMember) {
        actionBlock = `${freeBanner}
          <div class="banner mt16">
            <span class="kicker">You’re going</span>
            <p>${goingCount} going — see you there. Walk-ins are still welcome.</p>
          </div>
          <div class="btn-row">
            <button class="btn ghost" type="button" data-action="rsvp-withdraw" data-booking="${booking.id}">Can’t make it</button>
            ${calendarButton}
            ${directionsLink}
          </div>`;
      } else if (isMember) {
        actionBlock = `${freeBanner}
          <div class="btn-row">
            <button class="btn" type="button" data-action="rsvp-join" data-session="${s.id}">I’m coming</button>
            ${calendarButton}
            ${directionsLink}
          </div>`;
      } else {
        actionBlock = `${freeBanner}
          <div class="btn-row ${showDirections ? "two" : ""}">
            ${calendarButton}
            ${directionsLink}
          </div>`;
      }
    } else if (booking && isMember) {
      actionBlock = `
        <div class="banner mt16">
          <span class="kicker">You're going</span>
          <p>${goingCount} going — see you there. Everyone pays their own bill at the venue.</p>
        </div>
        <div class="btn-row ${showDirections ? "two" : ""}">
          <button class="btn ghost" type="button" data-action="rsvp-withdraw" data-booking="${booking.id}">Can't make it</button>
          ${directionsLink}
        </div>`;
    } else if (isMember) {
      actionBlock = `
        <div class="free-banner">
          ${ICONS.pin}
          <div><strong>Free to join — pay your own bill.</strong><br><span class="muted small">${goingCount} going so far · the organizer books a table from this list, so only tap if you're coming.</span></div>
        </div>
        <div class="btn-row ${showDirections ? "two" : ""}">
          <button class="btn" type="button" data-action="rsvp-join" data-session="${s.id}">Count me in</button>
          ${directionsLink}
        </div>`;
    } else if (user && user.status === "pending") {
      actionBlock = `<div class="banner mt16"><p>Your membership is being reviewed — you can RSVP once you're approved.</p></div>`;
    } else {
      actionBlock = membersOnlyGate();
    }
  } else if (midtownClosed) {
    const pos = user ? store.interestPosition(user.id, s.id) : null;
    const actionInner = isMember
      ? pos
        ? `
        <div class="banner mt16">
          <span class="kicker">Waiting for Midtown</span>
          <p>You’re #${pos} in line. When the collector opens this session, the first ${s.capacity} in line get spots automatically.</p>
        </div>
        <div class="btn-row">
          <button class="btn ghost" type="button" data-action="leave-interest" data-session="${s.id}">Leave the list</button>
          ${directionsLink}
        </div>`
        : `
        <div class="banner mt16">
          <span class="kicker">Midtown not open yet</span>
          <p>BFT fills first — the collector opens Midtown when demand justifies it. Join the list and you’ll auto-convert in order.</p>
        </div>
        <div class="btn-row">
          <button class="btn" type="button" data-action="join-interest" data-session="${s.id}">Wait for Midtown</button>
          ${directionsLink}
        </div>`
      : membersOnlyGate();
    actionBlock = actionInner;
  } else if (booking) {
    actionBlock = `
      <div class="banner mt16">
        <span class="kicker">You’re booked</span>
        <p>Booking ref ${esc(booking.id.toUpperCase())} · paid ${fmtMoney(s.price)}.</p>
      </div>
      <div class="btn-row">
        <a class="btn" href="#/booking/${booking.id}">Manage booking</a>
        ${directionsLink}
      </div>`;
  } else if (spots <= 0) {
    actionBlock = `
      <div class="btn-row">
        <button class="btn" disabled>Session full</button>
        ${directionsLink}
      </div>`;
  } else if (isMember) {
    actionBlock = `
      <div class="btn-row">
        <a class="btn" href="#/checkout/${s.id}">Book & pay · ${fmtMoney(s.price)}</a>
        ${directionsLink}
      </div>
      <p class="muted small mt8 center">Paid per session · receipt issued instantly · manage from your account</p>`;
  } else if (user && user.status === "pending") {
    actionBlock = `
      <div class="banner warn mt16">
        <span class="kicker">Booking locked</span>
        <p>Paid sessions unlock once an ITC leader approves your membership.</p>
      </div>
      ${directionsLink ? `<div class="btn-row">${directionsLink}</div>` : ""}`;
  } else if (user && user.status === "declined") {
    actionBlock = `
      <div class="banner mt16"><p>Your application wasn’t approved. Contact an ITC leader if you think this is a mistake.</p></div>
      ${directionsLink ? `<div class="btn-row">${directionsLink}</div>` : ""}`;
  } else {
    actionBlock = `
      ${membersOnlyGate()}
      ${directionsLink ? `<div class="btn-row">${directionsLink}</div>` : ""}`;
  }

  const metaPaid =
    s.kind === "paid"
      ? `
      <div><small>Price</small><strong>${fmtMoney(s.price)} / session</strong></div>
      <div><small>Places</small><strong>${spots <= 0 ? "Full" : `${spots} of ${s.capacity} left`}</strong></div>`
      : "";

  const fallbackNames = attendeeNames === undefined ? store.attendeesFor(s) : attendeeNames;
  const attendeeRows = Array.isArray(avatarRows)
    ? avatarRows
    : Array.isArray(fallbackNames)
      ? fallbackNames.map((displayName) => ({ displayName, url: null, source: "initials", state: "active" }))
      : [];
  const attendeeList = attendeeRows.length
    ? attendeeRows.map((row) => `
        <div class="attendee-row">
          ${avatarMarkup({
            name: row.displayName,
            presentation: row,
            size: 32,
            className: "attendee-avatar",
            decorative: true,
          })}
          <span class="attendee-name">${esc(row.displayName || "Member")}</span>
        </div>`).join("")
    : attendeeNames === null && !Array.isArray(avatarRows)
      ? '<p class="muted small">Attendee names are temporarily unavailable. Try again shortly.</p>'
      : '<p class="muted small">No confirmed bookings yet.</p>';
  const attendees =
    (s.kind === "paid" || store.sessionRequiresRsvp(s))
      ? isMember
        ? `
      <div class="section-head"><h2>Who’s coming</h2></div>
      <div class="attendees">${attendeeList}</div>`
        : `<div class="section-head"><h2>Who’s coming</h2></div>${memberOnlyNote("Member-only: the attendee list is visible after approval.")}`
      : "";

  const leaderNote = s.memberNote
    ? isMember
      ? `<div class="banner mt16"><span class="kicker">Leader note</span><p>${esc(s.memberNote)}</p></div>`
      : memberOnlyNote("Leader notes (meet points, routes, kit) are shared with approved members.")
    : "";
  const photoFallback = s.kind === "paid" ? "/assets/itc/hyrox.webp" : "/assets/itc/main.webp";
  const photo = s.photo || photoFallback;

  return `
    <a class="back-link" href="#/schedule">← Schedule</a>
    <img class="detail-photo" src="${esc(photo)}" alt="${esc(s.name)}" data-photo-fallback="${photoFallback}">
    <div class="mt16">${badgeFor(s, booking, reservation)}</div>
    <h1 class="display sm">${esc(s.name)}</h1>
    <div class="meta-grid">
      <div><small>When</small><strong>${esc(fmtDate(s.date))}<br>${fmtTime(s.time)}</strong></div>
      <div><small>Where</small><strong>${esc(s.location)}</strong></div>
      <div><small>Length</small><strong>${s.durationMin} min</strong></div>
      ${metaPaid}
    </div>
    <p class="subcopy mt16">${esc(s.blurb)}</p>
    ${leaderNote}
    ${venueVisual}
    ${actionBlock}
    ${attendees}`;
}

function mapsHref(s) {
  const presentation = venuePresentationFor(s);
  if (presentation.kind === "coordinates") {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${presentation.lat},${presentation.lng}`)}`;
  }
  const q = s.mapsQuery || s.location;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function membersOnlyGate() {
  return `
    <div class="banner mt16">
      <span class="kicker">Members only</span>
      <p>This is a paid member session. Apply for free membership — a leader approves every application — then book and pay here.</p>
    </div>
    <div class="btn-row two">
      <a class="btn" href="#/apply">Apply to join</a>
      <a class="btn ghost" href="#/account">Sign in</a>
    </div>`;
}

// --- Giving ---------------------------------------------------------------------------------
// Mock FPS donation flow. FPS is a push payment from the donor's banking
// app, so the flow is: choose an amount -> transfer with the shown reference
// -> gift recorded as "awaiting confirmation" until a leader reconciles it.

export const givingState = {
  step: 1, // 1 = amount, 2 = FPS instructions, 3 = thank you
  amount: 200,
  name: "",
  note: "",
  ref: null,
  campaignId: null,
};

export function resetGivingState() {
  givingState.step = 1;
  givingState.amount = 200;
  givingState.name = "";
  givingState.note = "";
  givingState.ref = null;
  givingState.campaignId = null;
}

function givingLocked(user) {
  const declined = user?.status === "declined";
  return `
    <div class="kicker">Giving &amp; Fundraising</div>
    <h1 class="display">Giving access.</h1>
    <div class="card mt16"><div class="card-body">
      <div class="locked-note">🔒 Giving is available to approved ITC members.</div>
      <h3 class="mt16">${declined ? "Speak with a leader" : "Your application is under review"}</h3>
      <p class="hero-meta">${declined
        ? "Please contact an ITC leader if you would like to discuss your membership decision and Giving access."
        : "Giving access will unlock after an ITC leader reviews and approves your membership application."}</p>
      <div class="btn-row">
        <a class="btn" href="#/account">View Profile</a>
        <a class="btn ghost" href="#/schedule">View Schedule</a>
      </div>
    </div></div>`;
}

export async function viewGiving({
  ownsGeneration = () => true,
  activeCampaignLookup = (options) => store.getActiveGivingCampaign(options),
} = {}) {
  const user = store.currentUser();
  if (!user || user.status !== "approved") return givingLocked(user);

  // The lookup receives the same ownership token as the view so stale route
  // completion cannot mutate store-level live campaign state before the DOM
  // generation guard runs.
  const campaign = await activeCampaignLookup({ ownsGeneration });
  const generationOwned = ownsGeneration();
  const gifts = store.donationsForUser(user.id);
  if (!campaign) {
    if (generationOwned) resetGivingState();
    return `
      <div class="kicker">Giving &amp; Fundraising</div>
      <h1 class="display">Every step can give back.</h1>
      <div class="card mt16"><div class="card-body">
        <h3>No active Giving campaign at the moment</h3>
        <p class="hero-meta mt8">Check back soon for the next opportunity to support the ITC community.</p>
      </div></div>
      ${gifts.length ? `<div class="section-head"><h2>Giving history</h2></div>${givingHistory(gifts)}` : ""}`;
  }

  if (generationOwned && givingState.campaignId !== campaign.id) {
    resetGivingState();
    givingState.campaignId = campaign.id;
  }
  const raised = store.campaignRaised(campaign);
  const goal = Number(campaign.goalHKD) || 0;
  const pct = goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0;

  const flow =
    givingState.step === 2
      ? givingFpsStep(campaign)
      : givingState.step === 3
        ? givingThanksStep()
        : givingAmountStep(user);

  return `
    <div class="kicker">Giving &amp; Fundraising</div>
    <h1 class="display">Every step can give back.</h1>
    <div class="card mt16"><div class="card-body">
      <span class="kicker">Current campaign</span>
      <h3 class="mt8">${esc(campaign.title)}</h3>
      <p class="hero-meta">${esc(campaign.description)}</p>
      <div class="progress mt16"><i style="width:${pct}%"></i></div>
      <div class="progress-meta">
        <strong>${fmtMoney(raised)} raised</strong>
        <span>${pct}% of ${fmtMoney(goal)} goal</span>
      </div>
    </div></div>
    ${flow}
    ${gifts.length ? `<div class="section-head"><h2>Giving history</h2></div>${givingHistory(gifts)}` : ""}`;
}

function givingAmountStep(user) {
  return `
    <div class="card mt16"><div class="card-body">
      <h3>Give via FPS</h3>
      <form id="form-giving" novalidate>
        <div class="chip-row mt16">
          ${[100, 200, 500, 1000]
            .map(
              (a) => `
            <button type="button" class="chip${givingState.amount === a ? " active" : ""}"
              data-action="giving-amount" data-amount="${a}">${fmtMoney(a)}</button>`
            )
            .join("")}
        </div>
        <div class="field">
          <label for="give-amount">Amount (HKD)</label>
          <input id="give-amount" name="amount" type="number" min="1" step="1" inputmode="numeric" value="${givingState.amount}" required>
        </div>
        <div class="field">
          <label for="give-name">Your name</label>
          <input id="give-name" name="name" autocomplete="name" value="${esc(givingState.name || user?.fullName || "")}" required>
        </div>
        <div class="field">
          <label for="give-note">Message (optional)</label>
          <input id="give-note" name="note" value="${esc(givingState.note)}" placeholder="e.g. Go ITC runners!">
        </div>
        <div id="giving-error"></div>
        <button class="btn mt16" type="submit">Continue</button>
        ${user ? "" : `<p class="muted small mt8 center">Tip: sign in first and this gift will appear in your giving history.</p>`}
      </form>
    </div></div>`;
}

function givingFpsStep(campaign) {
  return `
    <div class="card mt16"><div class="card-body">
      <span class="kicker">Step 2 · Complete the transfer</span>
      <h3 class="mt8">Pay ${fmtMoney(givingState.amount)} via FPS</h3>
      <div class="receipt-lines">
        <div class="line"><span>FPS ID</span><strong class="mono">${esc(campaign.fpsId)}</strong></div>
        <div class="line"><span>Payee</span><strong>${esc(campaign.fpsPayee)}</strong></div>
        <div class="line"><span>Amount</span><strong>${fmtMoney(givingState.amount)}</strong></div>
        <div class="line total"><span>Reference</span><strong class="mono">${esc(givingState.ref)}</strong></div>
      </div>
      <div class="btn-row two">
        <button class="btn ghost" type="button" data-action="copy-fps"
          data-copy-value="${esc(campaign.fpsId)}" data-copy-kind="id" aria-label="Copy FPS ID">Copy FPS ID</button>
        <button class="btn ghost" type="button" data-action="copy-reference"
          data-copy-value="${esc(givingState.ref)}" data-copy-kind="giving-reference" aria-label="Copy Giving reference">Copy reference</button>
      </div>
      <ol class="muted small mt16">
        <li>Open your banking app.</li>
        <li>Choose FPS and pay using the FPS ID.</li>
        <li>Paste the FPS ID.</li>
        <li>Enter ${fmtMoney(givingState.amount)} and reference <span class="mono">${esc(givingState.ref)}</span>.</li>
        <li>Return here and select <strong>I’ve made the transfer</strong>.</li>
      </ol>
      <div class="btn-row">
        <button class="btn" type="button" data-action="giving-confirm">I’ve made the transfer</button>
        <button class="btn ghost" type="button" data-action="giving-back">Back</button>
      </div>
      <p class="muted small mt8">Mock flow — no real payment. Gifts show as “Awaiting confirmation” until a leader reconciles the FPS transfer.</p>
    </div></div>`;
}

function givingThanksStep() {
  return `
    <div class="confirm-mark">${ICONS.check}</div>
    <h1 class="display sm center mt16">Thank you, ${esc(givingState.name.split(" ")[0] || "friend")}.</h1>
    <p class="subcopy center mt8">Your gift of ${fmtMoney(givingState.amount)} is recorded — ref <span class="mono">${esc(givingState.ref)}</span>. It will show as confirmed once a leader reconciles the transfer.</p>
    <div class="btn-row">
      <button class="btn" type="button" data-action="giving-reset">Back to Giving</button>
    </div>`;
}

function givingHistory(list) {
  const campaignById = new Map(store.campaigns().map((campaign) => [campaign.id, campaign]));
  return `
    <div class="session-list">
      ${list
        .map(
          (d) => `
        <div class="session-row">
          <time>${new Date(d.createdAt).toLocaleDateString("en-HK", { day: "numeric", month: "short" })}<small>${esc(d.ref)}</small></time>
          <div>
            <h3>${fmtMoney(d.amount)}</h3>
            <p>${esc(campaignById.get(d.campaignId)?.title || d.campaignTitle || "Giving campaign")} · FPS${d.note ? ` · “${esc(d.note)}”` : ""}</p>
          </div>
          <div class="row-end">
            ${d.status === "confirmed" ? '<span class="badge free">Confirmed</span>' : '<span class="badge warn">Awaiting confirmation</span>'}
          </div>
        </div>`
        )
        .join("")}
    </div>`;
}

// --- Community -----------------------------------------------------------------
// The Community tab is about connecting: prayer, fellowship, meals and news.
// Leaders and culture copy lives under Profile > About Island Training Club.

export async function viewCommunity(section) {
  switch (section) {
    case undefined:
      return communityHome();
    case "prayers":
      return await communityPrayers();
    case "fellowship":
      return communityFellowship();
    case "meals":
      // Meals moved to the Schedule tab (recurring RSVP lunch).
      return { redirect: "#/schedule" };
    case "announcements":
      return communityAnnouncements();
    case "about":
      return communityAbout();
    default:
      return viewNotFound();
  }
}

function communityHeading(user) {
  if (!user) return "Find your place in the crew.";
  if (user.status === "pending") return "You’re welcome here.";
  if (user.status === "approved") return "Connect and grow with us.";
  return "Find your place in the crew.";
}

function communityHome() {
  const user = store.currentUser();
  const announcement = ANNOUNCEMENTS[0];
  const nextSocial = store.nextSocialSession();
  const socialHref = nextSocial ? `#/activity/${nextSocial.id}` : "#/schedule";
  const socialDetail = nextSocial
    ? `<p class="muted small mt8">Next up: ${esc(nextSocial.name)} · ${esc(fmtDate(nextSocial.dateISO))}</p>`
    : "";
  return `
    <div class="community-pulse">
      <div class="kicker">Community</div>
      <h1 class="display">${esc(communityHeading(user))}</h1>
      <p class="subcopy mt8">Island Training Club is a Hong Kong training community with a Christian foundation — open to everyone. Training is the doorway; find your next way to connect.</p>

      <section class="community-feature" aria-labelledby="next-connection-title">
        <span class="kicker">Socials</span>
        <h2 id="next-connection-title">Connect beyond training</h2>
        <p>Meet up, share a meal, and find your people.</p>
        ${socialDetail}
        <div class="community-feature-actions">
          <a class="btn sm" href="${socialHref}">View next social</a>
        </div>
      </section>

      <div class="community-section-head">
        <h2>Latest from ITC</h2>
        <a href="#/community/announcements">All announcements →</a>
      </div>
      ${announcement ? `
        <a class="community-announcement-preview" href="#/community/announcements">
          <span class="kicker dim">${esc(fmtDay(announcement.postedAt))} · ITC Anniversary</span>
          <h3>${esc(announcement.title)}</h3>
          <p>${esc(announcement.lead)}</p>
        </a>` : `
        <div class="community-announcement-preview empty">No announcements yet.</div>`}

      <div class="community-section-head"><h2>Ways to connect</h2></div>
      <div class="community-action-grid">
        <a class="community-action-card" href="#/community/prayers">
          <span class="community-action-icon">${ICONS.heart}</span>
          <h3>Prayer</h3>
          <p>Share privately with our leaders.</p>
        </a>
        <a class="community-action-card" href="#/community/fellowship">
          <span class="community-action-icon">${ICONS.people}</span>
          <h3>Fellowship</h3>
          <p>Small groups and community life.</p>
        </a>
      </div>

      <div class="community-section-head"><h2>Explore</h2></div>
      <nav class="community-explore" aria-label="Explore the ITC community">
        <a href="#/schedule">Socials</a>
        <a href="#/community/announcements">Announcements</a>
        <a href="#/community/about">About ITC</a>
      </nav>
    </div>`;
}

// Leaders and culture sit at the bottom of the Community tab, behind the
// About card — open to everyone, signed in or not.
function communityAbout() {
  return `
    <a class="back-link" href="#/community">← Community</a>
    <div class="kicker mt16">Community · About Island Training Club</div>
    <h1 class="display sm">More than a workout.</h1>
    <p class="subcopy mt8">Island Training Club is a Hong Kong training community with a Christian foundation — open to everyone.</p>
    <div class="section-head"><h2>Leaders</h2></div>
    <div class="stack">
      ${LEADERS.map(
        (l) => `
        <div class="card leader-card">
          <img src="${l.photo}" alt="${esc(l.name)}">
          <div class="card-body">
            <h3>${esc(l.name)}</h3>
            <div class="role">${esc(l.role)}</div>
            <p>${esc(l.bio)}</p>
          </div>
        </div>`
      ).join("")}
    </div>
    <div class="section-head"><h2>Culture</h2></div>
    <div class="card"><div class="card-body prose">
      ${CULTURE.map((c) => `<h3>${esc(c.title)}</h3><p>${esc(c.body)}</p>`).join("")}
    </div></div>
    <p class="muted small mt16">Community copy is draft placeholder text for review with ITC leadership.</p>`;
}

const PRAYER_STATUS_LABELS = {
  new: "New",
  prayed_for: "Prayed for",
  closed: "Closed",
  withdrawn: "Withdrawn",
};

function prayerDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleDateString("en-HK", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Hong_Kong",
  });
}

function prayerHistory(rows, loadFailed) {
  if (loadFailed) {
    return `
      <div class="card prayer-load-error" role="alert"><div class="card-body">
        <h3>Prayer requests could not be loaded</h3>
        <p class="muted small mt8">Please try again. No saved requests are shown until the private list is available.</p>
        <button class="btn ghost sm mt16" type="button" data-action="retry-prayer-requests">Try again</button>
      </div></div>`;
  }
  if (!rows.length) return '<div class="empty">You haven’t sent any prayer requests yet.</div>';
  return `
    <div class="prayer-request-list">
      ${rows.map((row) => {
        const status = PRAYER_STATUS_LABELS[row.status] || PRAYER_STATUS_LABELS.new;
        if (row.status === "withdrawn") {
          const withdrawnAt = row.withdrawnAt ?? "";
          return `
            <article class="card prayer-request">
              <div class="card-body">
                <div class="prayer-request-meta">
                  <time datetime="${esc(String(withdrawnAt))}">${esc(prayerDate(withdrawnAt))}</time>
                  <span class="badge neutral">${esc(status)}</span>
                </div>
              </div>
            </article>`;
        }
        const canClose = ["new", "prayed_for"].includes(row.status);
        return `
          <article class="card prayer-request">
            <div class="card-body">
              <div class="prayer-request-meta">
                <time datetime="${esc(String(row.createdAt || ""))}">${esc(prayerDate(row.createdAt))}</time>
                <span class="badge neutral">${esc(status)}</span>
              </div>
              <p class="prayer-request-text">${esc(String(row.request || ""))}</p>
              <p class="muted small prayer-request-privacy">${row.anonymousToLeaders
                ? "Identity hidden from ITC leaders"
                : "Shared with my identity"}</p>
              <div class="prayer-request-actions">
                ${canClose ? `<button class="btn ghost sm" type="button" data-action="close-prayer-request" data-prayer="${esc(String(row.id || ""))}">Close request</button>` : ""}
                <button class="btn danger sm" type="button" data-action="withdraw-prayer-request" data-prayer="${esc(String(row.id || ""))}">Withdraw</button>
              </div>
            </div>
          </article>`;
      }).join("")}
    </div>`;
}

async function communityPrayers() {
  const user = store.currentUser();
  const approved = user?.status === "approved"
    && ["member", "admin", "superadmin", "super_admin"].includes(user.role);
  const intro = `
    <a class="back-link" href="#/community">← Community</a>
    <div class="kicker mt16">Community · Prayers</div>
    <h1 class="display sm">Prayers.</h1>
    <p class="subcopy mt8">We pray for each other — injuries, exams, work, family, anything. Send a request and the leaders will pray with you this week; you’re also welcome to pray along.</p>`;
  if (!approved) {
    const gateCopy = user
      ? "Prayer requests are private and available after your ITC membership is approved. View your membership status in Profile."
      : "Prayer requests are private. Sign in or apply through Profile to continue.";
    const gateAction = user ? "View Profile" : "Sign in or view Profile";
    return `${intro}
      <div class="card mt16"><div class="card-body">
        <h3>Approved members only</h3>
        <p class="muted small mt8">${gateCopy}</p>
        <a class="btn ghost mt16" href="#/account">${gateAction}</a>
      </div></div>`;
  }

  let rows = [];
  let loadFailed = false;
  try {
    rows = await store.listMyPrayerRequests();
  } catch {
    loadFailed = true;
  }

  return `${intro}
    <div class="card mt16 prayer-form-card"><div class="card-body">
      <h3>Ask for prayer</h3>
      <form id="form-prayer" novalidate>
        <div class="field">
          <label for="pr-text">Prayer request *</label>
          <textarea id="pr-text" name="request" rows="4" required maxlength="2000" placeholder="What can we pray about?"></textarea>
        </div>
        <label class="check prayer-anonymous-check" for="pr-anonymous">
          <input id="pr-anonymous" name="anonymousToLeaders" type="checkbox">
          <span>Hide my identity from ITC leaders</span>
        </label>
        <div id="prayer-error"></div>
        <button class="btn mt16" type="submit">Send prayer request</button>
        <p class="muted small mt8">Requests are shared privately with ITC Admins and are never posted publicly.</p>
      </form>
    </div></div>
    <div class="section-head prayer-history-head"><h2>My Prayer Requests</h2></div>
    ${prayerHistory(rows, loadFailed)}`;
}

function communityFellowship() {
  return `
    <a class="back-link" href="#/community">← Community</a>
    <div class="kicker mt16">Community · Fellowship</div>
    <h1 class="display sm">Fellowship.</h1>
    <p class="subcopy mt8">Sessions are where we train; fellowship is where we become friends. Whatever you believe, you’re welcome at every one of these.</p>
    <div class="card mt16"><div class="card-body prose">
      <h3>Small groups</h3>
      <p>Midweek groups meet around the city — a short reflection, honest conversation and prayer for anyone who wants it. No Bible knowledge required.</p>
      <h3>Sundays at IECC</h3>
      <p>Many of us worship at Island Evangelical Community Church on Sunday mornings. Come along and sit with the ITC crowd — service starts 10:30 AM.</p>
      <h3>First-timers</h3>
      <p>New to church entirely? Say so at any session and a leader will happily walk you through what to expect — zero pressure, zero jargon.</p>
    </div></div>
    <button class="btn mt16" type="button" data-action="connect-interest" data-topic="fellowship groups">I’m interested — tell me more</button>
    <p class="muted small mt16 center">Draft content — fellowship details to be confirmed with ITC leadership.</p>`;
}

function communityAnnouncements() {
  const announcement = ANNOUNCEMENTS[0];
  if (!announcement) {
    return `
      <a class="back-link" href="#/community">← Community</a>
      <div class="kicker mt16">Community · Announcements</div>
      <h1 class="display sm">Announcements.</h1>
      <div class="empty mt16">No announcements yet.</div>`;
  }
  return `
    <a class="back-link" href="#/community">← Community</a>
    <article class="anniversary-story">
    <article class="anniversary-story">
      <div class="kicker">${esc(fmtDay(announcement.postedAt))} · ITC Anniversary</div>
      <h1 class="display sm">${esc(announcement.title)}.</h1>
      <p class="subcopy mt8">${esc(announcement.lead)}</p>
      <div class="anniversary-hero">
        <strong aria-label="2 years">2<span>yrs</span></strong>
        <div><h2>Look what God has built.</h2><p>One community, growing stronger together.</p></div>
      </div>
      <div class="milestone-grid">
        ${announcement.milestones.map((item) => `
          <div class="milestone">
            <strong>${esc(item.value)}</strong>
            <span>${esc(item.label)}</span>
          </div>`).join("")}
      </div>
      <p class="anniversary-message">${esc(announcement.body)}</p>
      <blockquote class="anniversary-commitment">${esc(announcement.commitment)}</blockquote>
    </article>`;
}

function profileSubpageHeader({ backHref = "#/account", backLabel = "Profile", title }) {
  return `
    <a class="back-link" href="${esc(backHref)}">← ${esc(backLabel)}</a>
    <h1 class="display sm mt16">${esc(title)}</h1>`;
}

export async function viewAccount(section, sub) {
  if (!sub && typeof section === "string" && section.includes("/")) {
    [section, sub] = section.split("/");
  }
  if (sub && section === "details") section = "details/edit";
  if (sub && section === "privacy") section = "privacy/edit";
  const user = store.currentUser();
  if (!user) return accountVisitor();
  // Live mode: when no live application exists, render an unavailable card so
  // the Profile surface doesn't pretend to have data it can't actually show.
  if (isLive()) {
    const allowedWithoutApp = ["details/edit", "privacy/edit"];
    const path = `${section || "home"}${sub ? `/${sub}` : ""}`;
    if (!allowedWithoutApp.includes(path)) {
      try {
        const app = await store.fetchApplicationForUser(store.currentUser());
        if (!app) {
          const sectionTitle = {
            details: "Membership Details",
            donor: "Membership Details",
            indemnity: "Indemnity",
            payments: "Payments & Receipts",
            privacy: "Privacy & Notifications",
            bookings: "Bookings",
            history: "Bookings",
          }[section] || "Profile";
          return `
            ${profileSubpageHeader({
              backHref: section ? "#/account" : "#/home",
              backLabel: section ? "Profile" : "Home",
              title: sectionTitle,
            })}
            <div class="card mt16"><div class="card-body">
              <h3>Application details unavailable</h3>
              <p class="muted small">Your membership application isn't linked to this profile yet. ITC leaders will sync the records and the data will appear here within a working day.</p>
            </div></div>`;
        }
      } catch (err) {
        console.error("Failed to load live application for account", err);
      }
    }
  }
  if (user.status === "pending") return await accountPending(user);
  if (user.status === "declined") return accountDeclined(user);
  switch (section) {
    case undefined:
      return await accountMember(user);
    case "details":
      return await accountDetails(user);
    case "details/edit":
      return await accountDetailsEdit(user);
    case "indemnity":
      return await accountIndemnity(user);
    case "donor":
      return await accountDetails(user);
    case "payments":
      return accountPayments(user);
    case "privacy":
      return await accountPrivacy(user);
    case "privacy/edit":
      return await accountPrivacyEdit(user);
    case "bookings":
      return accountBookings(user, sub === "attended" ? "attended" : "all");
    case "history":
      return accountBookings(user, "all");
    default:
      return viewNotFound();
  }
}


async function hydrateLiveUser(user) {
  if (!isLive()) return user;
  try {
    const app = await store.fetchApplicationForUser(user);
    if (!app) return user;
    return {
      ...user,
      phone: app.mobile ?? user.phone ?? "",
      emergencyName: app.emergency_name ?? user.emergencyName ?? "",
      emergencyRelationship: app.emergency_relationship ?? user.emergencyRelationship ?? "",
      emergencyPhone: app.emergency_phone ?? user.emergencyPhone ?? "",
      preferredName: (Object.prototype.hasOwnProperty.call(app, "preferred_name")) ? (app.preferred_name || "") : user.preferredName,
      heard: app.heard_source ?? user.heard ?? "",
      donorId: app.donor_id ?? user.donorId ?? null,
      isMinor: app.is_minor !== undefined ? !!app.is_minor : user.isMinor,
      guardianName: app.guardian_name ?? user.guardianName ?? "",
      guardianPhone: app.guardian_phone ?? user.guardianPhone ?? "",
      mediaConsent: app.photo_consent !== undefined ? !!app.photo_consent : user.mediaConsent,
      whatsappReminders: app.whatsapp_reminders !== undefined ? !!app.whatsapp_reminders : user.whatsappReminders,
      hyroxPaymentReminders: app.hyrox_payment_reminders !== undefined
        ? !!app.hyrox_payment_reminders : user.hyroxPaymentReminders !== false,
      emailReceipts: app.email_receipts !== undefined ? !!app.email_receipts : user.emailReceipts,
      communityNews: app.community_news !== undefined ? !!app.community_news : user.communityNews,
      indemnityAcceptedAt: app.waiver_accepted_at ?? user.indemnityAcceptedAt,
      indemnitySignature: app.waiver_signature_text ?? user.indemnitySignature ?? "",
      indemnitySignedAt: app.waiver_signed_at ?? user.indemnitySignedAt ?? "",
      indemnityFormVersion: app.waiver_form_version ?? user.indemnityFormVersion ?? "",
      privacyAcceptedAt: app.privacy_accepted_at ?? user.privacyAcceptedAt,
      appliedAt: app.submitted_at ?? user.appliedAt,
    };
  } catch (err) {
    console.error("Failed to hydrate live user", err);
    return user;
  }
}

function accountVisitor() {
  if (isLive()) {
    return `
      <div class="kicker">Account</div>
      <h1 class="display">Sign in</h1>
      <p class="subcopy mt8">Use your Google account to sign in to Island Training Club. New here? You'll be guided through a short application after sign-in.</p>
      ${visitorDraftActions()}
      <div class="card mt24"><div class="card-body">
        <button class="btn mt16" type="button" data-action="sign-in-google">Continue with Google</button>
        <p class="muted small center mt16">or continue with email</p>
        <form id="form-magic-link" class="mt16" novalidate>
          <div class="field">
            <label for="magic-link-email">Email</label>
            <input id="magic-link-email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required>
          </div>
          <button class="btn ghost mt16" type="submit">Email me a sign-in link</button>
          <div class="muted small mt16" data-magic-link-feedback aria-live="polite"></div>
        </form>
        <p class="muted small mt16">By continuing, you agree to be added to the ITC community roster. An ITC leader will review your application before you can book sessions.</p>
      </div></div>`;
  }
  return `
    <div class="kicker">Account</div>
    <h1 class="display">Join the club.</h1>
    <p class="subcopy mt8">Membership is free. An ITC leader approves every application — approval unlocks paid booking and member content.</p>
    ${visitorDraftActions()}
    <div class="card mt24"><div class="card-body">
      <h3>Sign in</h3>
      <form id="form-signin" novalidate>
        <div class="field">
          <label for="signin-email">Email</label>
          <input id="signin-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required>
        </div>
        <div id="signin-error"></div>
        <button class="btn mt16" type="submit">Sign in</button>
      </form>
      <p class="muted small mt16">This local prototype has no password. Sign in with the email used for an application on this device.</p>
    </div></div>
    <div class="card mt16"><div class="card-body">
      <h3>Not a member yet?</h3>
      <p class="hero-meta">Apply in two minutes. You’ll keep browsing access while a leader reviews your application.</p>
      <a class="btn mt16" href="#/apply">Apply for membership</a>
    </div></div>`;
}

function emergencyContactSummary(name, relationship, phone) {
  return esc(
    [name, relationship, phone]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" · ") || "—"
  );
}

function indemnityState(user) {
  const acceptedAt = user?.indemnityAcceptedAt;
  if (!acceptedAt) {
    return {
      kind: "missing",
      row: "To be accepted",
      kicker: "To be accepted",
      body: "Please read the indemnity below, then accept and confirm — it’s required for joining ITC activities.",
    };
  }
  if (store.isIndemnityCurrent(user)) {
    return {
      kind: "current",
      row: `Indemnity confirmed on ${fmtDay(acceptedAt)}`,
      kicker: `Indemnity confirmed on ${fmtDay(acceptedAt)}`,
      body: "You’re confirmed to join ITC activities.",
    };
  }
  return {
    kind: "stale",
    row: `Legacy acceptance recorded on ${fmtDay(acceptedAt)}`,
    kicker: `Legacy acceptance recorded on ${fmtDay(acceptedAt)}`,
    body: "Please review the current indemnity and confirm it again so your record includes the required signature, signing date, and emergency-contact relationship.",
  };
}

async function accountPending(user) {
  const hydrated = await hydrateLiveUser(user);
  const indemnity = indemnityState(hydrated);
  return `
    <div class="kicker">Profile · ${esc(user.email)}</div>
    <h1 class="display">Thanks, ${esc(hydrated.preferredName || user.fullName.split(" ")[0])}.</h1>
    ${pendingBanner()}
    <div class="card mt16"><div class="card-body">
      <h3>Your application</h3>
      <div class="receipt-lines">
        <div class="line"><span>Name</span><strong>${esc(user.fullName)}</strong></div>
        <div class="line"><span>Phone</span><strong>${esc(hydrated.phone)}</strong></div>
        <div class="line"><span>Emergency contact</span><strong>${emergencyContactSummary(hydrated.emergencyName, hydrated.emergencyRelationship, hydrated.emergencyPhone)}</strong></div>
        <div class="line"><span>Heard about ITC</span><strong>${esc(hydrated.heard)}</strong></div>
        ${user.donorId ? `<div class="line"><span>Donor ID</span><strong>${esc(user.donorId)}</strong></div>` : ""}
        <div class="line"><span>Indemnity</span><strong>${indemnity.kind === "current" ? "Accepted" : indemnity.kind === "stale" ? "Review & confirm" : "—"}</strong></div>
        <div class="line"><span>Photo consent</span><strong>${hydrated.mediaConsent ? "Yes" : "No"}</strong></div>
      </div>
    </div></div>
    <div class="btn-row">
      <a class="btn ghost" href="#/schedule">Browse the schedule</a>
      <button class="btn danger" type="button" data-action="signout">Sign out</button>
    </div>`;
}

function accountDeclined(user) {
  return `
    <div class="kicker">Profile · ${esc(user.email)}</div>
    <h1 class="display">Application update.</h1>
    <div class="banner warn mt16">
      <span class="kicker">Not approved</span>
      <p>Your membership application wasn’t approved this time. Please speak to an ITC leader at any free session if you’d like to talk it through.</p>
    </div>
    <div class="btn-row">
      <a class="btn ghost" href="#/schedule">Browse free activities</a>
      <button class="btn danger" type="button" data-action="signout">Sign out</button>
    </div>`;
}

async function accountMember(user) {
  const hydrated = await hydrateLiveUser(user);
  const indemnity = indemnityState(hydrated);
  const normalized = normalizeRole(hydrated.role);
  if (user.role !== normalized) user.role = normalized;
  const isAdmin = isAdminRole(normalized);
  const canManageAvatar = ["member", "admin", "superadmin"].includes(normalized);
  const avatarPresentation = canManageAvatar ? await store.getOwnAvatar().catch(() => null) : null;

  const roleLabel = {
    member: "Active member",
    admin: "Admin",
    superadmin: "Super admin",
  }[normalized];

  const bookings = visibleBookingsForUser(user.id);
  const attended = bookings.filter((b) => b.status === "attended").length;

  return `
    <div class="kicker">Profile</div>

    <div class="profile-hero">
      <div class="ph-top">
        ${canManageAvatar
          ? `<button class="ph-avatar" type="button" data-action="manage-profile-photo" aria-label="Manage profile photo for ${esc(user.fullName)}">
              ${profileAvatarHTML(user, avatarPresentation)}
            </button>`
          : `<div class="ph-avatar">${profileAvatarHTML(user, null, { editable: false })}</div>`}
        <div class="ph-id">
          <div class="ph-role">${roleLabel}</div>
          <h1>${esc(user.fullName)}</h1>
          <p>Member since ${fmtMonthYear(hydrated.appliedAt)}</p>
        </div>
      </div>
      <div class="ph-stats">
        <a class="ph-stat" href="#/account/bookings" aria-label="View all bookings">
          <strong>${bookings.length}</strong><span>Bookings</span>
        </a>
        <a class="ph-stat" href="#/account/bookings/attended" aria-label="View attended bookings">
          <strong>${attended}</strong><span>Attended</span>
        </a>
      </div>
    </div>

    <div class="profile-rows">
      ${isAdmin ? profileRow("#/admin", ICONS.shield, "Admin Tools", "Approvals, activities and members") : ""}
      ${profileRow("#/account/details", ICONS.user, "Membership Details", "Contact, emergency and donor information")}
      ${profileRow(
        "#/account/indemnity",
        ICONS.check,
        "Indemnity",
        indemnity.row,
        { cls: indemnity.kind === "current" ? "ok" : "todo" }
      )}
      ${profileRow("#/account/payments", ICONS.dollar, "Payments & Receipts", "Bookings, donations and orders")}
      ${profileRow("#/account/privacy", ICONS.bell, "Privacy & Notifications", "Consent and communication choices")}
    </div>

    <div class="btn-row">
      <button class="btn ghost" type="button" data-action="signout">Sign out</button>
    </div>`;
}

// Tappable Profile row: icon tile + title + one-line status, separated by
// hairlines. (Community keeps the chunkier linkCard treatment.)
function profileRow(href, icon, title, status, { cls = "" } = {}) {
  return `
    <a class="profile-row" href="${href}">
      <span class="pr-icon">${icon}</span>
      <span class="pr-text">
        <strong>${esc(title)}</strong>
        <span class="pr-status${cls ? ` ${cls}` : ""}">${esc(status)}</span>
      </span>
      ${ICONS.chevron}
    </a>`;
}

async function accountDetailsEdit(user) {
  const hydrated = await hydrateLiveUser(user);
  return `
    ${profileSubpageHeader({
      backHref: "#/account/details",
      backLabel: "Membership Details",
      title: "Edit Membership Details",
    })}
    <form id="form-membership-details" data-form="membership-details" class="card mt16"><div class="card-body">
      <div class="line"><span>Full name</span><strong>${esc(user.fullName)}</strong></div>
      <div class="line"><span>Email</span><strong>${esc(user.email)}</strong></div>
      <div class="field">
        <label for="md-donorId">Donor ID</label>
        <input id="md-donorId" name="donorId" value="${esc(hydrated.donorId || "")}" placeholder="e.g. CHUI-08879" autocomplete="off">
        <div class="hint">Optional. Use the Donor ID from your IECC donor record so leaders can match your giving.</div>
      </div>
      <div id="membership-details-error"></div>
      <div class="field">
        <label for="md-preferred_name">Preferred name</label>
        <input id="md-preferred_name" name="preferred_name" value="${esc(hydrated.preferredName || "")}">
      </div>
      <div class="field">
        <label for="md-mobile">Mobile / WhatsApp *</label>
        <input id="md-mobile" name="mobile" type="tel" autocomplete="tel" value="${esc(hydrated.phone || "")}" required>
      </div>
      <div class="field">
        <label>Age</label>
        <label class="check"><input type="radio" name="age_over_18" value="yes" ${!hydrated.isMinor ? "checked" : ""}> 18 or over</label>
        <label class="check"><input type="radio" name="age_over_18" value="no" ${hydrated.isMinor ? "checked" : ""}> Under 18</label>
      </div>
      <div data-minor-only ${hydrated.isMinor ? "" : "hidden"}>
        <div class="field"><label for="md-guardian-name">Guardian name</label><input id="md-guardian-name" name="guardian_name" value="${esc(hydrated.guardianName || "")}"></div>
        <div class="field"><label for="md-guardian-phone">Guardian phone</label><input id="md-guardian-phone" name="guardian_phone" type="tel" value="${esc(hydrated.guardianPhone || "")}"></div>
      </div>
      <div class="field">
        <label for="md-emergency_name">Emergency contact name *</label>
        <input id="md-emergency_name" name="emergency_name" value="${esc(hydrated.emergencyName || "")}" required>
      </div>
      <div class="field">
        <label for="md-emergency_relationship">Emergency contact relationship *</label>
        <input id="md-emergency_relationship" name="emergency_relationship" value="${esc(hydrated.emergencyRelationship || "")}" required>
      </div>
      <div class="field">
        <label for="md-emergency_phone">Emergency contact phone *</label>
        <input id="md-emergency_phone" name="emergency_phone" type="tel" value="${esc(hydrated.emergencyPhone || "")}" required>
      </div>
      <div class="field">
        <label for="md-heard">How you heard about ITC</label>
        <input id="md-heard" name="heard_source" value="${esc(hydrated.heard || "")}">
      </div>
      <div class="actions">
        <button class="btn" type="submit">Save changes</button>
        <a class="btn ghost" href="#/account/details">Cancel</a>
      </div>
    </div></form>`;
}

async function accountDetails(user) {
  const hydrated = await hydrateLiveUser(user);
  const ageStatus = hydrated.isMinor ? "Under 18" : "18 or over";
  return `
    ${profileSubpageHeader({ title: "Membership Details" })}
    <div class="card mt16"><div class="card-body">
      <div class="receipt-lines" style="margin-top:0;border-top:0">
        <div class="line"><span>Full name</span><strong>${esc(user.fullName)}</strong></div>
        <div class="line"><span>Preferred name</span><strong>${hydrated.preferredName ? esc(hydrated.preferredName) : "Not provided"}</strong></div>
        <div class="line"><span>Email</span><strong>${esc(user.email)}</strong></div>
        <div class="line"><span>Donor ID</span><strong>${hydrated.donorId ? esc(hydrated.donorId) : "Not provided"}</strong></div>
        <div class="line"><span>Member since</span><strong>${fmtDay(hydrated.appliedAt)}</strong></div>
        <div class="line"><span>Mobile / WhatsApp number</span><strong>${esc(hydrated.phone)}</strong></div>
        <div class="line"><span>Age status</span><strong>${ageStatus}</strong></div>
        <div class="line"><span>Emergency contact name</span><strong>${esc(hydrated.emergencyName)}</strong></div>
        <div class="line"><span>Emergency contact relationship</span><strong>${esc(hydrated.emergencyRelationship)}</strong></div>
        <div class="line"><span>Emergency contact phone</span><strong>${esc(hydrated.emergencyPhone)}</strong></div>
        <div class="line"><span>How you heard about ITC</span><strong>${esc(hydrated.heard || "—")}</strong></div>
        <a class="btn ghost sm mt16" href="#/account/details/edit">Edit membership details</a>
      </div>
      <p class="muted small mt16">Keep these details current so ITC leaders can reach you in an emergency.</p>
    </div></div>`;
}

// Tappable card that opens a detail page. The face shows the title plus a
// one-line description or status (and an optional second line), so the page
// it leads to stays uncluttered. Used on Community (Profile uses profileRow).
function linkCard(href, title, status, { sub = "", cls = "" } = {}) {
  return `
    <a class="card link-card" href="${href}">
      <div class="card-body">
        <div class="lc-text">
          <h3>${esc(title)}</h3>
          <p class="lc-status${cls ? ` ${cls}` : ""}">${esc(status)}</p>
          ${sub ? `<p class="lc-sub">${esc(sub)}</p>` : ""}
        </div>
        ${ICONS.chevron}
      </div>
    </a>`;
}

async function accountIndemnity(user) {
  const hydrated = await hydrateLiveUser(user);
  const current = store.isIndemnityCurrent(hydrated);
  const hadAcceptance = !!hydrated.indemnityAcceptedAt;
  const defaultDate = todayISO();
  return `
    ${profileSubpageHeader({ title: "Indemnity" })}
    ${current ? `
      <div class="banner mt16">
        <span class="kicker">Indemnity confirmed on ${fmtDay(hydrated.indemnityAcceptedAt)}</span>
        <p>You’re confirmed to join ITC activities.</p>
      </div>` : `
      <div class="banner warn mt16">
        <span class="kicker">To be accepted</span>
        <p>${hadAcceptance
          ? "A new version of the Indemnity is available. Please read and re-sign."
          : "Please read the Indemnity, then accept and confirm."}</p>
      </div>`}
    ${current ? `
      <a class="btn ghost sm mt16" href="#" data-action="open-doc" data-doc="indemnity">View as full document</a>
      <div class="card mt16"><div class="card-body receipt-lines">
        <div class="line"><span>Signed by</span><strong>${esc(hydrated.indemnitySignature)}</strong></div>
        <div class="line"><span>Date of signing</span><strong>${fmtDay(parseISO(hydrated.indemnitySignedAt))}</strong></div>
        <div class="line"><span>Emergency contact name</span><strong>${esc(hydrated.emergencyName)}</strong></div>
        <div class="line"><span>Emergency contact relationship</span><strong>${esc(hydrated.emergencyRelationship)}</strong></div>
        <div class="line"><span>Emergency contact phone</span><strong>${esc(hydrated.emergencyPhone)}</strong></div>
        <div class="line"><span>Document version</span><strong>${esc(hydrated.indemnityFormVersion)}</strong></div>
      </div></div>` : `
      <div data-doc-accept="indemnity">
        <a class="btn ghost sm mt16" href="#" data-action="open-doc" data-doc="indemnity">View as full document</a>
        <p class="muted small" data-doc-hint>Read the document to enable acceptance.</p>
        <form id="form-indemnity" class="mt16" novalidate>
          <div class="field"><label for="indemnity-signature">Participant's full name as signature *</label><input id="indemnity-signature" name="signature" required autocomplete="name"></div>
          <div class="field"><label for="indemnity-signed-at">Date of signing *</label><input id="indemnity-signed-at" name="signedAt" type="date" value="${defaultDate}" max="${defaultDate}" required></div>
          <div class="card"><div class="card-body receipt-lines">
            <div class="line"><span>Emergency contact name</span><strong>${esc(hydrated.emergencyName || "Not provided")}</strong></div>
            <div class="line"><span>Emergency contact phone</span><strong>${esc(hydrated.emergencyPhone || "Not provided")}</strong></div>
          </div></div>
          <div class="field"><label for="indemnity-relationship">Emergency contact relationship *</label><input id="indemnity-relationship" name="emergencyRelationship" value="${esc(hydrated.emergencyRelationship || "")}" required></div>
          <a class="btn ghost sm" href="#/account/details/edit">Edit in Membership Details →</a>
          <div id="indemnity-error"></div>
          <button class="btn mt16" type="submit" data-doc-submit disabled>Accept &amp; Confirm</button>
        </form>
      </div>`}
  `;
}

function accountPayments(user) {
  const receipts = store.receiptsForUser(user.id);
  const pooledBookings = store.bookingsForUser(user.id)
    .filter((booking) => booking.cycleId && ["reserved", "confirmed"].includes(booking.status));
  return `
    ${profileSubpageHeader({ title: "Payments & Receipts" })}
    ${pooledBookings.length ? `<div class="session-list">${pooledBookings.map((booking) => pooledBookingRow(booking)).join("")}</div>` : ""}
    ${
      receipts.length
        ? `<div class="session-list">${receipts
            .map(
              (r) => `
            <a class="session-row" href="#/receipt/${r.id}">
              <time>${new Date(r.issuedAt).toLocaleDateString("en-HK", { day: "numeric", month: "short" })}<small>${esc(r.number)}</small></time>
              <div><h3>${esc(r.line)}</h3><p>Card •••• ${esc(r.cardLast4)}</p></div>
              <div class="row-end"><strong>${fmtMoney(r.amount)}</strong>${
                r.status === "refunded" ? '<span class="badge danger">Refunded</span>' : '<span class="badge neutral">Paid</span>'
              }</div>
            </a>`
            )
            .join("")}</div>`
        : `<div class="empty">No payments yet.</div>`
    }`;
}

async function accountPrivacyEdit(user) {
  const hydrated = await hydrateLiveUser(user);
  return `
    ${profileSubpageHeader({
      backHref: "#/account/privacy",
      backLabel: "Privacy & Notifications",
      title: "Edit Privacy & Notifications",
    })}
    <form id="form-privacy" data-form="privacy-preferences" class="card mt16"><div class="card-body">
      <div class="line"><span>Privacy policy accepted</span><strong>${hydrated.privacyAcceptedAt ? fmtDay(hydrated.privacyAcceptedAt) : "To be accepted"}</strong></div>
      <label class="check"><input type="checkbox" name="photo_consent" ${hydrated.mediaConsent ? "checked" : ""}> Photos and video at sessions</label>
      <label class="check"><input type="checkbox" name="whatsapp_reminders" ${hydrated.whatsappReminders ? "checked" : ""}> WhatsApp session reminders</label>
      <label class="check"><input type="checkbox" name="hyrox_payment_reminders" ${hydrated.hyroxPaymentReminders !== false ? "checked" : ""}> HYROX payment reminders</label>
      <p class="muted small">Thursday payment reminders for unpaid HYROX reservations. You can still check payment status in the app.</p>
      <label class="check"><input type="checkbox" name="email_receipts" ${hydrated.emailReceipts ? "checked" : ""}> Email receipts</label>
      <label class="check"><input type="checkbox" name="community_news" ${hydrated.communityNews ? "checked" : ""}> Community news</label>
      <div class="actions">
        <button class="btn" type="submit">Save changes</button>
        <a class="btn ghost" href="#/account/privacy">Cancel</a>
      </div>
    </div></form>`;
}

async function accountPrivacy(user) {
  const hydrated = await hydrateLiveUser(user);
  const onOff = (v) => (v ? "On" : "Off");
  return `
    ${profileSubpageHeader({ title: "Privacy & Notifications" })}
    <div class="card mt16"><div class="card-body">
      <div class="receipt-lines" style="margin-top:0;border-top:0">
        <div class="line"><span>Photo/video consent</span><strong>${hydrated.mediaConsent ? "Allowed" : "Not allowed"}</strong></div>
        <div class="line"><span>Privacy policy accepted</span><strong>${hydrated.privacyAcceptedAt ? fmtDay(hydrated.privacyAcceptedAt) : "To be accepted"}</strong></div>
        <div class="line"><span>WhatsApp session reminders</span><strong>${onOff(hydrated.whatsappReminders)}</strong></div>
        <div class="line"><span>HYROX payment reminders</span><strong>${onOff(hydrated.hyroxPaymentReminders !== false)}</strong></div>
        <div class="line"><span>Email receipts</span><strong>${onOff(hydrated.emailReceipts)}</strong></div>
        <div class="line"><span>Community news</span><strong>${onOff(hydrated.communityNews)}</strong></div>
      </div>
      <a class="btn ghost sm mt16" href="#/account/privacy/edit">Edit privacy preferences</a>
      <p class="muted small mt16">You can update these communication preferences at any time.</p>
    </div></div>`;
}

function bookingDisplaySnapshot(b) {
  const snapshot = b.snapshot || {};
  const session = b.sessionId ? store.getSession(b.sessionId) : null;
  const cycle = b.cycleId ? store.getHyroxCycle(b.cycleId) : null;
  return {
    ...snapshot,
    dateISO: snapshot.dateISO ?? session?.dateISO ?? cycle?.dateISO,
    time: snapshot.time ?? snapshot.startTime ?? session?.time ?? session?.startTime,
    name: snapshot.name ?? session?.name ?? "ITC HYROX",
    location: snapshot.location ?? session?.location ?? (cycle ? "Venue pending" : undefined),
    durationMin: snapshot.durationMin ?? session?.durationMin,
    kind: snapshot.kind ?? session?.kind ?? (cycle ? "paid" : undefined),
    requiresRsvp: snapshot.requiresRsvp ?? session?.requiresRsvp ?? snapshot.kind === "rsvp",
    price: snapshot.price ?? session?.price ?? snapshot.priceHkd,
  };
}

function pooledBookingRow(b, { highlight = false } = {}) {
  const s = bookingDisplaySnapshot(b);
  const venue = b.sessionId ? s.location : "Venue pending";
  return `<a class="session-row hyrox-queue-state${highlight ? " next" : ""}" href="#/booking/${esc(b.id)}">
    <time>${esc(fmtDate(s.dateISO))}</time><div><h3>ITC HYROX</h3><p>${esc(venue)} · ${b.status === "attended" ? "Arrived" : b.status === "confirmed" ? "Confirmed" : "Payment due"}</p></div>
    <div class="row-end"><span class="badge ${b.sessionId ? "free" : "neutral"}">${b.status === "attended" ? "Arrived" : b.sessionId ? "Booked" : "Venue pending"}</span></div>
  </a>`;
}

function bookingCard(b) {
  const s = bookingDisplaySnapshot(b);
  const started = sessionStarted(s);
  const live = b.status === "confirmed" && !started;
  const status =
    b.status === "cancelled"
      ? '<span class="badge danger">Cancelled</span>'
      : b.status === "attended"
        ? '<span class="badge neutral">Attended</span>'
        : b.status === "reserved"
          ? '<span class="badge warn">Awaiting payment</span>'
          : started
            ? '<span class="badge neutral">Ended</span>'
            : '<span class="badge free">Confirmed</span>';
  const amount = store.sessionRequiresRsvp(s)
    ? "RSVP"
    : (b.paymentMarkedAt != null || ["confirmed", "attended"].includes(b.status))
      ? `paid ${fmtMoney(s.price)}`
      : `${fmtMoney(s.price)} to be paid`;
  return `
    <div class="card booking-card"><div class="card-body">
      <header>
        <div>
          <div class="kicker dim" style="margin-top:0">${esc(fmtDate(s.dateISO))}${s.time ? ` · ${fmtTime(s.time)}` : ""}</div>
          <h3 class="mt8">${esc(s.name)}</h3>
        </div>
        ${status}
      </header>
      <p>${esc(s.location || "Venue pending")}${s.durationMin ? ` · ${s.durationMin} min` : ""} · ${amount}</p>
      <div class="actions">
        <a class="btn ghost sm" href="#/booking/${b.id}">${live ? "Manage" : "Details"}</a>
      </div>
    </div></div>`;
}

function bookingTimestamp(booking) {
  const createdAt = Number(booking.createdAt);
  if (booking.createdAt != null && Number.isFinite(createdAt)) return createdAt;
  const reservedAt = Number(booking.reservedAt);
  return booking.reservedAt != null && Number.isFinite(reservedAt) ? reservedAt : 0;
}

function bookingPriority(booking) {
  return { attended: 5, confirmed: 4, reserved: 3, cancelled: 2, withdrawn: 1 }[booking.status] || 0;
}

function bookingIdentity(booking) {
  const snapshot = bookingDisplaySnapshot(booking);
  return booking.cycleId
    || booking.sessionId
    || [snapshot.dateISO, snapshot.time, snapshot.name].filter(Boolean).join("|")
    || booking.id;
}

function dedupeBookings(records) {
  const unique = new Map();
  records.forEach((booking) => {
    const key = bookingIdentity(booking);
    const current = unique.get(key);
    const rsvpHistory = store.sessionRequiresRsvp(bookingDisplaySnapshot(booking))
      || (current && store.sessionRequiresRsvp(bookingDisplaySnapshot(current)));
    if (!current
        || (rsvpHistory && bookingTimestamp(booking) > bookingTimestamp(current))
        || (!rsvpHistory && bookingPriority(booking) > bookingPriority(current))
        || (!rsvpHistory && bookingPriority(booking) === bookingPriority(current)
          && bookingTimestamp(booking) > bookingTimestamp(current))) {
      unique.set(key, booking);
    }
  });
  return [...unique.values()];
}

function visibleBookingsForUser(userId) {
  return dedupeBookings(store.bookingsForUser(userId)).filter((booking) => {
    const inactiveRsvp = ["cancelled", "withdrawn"].includes(booking.status);
    return !(inactiveRsvp && store.sessionRequiresRsvp(bookingDisplaySnapshot(booking)));
  });
}

function sortBookings(records, direction = "asc") {
  return records.slice().sort((a, b) => {
    const aSnapshot = bookingDisplaySnapshot(a);
    const bSnapshot = bookingDisplaySnapshot(b);
    const aKey = `${aSnapshot.dateISO || ""}T${aSnapshot.time || ""}`;
    const bKey = `${bSnapshot.dateISO || ""}T${bSnapshot.time || ""}`;
    const result = aKey.localeCompare(bKey);
    if (result) return direction === "desc" ? -result : result;
    const timestampResult = bookingTimestamp(b) - bookingTimestamp(a);
    return timestampResult || String(a.id).localeCompare(String(b.id));
  });
}

function bookingGroup(title, bookings) {
  return bookings.length
    ? `<section class="booking-group"><div class="section-head"><h2>${title}</h2></div>${bookings.map(bookingCard).join("")}</section>`
    : "";
}

function accountBookings(user, filter = "all") {
  const records = visibleBookingsForUser(user.id);
  const filtered = filter === "attended"
    ? records.filter((booking) => booking.status === "attended")
    : records;
  const upcoming = sortBookings(
    filtered.filter((booking) => booking.status !== "cancelled" && !sessionStarted(bookingDisplaySnapshot(booking)))
  );
  const past = sortBookings(
    filtered.filter((booking) => booking.status !== "cancelled" && sessionStarted(bookingDisplaySnapshot(booking))),
    "desc"
  );
  const cancelled = sortBookings(
    filtered.filter((booking) => booking.status === "cancelled"),
    "desc"
  );
  const hasRecords = upcoming.length || past.length || cancelled.length;
  return `
    ${profileSubpageHeader({ title: "Bookings" })}
    <div class="chip-row mt16" aria-label="Booking filter">
      <a class="chip ${filter === "all" ? "active" : ""}" href="#/account/bookings">All bookings</a>
      <a class="chip ${filter === "attended" ? "active" : ""}" href="#/account/bookings/attended">Attended</a>
    </div>
    ${hasRecords
      ? `${bookingGroup("Upcoming", upcoming)}${bookingGroup("Past", past)}${bookingGroup("Cancelled", cancelled)}`
      : `<div class="empty mt16">${filter === "attended" ? "Attended sessions will appear here." : "Your bookings will appear here."}</div>`}`;
}

// --- Apply ---------------------------------------------------------------------------------

export async function viewApplyLive() {
  const cu = await store.getCurrentUser();
  if (!cu) return { redirect: "#/account" };
  if (cu.role !== "pending") {
    return `<section class="card"><p class="muted">Your application has already been processed.</p></section>`;
  }
  const existing = await store.getMyApplication({ force: true });
  if (existing) {
    return `
      <section class="card">
        <p class="kicker">Application</p>
        <h2 class="display">Awaiting review</h2>
        <p class="muted">Your application was submitted on ${fmtDate(existing.submitted_at)}. An admin will review it shortly.</p>
      </section>`;
  }
  return applyFormHtml(cu, store.getApplyDraft());
}

function heardSourceLabel(value) {
  return {
    friend: "Friend",
    family: "Family",
    search: "Search",
    social: "Social media",
    event: "Event",
    other: "Other",
  }[value] || String(value || "");
}

function ageStatusField(isMinor) {
  return `
    <div class="field age-status">
      <span class="field-label">Are you 18 or over? *</span>
      <label><input type="radio" name="age_over_18" value="yes" ${isMinor === false ? "checked" : ""} required> Yes</label>
      <label><input type="radio" name="age_over_18" value="no" ${isMinor === true ? "checked" : ""} required> No</label>
    </div>`;
}

function applyField(type, name, label, required, value = "", attrs = "") {
  return `
    <label class="field">
      <span class="field-label">${esc(label)}${required ? " *" : ""}</span>
      <input type="${type}" name="${name}" value="${esc(value || "")}" ${required ? "required" : ""}${attrs ? ` ${attrs}` : ""}>
    </label>`;
}

function applySelect(name, label, options, required, value = "") {
  const selectOptions = value && !options.includes(value) ? [value, ...options] : options;
  return `
    <label class="field">
      <span class="field-label">${esc(label)}${required ? " *" : ""}</span>
      <select name="${name}" ${required ? "required" : ""}>
        ${required ? "" : `<option value="">—</option>`}
        ${selectOptions.map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${esc(heardSourceLabel(option))}</option>`).join("")}
      </select>
    </label>`;
}

function applyFormHtml(cu, draft) {
  const displayName = cu?.profile?.full_name || cu?.email || "";
  const fields = draft?.fields || {};
  const fullName = fields.full_name || cu?.profile?.full_name || "";
  const savedAge = fields.age_over_18 === "no"
    ? true
    : fields.age_over_18 === "yes"
      ? false
      : undefined;
  const checked = (name) => fields[name] ? "checked" : "";
  const savedTime = draft
    ? new Date(draft.savedAt).toLocaleTimeString("en-HK", { hour: "numeric", minute: "2-digit" })
    : "";
  return `
    <section>
      <p class="kicker">Application</p>
      <h2 class="display">Tell us about you</h2>
      <p class="muted">Signed in as <strong>${esc(displayName)}</strong>${cu?.email ? ` · ${esc(cu.email)}` : ""}. We collect this so the team can approve your application and reach you in an emergency.</p>
      ${draft ? `<div class="banner mt16" data-draft-resume>
        <p>Resumed from your draft saved at <strong>${esc(savedTime)}</strong>.</p>
        <button class="btn ghost sm" type="button" data-action="discard-draft">Discard draft</button>
      </div>` : ""}
      <form data-form="apply" class="form-grid mt16">
        ${applyField("text", "full_name", "Full name", true, fullName, 'autocomplete="name" maxlength="120"')}
        ${applyField("text", "mobile", "Mobile / WhatsApp number", true, fields.mobile)}
        ${ageStatusField(savedAge)}
        <div data-minor-only ${savedAge === true ? "" : "hidden"}>
          ${applyField("text", "guardian_name", "Guardian name", savedAge === true, fields.guardian_name)}
          ${applyField("text", "guardian_phone", "Guardian phone", savedAge === true, fields.guardian_phone)}
        </div>
        ${applyField("text", "emergency_name", "Emergency contact name", true, fields.emergency_name)}
        ${applyField("text", "emergency_relationship", "Relationship to participant", true, fields.emergency_relationship)}
        ${applyField("text", "emergency_phone", "Emergency contact phone", true, fields.emergency_phone)}
        ${applySelect("heard_source", "How did you hear about ITC?", ["friend", "family", "search", "social", "event", "other"], true, fields.heard_source)}
        ${applyField("text", "heard_detail", "Detail (optional)", false, fields.heard_detail)}
        ${applyField("text", "preferred_name", "Preferred name (optional)", false, fields.preferred_name)}
        <label class="check"><input type="checkbox" name="photo_consent" ${checked("photo_consent")} required> I consent to photos/videos of me being used on ITC channels. *</label>
        <p class="muted small">Please contact ITC Committee if you have any questions/concerns about this.</p>
        <div data-doc-accept="indemnity">
          <label class="check"><input type="checkbox" name="waiver" ${checked("waiver")} required disabled data-doc-checkbox>
            <span>I accept the <a href="#" class="modal-link" data-action="open-doc" data-doc="indemnity">Indemnity</a> form. *</span></label>
          <p class="muted small" data-doc-hint>Read the document to enable acceptance.</p>
        </div>
        ${applyField("text", "waiver_signature_text", "Participant's full name as signature", true, fields.waiver_signature_text)}
        ${applyField("date", "waiver_signed_at", "Date of signing", true, fields.waiver_signed_at || todayISO(), `max="${todayISO()}"`)}
        <div data-doc-accept="privacy">
          <label class="check"><input type="checkbox" name="privacy" ${checked("privacy")} required disabled data-doc-checkbox>
            <span>I accept the <a href="#" class="modal-link" data-action="open-doc" data-doc="privacy">privacy policy</a>. *</span></label>
          <p class="muted small" data-doc-hint>Read the document to enable acceptance.</p>
        </div>
        <div data-doc-accept="guidelines">
          <label class="check"><input type="checkbox" name="guidelines" ${checked("guidelines")} required disabled data-doc-checkbox>
            <span>I accept the <a href="#" class="modal-link" data-action="open-doc" data-doc="guidelines">community guidelines</a>. *</span></label>
          <p class="muted small" data-doc-hint>Read the document to enable acceptance.</p>
        </div>
        <button class="btn btn-primary" type="submit">Submit application</button>
        <div class="draft-controls mt16">
          <button class="btn ghost sm" type="button" data-action="save-draft">Save draft now</button>
          <span class="muted small" data-draft-status aria-live="polite">${draft ? `Saved at ${esc(savedTime)}` : ""}</span>
        </div>
      </form>
    </section>`;
}

export function viewApply() {
  if (isLive()) return viewApplyLive();
  return viewApplyLocal();
}

function viewApplyLocal() {
  return `
    <a class="back-link" href="#/account">← Account</a>
    <div class="kicker mt16">Membership application</div>
    <h1 class="display sm">Apply to join ITC.</h1>
    <p class="subcopy mt8">Free to apply. A leader reviews every application — usually within a day or two. Approval never depends on fitness level.</p>
    <form id="form-apply" class="mt16" novalidate>
      <div class="field-row">
        <div class="field"><label for="ap-full">Full name *</label><input id="ap-full" name="fullName" required autocomplete="name"></div>
        <div class="field"><label for="ap-pref">Preferred name *</label><input id="ap-pref" name="preferredName" required></div>
      </div>
      <div class="field"><label for="ap-email">Email *</label><input id="ap-email" name="email" type="email" required autocomplete="email"></div>
      <div class="field"><label for="ap-phone">Mobile / WhatsApp *</label><input id="ap-phone" name="phone" type="tel" required autocomplete="tel" placeholder="+852 …"></div>
      <div class="field-row">
        <div class="field"><label for="ap-en">Emergency contact name *</label><input id="ap-en" name="emergencyName" required></div>
        <div class="field"><label for="ap-er">Relationship to participant *</label><input id="ap-er" name="emergencyRelationship" required></div>
        <div class="field"><label for="ap-ep">Emergency contact phone *</label><input id="ap-ep" name="emergencyPhone" type="tel" required></div>
      </div>
      <div class="field">
        <label for="ap-heard">How did you hear about ITC?</label>
        <select id="ap-heard" name="heard">
          <option>A friend</option>
          <option>Instagram</option>
          <option>Saw a session in the park</option>
          <option>Web search</option>
          <option>Other</option>
        </select>
      </div>
      <div class="field">
        <label for="ap-donor">Donor ID (optional)</label>
        <input id="ap-donor" name="donorId" placeholder="e.g. CHUI-08879" autocomplete="off">
        <div class="hint">For members who already give through IECC — your last name, a hyphen, then a 4- or 5-digit number (e.g. CHUI-8879). Leave blank or write “Not applicable” — you can add it later from your Profile.</div>
      </div>
      <label class="check"><input type="checkbox" name="ageConfirmed" required>
        <span>I confirm I am 18 or over, or that a parent/guardian will accompany me to sessions. *</span></label>
      <div data-doc-accept="indemnity">
        <label class="check"><input type="checkbox" name="indemnity" required disabled data-doc-checkbox>
          <span>I accept the <a href="#" class="modal-link" data-action="open-doc" data-doc="indemnity">Indemnity</a> form. *</span></label>
        <p class="muted small" data-doc-hint>Read the document to enable acceptance.</p>
      </div>
      <div class="field">
        <label for="ap-signature">Participant's full name as signature *</label>
        <input id="ap-signature" name="indemnitySignature" required autocomplete="name">
      </div>
      <div class="field">
        <label for="ap-signed-at">Date of signing *</label>
        <input id="ap-signed-at" name="indemnitySignedAt" type="date" value="${todayISO()}" max="${todayISO()}" required>
      </div>
      <div data-doc-accept="guidelines">
        <label class="check"><input type="checkbox" name="guidelines" required disabled data-doc-checkbox>
          <span>I accept the <a href="#" class="modal-link" data-action="open-doc" data-doc="guidelines">community guidelines</a>. *</span></label>
        <p class="muted small" data-doc-hint>Read the document to enable acceptance.</p>
      </div>
      <div data-doc-accept="privacy">
        <label class="check"><input type="checkbox" name="privacy" required disabled data-doc-checkbox>
          <span>I accept the <a href="#" class="modal-link" data-action="open-doc" data-doc="privacy">privacy policy</a>. *</span></label>
        <p class="muted small" data-doc-hint>Read the document to enable acceptance.</p>
      </div>
      <label class="check"><input type="checkbox" name="mediaConsent" required>
        <span>I consent to being included in ITC photos and videos. *</span></label>
      <p class="muted small">Please contact ITC Committee if you have any questions/concerns about this.</p>
      <div id="apply-error"></div>
      <button class="btn mt24" type="submit">Submit application</button>
    </form>`;
}

// --- Checkout --------------------------------------------------------------------------------

export function viewCheckout(sessionId) {
  const s = store.getSession(sessionId);
  if (!s || s.kind !== "paid") return viewNotFound("That checkout doesn’t exist.");
  const user = store.currentUser();
  if (!user || user.status !== "approved") {
    return { redirect: `#/activity/${sessionId}` };
  }
  const confirmed = store.userBookingFor(user.id, s.id);
  if (confirmed) {
    return { redirect: `#/booking/${confirmed.id}` };
  }
  const existingRes = store.userReservationFor(user.id, s.id);
  if (existingRes) return { redirect: `#/pay/${existingRes.id}` };
  if (sessionStarted(s) || s.cancelled || store.spotsLeft(s) <= 0)
    return { redirect: `#/activity/${sessionId}` };
  if (store.isMidtown(s) && !store.midtownOpenFor(s))
    return { redirect: `#/activity/${sessionId}` };

  return `
    <a class="back-link" href="#/activity/${s.id}">← ${esc(s.name)}</a>
    <div class="kicker mt16">Reserve your spot</div>
    <h1 class="display sm">Hold it, then pay.</h1>
    <div class="card mt16"><div class="card-body">
      <div class="receipt-lines" style="margin-top:0;border-top:0">
        <div class="line"><span>Session</span><strong>${esc(s.name)}</strong></div>
        <div class="line"><span>When</span><strong>${esc(fmtDate(s.dateISO))} · ${fmtTime(s.time)}</strong></div>
        <div class="line"><span>Where</span><strong>${esc(s.location)}</strong></div>
        <div class="line total"><span>Total</span><strong>${fmtMoney(s.price)}</strong></div>
      </div>
    </div></div>
    <div class="banner mt16">
      <span class="kicker">How it works</span>
      <p>Your spot is held right away. Pay by PayMe or FPS before the <strong>Thursday 6 PM</strong> checkpoint — the on-duty collector confirms in-app. Unpaid spots go to the waitlist at the checkpoint.</p>
    </div>
    <form id="form-reserve" class="mt16" data-session="${s.id}">
      <button class="btn" type="submit">Reserve spot · pay later</button>
      <p class="muted small mt8 center">Once paid, this booking is final — no refund and no deferral. If you can’t attend, arrange a manual replacement with an approved ITC friend. No refund or payment transfer is processed in the app; an Admin must confirm the handover.</p>
    </form>`;
}

// --- PayMe / FPS payment screen ----------------------------------------------------------------

function bookingPaymentReference(booking) {
  const suffix = String(booking?.id || "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(-6)
    .toUpperCase();
  return `ITC-${suffix || "PAYMENT"}`;
}

export function viewPay(bookingId) {
  const b = store.getBooking(bookingId);
  const user = store.currentUser();
  if (!b || !user || user.status !== "approved" || b.userId !== user.id) return viewNotFound("Booking not found.");
  if (b.status !== "reserved" || b.paymentMarkedAt)
    return { redirect: `#/booking/${b.id}` };
  const s = b.snapshot;
  const cycle = b.cycleId ? store.getHyroxCycle(b.cycleId) : null;
  const collector = store.collectorFor(cycle?.bftSessionId || b.sessionId);
  const cname = collector ? esc(collector.preferredName || collector.fullName) : "the on-duty collector";
  const payouts = collector ? store.collectorPayoutsFor(collector.id) : null;
  const payme = payouts?.paymeLink || collector?.paymeLink || "";
  const fps = payouts?.fpsPhone || collector?.fpsPhone || "";
  const paymentReference = bookingPaymentReference(b);
  const memberName = user.fullName || user.preferredName || "ITC Member";
  const paymentNote = cycle
    ? `${s.name} · ${fmtDate(s.dateISO)} · ${memberName}`
    : `${s.name} · ${fmtDate(s.dateISO)} · ${s.location || "Venue TBC"} · ${memberName}`;
  const paymentHeading = cycle
    ? b.promotedFromWaitlistAt
      ? "You’ve been promoted — pay by Thursday 8 PM"
      : Date.now() >= cycle.paymentDeadlineAt
        ? "Final payment grace — pay now by Thursday 7 PM"
        : `Pay ${fmtMoney(s.price)} by Thursday 6 PM`
    : `${fmtMoney(s.price)} to ${cname}.`;

  return `
    <a class="back-link" href="${cycle ? `#/hyrox/${esc(cycle.id)}` : `#/activity/${b.sessionId}`}">← ${esc(s.name)}</a>
    <div class="kicker mt16">Pay to secure your spot</div>
    <h1 class="display sm">${paymentHeading}</h1>
    <p class="subcopy mt8">Deadline: <strong>${fmtDeadline(b.payDeadlineAt)}</strong> — unpaid spots go to the waitlist.</p>
    <div class="card mt16"><div class="card-body">
      <h3>PayMe</h3>
      ${payme ? `
        <p class="muted small">PayMe opens the collector’s profile. Enter the displayed amount of <strong>${fmtMoney(s.price)}</strong> after it opens.</p>
        <a class="btn mt8" href="${esc(payme)}" target="_blank" rel="noopener">PayMe to ${cname} · ${fmtMoney(s.price)}</a>
      ` : `
        <p class="muted small">PayMe is unavailable for this collector. Please use FPS below to send <strong>${fmtMoney(s.price)}</strong>.</p>
        <button class="btn mt8" type="button" disabled>PayMe unavailable</button>
      `}
      <p class="muted small mt8">Suggested payment note</p>
      <p><strong>${esc(paymentNote)}</strong>
        <button class="btn ghost sm" type="button" data-action="copy-payment-note" data-note="${esc(paymentNote)}">Copy note</button>
      </p>
      <h3 class="mt24">FPS to ${cname}</h3>
      <p class="muted small">Copy these details, then switch to your banking app to make the transfer.</p>
      <div class="receipt-lines">
        <div class="line"><span>Assigned collector / payee</span><strong>${cname}</strong></div>
        <div class="line"><span>FPS mobile number</span><strong class="mono">${fps ? esc(fps) : "Not available"}</strong></div>
        <div class="line"><span>Exact amount</span><strong>${fmtMoney(s.price)}</strong></div>
        <div class="line total"><span>Suggested reference</span><strong class="mono">${esc(paymentReference)}</strong></div>
      </div>
      <div class="btn-row two">
        ${fps ? `<button class="btn ghost" type="button" data-action="copy-fps"
          data-copy-value="${esc(fps)}" data-copy-kind="number" aria-label="Copy FPS number">Copy FPS number</button>` : ""}
        <button class="btn ghost" type="button" data-action="copy-reference"
          data-copy-value="${esc(paymentReference)}" data-copy-kind="reference" aria-label="Copy payment reference">Copy reference</button>
      </div>
      ${fps ? `
        <ol class="muted small mt16">
          <li>Open your banking app.</li>
          <li>Choose FPS and pay by mobile number.</li>
          <li>Paste the FPS number.</li>
          <li>Enter ${fmtMoney(s.price)} and reference <span class="mono">${esc(paymentReference)}</span>.</li>
          <li>Return here and select <strong>I’ve paid</strong>.</li>
        </ol>
      ` : `<p class="muted small mt16">The collector’s FPS mobile number is not available. Ask an ITC leader for payment details before marking this booking paid.</p>`}
    </div></div>
    <form id="form-mark-paid" class="mt16" data-booking="${b.id}">
      <div class="card"><div class="card-body">
        <h3>Done? Tell the collector</h3>
        <div class="field-row">
          <label class="chip"><input type="radio" name="method" value="PayMe"${payme ? " checked" : " disabled"}> PayMe</label>
          <label class="chip"><input type="radio" name="method" value="FPS"${payme ? "" : " checked"}> FPS</label>
        </div>
        <div class="field"><label for="pay-ref">Reference (optional)</label><input id="pay-ref" name="ref" value="${esc(paymentReference)}"></div>
        <p class="muted small mt8">${cname} confirms in-app when the money lands — your spot is held meanwhile.</p>
      </div></div>
      <button class="btn mt16" type="submit">I’ve paid</button>
    </form>`;
}

// --- Manual HYROX replacement invite -----------------------------------------------------------

export async function viewReplacementInvite(token) {
  let inviteToken = "";
  try {
    inviteToken = decodeURIComponent(String(token || "")).trim();
  } catch {
    inviteToken = "";
  }
  const user = store.currentUser();
  if (!user) {
    return `<div class="kicker">HYROX replacement</div>
      <h1 class="display sm mt16">Sign in to view this invite.</h1>
      <p class="subcopy mt8">This private link can only be accepted by an approved ITC member.</p>
      <a class="btn mt16" href="#/account">Sign in</a>`;
  }
  if (user.status !== "approved") {
    return `<div class="kicker">HYROX replacement</div>
      <h1 class="display sm mt16">Approved membership required.</h1>
      <p class="subcopy mt8">Ask an ITC leader to approve your membership before accepting a replacement invite.</p>
      <a class="btn mt16" href="#/account">Go to Account</a>`;
  }

  let request = null;
  try {
    request = isLive()
      ? await liveOps.liveReplacementInvite(await liveOps.hashReplacementToken(inviteToken))
      : store.replacementInviteForToken(inviteToken);
  } catch {
    request = null;
  }
  if (!request) {
    return `<div class="kicker">HYROX replacement</div>
      <h1 class="display sm mt16">Invite unavailable.</h1>
      <p class="subcopy mt8">This private invite may be invalid, expired, already claimed, or no longer available.</p>
      <a class="btn ghost mt16" href="#/schedule">Back to Schedule</a>`;
  }

  const snapshot = request.snapshot || {};
  const session = request.sessionId ? store.getSession(request.sessionId) : null;
  const dateISO = session?.dateISO || snapshot.dateISO || snapshot.session_date;
  const time = session?.time || snapshot.time || snapshot.start_time;
  const venue = session?.location || snapshot.location || snapshot.venue || "Venue pending";
  const when = dateISO ? `${fmtDate(dateISO)}${time ? ` · ${fmtTime(String(time).slice(0, 5))}` : ""}` : "HYROX session";
  const isOriginal = request.originalUserId && request.originalUserId === user.id;
  let stateCopy = "";
  let actions = "";
  if (request.status === "pending") {
    stateCopy = isOriginal
      ? "Share this single-use invite with an approved ITC member."
      : "Accepting this does not transfer payment. An Admin must confirm the handover first.";
    actions = isOriginal
      ? `<a class="btn mt16" href="#/booking/${esc(request.bookingId)}">View booking</a>`
      : `<div class="btn-row mt16"><button class="btn" type="button" data-action="replacement-accept" data-token="${esc(inviteToken)}">Accept replacement</button><button class="btn ghost" type="button" data-action="replacement-decline" data-token="${esc(inviteToken)}">Decline</button></div>`;
  } else if (request.status === "accepted") {
    stateCopy = "An approved member accepted this invite. ITC is reviewing the handover; the original attendee remains in place until confirmation.";
  } else if (request.status === "confirmed") {
    stateCopy = "ITC confirmed this replacement. The approved member is now the attendee; the original member remains payer and receipt owner.";
  } else {
    stateCopy = `This invite is ${request.status || "unavailable"}.`;
  }

  const inviteHeading = request.status === "confirmed"
    ? "Replacement confirmed."
    : request.status === "accepted" ? "Pending Admin confirmation."
      : "Take this ITC place.";
  return `<a class="back-link" href="#/schedule">← Schedule</a>
    <div class="kicker mt16">HYROX replacement</div>
    <h1 class="display sm mt16">${inviteHeading}</h1>
    <p class="subcopy mt8">${esc(stateCopy)}</p>
    <div class="card mt16"><div class="card-body">
      <div class="receipt-lines" style="margin-top:0;border-top:0">
        <div class="line"><span>Session</span><strong>ITC HYROX</strong></div>
        <div class="line"><span>When</span><strong>${esc(when)}</strong></div>
        <div class="line"><span>Where</span><strong>${esc(venue)}</strong></div>
        <div class="line total"><span>Payment</span><strong>Already paid by original member</strong></div>
      </div>
    </div></div>
    ${actions}
    <p class="muted small mt16">The place stays on the same HYROX session and venue. No refund, payment transfer, or new charge is created.</p>`;
}

// --- Booking confirmation / manage ------------------------------------------------------------

function currentBookingFor(userId, sessionId) {
  return store.bookingsForUser(userId).find(
    (x) => x.sessionId === sessionId && (x.status === "reserved" || x.status === "confirmed")
  ) ?? null;
}

export function viewBooking(bookingId) {
  const b = store.getBooking(bookingId);
  const user = store.currentUser();
  const isConfirmedAttendee = !!b?.replacementConfirmedAt && b.replacementUserId === user?.id;
  if (!b || !user || (b.userId !== user.id && !isAdminRole(user.role) && !isConfirmedAttendee)) {
    return viewNotFound("Booking not found.");
  }
  const s = b.snapshot;
  const cycle = b.cycleId ? store.getHyroxCycle(b.cycleId) : null;
  const assignedSession = b.sessionId ? store.getSession(b.sessionId) : null;
  const assignedVenue = hyroxAssignedVenue(cycle, b, assignedSession);
  const venuePreferenceCard = cycle && b.venuePreference ? `
    <div class="card mt16 hyrox-booking-preference">
      <div class="card-body">
        <p class="muted small">Venue preference:</p>
        <p><strong>${esc(hyroxVenuePreferenceLabel(b.venuePreference))}</strong>${assignedVenue ? ` · assigned to <strong>${esc(assignedVenue)}</strong>` : ""}</p>
      </div>
    </div>` : "";
  const started = assignedSession ? sessionStarted(assignedSession) : false;
  const receipt = store.receiptForBooking(b.id);
  const mine = b.userId === user.id;
  const requiresRsvp = store.sessionRequiresRsvp(assignedSession || s);

  let head = "";
  let actions = "";
  if (b.status === "reserved" && !b.paymentMarkedAt) {
    const paymentHeading = cycle
      ? b.promotedFromWaitlistAt
        ? "You’ve been promoted — pay by Thursday 8 PM"
        : Date.now() >= cycle.paymentDeadlineAt
          ? "Final payment grace — pay now by Thursday 7 PM"
          : `Pay ${fmtMoney(s.price)} by Thursday 6 PM`
      : "Spot held.";
    head = `
      <h1 class="display sm mt16">${paymentHeading}</h1>
      <p class="subcopy mt8">Pay ${fmtMoney(s.price)} by <strong>${fmtDeadline(b.payDeadlineAt)}</strong> or the spot goes to the waitlist.</p>`;
    actions = mine ? `
      <a class="btn" href="#/pay/${b.id}">Pay ${fmtMoney(s.price)}</a>
      <button class="btn ghost" type="button" data-action="release-reservation" data-booking="${b.id}">Cancel booking</button>` : "";
  } else if (b.status === "reserved" && b.paymentMarkedAt) {
    const collector = store.collectorFor(cycle?.bftSessionId || b.sessionId);
    const cname = collector ? esc(collector.preferredName || collector.fullName) : "the collector";
    head = `
      <h1 class="display sm mt16">Payment being confirmed.</h1>
      <p class="subcopy mt8">${cname} is checking your ${esc(b.paidMethod || "payment")}${b.paymentRef ? ` (ref ${esc(b.paymentRef)})` : ""} — your spot is held meanwhile.</p>`;
  } else if (b.status === "confirmed" && !started && Number(s.price) === 0) {
    head = `
      <div class="confirm-mark">${ICONS.check}</div>
      <h1 class="display sm center mt16">You’re going.</h1>
      <p class="subcopy center mt8">${s.kind === "free"
        ? "You’re on the headcount. Walk-ins are still welcome."
        : "No payment needed — everyone pays their own bill at the venue."}</p>`;
    actions = `
      <button class="btn ghost" type="button" data-action="ics-booking" data-booking="${b.id}">Add to calendar</button>
      ${mine ? `<button class="btn ghost" type="button" data-action="rsvp-withdraw" data-booking="${b.id}">Can’t make it</button>` : ""}`;
  } else if (b.status === "confirmed" && !started) {
    const movedFrom = !cycle && mine && b.deferredFrom ? store.getBooking(b.deferredFrom) : null;
    head = `
      <div class="confirm-mark">${ICONS.check}</div>
      <h1 class="display sm center mt16">${cycle ? "Your weekly HYROX place is confirmed" : movedFrom ? "Booking moved." : "You’re booked in."}</h1>
      <p class="subcopy center mt8">${cycle
        ? cycle.venuePlan === "both" ? "Both gyms confirmed" : b.sessionId ? "Your weekly HYROX place is confirmed" : "Your venue is pending automatic allocation."
        : movedFrom ? "Your payment has carried over."
          : `Booking ref <span class="mono">${esc(b.id.toUpperCase())}</span>`}</p>
      ${cycle ? `<p class="hyrox-queue-state">${b.sessionId
        ? `${b.allocationState === "final" ? "Your venue is final" : "Your venue is provisional until Friday 9 PM"} · ${esc(assignedVenue || "Venue pending")}`
        : "Venue pending"}</p>` : ""}`;
    const targets = mine ? store.deferTargetsFor(b) : [];
    actions = `
      ${movedFrom ? `<div class="card mt16"><div class="card-body"><strong>Previous spot released</strong><p class="muted small mt8">${esc(fmtDate(movedFrom.snapshot.dateISO))} · ${fmtTime(movedFrom.snapshot.time)}</p></div></div>` : ""}
      <button class="btn ghost" type="button" data-action="ics-booking" data-booking="${b.id}">Add to calendar</button>
      ${receipt ? `<a class="btn ghost" href="#/receipt/${receipt.id}">View receipt · ${esc(receipt.number)}</a>` : ""}
      `;
    if (cycle && mine && cycle.venuePlan === "both" && b.allocationState === "provisional" && b.sessionId) {
      const target = hyroxCycleVenues(cycle).find((venue) => venue.id !== b.sessionId);
      const switchEntry = store.hyroxCycleQueues(cycle.id).venueSwitches
        .find((entry) => entry.userId === b.userId && entry.status === "active");
      const queueName = target?.location?.includes("BFT") ? "BFT switch queue" : "Midtown switch queue";
      actions += `<div class="card mt16"><div class="card-body"><h3>Venue choice</h3>
        <p class="muted small">Current assignment: <strong>${esc(assignedVenue || "Venue pending")}</strong>.</p>
        ${switchEntry ? `<p class="hyrox-queue-state">${esc(queueName)} · queue position ${store.hyroxCycleQueuePosition(b.userId, cycle.id, "venue_switch", switchEntry.targetSessionId)}. Your ${esc(assignedVenue || "current venue")} place remains guaranteed while you wait.</p>
          <button class="btn ghost sm" type="button" data-action="leave-hyrox-switch-queue" data-entry="${switchEntry.id}">Leave switch queue</button>`
          : `<div class="actions"><button class="btn ghost sm" type="button" data-action="select-hyrox-venue" data-booking="${b.id}" data-session="${target?.id}">Change to ${esc(target?.location || "other venue")}</button>
            <button class="btn ghost sm" type="button" data-action="join-hyrox-switch-queue" data-booking="${b.id}" data-session="${target?.id}">${esc(queueName)}</button></div>`}
      </div></div>`;
    }
    // No-deferral policy: confirmed paid bookings do not offer self-service
    // deferral. Members who can't attend can arrange a manual replacement.
    const replacement = store.replacementRequestForBooking(b.id);
    if (mine && Number(s.price) > 0
        && (replacement?.status === "confirmed" || store.replacementEligible(b).ok)) {
      const inviteToken = store.replacementInviteTokenForBooking(b.id);
      const shareUrl = inviteToken ? replacementShareUrl(inviteToken) : "";
      const shareText = shareUrl
        ? `I have an ITC HYROX place available for ${fmtDate(s.dateISO)} at ${assignedSession?.location || s.location || "Venue pending"}. If you’re an approved ITC member and can take it, accept it here: ${shareUrl}`
        : "";
      const shareHref = shareText ? `https://wa.me/?text=${encodeURIComponent(shareText)}` : "";
      if (!replacement || ["declined", "cancelled", "rejected", "expired"].includes(replacement.status)) {
        actions += `<div class="card mt16 replacement-panel"><div class="card-body">
          <h3>I can’t attend — arrange a replacement</h3>
          <p class="muted small">Your paid booking is final — no refund or deferral. If an approved ITC friend is taking your place, contact ITC so an Admin can record and confirm the manual replacement. Payment and receipt ownership stay with you.</p>
          <button class="btn mt12" type="button" data-action="replacement-create" data-booking="${esc(b.id)}">Create private invite</button>
        </div></div>`;
      } else if (replacement.status === "pending") {
        actions += `<div class="card mt16 replacement-panel"><div class="card-body">
          <h3>I can’t attend — arrange a replacement</h3>
          <p class="muted small">Share this single-use invite before ${esc(fmtDay(replacement.expiresAt))}. Your booking remains yours until Admin confirmation.</p>
          ${shareHref ? `<a class="btn mt12" href="${esc(shareHref)}" target="_blank" rel="noopener">Share via WhatsApp</a>` : `<p class="muted small mt12">The private link is available immediately after creating the invite.</p>`}
          <button class="btn ghost mt8" type="button" data-action="replacement-cancel" data-request="${esc(replacement.id || replacement.requestId)}">Cancel invite</button>
        </div></div>`;
      } else if (replacement.status === "accepted") {
        actions += `<div class="card mt16 replacement-panel"><div class="card-body">
          <h3>Pending Admin confirmation</h3>
          <p class="muted small">${esc(replacement.replacementDisplayName || "An approved member")} accepted the invite. Your booking and attendance remain unchanged until Admin confirmation.</p>
        </div></div>`;
      } else if (replacement.status === "confirmed") {
        const attendee = b.replacementUserId ? store.effectiveAttendeeForBooking(b) : null;
        actions += `<div class="card mt16 replacement-panel"><div class="card-body">
          <h3>Replacement confirmed</h3>
          <p class="muted small">${esc(attendee?.preferredName || attendee?.fullName || replacement.replacementDisplayName || "The approved member")} is now the attendee. You remain the payer and receipt owner.</p>
        </div></div>`;
      }
    }
  } else {
    const label =
      b.status === "deferred" ? "Deferred"
      : b.status === "expired" ? "Expired (missed the payment checkpoint)"
      : b.status === "cancelled" ? "Cancelled"
      : b.status === "attended" ? "Attended" : esc(b.status);
    head = `<h1 class="display sm mt16">Booking ${label.toLowerCase()}.</h1>`;
    if (b.status === "deferred" && b.deferredTo) {
      const moved = currentBookingFor(user.id, b.deferredTo);
      if (moved) actions = `<a class="btn" href="#/booking/${moved.id}">View new booking</a>`;
    }
  }

  return `
    ${head}
    <div class="card mt24"><div class="card-body">
      <div class="receipt-lines" style="margin-top:0;border-top:0">
        <div class="line"><span>Session</span><strong>${esc(s.name)}</strong></div>
        <div class="line"><span>When</span><strong>${esc(fmtDate(s.dateISO))}${s.time ? ` · ${fmtTime(s.time)}` : ""}</strong></div>
        <div class="line"><span>Where</span><strong>${esc(assignedVenue || s.location || "Venue pending")}</strong></div>
        <div class="line"><span>Status</span><strong>${esc(b.status)}</strong></div>
        ${requiresRsvp && s.kind === "free"
          ? b.status === "confirmed"
            ? '<div class="line total"><span>Attendance</span><strong>RSVP confirmed</strong></div>'
            : ""
          : `<div class="line total"><span>Price</span><strong>${Number(s.price) > 0 ? fmtMoney(s.price) : "Pay your own bill"}</strong></div>`}
      </div>
    </div></div>
    ${venuePreferenceCard}
    <div class="btn-row">
      ${actions}
      <a class="btn ghost" href="#/schedule">Back to schedule</a>
    </div>`;
}

// --- Receipt -----------------------------------------------------------------------------------

export function viewReceipt(receiptId) {
  const r = store.getReceipt(receiptId);
  const user = store.currentUser();
  if (!r || !user || (r.userId !== user.id && !isAdminRole(user.role))) {
    return viewNotFound("Receipt not found.");
  }
  return `
    <a class="back-link" href="#/account">← Account</a>
    <div class="kicker mt16">Receipt</div>
    <h1 class="display sm">${esc(r.number)}</h1>
    <p class="subcopy mt8">Issued ${new Date(r.issuedAt).toLocaleString("en-HK", { dateStyle: "medium", timeStyle: "short" })} · ${r.status === "refunded" ? "Refunded" : "Paid"}</p>
    <div class="card mt16"><div class="card-body">
      <div class="receipt-lines" style="margin-top:0;border-top:0">
        <div class="line"><span>Item</span><strong>${esc(r.line)}</strong></div>
        <div class="line"><span>Payment method</span><strong>${r.method ? esc(r.method) : `Card •••• ${esc(r.cardLast4)}`}</strong></div>
        <div class="line total"><span>Total (${esc(r.currency)})</span><strong>${fmtMoney(r.amount)}</strong></div>
      </div>
    </div></div>
    <p class="muted small mt16">Prototype: receipts render in-app. The real product will email a copy and record the payment provider reference.</p>`;
}

export function viewNotFound(msg = "Page not found.") {
  return `<div class="card" data-route-not-found><div class="card-body">
    <span class="kicker">404</span>
    <h2 class="mt8">${esc(msg)}</h2>
    <a class="btn mt16" href="#/home">Back to home</a>
  </div></div>`;
}

// --- Admin --------------------------------------------------------------------------------------

// PostgREST emits PGRST205 when a query names a table the deployed schema
// cache has not seen. The store stays authoritative — it throws the error —
// so the Admin views can render an honest "setup required" panel rather than
// a fake campaign list.
const isGivingSchemaMissing = (error) => error?.code === "PGRST205";

function adminGivingSetupRequired() {
  return `
    <div class="section-head"><h2>Giving setup required</h2></div>
    <div class="card"><div class="card-body">
      <p class="hero-meta">Campaign management becomes available after the Giving schema migrations are applied to the deployed Supabase project.</p>
      <div class="receipt-lines mt16">
        <div class="line"><span>1</span><strong class="mono">20260805000011_giving_campaigns.sql</strong></div>
        <div class="line"><span>2</span><strong class="mono">20260806000001_donor_id.sql</strong></div>
      </div>
      <p class="muted small mt16">After installation, return here to create and publish the first real campaign.</p>
    </div></div>`;
}

function adminPrayerLoadError() {
  return `
    <div class="section-head"><h2>Prayer Requests</h2></div>
    <div class="card prayer-load-error" role="alert"><div class="card-body">
      <h3>Prayer requests could not be loaded</h3>
      <p class="muted small mt8">Please try again. No requests are shown until the private Admin queue is available.</p>
      <button class="btn ghost sm mt16" type="button" data-action="retry-admin-prayer-requests">Try again</button>
    </div></div>`;
}

export async function viewAdmin(tab = "members") {
  const user = store.currentUser();
  if (!user || !isAdminRole(user.role)) {
    return { redirect: "#/account" };
  }
  const requestedTab = tab === "ops" ? "payments" : tab;
  const canonicalTab = ["members", "activities", "prayers", "giving", "payments"].includes(requestedTab)
    ? requestedTab
    : "members";
  const tabs = `
    <nav class="admin-tabs admin-tabs-scroll">
      ${[
        ["members", "Members"],
        ["activities", "Activities"],
        ["prayers", "Prayer Requests"],
        ["giving", "Giving"],
        ["payments", "Payments"],
      ]
        .map(([key, label]) => `<a href="#/admin/${key}" class="${key === canonicalTab ? "active" : ""}"${key === canonicalTab ? ' aria-current="page"' : ""}>${label}</a>`)
        .join("")}
    </nav>`;

  // Live mode reads real data (Supabase applications + profiles); local
  // mode keeps the local prototype lists.
  let memberUsers = null;
  let adminAvatarRows = null;
  let avatarLoadFailed = false;
  if (["members", "payments"].includes(canonicalTab)) {
    memberUsers = (await store.listPaymentUsers())
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }
  let pendingApplicants = [];
  if (canonicalTab === "members") {
    pendingApplicants = await store.listApprovalCandidates();
    try {
      adminAvatarRows = await store.getAdminAvatarRows();
    } catch {
      avatarLoadFailed = true;
    }
  }
  let prayerRows = [];
  let prayerLoadFailed = false;
  if (canonicalTab === "prayers") {
    try {
      prayerRows = await store.listAdminPrayerRequests();
    } catch {
      prayerLoadFailed = true;
    }
  }
  let body;
  if (canonicalTab === "activities") body = adminActivities();
  else if (canonicalTab === "members") {
    body = adminMembers(
      user,
      memberUsers,
      pendingApplicants,
      adminAvatarRows,
      { avatarLoadFailed },
    );
  } else if (canonicalTab === "prayers") {
    body = prayerLoadFailed ? adminPrayerLoadError() : adminPrayerRequests(prayerRows);
  } else if (canonicalTab === "giving") {
    try {
      body = adminGiving(await store.listGivingCampaigns());
    } catch (error) {
      if (!isGivingSchemaMissing(error)) throw error;
      body = adminGivingSetupRequired();
    }
  } else {
    let profilePhone = String(user.phone || "").trim();
    try {
      const application = await store.getMyApplication();
      profilePhone = String(application?.mobile || application?.phone || profilePhone).trim();
    } catch (error) {
      console.warn("Unable to load Membership Details phone for payout form", error);
    }
    body = await adminOps(user, memberUsers, profilePhone);
  }

  return `
    <a class="back-link" href="#/account">← Profile</a>
    <h1 class="display mt16">Admin Tools</h1>
    ${tabs}
    ${body}`;
}

function pendingPayments(memberUsers) {
  const directory = new Map((memberUsers || []).map((user) => [user.id, user]));
  return store.pendingPaymentBookings().map((booking) => {
    const member = directory.get(booking.userId);
    return { booking, who: member ? (member.preferredName || member.fullName) : "Member" };
  });
}

function adminRosterName(userId, memberUsers) {
  const member = (memberUsers || []).find((member) => member.id === userId);
  return member?.fullName || member?.preferredName || "Member";
}

function adminQueueDisclosure({ id, title, subtitle, entries, memberUsers, preference = false, closed = false }) {
  // Queue selectors already provide queue order; never alphabetize requests.
  const rows = closed ? [] : entries;
  return `<details class="admin-payment-group admin-queue-group" name="roster-${esc(id)}" data-queue-title="${esc(title)}">
    <summary><span><strong>${esc(title)}</strong>${subtitle ? `<span class="muted small">${esc(subtitle)}</span>` : ""}</span><span class="badge neutral">${closed ? "Closed" : rows.length}</span></summary>
    ${closed ? `<p class="muted small">Switching closed Friday at 9 PM HKT. Unmatched members keep their assigned venue.</p>` : rows.length ? `<ol class="admin-queue-list">${rows.map((entry) => {
      const userId = typeof entry === "string" ? entry : entry.userId;
      return `<li><strong>${esc(adminRosterName(userId, memberUsers))}</strong>${preference ? `<span class="muted small">Preference: ${esc(hyroxVenuePreferenceLabel(entry.venuePreference))}</span>` : ""}</li>`;
    }).join("")}</ol>` : `<p class="muted small">No active requests.</p>`}
  </details>`;
}

function adminPaymentRoster({ id, label, dateISO, venue, bookings, memberUsers, queue = "" }) {
  const directory = new Map((memberUsers || []).map((member) => [member.id, member]));
  const displayName = (booking) => {
    const member = directory.get(booking.userId);
    return member ? (member.fullName || member.preferredName || "Member") : "Member";
  };
  const definitions = [
    ["payment_due", "Payment due", "warn"],
    ["awaiting_confirmation", "Awaiting confirmation", "warn"],
    ["paid", "Paid", "free"],
  ];
  const grouped = new Map(definitions.map(([state]) => [state, []]));
  for (const booking of bookings || []) {
    const state = store.paymentStateForBooking(booking);
    if (state) grouped.get(state).push(booking);
  }
  for (const rows of grouped.values()) {
    rows.sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }
  return `<div class="admin-roster-disclosures" data-payment-roster="${esc(id)}" aria-label="Payment roster · ${esc(label)} · ${esc(fmtDate(dateISO))}">
    <p class="muted small admin-roster-context">${esc(venue)}</p>
    ${definitions.map(([state, text, badgeClass]) => {
      const rows = grouped.get(state);
      return `<details class="admin-payment-group" name="roster-${esc(id)}" data-payment-state="${state}"${state === "awaiting_confirmation" && rows.length ? " open" : ""}>
        <summary><span>${esc(text)}</span><span class="badge ${badgeClass}">${rows.length}</span></summary>
        ${rows.length ? rows.map((booking) => `<div class="admin-roster-row"><strong>${esc(displayName(booking))}</strong>${state === "awaiting_confirmation" ? `<button class="btn sm" type="button" data-action="confirm-payment" data-booking="${esc(booking.id)}">Confirm received</button>` : `<span class="badge ${badgeClass}">${esc(text)}</span>`}</div>${state === "awaiting_confirmation" && booking.cycleId ? `<form id="form-hyrox-payment-reject" class="admin-roster-reject" data-booking="${esc(booking.id)}"><div class="field"><label>Reject reason<input name="reason" required placeholder="e.g. Reference not found"></label></div><button class="btn danger ghost sm" type="submit">Reject claim</button></form>` : ""}`).join("") : `<p class="muted small">No members in this state.</p>`}
      </details>`;
    }).join("")}
    ${queue}
  </div><!-- payment-roster-end:${esc(id)} -->`;
}

function adminAttendanceSession(session, memberUsers) {
  const directory = new Map((memberUsers || []).map((member) => [member.id, member]));
  const displayName = (booking) => {
    const attendeeId = store.effectiveAttendeeId(booking);
    const member = directory.get(attendeeId);
    return member ? (member.fullName || member.preferredName || "Member") : "Member";
  };
  const bookings = store.attendanceBookingsForSession(session.id);
  const expected = bookings.filter((booking) => booking.status === "confirmed")
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const arrived = bookings.filter((booking) => booking.status === "attended")
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const window = store.attendanceWindowForSession(session);
  const timingCopy = window.state === "upcoming"
    ? "Check-in opens 15 minutes before the session."
    : window.state === "locked"
      ? "Attendance locked."
      : "Attendance check-in is open.";
  const row = (booking, isArrived) => `<div class="admin-roster-row">
    <span class="admin-attendance-name"><strong>${esc(displayName(booking))}</strong><span class="badge ${isArrived ? "free" : "neutral"}">${isArrived ? "Arrived" : "Expected"}</span></span>
    ${window.state === "open" ? `<button class="btn ${isArrived ? "ghost " : ""}sm" type="button" data-action="attendance-toggle" data-booking="${esc(booking.id)}" data-arrived="${isArrived ? "0" : "1"}">${isArrived ? "Undo" : "Mark Arrived"}</button>` : ""}
  </div>`;
  return `<details class="admin-attendance-session" data-attendance-session="${esc(session.id)}" open>
    <summary><span><strong>Expected arrivals</strong><span class="muted small">${esc(fmtTime(session.time))} · ${esc(session.location || "Venue pending")}</span></span><span>${arrived.length} arrived · ${expected.length} still expected</span></summary>
    <p class="muted small admin-attendance-copy">${timingCopy}</p>
    ${expected.map((booking) => row(booking, false)).join("")}
    ${arrived.map((booking) => row(booking, true)).join("")}
    ${bookings.length ? "" : `<p class="muted small admin-attendance-empty">No confirmed-paid arrivals.</p>`}
  </details>`;
}

function venueDisplayName(session) {
  const identity = `${session?.id || ""} ${session?.location || ""}`.toLowerCase();
  if (identity.includes("bft")) return "BFT";
  if (identity.includes("midtown")) return "Midtown 28";
  if (identity.includes("island ecc") || identity.includes("quarry bay")) return "Island ECC";
  return session?.location || "venue";
}

function adminCapacityLine(count, capacity) {
  const available = capacity == null ? "Uncapped" : `${Math.max(0, Number(capacity) - count)} available`;
  return `<p class="muted small admin-capacity-line">${count} active places · ${available}</p>`;
}

function adminVenueHandoff(session, { message, override, meta = "", extra = "", ready = true, heading = venueDisplayName(session), subheading = "", cardClass = "" }) {
  const venueName = venueDisplayName(session);
  const blockedCopy = "Available after venue allocation is finalized.";
  return `<div class="card hyrox-venue-card mt16 ${cardClass}"><div class="card-body">
    ${meta}
    <div class="section-head"><div><h3>${esc(heading)}</h3>${subheading ? `<p class="muted small hyrox-card-subtitle">${esc(subheading)}</p>` : ""}</div>${override.gymConfirmedAt ? `<span class="badge free">Confirmed</span>` : `<span class="badge neutral">Venue handoff</span>`}</div>
    ${extra}
    <section class="admin-venue-finalization${override.gymConfirmedAt ? " is-finalized" : ""}" aria-labelledby="venue-finalization-${esc(session.id)}">
      <div class="section-head">
        <div><span class="kicker dim">Venue operations</span><h4 id="venue-finalization-${esc(session.id)}">${override.gymConfirmedAt ? "Venue finalized" : "Finalize with venue"}</h4></div>
        ${override.gymConfirmedAt ? '<span class="badge free">Complete</span>' : ""}
      </div>
      ${override.gymConfirmedAt
        ? `<p class="badge free mt8">Confirmed with ${esc(venueName)} · ${new Date(override.gymConfirmedAt).toLocaleDateString("en-HK", { day: "numeric", month: "short" })}${override.gymNote ? ` — ${esc(override.gymNote)}` : ""}</p>`
        : ready
          ? `<p class="muted small mt8">Send the confirmed headcount to the venue, then record their confirmation.</p>
             <div class="btn-row mt16">
              <a class="btn sm" href="https://wa.me/?text=${encodeURIComponent(message)}" target="_blank" rel="noopener">Send via WhatsApp</a>
              <button class="btn ghost sm" type="button" data-action="copy-gym" data-msg="${esc(message)}">Copy message</button>
            </div>
            <form id="form-gym-note" data-session="${esc(session.id)}" class="mt8">
              <div class="field"><label>Note (optional)</label><input name="note" placeholder="e.g. confirmed 16 with ${esc(venueName)}"></div>
              <button class="btn sm" type="submit">Mark confirmed with ${esc(venueName)}</button>
            </form>`
          : `<p class="badge neutral mt8">${blockedCopy}</p>`}
    </section>
  </div></div>`;
}

function adminHyroxGymControls(cycle, memberUsers) {
  const sessionIds = (cycle.venuePlan === "bft_only"
    ? [cycle.bftSessionId]
    : [cycle.bftSessionId, cycle.midtownSessionId]).filter(Boolean);
  const ready = cycle.venuePlan !== "pending" && !!cycle.allocationClosedAt;
  if (!sessionIds.length) return "";
  return `<div class="hyrox-gym-controls"><h3>Venue handoff</h3>
    ${!ready ? `<p class="muted small">BFT and Midtown 28 handoff controls appear after venue allocation is finalized.</p>` : ""}
    ${sessionIds.map((sessionId) => {
      const session = store.getSession(sessionId);
      if (!session) return "";
      const override = store.weekVenueOverride(sessionId);
      const paidCount = store.paymentRosterBookings().filter((booking) =>
        booking.sessionId === sessionId && ["confirmed", "attended"].includes(booking.status)
      ).length;
      const message = `ITC HYROX booking — ${fmtDate(cycle.dateISO)} at ${session.location}. Confirmed: ${paidCount}.`;
      const otherId = sessionId === cycle.bftSessionId ? cycle.midtownSessionId : cycle.bftSessionId;
      const other = store.getSession(otherId);
      const queue = cycle.venuePlan === "both" ? adminQueueDisclosure({
        id: sessionId,
        title: `Switch requests into ${venueDisplayName(session)}`,
        subtitle: `Already booked at ${venueDisplayName(other)}`,
        entries: store.hyroxCycleQueues(cycle.id).venueSwitches.filter((entry) => entry.targetSessionId === sessionId),
        memberUsers,
        closed: !!cycle.allocationClosedAt || Date.now() >= cycle.venueChoiceDeadlineAt,
      }) : "";
      const extra = cycle.venuePlan === "pending" ? "" : `${queue}${adminAttendanceSession(session, memberUsers)}`;
      return adminVenueHandoff(session, { message, override, ready, extra });
    }).join("")}
  </div>`;
}

function paymentVisibleHyroxCycles(financialBookings, now = Date.now()) {
  return store.hyroxCycles().filter((cycle) => {
    const active = financialBookings.some((booking) => booking.cycleId === cycle.id);
    const childSessions = [cycle.bftSessionId, cycle.midtownSessionId]
      .map((sessionId) => sessionId ? store.getSession(sessionId) : null)
      .filter(Boolean);
    const closesAt = childSessions.length
      ? Math.max(...childSessions.map((session) => store.attendanceWindowForSession(session, now).closesAt))
      : cycle.venueChoiceDeadlineAt + 24 * 60 * 60_000;
    return active || (now >= cycle.registrationOpensAt && now <= closesAt);
  });
}

function adminHyroxCycleCards(memberUsers, cycles = paymentVisibleHyroxCycles(store.paymentRosterBookings())) {
  const financialBookings = store.paymentRosterBookings();
  return cycles.map((cycle) => {
    const bookings = store.hyroxCycleBookings(cycle.id);
    const active = bookings.filter((booking) => store.paymentStateForBooking(booking));
    const claims = bookings.filter((booking) => store.paymentStateForBooking(booking) === "awaiting_confirmation");
    const queues = store.hyroxCycleQueues(cycle.id);
    const locked = Date.now() < cycle.registrationOpensAt && cycle.registrationState === "draft";
    const afterPromotion = Date.now() >= cycle.promotedPaymentDeadlineAt;
    const cycleFinancialBookings = financialBookings.filter((booking) => booking.cycleId === cycle.id);
    const paymentRoster = adminPaymentRoster({
      id: cycle.id,
      label: "ITC HYROX weekly cycle",
      dateISO: cycle.dateISO,
      venue: active.some((booking) => !booking.sessionId)
        ? "Venue allocation pending"
        : cycle.venuePlan === "both" ? "BFT + Midtown 28" : "BFT",
      bookings: cycleFinancialBookings,
      memberUsers,
      queue: adminQueueDisclosure({
        id: cycle.id, title: "Weekly waitlist",
        subtitle: "Waiting for a place in the shared pool",
        entries: queues.weeklyWaitlist, memberUsers, preference: true,
      }),
    });
    const allocationPending = cycleFinancialBookings.some((booking) =>
      !booking.sessionId && ["confirmed", "attended"].includes(booking.status)
    ) || (cycle.venuePlan === "pending" && cycleFinancialBookings.some((booking) => !booking.sessionId));
    const retry = !claims.length && cycle.venuePlan === "pending" && cycle.reconciliationStartedAt
      ? `<button class="btn sm" type="button" data-action="hyrox-plan-retry" data-cycle="${esc(cycle.id)}">Retry automatic venue plan</button>` : "";
    const close = cycle.venuePlan !== "pending" && !cycle.allocationClosedAt && Date.now() >= cycle.venueChoiceDeadlineAt
      ? `<button class="btn ghost sm" type="button" data-action="hyrox-allocation-close" data-cycle="${esc(cycle.id)}">Close venue allocation</button>` : "";
    const openingDate = new Date(cycle.registrationOpensAt).toLocaleDateString("en-HK", {
      timeZone: "Asia/Hong_Kong", day: "numeric", month: "short",
    });
    return `<section class="card hyrox-admin-cycle mt16" data-hyrox-week="${esc(cycle.dateISO)}"><div class="card-body">
      <div class="section-head"><div><span class="kicker">${esc(fmtDate(cycle.dateISO))}</span><h2>ITC HYROX<br><span>Payment reconciliation</span></h2></div><span class="badge ${locked ? "neutral" : "warn"}">${locked ? "Locked" : esc(cycle.registrationState)}</span></div>
      <p class="muted small">${locked ? `Registration opens Mon ${esc(openingDate)} · 6 PM HKT.` : afterPromotion ? "Final reconciliation summary after Thursday 8 PM HKT." : "Payment review runs Thursday at 6 PM HKT."}</p>
      ${paymentRoster}
      ${adminCapacityLine(active.length, cycle.capacity)}
      ${allocationPending ? `<p class="muted small mt16">Expected-arrivals roster available after venue allocation.</p>` : ""}
      <div class="actions">${retry}${close}</div>${adminHyroxGymControls(cycle, memberUsers)}
      <form id="form-cancel-hyrox-cycle" class="mt16" data-cycle="${esc(cycle.id)}"><div class="field"><label>Cancel this HYROX cycle — reason</label><input name="reason" required placeholder="e.g. Gym unavailable"></div><button class="btn danger ghost sm" type="submit">Cancel HYROX cycle</button></form>
    </div></section>${adminIslandEccHandoff(cycle, memberUsers)}`;
  }).join("");
}

function adminHyroxWeeklyBookingSetup(memberUsers) {
  // Week grouping follows Hong Kong, independent of the Admin's device zone.
  const saturday = new Date(Date.now() + 8 * 60 * 60_000);
  saturday.setUTCDate(saturday.getUTCDate() + (6 - saturday.getUTCDay() + 7) % 7);
  const currentDate = saturday.toISOString().slice(0, 10);
  const futureDates = new Set(Array.from({ length: 3 }, (_, index) => {
    const day = new Date(saturday);
    day.setUTCDate(day.getUTCDate() + (index + 1) * 7);
    return day.toISOString().slice(0, 10);
  }));
  const cycles = store.hyroxCycles();
  const upcoming = cycles.filter((cycle) => futureDates.has(cycle.dateISO))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const visibleIds = new Set(paymentVisibleHyroxCycles(store.paymentRosterBookings()).map((cycle) => cycle.id));
  const current = cycles.filter((cycle) => !futureDates.has(cycle.dateISO)
    && (cycle.dateISO === currentDate || visibleIds.has(cycle.id)))
    .sort((a, b) => (a.dateISO === currentDate ? -1 : b.dateISO === currentDate ? 1 : b.dateISO.localeCompare(a.dateISO)));
  const groupedDates = new Set([...current, ...upcoming].map((cycle) => cycle.dateISO));
  return `<details class="admin-section mt24">
    <summary><h2>HYROX weekly booking setup</h2></summary>
    ${adminHyroxCycleCards(memberUsers, current)}
    <details class="admin-upcoming-weeks mt24">
      <summary><h3>Upcoming weeks</h3><span class="badge neutral">${upcoming.length}</span></summary>
      <p class="muted small mt8">The next three Saturdays. Previewing a week does not open member registration.</p>
      ${adminHyroxCycleCards(memberUsers, upcoming) || `<p class="muted small mt8">No upcoming weeks provisioned yet.</p>`}
    </details>
    ${adminFinalizeGym(memberUsers, groupedDates)}
  </details>`;
}

async function adminOps(viewer, memberUsers, profilePhone = "") {
  const upcoming = store.upcomingSessions(21).filter((s) => s.category === "HYROX" && !sessionStarted(s));
  const thisWeekSat = upcoming[0]?.dateISO;
  const dutyUser = thisWeekSat ? store.collectorFor(`hyrox-bft-${thisWeekSat}`) : null;
  const admins = (memberUsers || []).filter(
    (u) => isAdminRole(u.role) && u.status === "approved"
  );
  const viewerPayouts = store.collectorPayoutsFor(viewer.id);

  const pending = pendingPayments(memberUsers);

  const dutyCard = `
    <details class="admin-section mt16">
      <summary><h2>Payment duty</h2></summary>
    <div class="card mt8"><div class="card-body">
      <p class="muted small">One collector per week covers both venues. Member payment screens show this collector’s PayMe/FPS details.</p>
      <p class="mt8">On duty this week: <strong>${dutyUser ? esc(dutyUser.preferredName || dutyUser.fullName) : "—"}</strong></p>
      <div class="btn-row">
        ${dutyUser?.id !== viewer.id ? `<button class="btn sm" type="button" data-action="duty-claim" data-week="${thisWeekSat}">I’m on duty this week</button>` : ""}
        <select class="role-select" data-change="duty-set" data-week="${thisWeekSat}" aria-label="Hand over duty">
          <option value="">Hand over to…</option>
          ${admins.filter((a) => a.id !== dutyUser?.id).map((a) => `<option value="${esc(a.id)}">${esc(a.preferredName || a.fullName)}</option>`).join("")}
        </select>
      </div>
      <form id="form-payouts" class="mt16" data-fps-phone="${esc(profilePhone)}">
        <h3>My payout details</h3>
        <div class="field"><label for="payme-link">PayMe link</label><input id="payme-link" name="paymeLink" value="${esc(viewerPayouts.paymeLink)}" placeholder="https://payme.hsbc.com.hk/…"></div>
        <p class="muted small mt8">FPS phone: <strong>${esc(profilePhone || "Not set")}</strong> — taken from your Membership Details.</p>
        <p class="muted small">To change this number, update Membership Details first, then save your payout details here.</p>
        <button class="btn ghost sm mt8" type="submit">Save payout details</button>
      </form>
    </div></div>
    </details>`;

  const replacementCard = await adminReplacementReview();
  const pendingCard = `
    <details class="admin-section mt24">
      <summary><h2>Pending payments</h2></summary>
    ${pending.length ? pending.map(({ booking: b, who }) => `
      <div class="card booking-card mt16"><div class="card-body">
        <header>
          <div>
            <h3>${esc(who)}</h3>
            <p class="muted small">${esc(b.snapshot.name)} · ${esc(fmtDate(b.snapshot.dateISO))} · ${esc(b.paidMethod)}${b.paymentRef ? ` · ref ${esc(b.paymentRef)}` : ""}</p>
          </div>
          <span class="badge warn">${fmtMoney(b.snapshot.price)}</span>
        </header>
        <div class="actions">
          <button class="btn sm" type="button" data-action="confirm-payment" data-booking="${esc(b.id)}">Confirm received</button>
        </div>
      </div></div>`).join("")
    : `<div class="empty mt8">Nothing waiting. When members mark “I’ve paid”, they land here.</div>`}
    </details>`;

  return `
    ${dutyCard}
    ${pendingCard}
    ${replacementCard}
    ${adminHyroxWeeklyBookingSetup(memberUsers)}`;
}

async function adminReplacementReview() {
  const requests = await store.replacementRequestsForAdmin();
  const active = requests.filter((request) => ["pending", "accepted"].includes(request.status));
  const rows = active.map((request) => {
    const waiting = request.status === "pending";
    const session = request.snapshot || {};
    return `<div class="replacement-admin-row">
      <div class="who"><strong>${esc(request.originalDisplayName)}${request.replacementDisplayName ? ` → ${esc(request.replacementDisplayName)}` : ""}</strong>
        <span>${esc(session.name || "ITC HYROX")} · ${esc(session.dateISO || "Date pending")}</span></div>
      <div class="replacement-admin-status"><span class="badge ${waiting ? "neutral" : "warn"}">${waiting ? "Waiting for member" : "Pending Admin confirmation"}</span>
        ${waiting ? `<span class="muted small">Private invite has not been claimed.</span>` : `<div class="btn-row two"><button class="btn sm" type="button" data-action="replacement-decision" data-request="${esc(request.requestId)}" data-confirmed="1">Confirm replacement</button><button class="btn danger ghost sm" type="button" data-action="replacement-decision" data-request="${esc(request.requestId)}" data-confirmed="0">Reject replacement</button></div>`}
      </div>
    </div>`;
  }).join("");
  return `<details class="admin-section mt24" open>
    <summary><h2>HYROX replacements${active.length ? ` <span class="badge warn">${active.length}</span>` : ""}</h2></summary>
    <p class="muted small mt8">Review accepted handovers. The original member remains payer and receipt owner; only confirmation changes the attendee.</p>
    ${rows || `<div class="empty mt8">No HYROX replacement requests waiting for review.</div>`}
  </details>`;
}

// Weekly paid-session setup controls (time, note, venue TBC) live
// on the Activities tab alongside the recurring defaults and free/RSVP event
// controls. Booking and payment status belongs on Payments.
function adminPaidSessionControls() {
  const upcoming = store.upcomingSessions(21).filter(
    (s) => !s.oneOff && s.category === "HYROX" && s.kind === "paid" && !sessionStarted(s)
      && ![store.hyroxCycleForDate(s.dateISO)?.bftSessionId, store.hyroxCycleForDate(s.dateISO)?.midtownSessionId].includes(s.id)
  );
  const sessionCards = upcoming.map((s) => {
    const override = store.getSession(s.id);
    return `
      <div class="card mt16 ${override.cancelled ? "is-cancelled" : ""}"><div class="card-body">
        <div class="kicker dim" style="margin-top:0">${esc(fmtDate(s.dateISO))} · ${fmtTime(s.time)}</div>
        <h3 class="mt8">${esc(s.location)}</h3>
        ${override.cancelled ? `<p class="badge danger">${esc(sessionCancellationCopy(override))}</p>` : ""}
        <p class="muted small mt8">Session setup only. Booking and payment status is shown under Admin → Payments.</p>
        ${!override.cancelled ? `
        <details class="mt8">
          <summary>Session controls</summary>
          <div class="btn-row mt8">
            <button class="btn ghost sm" type="button" data-action="venue-tbc-toggle" data-session="${esc(s.id)}" data-on="${override.venueTBC ? "0" : "1"}">${override.venueTBC ? "Venue confirmed" : "Mark venue TBC"}</button>
          </div>
          <form id="form-session-time" data-session="${esc(s.id)}" class="mt8">
            <div class="field"><label>Change time</label><input type="time" name="time" value="${esc(s.time)}"></div>
            <button class="btn ghost sm" type="submit">Save time</button>
          </form>
          <form id="form-session-notice" data-session="${esc(s.id)}" class="mt8">
            <div class="field"><label>Session note (weather, logistics)</label><input name="notice" value="${esc(override.notice || "")}" placeholder="Shown on Schedule + session page"></div>
            <button class="btn ghost sm" type="submit">Post note</button>
          </form>
          <form id="form-cancel-week" data-session="${esc(s.id)}" class="mt8">
            <div class="field"><label>Cancel this week — reason (required)</label><input name="reason" placeholder="e.g. HYROX race weekend — no session" required></div>
            <button class="btn danger sm" type="submit">Cancel session</button>
          </form>
        </details>` : ""}
      </div></div>`;
  }).join("");
  return `
    <h3 id="paid-sessions-title">Paid Sessions</h3>
    <p class="muted small mt8">Change the time, venue status or note for one dated HYROX session — or cancel that week.</p>
    ${sessionCards || `<div class="empty mt8">No upcoming paid sessions.</div>`}`;
}

// Money-side per-session work stays on the Payments tab: confirming paid
// headcount with the venue reads bookings/receipts, not session setup.
function adminFinalizeGymCard(s, cardClass = "", memberUsers = []) {
  const override = store.getSession(s.id);
  if (override.cancelled) return "";
  const held = store.paymentRosterBookings().filter((booking) => booking.sessionId === s.id);
  const confirmed = held.filter((booking) => ["confirmed", "attended"].includes(booking.status));
  const names = store.attendeesFor(s);
  const venueName = venueDisplayName(s);
  const venueCardClass = cardClass || (venueName === "Island ECC" ? "hyrox-island-ecc-card" : "");
  const message = `ITC HYROX booking — ${fmtDate(s.dateISO)} ${fmtTime(s.time)} at ${s.location}. Confirmed: ${confirmed.length} of ${s.capacity}. Names: ${names.join(", ")}. Total: ${fmtMoney(confirmed.length * s.price)}.`;
  const isMid = store.isMidtown(s);
  const open = store.midtownOpenFor(s);
  const paymentRoster = adminPaymentRoster({
    id: s.id,
    label: s.name || "ITC HYROX",
    dateISO: s.dateISO,
    venue: s.location || "Venue pending",
    bookings: held,
    memberUsers,
    queue: adminQueueDisclosure({
      id: s.id, title: "Session waitlist", subtitle: "Waiting for a place in this session",
      entries: store.queueFor(s.id).waitlist, memberUsers,
    }),
  });
  return adminVenueHandoff(s, {
    message,
    override,
    meta: `<div class="kicker" style="margin-top:0">${esc(fmtDate(s.dateISO))}</div>`,
    heading: `ITC HYROX - ${venueName}`,
    subheading: "Payment reconciliation",
    cardClass: venueCardClass,
    extra: `${paymentRoster}${adminCapacityLine(held.length, s.capacity)}${adminAttendanceSession(s, memberUsers)}${isMid
      ? `<p class="muted small mt8">Registration: <strong>${open ? "Open" : "Closed"}</strong></p>
         <button class="btn ghost sm" type="button" data-action="midtown-toggle" data-session="${esc(s.id)}" data-open="${open ? "0" : "1"}">${open ? "Close Midtown" : "Open Midtown"}</button>`
      : ""}`,
  });
}

function adminIslandEccHandoff(cycle, memberUsers) {
  const childIds = [cycle.bftSessionId, cycle.midtownSessionId].filter(Boolean);
  const financialSessionIds = store.paymentRosterBookings()
    .filter((booking) => booking.sessionId && booking.snapshot?.dateISO === cycle.dateISO)
    .map((booking) => booking.sessionId);
  const candidates = [
    ...store.upcomingSessions(35),
    ...financialSessionIds.map((sessionId) => store.getSession(sessionId)).filter(Boolean),
  ];
  const session = candidates.find((candidate) => {
    if (candidate.category !== "HYROX" || candidate.dateISO !== cycle.dateISO
        || childIds.includes(candidate.id)) return false;
    return !store.getSession(candidate.id).cancelled;
  });
  return session ? adminFinalizeGymCard(session, "hyrox-island-ecc-card", memberUsers) : "";
}

function adminFinalizeGym(memberUsers, groupedDates = null) {
  const financialBookings = store.paymentRosterBookings();
  const cycleDates = groupedDates || new Set(paymentVisibleHyroxCycles(financialBookings).map((cycle) => cycle.dateISO));
  const candidates = new Map(store.upcomingSessions(21)
    .filter((session) => session.category === "HYROX")
    .map((session) => [session.id, session]));
  for (const booking of financialBookings) {
    if (!booking.sessionId || booking.cycleId) continue;
    const session = store.getSession(booking.sessionId);
    if (session?.category === "HYROX") candidates.set(session.id, session);
  }
  const upcoming = [...candidates.values()].filter((session) => {
    const cycleChildren = [
      store.hyroxCycleForDate(session.dateISO)?.bftSessionId,
      store.hyroxCycleForDate(session.dateISO)?.midtownSessionId,
    ];
    const hasActiveBooking = financialBookings.some((booking) => booking.sessionId === session.id);
    const start = hktEventStartMs(session.dateISO, session.time);
    const withinDisplayWindow = Date.now() >= start - 21 * 24 * 60 * 60_000
      && store.attendanceWindowForSession(session).state !== "locked";
    return !cycleDates.has(session.dateISO) && !cycleChildren.includes(session.id)
      && (hasActiveBooking || withinDisplayWindow);
  }).sort((a, b) => hktEventStartMs(a.dateISO, a.time) - hktEventStartMs(b.dateISO, b.time));
  const cards = upcoming.map((session) => adminFinalizeGymCard(session, "", memberUsers)).join("");
  return `
    <section class="admin-control-group mt24" aria-labelledby="hyrox-venue-handoff-title">
      <div class="section-head"><h3 id="hyrox-venue-handoff-title">Venue handoff</h3></div>
      <p class="muted small mt8">Review each venue’s booking status, send the confirmed headcount, then record venue confirmation.</p>
      ${cards || `<div class="empty mt8">No upcoming venue handoffs.</div>`}
    </section>`;
}

function adminRsvpOccurrenceControls(session, {
  cancelLabel = "Cancel this week's event",
  cancelFieldLabel = "Cancel this week — reason (required)",
  cancelPlaceholder = "e.g. Organizer away",
  allowDelete = false,
} = {}) {
  if (!store.sessionRequiresRsvp(session) || Number(session.price ?? 0) !== 0) return "";
  const safeId = esc(session.id);
  const count = `<p class="muted small mt8">${store.attendeeCountFor(session)} going${session.capacity != null ? ` · cap ${session.capacity}` : ""}</p>`;
  if (session.cancelled) {
    return `${count}
      <p class="badge danger">${esc(sessionCancellationCopy(session))}</p>
      <button class="btn ghost sm mt8" type="button" data-action="repost-rsvp" data-session="${safeId}">Reopen event</button>`;
  }
  return `${count}
    <form id="form-cancel-week" data-session="${safeId}" class="mt8">
      <div class="field"><label>${cancelFieldLabel}</label><input name="reason" placeholder="${cancelPlaceholder}" required></div>
      <div class="btn-row">
        <button class="btn danger sm" type="submit">${cancelLabel}</button>
        ${allowDelete ? `<button class="btn ghost sm" type="button" data-action="delete-event" data-session="${safeId}">Delete</button>` : ""}
      </div>
    </form>`;
}

function adminFreeEventControls() {
  const upcoming = store.upcomingSessions(21)
    .filter((s) => !s.oneOff && s.kind !== "paid" && !sessionStarted(s));
  return `
    <h3 id="free-rsvp-events-title">Free &amp; RSVP Events</h3>
    <p class="muted small mt8">Set a venue for one dated free or RSVP event. Later weeks keep the recurring default.</p>
    ${upcoming.length ? upcoming.map((s) => {
      const override = store.weekVenueOverride(s.id);
      const recurring = store.getActivity(s.activityId);
      const safeId = esc(s.id);
      const locationId = `week-venue-location-${safeId}`;
      const mapsId = `week-venue-maps-${safeId}`;
      const point = normalizeMeetingPoint(override.meetingLat, override.meetingLng);
      const isTamar = normalizeVenueLocation(override.location || s.location) === "tamar park";
      const picker = s.activityId === "wnt" ? `
        <input type="hidden" name="meetingLat" value="${point?.lat ?? ""}">
        <input type="hidden" name="meetingLng" value="${point?.lng ?? ""}">
        <div class="venue-picker-shell ${isTamar ? "" : "hidden"}" data-venue-picker-shell>
          <p class="kicker dim">Meeting point · Only this session</p>
          <div class="venue-picker" data-venue-picker data-session="${safeId}">
            <p class="muted small" role="status">Loading map…</p>
          </div>
        </div>` : "";
      return `
        <div class="card mt16 free-event-venue-card"><div class="card-body">
          <div class="kicker dim" style="margin-top:0">${esc(fmtDate(s.dateISO))} · ${fmtTime(s.time)}</div>
          <h3 class="mt8">${esc(s.name)}</h3>
          <span class="badge neutral">Only this session</span>
          <p class="muted small mt8">Current venue: <strong>${esc(s.location || "TBC")}</strong></p>
          <p class="muted small">Recurring default: <strong>${esc(recurring?.location || "TBC")}</strong></p>
          <form class="mt8" data-action="form-week-venue" data-session="${safeId}">
            <div class="field-row">
              <div class="field">
                <label for="${locationId}">Display location</label>
                <input id="${locationId}" name="location" value="${esc(override.location || '')}" placeholder="e.g. Central Harbourfront — 7pm sharp">
              </div>
              <div class="field">
                <label for="${mapsId}">Google Maps search</label>
                <input id="${mapsId}" name="mapsQuery" value="${esc(override.mapsQuery || '')}" placeholder="e.g. Central Harbourfront, Hong Kong">
              </div>
            </div>
            ${picker}
            <div class="btn-row">
              <button class="btn ghost sm" type="submit">Save Weekly Venue</button>
              <button class="btn ghost sm" type="button" data-action="reset-week-venue" data-session="${safeId}">Reset to Recurring Default</button>
            </div>
          </form>
          ${adminRsvpOccurrenceControls(s)}
        </div></div>`;
    }).join("") : `<div class="empty mt8">No upcoming free or RSVP events.</div>`}`;
}

function adminWeeklyEventControls() {
  return `
    <details class="admin-section mt24">
      <summary><h2>Weekly Event Controls</h2></summary>
      <p class="muted small mt8">Manage one dated event without changing its recurring defaults.</p>
      <section class="admin-control-group" aria-labelledby="free-rsvp-events-title">
        ${adminFreeEventControls()}
      </section>
      <section class="admin-control-group mt24" aria-labelledby="paid-sessions-title">
        ${adminPaidSessionControls()}
      </section>
    </details>`;
}

function adminApprovals(pending) {
  if (!pending.length) {
    return `<div class="empty">No pending members. New signups will land here.</div>`;
  }

  const ready = pending.filter((item) => item.applicationSubmitted);
  const awaiting = pending.filter((item) => !item.applicationSubmitted);
  const section = (title, items, emptyCopy, renderCard) => `
    <section class="approval-group">
      <div class="section-head"><h2>${title} (${items.length})</h2></div>
      ${items.length ? items.map(renderCard).join("") : `<div class="empty">${emptyCopy}</div>`}
    </section>`;
  const decisionButton = (u, action, extraClass = "") => `
    <button class="btn ${extraClass}sm" type="button" data-action="${action}" data-user="${esc(u.id)}" data-applicant-name="${esc(u.fullName)}">${action === "approve" ? "Approve" : "Decline"}</button>`;
  const joinedDate = (u) => new Date(u.appliedAt).toLocaleDateString("en-HK", { day: "numeric", month: "short" });
  const indemnityStatus = (u) => !u.indemnityAcceptedAt
    ? "—"
    : store.isIndemnityCurrent(u)
      ? "Accepted"
      : "Review required";
  const readyCard = (u) => `
    <div class="card booking-card applicant" id="approval-${esc(u.id)}" data-approval-card data-applicant-name="${esc(u.fullName)}"><div class="card-body">
      <header>
        <div>
          <div class="kicker dim" style="margin-top:0">Applied ${joinedDate(u)}</div>
          <h3 class="mt8">${esc(u.fullName)}</h3>
        </div>
        <span class="badge warn">Pending</span>
      </header>
      <dl>
        <dt>Email</dt><dd>${esc(u.email)}</dd>
        <dt>Phone</dt><dd>${esc(u.phone)}</dd>
        <dt>Emergency</dt><dd>${emergencyContactSummary(u.emergencyName, u.emergencyRelationship, u.emergencyPhone)}</dd>
        <dt>Heard via</dt><dd>${esc(u.heard)}</dd>
        <dt>Age 18+ / guardian</dt><dd>${u.isMinor ? "Under 18 · guardian required" : "18 or over"}</dd>
        <dt>Indemnity</dt><dd>${indemnityStatus(u)}</dd>
        <dt>Photo consent</dt><dd>${u.mediaConsent ? "Yes" : "No"}</dd>
      </dl>
      <div class="actions">
        ${decisionButton(u, "approve")}
        ${decisionButton(u, "decline", "danger ")}
      </div>
      <div class="decision-error" role="alert" hidden></div>
    </div></div>`;
  const awaitingCard = (u) => `
    <div class="card booking-card applicant applicant-awaiting" id="approval-${esc(u.id)}" data-approval-card data-applicant-name="${esc(u.fullName)}"><div class="card-body">
      <header>
        <div>
          <div class="kicker dim" style="margin-top:0">Joined ${joinedDate(u)}</div>
          <h3 class="mt8">${esc(u.fullName)}</h3>
        </div>
        <span class="badge neutral">Awaiting</span>
      </header>
      <dl><dt>Email</dt><dd>${esc(u.email)}</dd></dl>
      <p class="hero-meta mt8"><strong>Application not submitted</strong></p>
      <p class="muted small">This pending profile has not finished the membership application yet, so approval stays locked until they submit it.</p>
      <div class="actions">
        <button class="btn sm" type="button" data-action="approve" data-user="${esc(u.id)}" data-applicant-name="${esc(u.fullName)}" disabled>Approve</button>
        <button class="btn danger sm" type="button" data-action="decline" data-user="${esc(u.id)}" data-applicant-name="${esc(u.fullName)}" disabled>Decline</button>
      </div>
    </div></div>`;

  return [
    section("Ready for review", ready, "No applications ready for review.", readyCard),
    section("Awaiting application", awaiting, "No members awaiting an application.", awaitingCard),
  ].join("");
}

function adminPrayerTimestamp(value) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function adminPrayerSubmittedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return date.toLocaleString("en-HK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Hong_Kong",
  });
}

function adminPrayerCard(row) {
  const status = PRAYER_STATUS_LABELS[row.status];
  const canMarkPrayed = row.status === "new";
  const canClose = ["new", "prayed_for"].includes(row.status);
  return `
    <article class="card admin-prayer-request">
      <div class="card-body">
        <div class="admin-prayer-request-header">
          <div>
            <h3>${esc(String(row.displayName || "Anonymous member"))}</h3>
            <time datetime="${esc(String(row.createdAt || ""))}">Submitted ${esc(adminPrayerSubmittedAt(row.createdAt))}</time>
          </div>
          <span class="badge neutral">${esc(status)}</span>
        </div>
        <p class="admin-prayer-request-copy">${esc(String(row.request || ""))}</p>
        ${canMarkPrayed || canClose ? `
          <div class="admin-prayer-actions">
            ${canMarkPrayed ? `<button class="btn sm" type="button" data-action="mark-prayer-prayed" data-prayer="${esc(String(row.id || ""))}">Mark as prayed for</button>` : ""}
            ${canClose ? `<button class="btn ghost sm" type="button" data-action="close-admin-prayer" data-prayer="${esc(String(row.id || ""))}">Close</button>` : ""}
          </div>` : ""}
      </div>
    </article>`;
}

function adminPrayerRequests(rows) {
  const byStatus = (status) => rows
    .filter((row) => row.status === status)
    .slice()
    .sort((a, b) => {
      const direction = status === "closed" ? -1 : 1;
      return direction * (adminPrayerTimestamp(a.createdAt) - adminPrayerTimestamp(b.createdAt))
        || String(a.id || "").localeCompare(String(b.id || ""));
    });
  const activeGroup = (status, title) => {
    const groupRows = byStatus(status);
    return `
      <section class="admin-prayer-group" aria-labelledby="admin-prayers-${status}">
        <div class="section-head admin-prayer-group-head">
          <h2 id="admin-prayers-${status}">${title}</h2>
          <span class="badge neutral">${groupRows.length}</span>
        </div>
        ${groupRows.length
          ? `<div class="admin-prayer-list">${groupRows.map(adminPrayerCard).join("")}</div>`
          : `<div class="empty">No ${title.toLowerCase()} prayer requests.</div>`}
      </section>`;
  };
  const closedRows = byStatus("closed");
  return `
    <div class="admin-prayer-groups">
      ${activeGroup("new", "New")}
      ${activeGroup("prayed_for", "Prayed for")}
      <details class="admin-prayer-group admin-prayer-closed">
        <summary>
          <h2>Closed <span class="badge neutral" aria-label="${closedRows.length} prayer request${closedRows.length === 1 ? "" : "s"}">${closedRows.length}</span></h2>
        </summary>
        ${closedRows.length
          ? `<div class="admin-prayer-list">${closedRows.map(adminPrayerCard).join("")}</div>`
          : '<div class="empty">No closed prayer requests.</div>'}
      </details>
    </div>`;
}

function campaignStatusBadge(status) {
  const className = status === "published" ? "free" : status === "draft" ? "warn" : "neutral";
  return `<span class="badge ${className}">${esc(status)}</span>`;
}

function adminGiving(campaignList) {
  const hasOpen = campaignList.some((campaign) => campaign.status !== "closed");
  return `
    <div class="section-head"><h2>Giving campaigns</h2></div>
    ${campaignList.length
      ? `<div class="campaign-list">${campaignList.map((campaign) => `
        <a class="card campaign-row" href="#/admin/campaign/${esc(campaign.id)}">
          <div class="card-body">
            <div><h3>${esc(campaign.title)}</h3><p class="hero-meta">${fmtMoney(campaign.goalHKD)} goal</p></div>
            ${campaignStatusBadge(campaign.status)}
          </div>
        </a>`).join("")}</div>`
      : `<div class="empty">No Giving campaigns yet.</div>`}
    ${hasOpen ? "" : `<a class="btn ghost mt16" href="#/admin/campaign/new">+ Create campaign</a>`}`;
}

export async function viewAdminCampaign(id) {
  const user = store.currentUser();
  if (!user || !isAdminRole(user.role)) return { redirect: "#/account" };
  let campaignList;
  try {
    campaignList = await store.listGivingCampaigns();
  } catch (error) {
    if (!isGivingSchemaMissing(error)) throw error;
    return adminGivingSetupRequired();
  }
  const isNew = id === "new";
  const campaign = isNew
    ? { id: "", title: "", description: "", goalHKD: "", fpsId: "", fpsPayee: "", status: "draft" }
    : campaignList.find((item) => item.id === id);
  if (!campaign) return viewNotFound("Giving campaign not found.");
  if (isNew && campaignList.some((item) => item.status !== "closed")) {
    return viewNotFound("Close the current Giving campaign before creating another.");
  }
  const closed = campaign.status === "closed";
  const field = (id, name, label, value, options = "") => `
    <div class="field"><label for="${id}">${label} *</label>
      <input id="${id}" name="${name}" value="${esc(value)}" ${options} required ${closed ? "disabled" : ""}>
    </div>`;
  if (closed) {
    return `
      <a class="back-link" href="#/admin/giving">← Giving</a>
      <div class="kicker mt16">Admin · Giving · Closed</div>
      <h1 class="display sm">${esc(campaign.title)}.</h1>
      <div class="card mt16"><div class="card-body">
        ${campaignStatusBadge(campaign.status)}
        <p class="hero-meta mt16">${esc(campaign.description)}</p>
        <div class="receipt-lines">
          <div class="line"><span>Goal</span><strong>${fmtMoney(campaign.goalHKD)}</strong></div>
          <div class="line"><span>FPS ID</span><strong class="mono">${esc(campaign.fpsId)}</strong></div>
          <div class="line"><span>FPS payee</span><strong>${esc(campaign.fpsPayee)}</strong></div>
          <div class="line"><span>Closed</span><strong>${campaign.closedAt ? esc(fmtDay(campaign.closedAt)) : "Closed"}</strong></div>
        </div>
      </div></div>`;
  }
  return `
    <a class="back-link" href="#/admin/giving">← Giving</a>
    <div class="kicker mt16">Admin · Giving</div>
    <h1 class="display sm">${isNew ? "New campaign." : "Edit campaign."}</h1>
    ${isNew ? "" : `<div class="mt16">${campaignStatusBadge(campaign.status)}</div>`}
    <form id="form-campaign" class="mt16" data-campaign="${esc(campaign.id)}" novalidate>
      ${field("campaign-title", "title", "Campaign title", campaign.title)}
      <div class="field"><label for="campaign-description">Description *</label>
        <textarea id="campaign-description" name="description" rows="4" required>${esc(campaign.description)}</textarea>
      </div>
      ${field("campaign-goal", "goalHKD", "Goal (HKD)", campaign.goalHKD, 'type="number" min="1" step="1" inputmode="numeric"')}
      ${field("campaign-fps-id", "fpsId", "FPS ID", campaign.fpsId)}
      ${field("campaign-fps-payee", "fpsPayee", "FPS payee", campaign.fpsPayee)}
      <div id="campaign-error" aria-live="polite"></div>
      <button class="btn mt24" type="submit">${isNew ? "Create draft" : "Save changes"}</button>
      ${!isNew && campaign.status === "draft" ? `<button class="btn ghost mt16" type="button" data-action="campaign-publish" data-campaign="${esc(campaign.id)}" data-campaign-name="${esc(campaign.title)}">Publish campaign</button>` : ""}
      ${campaign.status === "published" ? `<button class="btn danger mt16" type="button" data-action="campaign-close" data-campaign="${esc(campaign.id)}" data-campaign-name="${esc(campaign.title)}">Close campaign</button>` : ""}
    </form>`;
}

// One-off events: single-date admin-created events (race days, socials,
// pop-ups). Paid events flow through the normal reserve/pay pipeline; free
// events are show-up. Deletion is only possible before anyone books.
function adminOneOffEvents() {
  const upcoming = store.upcomingSessions(60).filter((s) => s.oneOff && !sessionStarted(s));
  const cards = upcoming.map((s) => {
    const override = store.getSession(s.id);
    const cancelled = override?.cancelled;
    const rsvpOccurrence = store.sessionRequiresRsvp(override) && Number(override?.price ?? 0) === 0;
    return `
      <div class="card mt16 ${cancelled ? "is-cancelled" : ""}"><div class="card-body">
        <div class="kicker dim" style="margin-top:0">${esc(fmtDate(s.dateISO))} · ${fmtTime(s.time)}</div>
        <h3 class="mt8">${esc(s.name)}</h3>
        <p class="muted small mt8">${esc(s.location)} · ${s.kind === "paid" ? `${fmtMoney(s.price)} · cap ${s.capacity}` : "Free · RSVP optional"}</p>
        ${rsvpOccurrence
          ? adminRsvpOccurrenceControls(override, {
            cancelLabel: "Cancel event",
            cancelFieldLabel: "Cancel this event — reason (required)",
            cancelPlaceholder: "e.g. Venue unavailable",
            allowDelete: true,
          })
          : cancelled
            ? `<p class="badge danger">${esc(sessionCancellationCopy(override))}</p>`
            : `
            <form id="form-cancel-week" data-session="${esc(s.id)}" class="mt8">
              <div class="field"><label>Cancel this event — reason (required)</label><input name="reason" placeholder="e.g. Venue unavailable" required></div>
              <div class="btn-row">
                <button class="btn danger sm" type="submit">Cancel event</button>
                <button class="btn ghost sm" type="button" data-action="delete-event" data-session="${esc(s.id)}">Delete</button>
              </div>
            </form>`}
      </div></div>`;
  }).join("");
  return `
    <details class="admin-section mt24">
      <summary><h2>One-off Events</h2></summary>
      <p class="muted small mt8">Single-date events — race days, socials, pop-ups. Free events need no booking; paid events use the normal reserve-and-pay flow. Delete works only before anyone books; afterwards cancel instead.</p>
      ${cards || `<div class="empty mt8">No upcoming one-off events.</div>`}
      <form id="form-one-off-event" class="card mt16"><div class="card-body">
        <h3>Add one-off event</h3>
        <div class="field"><label for="oe-name">Name *</label><input id="oe-name" name="name" required placeholder="e.g. Dragon boat taster"></div>
        <div class="field-row">
          <div class="field"><label for="oe-date">Date *</label><input id="oe-date" name="date" type="date" required></div>
          <div class="field"><label for="oe-time">Start time *</label><input id="oe-time" name="time" type="time" required></div>
          <div class="field"><label for="oe-dur">Duration (min)</label><input id="oe-dur" name="durationMin" type="number" min="15" step="15" value="60"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="oe-loc">Venue *</label><input id="oe-loc" name="location" required placeholder="e.g. Central Harbourfront"></div>
          <div class="field"><label for="oe-maps">Google Maps search</label><input id="oe-maps" name="mapsQuery" placeholder="Defaults to venue"></div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="oe-cat">Category</label>
            <select id="oe-cat" name="category">
              ${["Other", "Strength", "Run", "HYROX", "Water", "Socials"].map((c) => `<option>${c}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="oe-kind">Type</label>
            <select id="oe-kind" name="kind" data-change="kind-toggle">
              <option value="free" selected>Free — open attendance</option>
              <option value="paid">Paid — book & pay in app</option>
            </select>
          </div>
        </div>
        <div class="paid-only hidden">
          <div class="field-row">
            <div class="field"><label for="oe-price">Price (HKD)</label><input id="oe-price" name="price" type="number" min="0" value="180"></div>
            <div class="field"><label for="oe-cap">Capacity</label><input id="oe-cap" name="capacity" type="number" min="1" value="20"></div>
          </div>
        </div>
        <button class="btn sm mt8" type="submit">Add event</button>
      </div></form>
    </details>`;
}

function adminActivities() {
  const acts = store.activities();
  const activityRows = acts
    .map(
      (a) => `
        <a class="session-row" href="#/admin/activity/${a.id}">
          <time>${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][a.weekday]}<small>${a.time}</small></time>
          <div>
            <h3>${esc(a.name)}</h3>
            <p>${esc(a.location)}${a.kind === "paid" ? ` · ${fmtMoney(a.price)} · cap ${a.capacity}` : " · open attendance"}</p>
          </div>
          <div class="row-end">
            ${a.kind === "free" ? '<span class="badge free">Free</span>' : a.kind === "rsvp" ? '<span class="badge free">RSVP</span>' : '<span class="badge paid">Paid</span>'}
            ${a.published ? "" : '<span class="badge neutral">Hidden</span>'}
          </div>
        </a>`
    )
    .join("");
  return `
    <details class="admin-section">
      <summary><h2>Recurring Activity Defaults</h2></summary>
    <p class="muted small mt8">${isLive()
      ? "Live deployment — recurring defaults are bundled with the app build and read-only. Set a venue for one week with Weekly Event Controls &gt; Free &amp; RSVP Events below."
      : "Changes here affect all future weeks unless a dated override is set below."}</p>
    <div class="session-list">${activityRows}</div>
    ${isLive() ? "" : `<a class="btn ghost mt16" href="#/admin/activity/new">+ New activity</a>`}
    </details>
    ${adminWeeklyEventControls()}
    ${adminOneOffEvents()}`;
}

function adminMembers(
  viewer,
  users = [],
  pendingApplicants = [],
  avatarRows = null,
  { avatarLoadFailed = false } = {},
) {
  const canEdit = isSuperRole(viewer.role);
  const canModerate = isAdminRole(viewer.role);
  const avatarById = new Map((avatarRows || []).map((row) => [row.profileId, row]));
  const photoStateLabel = (row) => {
    if (avatarLoadFailed) return '<span class="badge neutral">Photo status unavailable</span>';
    if (!row || row.source === "initials" && row.state === "active") return '<span class="badge neutral">No photo</span>';
    if (row.state === "pending_review") return '<span class="badge warn">Photo pending review</span>';
    if (row.state === "hidden") return '<span class="badge danger">Photo hidden</span>';
    return `<span class="badge free">${row.source === "google" ? "Google photo" : "Custom photo"}</span>`;
  };
  const pendingRows = (avatarRows || []).filter((row) => {
    if (row.state !== "pending_review") return false;
    const member = users.find((item) => item.id === row.profileId);
    if (!member) return false;
    const filterQuery = adminMemberFilters.query.trim().toLocaleLowerCase();
    return (!filterQuery || `${member.fullName || ""} ${member.email || ""}`.toLocaleLowerCase().includes(filterQuery))
      && (adminMemberFilters.status === "all" || member.status === adminMemberFilters.status)
      && (adminMemberFilters.role === "all" || normalizedRole(member.role) === adminMemberFilters.role);
  });
  const pendingQueue = `
    <section class="avatar-review-queue" aria-labelledby="avatar-review-title">
      <div class="section-head"><h2 id="avatar-review-title">Profile photo review</h2></div>
      ${avatarLoadFailed
        ? '<div class="empty">Photo review status unavailable — try again.</div>'
        : pendingRows.length ? pendingRows.map((row) => `
        <div class="avatar-review-card" data-avatar-moderation-card data-profile-id="${esc(row.profileId)}">
          ${avatarMarkup({
            name: row.displayName,
            presentation: {
              url: row.pendingPreviewUrl,
              source: row.pendingPreviewUrl ? "custom" : "initials",
              state: "pending_review",
              expiresAt: row.expiresAt,
            },
            size: 64,
            className: "admin-pending-avatar",
            decorative: true,
          })}
          <div class="avatar-review-copy">
            <strong>${esc(row.displayName)}</strong>
            <span class="badge warn">Awaiting review</span>
            ${row.moderationReason ? `<p class="muted small">Previous action: ${esc(row.moderationReason)}</p>` : ""}
          </div>
          <div class="avatar-review-actions">
            <label for="avatar-reject-reason-${esc(row.profileId)}">Reason if rejecting</label>
            <input id="avatar-reject-reason-${esc(row.profileId)}" type="text" maxlength="300" data-avatar-moderation-reason placeholder="Required to reject">
            <div class="btn-row two">
              <button class="btn sm" type="button" data-action="avatar-approve" data-profile-id="${esc(row.profileId)}" data-member-name="${esc(row.displayName)}">Approve</button>
              <button class="btn danger sm" type="button" data-action="avatar-reject" data-profile-id="${esc(row.profileId)}" data-member-name="${esc(row.displayName)}">Reject</button>
            </div>
          </div>
        </div>`).join("") : '<div class="empty">No profile photos awaiting review.</div>'}
    </section>`;
  const query = adminMemberFilters.query.trim().toLocaleLowerCase();
  const filtered = users.filter((u) => {
    const matchesQuery = !query || `${u.fullName || ""} ${u.email || ""}`.toLocaleLowerCase().includes(query);
    const matchesStatus = adminMemberFilters.status === "all" || u.status === adminMemberFilters.status;
    const matchesRole = adminMemberFilters.role === "all" || normalizedRole(u.role) === adminMemberFilters.role;
    return matchesQuery && matchesStatus && matchesRole;
  });
  const approvalsSection = pendingApplicants.length
    ? adminApprovals(pendingApplicants)
    : "";
  const option = (value, label, selected) =>
    `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`;
  const filterChip = (key, value, label) =>
    `<button id="member-filter-${key}-${value}" type="button" data-action="admin-member-filter" data-filter-key="${key}" data-filter-value="${value}" aria-pressed="${adminMemberFilters[key] === value}">${label}</button>`;
  const activeFilters = [
    query ? `search “${esc(adminMemberFilters.query.trim())}”` : "",
    adminMemberFilters.status !== "all" ? `status ${adminMemberFilters.status[0].toUpperCase()}${adminMemberFilters.status.slice(1)}` : "",
    adminMemberFilters.role !== "all" ? `role ${roleLabel(adminMemberFilters.role)}` : "",
  ].filter(Boolean).join(", ");
  const rows = filtered.map((u) => {
    const role = normalizedRole(u.role);
    const avatarRow = avatarById.get(u.id) || null;
    const photoControls = canModerate && avatarRow?.state === "active" && avatarRow.source !== "initials"
      ? `<div class="avatar-hide-controls" data-avatar-moderation-card data-profile-id="${esc(u.id)}">
          <label for="avatar-hide-reason-${esc(u.id)}">Reason to hide photo</label>
          <div class="avatar-hide-action">
            <input id="avatar-hide-reason-${esc(u.id)}" type="text" maxlength="300" data-avatar-moderation-reason placeholder="Required">
            <button class="btn danger sm" type="button" data-action="avatar-hide" data-profile-id="${esc(u.id)}" data-member-name="${esc(u.fullName)}">Hide photo</button>
          </div>
        </div>`
      : avatarRow?.state === "hidden" && avatarRow.moderationReason
      ? `<p class="muted small avatar-moderation-reason">Reason: ${esc(avatarRow.moderationReason)}</p>`
      : "";
    const roleBadge =
      u.status === "pending"
        ? '<span class="badge warn">Pending</span>'
        : u.status === "declined"
          ? '<span class="badge danger">Declined</span>'
          : `<span class="badge ${role === "member" ? "free" : role === "admin" ? "paid" : "warn"}">${roleLabel(role)}</span>`;
    const editor = canEdit && u.status === "approved" && u.id !== viewer.id
      ? `<div class="member-role-actions">
          <label class="sr-only" for="member-role-${esc(u.id)}">Role for ${esc(u.fullName)}</label>
          <select id="member-role-${esc(u.id)}" class="role-select" data-change="set-role" data-user="${esc(u.id)}" data-member-name="${esc(u.fullName)}" data-current-role="${role}">
            ${["member", "admin", "superadmin"].map((r) => option(r, roleLabel(r), role)).join("")}
          </select>
          <button class="btn danger sm" type="button" data-action="revoke-member" data-user="${esc(u.id)}" data-member-name="${esc(u.fullName)}">Revoke access</button>
        </div>`
      : roleBadge;
    return `
      <div class="member-row">
        <div class="who member-avatar-who">
          ${avatarMarkup({
            name: u.fullName,
            presentation: avatarRow,
            size: 40,
            className: "admin-member-avatar",
            decorative: true,
          })}
          <span class="member-avatar-copy"><strong>${esc(u.fullName)}</strong><span>${esc(u.email)}</span></span>
        </div>
        <div class="member-admin-controls">
          <div class="member-photo-state">${photoStateLabel(avatarRow)}${photoControls}</div>
          ${editor}
        </div>
      </div>`;
  }).join("");
  const hasActiveFilters = adminMemberFilters.query.length > 0 ||
    adminMemberFilters.status !== "all" || adminMemberFilters.role !== "all";
  return `
    ${pendingQueue}
    <div class="card mt16"><div class="card-body">
      <h2>Indemnity records</h2>
      <p class="muted small mt8">Download every profile, including members who have not accepted the current indemnity.</p>
      <button class="btn ghost sm mt16" type="button" data-action="download-indemnity-list">Download indemnity list</button>
    </div></div>
    <p class="muted small mt16">${canEdit ? "Role changes are Super Admin only." : "Only a Super Admin can change roles."}</p>
    <div class="member-filters" aria-label="Filter members">
      <div class="field"><label for="member-search">Search members</label><input id="member-search" type="search" value="${esc(adminMemberFilters.query)}" placeholder="Name or email" data-input="member-search"></div>
      <fieldset class="admin-filter-group">
        <legend>Status</legend>
        <div class="admin-filter-chips">
          ${filterChip("status", "all", "All")}${filterChip("status", "approved", "Approved")}${filterChip("status", "pending", "Pending")}${filterChip("status", "declined", "Declined")}
        </div>
      </fieldset>
      <fieldset class="admin-filter-group">
        <legend>Role</legend>
        <div class="admin-filter-chips">
          ${filterChip("role", "all", "All roles")}${filterChip("role", "member", "Member")}${filterChip("role", "admin", "Admin")}${filterChip("role", "superadmin", "Super Admin")}
        </div>
      </fieldset>
      ${hasActiveFilters ? '<button class="admin-filters-clear" type="button" data-action="admin-member-filters-clear">Clear filters</button>' : ""}
    </div>
    <div class="member-results">${rows || `<div class="empty">No members match${activeFilters ? ` ${activeFilters}` : " these filters"}.</div>`}</div>
    ${approvalsSection ? `<div class="member-approvals">${approvalsSection}</div>` : ""}`;
}

export function viewAdminActivity(id) {
  const user = store.currentUser();
  if (!user || !isAdminRole(user.role)) {
    return { redirect: "#/account" };
  }
  const isNew = id === "new";
  const a = isNew
    ? {
        id: "",
        name: "",
        kind: "free",
        category: "Strength",
        weekday: 3,
        time: "19:00",
        durationMin: 60,
        location: "",
        mapsQuery: "",
        blurb: "",
        memberNote: "",
        photo: "../assets/itc/main.webp",
        price: 250,
        capacity: 18,
        published: true,
      }
    : store.getActivity(id);
  if (!a) return viewNotFound("Activity not found.");

  // Live deployments: recurring defaults are seed/SQL-administered. Editing
  // them here would write device-local state behind a success toast while the
  // shared schedule never changes — so the editor is read-only on live.
  const liveReadOnly = isLive();

  const paidOnly = (inner) => `<div class="paid-only ${a.kind === "paid" ? "" : "hidden"}">${inner}</div>`;

  return `
    <a class="back-link" href="#/admin/activities">← Activities</a>
    <div class="kicker mt16">Admin · Activity</div>
    <h1 class="display sm">${isNew ? "New activity." : "Edit activity."}</h1>
    ${liveReadOnly ? `
      <p class="badge neutral mt16">Live deployment — recurring defaults are bundled with the app build.</p>
      <p class="muted small mt8">To change the venue for one week, use Weekly Event Controls &gt; Free &amp; RSVP Events on the Activities tab. Paid venues are administered in Supabase. This form is read-only here.</p>` : ""}
    <form id="form-activity" class="mt16" data-activity="${esc(a.id)}" novalidate>
      ${liveReadOnly ? `<fieldset class="form-fieldset" disabled>` : ""}
      <div class="field"><label for="ac-name">Name *</label><input id="ac-name" name="name" value="${esc(a.name)}" required></div>
      <div class="field-row">
        <div class="field">
          <label for="ac-kind">Type</label>
          <select id="ac-kind" name="kind" data-change="kind-toggle">
            <option value="free" ${a.kind === "free" ? "selected" : ""}>Free — open attendance</option>
            <option value="paid" ${a.kind === "paid" ? "selected" : ""}>Paid — book & pay in app</option>
          </select>
        </div>
        <div class="field">
          <label for="ac-cat">Category</label>
          <select id="ac-cat" name="category">
            ${["Strength", "Run", "HYROX", "Water", "Socials", "Other"].map((c) => `<option ${a.category === c ? "selected" : ""}>${c}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="ac-day">Day of week</label>
          <select id="ac-day" name="weekday">
            ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
              .map((d, i) => `<option value="${i}" ${a.weekday === i ? "selected" : ""}>${d}</option>`)
              .join("")}
          </select>
        </div>
        <div class="field"><label for="ac-time">Start time</label><input id="ac-time" name="time" type="time" value="${esc(a.time)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="ac-dur">Duration (min)</label><input id="ac-dur" name="durationMin" type="number" min="15" step="15" value="${a.durationMin}"></div>
        <div class="field"><label for="ac-loc">Location *</label><input id="ac-loc" name="location" value="${esc(a.location)}" required></div>
      </div>
      ${paidOnly(`
        <div class="field-row">
          <div class="field"><label for="ac-price">Price (HKD, fixed per session)</label><input id="ac-price" name="price" type="number" min="0" value="${a.price ?? 250}"></div>
          <div class="field"><label for="ac-cap">Capacity</label><input id="ac-cap" name="capacity" type="number" min="1" value="${a.capacity ?? 18}"></div>
        </div>
      `)}
      <div class="field"><label for="ac-blurb">Description</label><textarea id="ac-blurb" name="blurb" rows="3">${esc(a.blurb)}</textarea></div>
      <div class="field"><label for="ac-note">Leader note (members only)</label><textarea id="ac-note" name="memberNote" rows="2">${esc(a.memberNote || "")}</textarea></div>
      <label class="check"><input type="checkbox" name="published" ${a.published ? "checked" : ""}>
        <span>Published — visible on the schedule</span></label>
      <button class="btn mt24" type="submit" ${liveReadOnly ? "hidden" : ""}>${isNew ? "Create activity" : "Save changes"}</button>
      ${liveReadOnly ? `</fieldset>` : ""}
    </form>`;
}


export const notificationFilters = { kind: "all" };

const ADMIN_NOTIFICATION_FILTERS = [
  ["all", "All"],
  ["application", "Applications"],
  ["decision", "Decisions"],
  ["role", "Role changes"],
  ["club", "Club updates"],
  ["personal", "My account"],
];
const MEMBER_NOTIFICATION_FILTERS = ADMIN_NOTIFICATION_FILTERS.filter(([kind]) =>
  ["all", "club", "personal"].includes(kind)
);
const NOTIFICATION_CATEGORY_LABELS = {
  application: "Application",
  decision: "Decision",
  role: "Role change",
  club: "Club update",
  personal: "My account",
};

export async function viewNotifications(now = new Date(), prefetchedRows = null) {
  const user = store.currentUser();
  const rows = prefetchedRows ?? await store.listMyNotifications();
  const admin = isAdminRole(user?.role);
  const availableFilters = admin ? ADMIN_NOTIFICATION_FILTERS : MEMBER_NOTIFICATION_FILTERS;
  const availableKinds = new Set(availableFilters.map(([kind]) => kind));
  const activeKind = availableKinds.has(notificationFilters.kind) ? notificationFilters.kind : "all";
  notificationFilters.kind = activeKind;

  // Keep the existing member boundary even for unknown future admin kinds:
  // malformed categories fall back safely without exposing operational rows.
  const visibleRows = rows.filter((notification) => {
    const kind = typeof notification?.kind === "string" ? notification.kind.trim() : "";
    return !notification?.read_at && (admin || !kind.startsWith("admin_"));
  }).sort((a, b) => {
    const aTime = Date.parse(a?.created_at);
    const bTime = Date.parse(b?.created_at);
    return (Number.isFinite(bTime) ? bTime : -Infinity) - (Number.isFinite(aTime) ? aTime : -Infinity);
  });
  const filteredRows = activeKind === "all"
    ? visibleRows
    : visibleRows.filter((notification) => notificationCategory(notification?.kind) === activeKind);

  const notificationRow = (notification) => {
    const unread = !notification?.read_at;
    const kind = typeof notification?.kind === "string" ? notification.kind.trim() : "";
    const category = notificationCategory(kind);
    const relativeTime = notificationRelativeTime(notification?.created_at, now);
    const exactTime = notificationHktTime(notification?.created_at);
    const time = relativeTime && exactTime
      ? `<span>${esc(relativeTime)}</span><span>${esc(exactTime)}</span>`
      : `<span>Time unavailable</span>`;
    return `
      <button class="notification-row${unread ? " unread" : ""}" type="button"
        data-action="notification-open"
        data-notification-id="${esc(notification?.id)}"
        data-notification-read="${unread ? "false" : "true"}"
        data-destination="${esc(notificationDestination(kind, notification?.destination))}">
        <span class="notification-unread" ${unread ? `aria-label="Unread"` : `aria-hidden="true"`}></span>
        <span class="notification-copy">
          <span class="notification-kind-badge">${esc(NOTIFICATION_CATEGORY_LABELS[category])}</span>
          <strong>${esc(notification?.title)}</strong>
          <span>${esc(notification?.body)}</span>
        </span>
        <span class="notification-time">${time}</span>
      </button>`;
  };

  const activeLabel = availableFilters.find(([kind]) => kind === activeKind)?.[1] || "All";
  const emptyCopy = activeKind === "all" ? "No any notifications." : `No ${activeLabel} notifications.`;
  const filterButtons = availableFilters.map(([kind, label]) => `
    <button type="button" data-action="notification-filter" data-notification-filter="${kind}"
      aria-pressed="${kind === activeKind ? "true" : "false"}">${esc(label)}</button>`).join("");

  return `
    <header class="notification-header">
      <p class="kicker">Inbox</p>
      <h1 class="display sm">Notifications</h1>
    </header>
    <div class="notification-filter-scroll">
      <div class="notification-filter-chips" role="group" aria-label="Filter notifications">${filterButtons}</div>
    </div>
    ${filteredRows.length
      ? `<section class="card notification-section" aria-label="${esc(activeLabel)} notifications">
          <div class="card-body">
            <div class="notification-list">${filteredRows.map(notificationRow).join("")}</div>
          </div>
        </section>`
      : `<p class="notification-empty">${esc(emptyCopy)}</p>`}`;
}
