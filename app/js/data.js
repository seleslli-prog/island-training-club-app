// ==========================================================================
// ITC prototype — seed data and pure helpers.
// No DOM access in this module; safe to unit-test in isolation.
// ==========================================================================

// Photo paths are relative to /app/index.html.
const PH = "../assets/itc/";

export const ISLAND_ECC_HYROX_ACTIVITY_IDS = new Set([
  "hyrox-quarry-bay-early",
  "hyrox-quarry-bay",
]);

// --- Activity templates ----------------------------------------------------
// kind: "free"  -> no booking required; optional RSVP; no capacity or checkout
// kind: "paid"  -> members book + pay per session at a fixed price
// HYROX capacity is a seeded placeholder; price, time and capacity are all
// editable in the Admin area.

export const SEED_ACTIVITIES = [
  {
    id: "wnt",
    name: "Wednesday Night Training",
    kind: "free",
    requiresRsvp: true,
    category: "Strength",
    weekday: 3, // Wednesday
    time: "19:30",
    durationMin: 60,
    location: "TBC",
    mapsQuery: "", // venue to be confirmed — no directions link until set
    photo: PH + "main.webp",
    blurb:
      "Our flagship all-level session. Structured strength and conditioning led by the community — come ready to move and we scale every workout to you.",
    memberNote: "Meeting point to be confirmed — check back before Wednesday. Bring water.",
    price: 0,
    capacity: null,
    published: true,
  },
  {
    id: "run",
    name: "ITC Run Club",
    kind: "free",
    requiresRsvp: true,
    category: "Run",
    weekday: 1, // Monday
    time: "19:30",
    durationMin: 45,
    location: "TBC",
    mapsQuery: "", // venue to be confirmed — no directions link until set
    photo: PH + "running.webp",
    blurb:
      "Easy-pace social run along the harbour. All paces welcome — nobody gets left behind.",
    memberNote: "Bag drop with a leader at the start point.",
    price: 0,
    capacity: null,
    published: true,
  },
  {
    id: "water",
    name: "ITC Swimming",
    kind: "free",
    requiresRsvp: true,
    category: "Water",
    weekday: 2, // Tuesday
    time: "19:30",
    durationMin: 90,
    location: "TBC",
    mapsQuery: "",
    photo: PH + "water.webp",
    blurb:
      "Community water session — skills, games and a good workout. Kit is provided, just bring a towel.",
    memberNote: "Changing facilities on site. Arrive 15 minutes early.",
    price: 0,
    capacity: null,
    published: true,
  },
  {
    id: "hyrox-quarry-bay-early",
    name: "ITC HYROX",
    kind: "paid",
    category: "HYROX",
    weekday: 6, // Saturday
    time: "09:15",
    durationMin: 60,
    location: "10/F, Island ECC, Quarry Bay",
    mapsQuery: "Island ECC, Quarry Bay, Hong Kong",
    photo: PH + "hyrox.webp",
    blurb:
      "Weekly hybrid race training: ski, sled, burpees and running intervals. Every session is purchased separately at one fixed price.",
    memberNote: "Gym entry fee is included in the session price.",
    price: 180, // HKD
    capacity: 30,
    published: true,
  },
  {
    id: "hyrox-quarry-bay",
    name: "ITC HYROX",
    kind: "paid",
    category: "HYROX",
    weekday: 6, // Saturday
    time: "10:30",
    durationMin: 60,
    location: "10/F, Island ECC, Quarry Bay",
    mapsQuery: "Island ECC, Quarry Bay, Hong Kong",
    photo: PH + "hyrox.webp",
    blurb:
      "Weekly hybrid race training: ski, sled, burpees and running intervals. Every session is purchased separately at one fixed price.",
    memberNote: "Gym entry fee is included in the session price.",
    price: 180, // HKD
    capacity: 30,
    published: true,
  },
  {
    id: "lunch",
    name: "Post-Training Lunch",
    kind: "rsvp",
    category: "Socials",
    weekday: 6, // Saturday — follows the morning HYROX sessions
    time: "12:45",
    durationMin: 75,
    location: "TBC",
    mapsQuery: "", // venue set per week by admins (weekly venue override)
    photo: PH + "community.webp",
    blurb:
      "The other half of Saturday: refuel together after training. Everyone pays their own bill — tap Count me in so the organizer can book a table.",
    memberNote: "Venue is posted in the session note once the table is booked.",
    price: 0,
    capacity: null, // unlimited — the organizer books a table from the RSVP list
    published: true,
  },
];

export const ANNOUNCEMENTS = [
  {
    id: "ann-itc-turns-2",
    title: "Island Training Club turns 2",
    postedAt: new Date(2026, 7, 6, 12).getTime(),
    lead: "Today, August 6, 2026 marks 2 years of Island Training Club.",
    milestones: [
      { value: "620", label: "members strong" },
      { value: "14", label: "committed leaders" },
      { value: "1", label: "unwavering vision" },
      { value: "1", label: "clear mission" },
      { value: "1", label: "God who made this all possible" },
    ],
    body: "On behalf of the ITC Leadership and Coaching Team, we are blessed to share this journey with you! We should all be proud of how far we've come and look forward to much more 👊",
    commitment: "We will continue our commitment to serve our God and this community, doing our best to create and maintain a space where you grow in fitness, friendship, community and faith.",
  },
];

// --- Leaders & culture (draft community content) ------------------------------
// --- Leaders & culture (draft community content) ------------------------------

export const LEADERS = [
  {
    name: "Arnold Wong",
    role: "Founder · Head Coach",
    photo: PH + "community.webp",
    bio: "Started ITC so training in Hong Kong could be serious about fitness and serious about people at the same time.",
  },
  {
    name: "Tina",
    role: "Community Lead",
    photo: PH + "main.webp",
    bio: "Keeps Wednesday nights running and makes sure every first-timer leaves with a name and a next session.",
  },
  {
    name: "CM Chui",
    role: "Run Club Lead",
    photo: PH + "running.webp",
    bio: "Leads Monday harbour runs. Believes the best pace is the one you can talk at.",
  },
];

export const CULTURE = [
  {
    title: "Our foundation",
    body: "Island Training Club is built on a Christian foundation. We train hard, look out for each other, and welcome everyone — whatever you believe and however fit you are today.",
  },
  {
    title: "Purpose",
    body: "We exist to make Hong Kong healthier together: consistent training, real friendship, and a community that shows up for each other on and off the park.",
  },
  {
    title: "Values",
    body: "Everyone welcome · Show up for each other · Effort over ego · Leave the park better than we found it.",
  },
  {
    title: "Safety",
    body: "Sessions may be volunteer-led and involve physical activity. Work within your own limits, tell a leader about anything we should know, and consult a healthcare professional when appropriate. Participants aged 17 or under need a parent or guardian present.",
  },
  {
    title: "Community guidelines",
    body: "Be welcoming to first-timers. Respect leaders, venues and each other. No harassment, no exclusion, no hard sell. Photos are opt-in — consent is asked, never assumed.",
  },
];

// ============================================================================
// Pure helpers
// ============================================================================

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad(n) {
  return String(n).padStart(2, "0");
}

const HKT_OFFSET_MS = 8 * 60 * 60 * 1000;

export function todayHktISO(now = Date.now()) {
  const instant = now instanceof Date ? now.getTime() : Number(now);
  return new Date(instant + HKT_OFFSET_MS).toISOString().slice(0, 10);
}

export function hktEventStartMs(dateISO, time) {
  const wallTime = String(time || "").trim();
  const normalizedTime = /^\d{2}:\d{2}$/.test(wallTime)
    ? `${wallTime}:00`
    : wallTime;
  return Date.parse(`${dateISO}T${normalizedTime}+08:00`);
}

export function todayLocal() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(date, n) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

export function mondayOf(date) {
  const d = new Date(date.getTime());
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  return addDays(d, -offset);
}

export function sundayOf(date) {
  return addDays(new Date(date.getTime()), -date.getDay());
}

function saturdayOnOrBefore(date) {
  const d = new Date(date.getTime());
  const offset = (d.getDay() + 1) % 7; // days since Saturday
  return addDays(d, -offset);
}

export function saturdayOnOrAfter(date) {
  const d = saturdayOnOrBefore(date);
  return isoDate(d) === isoDate(date) ? d : addDays(d, 7);
}

export function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function fmtDate(d) {
  const date = d instanceof Date ? d : parseISO(d);
  return `${DAY_NAMES[date.getDay()]} · ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
}

export function fmtDateLong(d) {
  const date = d instanceof Date ? d : parseISO(d);
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

export function fmtTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${pad(m)} ${suffix}`;
}

export function fmtMoney(hkd) {
  return `HK$${Number(hkd).toLocaleString("en-HK")}`;
}

export function initials(name) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

// Donor IDs come from IECC as LASTNAME-NNNN(N): the member's surname, a
// hyphen, then a 4- or 5-digit number (e.g. CHUI-08879 or CHUI-8879). The
// hyphen is mandatory — anything else is rejected with a re-entry error.
// Blank or "not applicable"-style answers mean "no donor ID" (null) — the
// member can add one later from the Profile tab.
const DONOR_ID_RE = /^[A-Za-z]+-\d{4,5}$/;
const DONOR_ID_NA_RE = /^(n\/?a|not applicable|none|no)$/i;

// Members type these on phones, where autocorrect rewrites "-" as an en/em
// dash (or they hit the spacebar instead). Canonicalize any dash/space
// separator to a plain hyphen so the stored ID always reads LASTNAME-NNNN(N).
function canonicalDonorId(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/[‐-―_]/g, "-") // unicode dashes, underscore -> hyphen
    .replace(/\s*-\s*/g, "-") // tidy spaces around a hyphen
    .replace(/^([A-Za-z]+)\s+(\d{4,5})$/, "$1-$2") // space as the separator
    .toUpperCase();
}

export function normalizeDonorId(raw) {
  const v = canonicalDonorId(raw);
  if (!v || DONOR_ID_NA_RE.test(v)) return null;
  return v;
}

// Returns "format" when a non-blank, non-N/A value isn't a valid donor ID,
// null otherwise — forms use this to reject typos before anything is saved.
export function donorIdProblem(raw) {
  const v = canonicalDonorId(raw);
  if (!v || DONOR_ID_NA_RE.test(v)) return null;
  return DONOR_ID_RE.test(v) ? null : "format";
}

// --- Sessions -----------------------------------------------------------------
// A session is a dated instance of an activity template, generated on demand
// with a deterministic id (`${activityId}-${YYYY-MM-DD}`) so bookings survive
// reloads.

export function compareSessionsByStart(a, b) {
  return String(a?.dateISO || "").localeCompare(String(b?.dateISO || ""))
    || String(a?.time || "").localeCompare(String(b?.time || ""))
    || String(a?.id || "").localeCompare(String(b?.id || ""));
}

// Recurring activity templates have a weekday (0=Sun … 6=Sat) and clock time,
// but no dated occurrence. Sort week-day first, then start time, then id.
export function compareActivitiesByWeekday(a, b) {
  return (Number(a?.weekday) || 0) - (Number(b?.weekday) || 0)
    || String(a?.time || "").localeCompare(String(b?.time || ""))
    || String(a?.id || "").localeCompare(String(b?.id || ""));
}

export function sessionsInRange(activities, fromDate, days) {
  const out = [];
  const from = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    for (const act of activities) {
      if (!act.published) continue;
      if (date.getDay() !== act.weekday) continue;
      out.push({
        ...act,
        id: `${act.id}-${isoDate(date)}`,
        activityId: act.id,
        dateISO: isoDate(date),
        date,
      });
    }
  }
  return out.sort(compareSessionsByStart);
}

// A session counts as past once its start time has passed — a date-only
// check would keep this morning's session "upcoming" (and bookable) all day.
// Works for live sessions and booking snapshots (both carry dateISO + time).
export function sessionStarted(s) {
  return hktEventStartMs(s.dateISO, s.time) <= Date.now();
}

export function findSession(activities, sessionId) {
  // sessionId = `${activityId}-${YYYY-MM-DD}`; split off the date part
  const match = sessionId.match(/^(.*)-(\d{4}-\d{2}-\d{2})$/);
  if (!match) return null;
  const [, activityId, dateISO] = match;
  const act = activities.find((a) => a.id === activityId);
  if (!act) return null;

  const date = parseISO(dateISO);
  return { ...act, id: sessionId, activityId, dateISO, date };
}

// --- Payment checkpoints ---------------------------------------------------
// The collector's week: unpaid reservations expire at Thursday 6:00 PM;
// promotions after that get until Friday 2:00 PM (when the collector
// finalizes with the gym); last-minute spots get a 2-hour window.

export function mainDeadlineFor(dateISO) {
  const d = parseISO(dateISO);
  d.setDate(d.getDate() - 2); // Saturday -> Thursday
  d.setHours(18, 0, 0, 0);
  return d.getTime();
}

export function finalCheckpointFor(dateISO) {
  const d = parseISO(dateISO);
  d.setDate(d.getDate() - 1); // Saturday -> Friday
  d.setHours(14, 0, 0, 0);
  return d.getTime();
}

export const LAST_MINUTE_WINDOW_MS = 2 * 60 * 60 * 1000;

export function nextPayDeadline(dateISO, now = Date.now()) {
  const main = mainDeadlineFor(dateISO);
  if (now < main) return main;
  const fin = finalCheckpointFor(dateISO);
  if (now < fin) return fin;
  return now + LAST_MINUTE_WINDOW_MS;
}

// --- Calendar (.ics) ------------------------------------------------------------

function escapeICS(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/([,;])/g, "\\$1");
}

function formatICSUtc(ms) {
  const date = new Date(ms);
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join("") + "T" + [
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("") + "Z";
}

function foldICSLine(line) {
  const encoder = new TextEncoder();
  const parts = [];
  let part = "";
  let bytes = 0;
  for (const character of line) {
    const characterBytes = encoder.encode(character).length;
    const limit = parts.length ? 74 : 75;
    if (part && bytes + characterBytes > limit) {
      parts.push(part);
      part = "";
      bytes = 0;
    }
    part += character;
    bytes += characterBytes;
  }
  parts.push(part);
  return parts.join("\r\n ");
}

export function buildICS(session) {
  const startMs = hktEventStartMs(session.dateISO, session.time);
  const durationMin = Number(session.durationMin);
  const endMs = startMs + (Number.isFinite(durationMin) ? durationMin : 60) * 60000;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Island Training Club//ITC App//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${session.id}@islandtrainingclub`,
    `DTSTAMP:${formatICSUtc(Date.now())}`,
    `DTSTART:${formatICSUtc(startMs)}`,
    `DTEND:${formatICSUtc(endMs)}`,
    `SUMMARY:${escapeICS(`${session.name} — Island Training Club`)}`,
    `LOCATION:${escapeICS(session.location)}`,
    `DESCRIPTION:${escapeICS(session.blurb)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].map(foldICSLine).join("\r\n") + "\r\n";
}

export function mapsUrl(session) {
  const q = session.mapsQuery || session.location;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

// ============================================================================
// Notifications — deterministic display helpers
// ============================================================================

const notificationDate = (value) => {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const notificationKind = (kind) => typeof kind === "string" ? kind.trim() : "";

const NOTIFICATION_CATEGORIES = new Map([
  ["admin_application_submitted", "application"],
  ["admin_application_approved", "decision"],
  ["admin_application_declined", "decision"],
  ["admin_role_promoted", "role"],
  ["admin_role_demoted", "role"],
  ["admin_membership_revoked", "role"],
  // Retain a stable category for notifications created before transition-
  // specific role kinds were introduced.
  ["admin_role_changed", "role"],
  ["giving_campaign_published", "club"],
  ["operational_session_venue_updated", "club"],
  ["community_announcement_published", "club"],
  ["community_announcement_audit", "club"],
]);

export function notificationCategory(kind) {
  return NOTIFICATION_CATEGORIES.get(notificationKind(kind)) || "personal";
}

export function notificationRelativeTime(value, now = new Date()) {
  const createdAt = notificationDate(value);
  const currentTime = notificationDate(now);
  if (!createdAt || !currentTime) return "";
  const seconds = Math.max(0, Math.floor((currentTime - createdAt) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (hours < 48) return "Yesterday";
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

export function notificationHktTime(value) {
  const date = notificationDate(value);
  if (!date) return "";
  const formatted = new Intl.DateTimeFormat("en-HK", {
    timeZone: "Asia/Hong_Kong",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${formatted.replace(/\b(am|pm)\b/i, (period) => period.toUpperCase())} HKT`;
}

/** Kinds eligible for web push when applications.web_push_ops is on (live delivery). */
export const WEB_PUSH_OPS_KINDS = Object.freeze([
  "operational_booking_reserved",
  "operational_rsvp_confirmed",
  "operational_payment_approved",
  "operational_session_deferred",
  "operational_session_cancelled",
  "operational_session_cancelled_no_defer",
  "operational_session_venue_updated",
  "community_announcement_published",
]);

const NOTIFICATION_DESTINATIONS = new Map([
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
  ["community_announcement_published", "#/community/announcements"],
  ["community_announcement_audit", "#/community/announcements"],
  ["welcome", "#/account"],
]);

export function notificationDestination(kind, destination = null) {
  if (typeof destination === "string" && destination.startsWith("#/")) return destination;
  return NOTIFICATION_DESTINATIONS.get(notificationKind(kind)) || "#/account";
}

// --- Weekly encouragement verse ------------------------------------------
// Used by the Home page to display a deterministic weekly verse. The same
// week shows the same verse across every browser and visitor; the verse
// rotates on Sunday in Hong Kong local time.

export const WEEKLY_VERSES = [
  {
    ref: "Hebrews 12:1",
    text: "Let us run with perseverance the race marked out for us.",
  },
  {
    ref: "Isaiah 40:31",
    text: "Those who hope in the Lord will renew their strength; they will run and not grow weary.",
  },
  {
    ref: "1 Corinthians 9:24",
    text: "Run in such a way as to get the prize.",
  },
  {
    ref: "Philippians 4:13",
    text: "I can do all this through him who gives me strength.",
  },
  {
    ref: "Joshua 1:9",
    text: "Be strong and courageous — the Lord your God will be with you wherever you go.",
  },
  {
    ref: "Colossians 3:23",
    text: "Whatever you do, work at it with all your heart, as working for the Lord.",
  },
  {
    ref: "Galatians 6:9",
    text: "Let us not become weary in doing good, for at the proper time we will reap a harvest if we do not give up.",
  },
  {
    ref: "2 Timothy 4:7",
    text: "I have fought the good fight, I have finished the race, I have kept the faith.",
  },
];

const CALENDAR_DAY_MS = 24 * 60 * 60 * 1000;
const VERSE_EPOCH_DAY = Date.UTC(2026, 6, 26) / CALENDAR_DAY_MS;
const HKT_DATE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Hong_Kong",
  calendar: "gregory",
  numberingSystem: "latn",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

function hktCalendarDay(date) {
  const parts = Object.fromEntries(
    HKT_DATE_PARTS.formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)])
  );
  return Date.UTC(parts.year, parts.month - 1, parts.day) / CALENDAR_DAY_MS;
}

export function weeklyVerse(date = new Date()) {
  const weeks = Math.floor((hktCalendarDay(date) - VERSE_EPOCH_DAY) / 7);
  const n = WEEKLY_VERSES.length;
  return WEEKLY_VERSES[((weeks % n) + n) % n];
}
