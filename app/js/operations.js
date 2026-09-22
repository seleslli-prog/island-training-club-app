// ==========================================================================
// ITC prototype — live operational cache + RPC adapters.
//
// In live mode, every operational state read passes through the in-memory
// cache populated by `hydrateOperationalState()`. Mutations are routed to
// Supabase SECURITY DEFINER RPCs through `runOperationalRpc()`. The cache
// is reconciled both on RPC success and via Realtime events.
//
// No live fallback: when a Supabase call fails, the cache is left untouched
// and the surface stays read-only. Callers must surface the error and stop
// any local mutation that would otherwise mask the failure.
// ==========================================================================

import { SEED_ACTIVITIES } from "./data.js";
import { isLive, supabase } from "./config.js";
import { normalizeMeetingPoint } from "./venue.js";
import { activeBookingRowsForSession, heldBookingRowsForSession } from "./events-workflow.js";
import { hyroxQueueGroups } from "./hyrox-workflow.js";

const LIVE_TABLES = [
  "operational_sessions",
  "operational_bookings",
  "operational_queue_entries",
  "operational_receipts",
  "collector_assignments",
  "collector_payout_profiles",
  "operational_session_venue_overrides",
  "operational_rsvp_counts",
  "operational_hyrox_cycles",
  "operational_hyrox_queue_entries",
  "operational_booking_replacement_requests",
  "operational_booking_replacement_audit",
];

const cutoverMarker = "itc.live.operations.backend.v1";

const ACTIVITY_PRESENTATION = new Map(
  SEED_ACTIVITIES.map((activity) => [activity.id, activity])
);
const FREE_PRESENTATION_ACTIVITY_IDS = new Set(
  SEED_ACTIVITIES
    .filter((activity) => activity.kind === "free")
    .map((activity) => activity.id)
);

const liveCache = {
  sessions: new Map(),
  templates: [],
  bookings: [],
  queues: [],
  receipts: [],
  assignments: new Map(),
  payout: new Map(),
  venueOverrides: new Map(),
  rsvpCounts: new Map(),
  hyroxCycles: new Map(),
  hyroxQueues: [],
  replacementRequests: [],
  rsvpCountError: null,
  loaded: false,
  loading: null,
  error: null,
  payoutError: null,
  updatedAt: 0,
};

const listeners = new Set();
let subscription = null;
let scheduleSubscription = null;
let hyroxSubscription = null;

function notifyListeners() {
  for (const fn of listeners) {
    try { fn(); } catch (err) { console.warn("operations listener failed", err); }
  }
}

function buildTemplateRow(row) {
  return {
    activity_id: row.activity_id,
    name: row.name,
    venue: row.venue,
    weekday: row.weekday,
    start_time: String(row.start_time || "").slice(0, 5),
    duration_minutes: row.duration_minutes,
    capacity: row.capacity,
    price_hkd: row.price_hkd,
    default_open: row.default_open,
    active: row.active,
    category: row.category || null,
    maps_query: row.maps_query || null,
    requires_rsvp: !!row.requires_rsvp,
  };
}

function buildHyroxCycleRow(row) {
  return {
    id: row.id,
    dateISO: String(row.session_date).slice(0, 10),
    bftSessionId: row.bft_session_id,
    midtownSessionId: row.midtown_session_id,
    registrationState: row.registration_state,
    venuePlan: row.venue_plan,
    capacity: row.registration_capacity,
    paymentDeadlineAt: parseTimestamp(row.payment_deadline_at),
    venueChoiceDeadlineAt: parseTimestamp(row.venue_choice_deadline_at),
    registrationOpensAt: parseTimestamp(row.registration_opens_at),
    holderGraceDeadlineAt: parseTimestamp(row.holder_grace_deadline_at),
    promotedPaymentDeadlineAt: parseTimestamp(row.promoted_payment_deadline_at),
    capacityWarningSentAt: parseTimestamp(row.capacity_warning_sent_at),
    paymentReminderSentAt: parseTimestamp(row.payment_reminder_sent_at),
    collectorPaymentReminderSentAt: parseTimestamp(row.collector_payment_reminder_sent_at),
    venueChoiceReminderSentAt: parseTimestamp(row.venue_choice_reminder_sent_at),
    venueFinalizationReminderSentAt: parseTimestamp(row.venue_finalization_reminder_sent_at),
    holderGraceStartedAt: parseTimestamp(row.holder_grace_started_at),
    waitlistPromotedAt: parseTimestamp(row.waitlist_promoted_at),
    reconciliationStartedAt: parseTimestamp(row.reconciliation_started_at),
    openedAt: parseTimestamp(row.opened_at),
    planConfirmedAt: parseTimestamp(row.plan_confirmed_at),
    planConfirmedBy: row.plan_confirmed_by,
    planConfirmedSource: row.plan_confirmed_source || null,
    allocationClosedAt: parseTimestamp(row.allocation_closed_at),
    cancelledAt: parseTimestamp(row.cancelled_at),
    cancelReason: row.cancel_reason || null,
  };
}

function buildHyroxQueueRow(row) {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    userId: row.profile_id,
    kind: row.kind,
    targetSessionId: row.target_session_id || null,
    venuePreference: row.venue_preference || null,
    fallbackAcknowledgedAt: parseTimestamp(row.fallback_acknowledged_at),
    status: row.status,
    joinedAt: parseTimestamp(row.joined_at),
    resolvedAt: parseTimestamp(row.resolved_at),
  };
}

function buildSessionRow(row, templatesById = null) {
  const dateISO = typeof row.session_date === "string"
    ? row.session_date.slice(0, 10)
    : new Date(row.session_date).toISOString().slice(0, 10);
  const date = new Date(`${dateISO}T00:00:00`);
  const metadata = ACTIVITY_PRESENTATION.get(row.activity_id);
  const template = templatesById?.get(row.activity_id) ?? null;
  const oneOff = String(row.activity_id).startsWith("event-");
  const freePresentation = oneOff || FREE_PRESENTATION_ACTIVITY_IDS.has(row.activity_id);
  const legacyMidtown = row.activity_id === "hyrox-midtown"
    && row.venue === "Midtown 28";
  const venue = legacyMidtown
    ? (metadata?.location || row.venue)
    : row.venue;
  const mapsQuery = legacyMidtown
    ? (metadata?.mapsQuery || row.venue)
    : (template?.maps_query || row.venue);
  return {
    id: row.id,
    activityId: row.activity_id,
    // One-off events take their display name/category from their template;
    // the recurring HYROX templates keep the historical labels.
    name: template?.name || "ITC HYROX",
    // RSVP capability is separate from presentation: recurring community
    // sessions and free one-offs stay `free`, while Lunch keeps its dedicated
    // RSVP presentation. Paid sessions retain the reserve/pay pipeline.
    kind: Number(row.price_hkd) > 0
      ? "paid"
      : freePresentation
        ? "free"
        : template?.requires_rsvp ? "rsvp" : "free",
    requiresRsvp: !!template?.requires_rsvp,
    category: template?.category || metadata?.category || (oneOff ? "Other" : "HYROX"),
    weekday: date.getDay(),
    oneOff,
    dateISO,
    date,
    time: String(row.start_time || "").slice(0, 5),
    durationMin: row.duration_minutes,
    location: venue,
    mapsQuery,
    venue,
    photo: metadata?.photo || (oneOff ? "../assets/itc/main.webp" : "../assets/itc/hyrox.webp"),
    blurb: metadata?.blurb || "",
    memberNote: metadata?.memberNote || "",
    capacity: row.capacity,
    price: row.price_hkd,
    isOpen: row.is_open,
    venueTBC: !!row.venue_tbc,
    notice: row.notice || null,
    cancelReason: row.cancel_reason || null,
    cancelled: !!row.cancelled_at,
    cancelledAt: row.cancelled_at || null,
    cancelledBy: row.cancelled_by || null,
    cancelledSource: row.cancelled_source || null,
    gymConfirmedAt: row.gym_confirmed_at || null,
    gymConfirmedBy: row.gym_confirmed_by || null,
    gymNote: row.gym_note || null,
    published: true,
  };
}

function parseTimestamp(value) {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function buildReplacementRequestRow(row) {
  if (!row) return null;
  const value = Array.isArray(row) ? row[0] : row;
  if (!value) return null;
  const rawSnapshot = value.snapshot || {};
  const snapshot = {
    name: rawSnapshot.name || null,
    dateISO: rawSnapshot.dateISO || rawSnapshot.session_date || null,
    time: rawSnapshot.time || rawSnapshot.start_time || null,
    location: rawSnapshot.location || rawSnapshot.venue || null,
    price: rawSnapshot.price ?? rawSnapshot.price_hkd ?? null,
  };
  return {
    requestId: value.requestId ?? value.request_id ?? null,
    bookingId: value.bookingId ?? value.booking_id ?? null,
    status: value.status || null,
    originalDisplayName: value.originalDisplayName ?? value.original_display_name ?? null,
    replacementDisplayName: value.replacementDisplayName ?? value.replacement_display_name ?? null,
    sessionId: value.sessionId ?? value.session_id ?? null,
    cycleId: value.cycleId ?? value.cycle_id ?? null,
    snapshot: Object.values(snapshot).some((item) => item !== null) ? snapshot : null,
    createdAt: parseTimestamp(value.createdAt ?? value.created_at),
    expiresAt: parseTimestamp(value.expiresAt ?? value.expires_at),
    acceptedAt: parseTimestamp(value.acceptedAt ?? value.accepted_at),
    declinedAt: parseTimestamp(value.declinedAt ?? value.declined_at),
    cancelledAt: parseTimestamp(value.cancelledAt ?? value.cancelled_at),
    rejectedAt: parseTimestamp(value.rejectedAt ?? value.rejected_at),
    confirmedAt: parseTimestamp(value.confirmedAt ?? value.confirmed_at),
    decisionReason: value.decisionReason ?? value.decision_reason ?? null,
  };
}

function cacheReplacementRequest(row) {
  const request = buildReplacementRequestRow(row);
  if (!request?.requestId) return request;
  const index = liveCache.replacementRequests.findIndex((item) => item.requestId === request.requestId);
  if (index >= 0) liveCache.replacementRequests[index] = request;
  else liveCache.replacementRequests.push(request);
  return request;
}

function buildBookingRow(row, sessionsById = null) {
  const snapshot = row.snapshot || {};
  const session = sessionsById?.get(row.session_id) || null;
  const rawDateISO = snapshot.session_date || snapshot.dateISO || session?.dateISO || null;
  const dateISO = rawDateISO ? String(rawDateISO).slice(0, 10) : null;
  const snapshotTime = snapshot.start_time || snapshot.time || session?.time || null;
  return {
    id: row.id,
    userId: row.profile_id,
    sessionId: row.session_id,
    status: row.status,
    createdAt: parseTimestamp(row.created_at),
    reservedAt: parseTimestamp(row.reserved_at),
    payDeadlineAt: parseTimestamp(row.pay_deadline_at),
    paymentMarkedAt: parseTimestamp(row.payment_marked_at),
    paidMethod: row.payment_method ? String(row.payment_method).toUpperCase() : null,
    paymentRef: row.payment_reference || null,
    paidAt: parseTimestamp(row.paid_at),
    confirmedBy: row.confirmed_by || null,
    deferredFrom: row.deferred_from_booking_id || null,
    deferredTo: row.deferred_to_booking_id || null,
    cycleId: row.hyrox_cycle_id || null,
    venuePreference: row.venue_preference || null,
    fallbackAcknowledgedAt: parseTimestamp(row.fallback_acknowledged_at),
    promotedFromWaitlistAt: parseTimestamp(row.promoted_from_waitlist_at),
    allocationState: row.allocation_state || null,
    allocationSource: row.allocation_source || null,
    allocatedAt: parseTimestamp(row.allocated_at),
    allocationSnapshot: row.allocation_snapshot || null,
    paymentRejectedAt: parseTimestamp(row.payment_rejected_at),
    paymentRejectedBy: row.payment_rejected_by || null,
    paymentRejectionReason: row.payment_rejection_reason || null,
    attendedAt: parseTimestamp(row.attended_at),
    attendedBy: row.attended_by || null,
    replacementUserId: row.replacement_profile_id || null,
    replacementConfirmedAt: parseTimestamp(row.replacement_confirmed_at),
    replacementConfirmedBy: row.replacement_confirmed_by || null,
    snapshot: {
      ...snapshot,
      price: snapshot.price_hkd ?? snapshot.price ?? session?.price ?? null,
      location: snapshot.venue || snapshot.location || session?.location || null,
      name: snapshot.name || session?.name
        || (snapshot.activity_id === "hyrox-midtown" ? "ITC HYROX" : "ITC HYROX"),
      // DB snapshots store start_time ("HH:MM:SS"); the UI expects time
      // ("HH:MM"). Map it or use the authoritative session.
      time: snapshotTime ? String(snapshotTime).slice(0, 5) : null,
      durationMin: snapshot.duration_min ?? snapshot.durationMin ?? session?.durationMin ?? null,
      kind: snapshot.kind ?? session?.kind ?? "paid",
      dateISO,
    },
    dateISO,
  };
}

function buildQueueRow(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.profile_id,
    kind: row.kind,
    status: row.status,
    joinedAt: Date.parse(row.joined_at) || Date.now(),
    resolvedAt: row.resolved_at ? Date.parse(row.resolved_at) : null,
  };
}

function buildReceiptRow(row) {
  return {
    id: row.id,
    number: row.receipt_number,
    bookingId: row.booking_id,
    userId: row.profile_id,
    sessionId: row.session_id,
    amount: row.amount_hkd,
    currency: row.currency,
    method: String(row.payment_method || "").toUpperCase(),
    status: row.status,
    issuedAt: Date.parse(row.issued_at) || Date.now(),
    cycleId: row.hyrox_cycle_id || null,
    line: row.session_id ? `ITC HYROX — ${row.session_id}` : "ITC HYROX",
  };
}

function buildAssignmentRow(row) {
  const saturdayISO = typeof row.week_start === "string"
    ? row.week_start.slice(0, 10)
    : new Date(row.week_start).toISOString().slice(0, 10);
  return {
    saturdayISO,
    userId: row.collector_profile_id,
    setAt: Date.parse(row.assigned_at) || Date.now(),
  };
}

function buildPayoutRow(row) {
  return {
    profileId: row.profile_id,
    paymeLink: row.payme_link || null,
    fpsPhone: row.fps_phone || null,
    ...(row.full_name ? { fullName: row.full_name } : {}),
    ...(row.preferred_name ? { preferredName: row.preferred_name } : {}),
  };
}

function buildVenueOverrideRow(row) {
  const point = normalizeMeetingPoint(row.meeting_lat, row.meeting_lng);
  return {
    sessionId: row.session_id,
    activityId: row.activity_id,
    location: row.location || null,
    mapsQuery: row.maps_query || null,
    meetingLat: point?.lat ?? null,
    meetingLng: point?.lng ?? null,
    setBy: row.set_by || null,
    setAt: row.set_at ? Date.parse(row.set_at) : null,
    memberNotifiedAt: row.member_notified_at ? Date.parse(row.member_notified_at) : null,
  };
}

function replaceState(payload) {
  liveCache.sessions = new Map(payload.sessions.map((row) => [row.id, row]));
  liveCache.hyroxCycles = new Map(
    (payload.hyroxCycles || []).map((row) => [row.id, row])
  );
  liveCache.hyroxQueues = payload.hyroxQueues || [];
  if (payload.replacementRequests) {
    liveCache.replacementRequests = payload.replacementRequests
      .map(buildReplacementRequestRow).filter(Boolean);
  }
  liveCache.templates = payload.templates || [];
  liveCache.bookings = payload.bookings;
  liveCache.queues = payload.queues;
  liveCache.receipts = payload.receipts;
  liveCache.assignments = new Map(
    payload.assignments.map((row) => [row.saturdayISO, row])
  );
  liveCache.payout = new Map(
    payload.payouts.map((row) => [row.profileId, row])
  );
  liveCache.venueOverrides = new Map(
    (payload.venueOverrides || []).map((row) => [row.sessionId, row])
  );
  liveCache.rsvpCounts = new Map();
  liveCache.rsvpCountError = payload.rsvpCountError || null;
  if (!liveCache.rsvpCountError) {
    for (const session of payload.sessions) {
      if (session.requiresRsvp) liveCache.rsvpCounts.set(session.id, 0);
    }
    for (const row of payload.rsvpCounts || []) {
      const count = Number(row.going_count);
      if (row.session_id && Number.isInteger(count) && count >= 0) {
        liveCache.rsvpCounts.set(row.session_id, count);
      }
    }
  }
  liveCache.loaded = true;
  liveCache.error = null;
  liveCache.payoutError = payload.payoutError || null;
  liveCache.updatedAt = Date.now();
}

function operationalProblem(error) {
  if (!error) return new Error("Unable to save — try again.");
  const message = String(error.message || error);
  if (error.code === "PGRST202" && message.includes("operational_replacement")) {
    return new Error("Replacement setup is temporarily unavailable. Please contact ITC.");
  }
  if (message.includes("Session is cancelled")) return new Error("Session is cancelled.");
  if (message.includes("Session is full")) return new Error("Session is full.");
  if (message.includes("Session is not open")) return new Error("Session is not open.");
  if (message.includes("Already booked")) return new Error("Already booked.");
  if (message.includes("Approved membership required")) return new Error("Approved membership required.");
  if (message.includes("Not authorized for this booking")) return new Error("Not authorized for this booking.");
  if (message.includes("Not authorized for this queue entry")) return new Error("Not authorized for this queue entry.");
  if (message.includes("Not authorized for this payout profile")) return new Error("Not authorized for this payout profile.");
  if (message.includes("Administrator access required")) return new Error("Admin access required.");
  if (message.includes("Cancellation reason is required")) return new Error("Cancellation reason is required.");
  if (message.includes("Payment has not been marked")) return new Error("Payment has not been marked.");
  if (message.includes("Payment has already been marked")) return new Error("Payment has already been marked.");
  if (message.includes("Payment has already been processed")) return new Error("Payment has already been processed.");
  if (message.includes("Booking is not awaiting approval")) return new Error("Booking is not awaiting approval.");
  if (message.includes("Only confirmed bookings can be deferred")) return new Error("Only confirmed bookings can be deferred.");
  if (message.includes("Target must be a session of the same activity")) return new Error("Target must be a session of the same activity.");
  if (message.includes("Target must be later than the current session")) return new Error("Target must be later than the current session.");
  if (message.includes("Target session is full")) return new Error("Target session is full.");
  if (message.includes("Session has already started")) return new Error("Session has already started.");
  if (message.includes("Session is already cancelled")) return new Error("Session is already cancelled.");
  if (message.includes("Gym confirmation has already been recorded")) return new Error("Gym confirmation has already been recorded.");
  if (message.includes("Session not found")) return new Error("Session not found.");
  if (message.includes("Booking not found")) return new Error("Booking not found.");
  if (message.includes("Queue entry not found")) return new Error("Queue entry not found.");
  if (message.includes("Authentication required")) return new Error("Authentication required.");
  if (message.includes("Choose BFT, Midtown, or Either")) return new Error("Choose BFT, Midtown, or Either.");
  if (message.includes("Fallback acknowledgement is required")) return new Error("Fallback acknowledgement is required.");
  if (message.includes("HYROX cycle not found")) return new Error("HYROX cycle not found.");
  if (message.includes("This HYROX cycle is cancelled")) return new Error("This HYROX cycle is cancelled.");
  if (message.includes("HYROX registration opens Monday")) return new Error("HYROX registration opens Monday at 6 PM HKT.");
  if (message.includes("HYROX registration is closed")) return new Error("HYROX registration is closed.");
  if (message.includes("HYROX registration is full")) return new Error("HYROX registration is full. Join the weekly waitlist.");
  if (message.includes("You already joined this HYROX registration")) return new Error("You already joined this HYROX registration.");
  if (message.includes("You already have a HYROX booking for this Saturday")) return new Error("You already have a HYROX booking for this Saturday.");
  if (message.includes("HYROX places are still available")) return new Error("HYROX places are still available.");
  if (message.includes("HYROX queue entry not found")) return new Error("HYROX queue entry not found.");
  if (message.includes("Queue entry is no longer active")) return new Error("Queue entry is no longer active.");
  if (message.includes("Use the weekly HYROX registration")) return new Error("Use the weekly HYROX registration.");
  if (message.includes("Payment rejection reason is required")) return new Error("Payment rejection reason is required.");
  if (message.includes("Booking has no pending payment claim")) return new Error("Booking has no pending payment claim.");
  if (message.includes("Venue changes are available only when both gyms open")) return new Error("Venue changes are available only when both gyms open.");
  if (message.includes("Booking allocation is not changeable")) return new Error("Booking allocation is not changeable.");
  if (message.includes("Venue changes closed Friday at 9 PM HKT")) return new Error("Venue changes closed Friday at 9 PM HKT.");
  if (message.includes("Venue changes close Friday at 9 PM HKT")) return new Error("Venue changes close Friday at 9 PM HKT.");
  if (message.includes("Target venue is not part of this HYROX cycle")) return new Error("Target venue is not part of this HYROX cycle.");
  if (message.includes("Target venue is full")) return new Error("Target venue is full.");
  if (message.includes("Choose the other venue in this HYROX cycle")) return new Error("Choose the other venue in this HYROX cycle.");
  if (message.includes("You already have an active HYROX queue request")) return new Error("You already have an active HYROX queue request.");
  if (message.includes("Venue-switch request is no longer active")) return new Error("Venue-switch request is no longer active.");
  if (message.includes("HYROX venue plan is not ready")) return new Error("HYROX venue plan is not ready.");
  if (message.includes("HYROX cycle is already cancelled")) return new Error("HYROX cycle is already cancelled.");
  if (message.includes("Cancel the weekly HYROX cycle instead")) return new Error("Cancel the weekly HYROX cycle instead.");
  if (message.includes("Midtown availability is derived from the weekly HYROX plan")) return new Error("Midtown availability is derived from the weekly HYROX plan.");
  if (message.includes("HYROX venue allocation must be closed first")) return new Error("HYROX venue allocation must be closed first.");
  if (message.includes("HYROX child venue is not enabled by the weekly plan")) return new Error("HYROX child venue is not enabled by the weekly plan.");
  if (message.includes("Midtown toggle is only valid")) return new Error("Midtown toggle is only valid for Midtown sessions.");
  if (message.includes("Interest list is only for closed Midtown")) return new Error("Interest list is only for closed Midtown sessions.");
  if (message.includes("Waitlist is only for open sessions")) return new Error("Waitlist is only for open sessions.");
  if (message.includes("Waitlist is only for full sessions")) return new Error("Waitlist is only for full sessions.");
  if (message.includes("Session is not full")) return new Error("Session is not full.");
  if (message.includes("Interest list is only")) return new Error("Interest list is only for closed Midtown sessions.");
  if (message.includes("Activity venue is fixed.")
      || message.includes("replacement invite")
      || message.includes("replacement request")
      || message.includes("replacement")) return new Error(message);
  return new Error(message || "Unable to save — try again.");
}

let hydrationPromise = null;

async function fetchAssignedPayoutRows() {
  try {
    const { data, error } = await supabase.rpc("get_assigned_collector_payout_profiles");
    if (error) return { rows: [], error: operationalProblem(error) };
    return { rows: data || [], error: null };
  } catch (error) {
    return { rows: [], error: operationalProblem(error) };
  }
}

async function fetchRsvpCounts() {
  try {
    const { data, error } = await supabase.rpc("get_operational_rsvp_counts");
    if (error) throw operationalProblem(error);
    return { rows: data || [], error: null };
  } catch (err) {
    return { rows: [], error: operationalProblem(err) };
  }
}

export async function liveScheduleWindow(startISO, endISO, viewerId = null) {
  if (!isLive() || !supabase) {
    return { sessions: [], cycles: [], viewerBookings: [], rsvpCounts: [] };
  }
  const [sessionsResult, cyclesResult] = await Promise.all([
    supabase.from("operational_sessions")
      .select("*")
      .gte("session_date", startISO)
      .lte("session_date", endISO)
      .order("session_date"),
    supabase.from("operational_hyrox_cycles")
      .select("*")
      .gte("session_date", startISO)
      .lte("session_date", endISO)
      .order("session_date"),
  ]);
  if (sessionsResult.error) throw operationalProblem(sessionsResult.error);
  if (cyclesResult.error) throw operationalProblem(cyclesResult.error);

  const sessionRows = sessionsResult.data || [];
  const cycleRows = cyclesResult.data || [];
  const activityIds = [...new Set(sessionRows.map((row) => row.activity_id).filter(Boolean))];
  const templatesResult = activityIds.length
    ? await supabase.from("operational_activity_templates").select("*").in("activity_id", activityIds)
    : { data: [], error: null };
  if (templatesResult.error) throw operationalProblem(templatesResult.error);
  const templatesById = new Map((templatesResult.data || [])
    .map(buildTemplateRow)
    .map((template) => [template.activity_id, template]));
  const sessions = sessionRows.map((row) => buildSessionRow(row, templatesById));
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));

  let viewerBookings = [];
  const heldBookingCounts = {};
  if (viewerId) {
    const sessionIds = sessions.map((session) => session.id);
    const cycleIds = cycleRows.map((row) => row.id);
    const bookingReads = [];
    if (sessionIds.length) {
      bookingReads.push(supabase.from("operational_bookings").select("*").in("session_id", sessionIds));
    }
    if (cycleIds.length) {
      bookingReads.push(supabase.from("operational_bookings").select("*").in("hyrox_cycle_id", cycleIds));
    }
    const bookingResults = await Promise.all(bookingReads);
    for (const result of bookingResults) {
      if (result.error) throw operationalProblem(result.error);
    }
    const bookingRows = new Map();
    for (const result of bookingResults) {
      for (const row of result.data || []) {
        if (row.session_id && ["reserved", "confirmed", "attended"].includes(row.status)) {
          heldBookingCounts[row.session_id] = (heldBookingCounts[row.session_id] || 0) + 1;
        }
        if (row.profile_id === viewerId) bookingRows.set(row.id, row);
      }
    }
    viewerBookings = [...bookingRows.values()].map((row) => buildBookingRow(row, sessionsById));
  }

  const rsvpCounts = await fetchRsvpCounts();
  return {
    sessions,
    cycles: cycleRows.map(buildHyroxCycleRow),
    viewerBookings,
    heldBookingCounts,
    rsvpCounts: rsvpCounts.rows.filter((row) => sessionsById.has(row.session_id)),
  };
}

async function fetchOperationalState({ authenticated } = {}) {
  if (!isLive() || !supabase) return null;
  if (authenticated === undefined) {
    try {
      const { data } = await supabase.auth.getSession();
      authenticated = Boolean(data?.session);
    } catch {
      authenticated = false;
    }
  }
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [
    sessions,
    bookings,
    queues,
    receipts,
    assignments,
    payouts,
    assignedPayouts,
    templates,
    venueOverrides,
    rsvpCounts,
    hyroxCycles,
    hyroxQueues,
  ] = await Promise.all([
    supabase.from("operational_sessions").select("*").gte("session_date", since).order("session_date"),
    supabase.from("operational_bookings").select("*"),
    supabase.from("operational_queue_entries").select("*")
      .or("status.eq.active,status.eq.promoted,status.eq.dissolved")
      .order("joined_at"),
    supabase.from("operational_receipts").select("*").order("issued_at", { ascending: false }),
    supabase.from("collector_assignments").select("*"),
    supabase.from("collector_payout_profiles").select("*"),
    fetchAssignedPayoutRows(),
    supabase.from("operational_activity_templates").select("*").order("activity_id"),
    supabase.from("operational_session_venue_overrides").select("*"),
    fetchRsvpCounts(),
    supabase.from("operational_hyrox_cycles").select("*").order("session_date"),
    authenticated
      ? supabase.from("operational_hyrox_queue_entries").select("*").order("joined_at")
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [
    sessions,
    bookings,
    queues,
    receipts,
    assignments,
    payouts,
    templates,
    venueOverrides,
    hyroxCycles,
    hyroxQueues,
  ]) {
    if (result.error) throw operationalProblem(result.error);
  }
  // Templates hydrate before sessions so one-off event rows (inactive
  // templates) can lend their name, category and maps query to the session.
  const templateRows = (templates.data || []).map(buildTemplateRow);
  const templatesById = new Map(templateRows.map((t) => [t.activity_id, t]));
  const currentSessionRows = sessions.data || [];
  const currentSessionIds = new Set(currentSessionRows.map((row) => row.id));
  const missingSessionIds = [...new Set((bookings.data || [])
    .map((row) => row.session_id)
    .filter((id) => id && !currentSessionIds.has(id)))];
  let historicalSessionRows = [];
  if (missingSessionIds.length) {
    const historicalSessions = await supabase
      .from("operational_sessions")
      .select("*")
      .in("id", missingSessionIds);
    if (historicalSessions.error) throw operationalProblem(historicalSessions.error);
    historicalSessionRows = historicalSessions.data || [];
  }
  // Keep the Schedule horizon query narrow while adding only sessions needed
  // to give a user's historical booking its authoritative display metadata.
  const sessionRowsById = new Map();
  for (const row of [...currentSessionRows, ...historicalSessionRows]) {
    if (!sessionRowsById.has(row.id)) {
      sessionRowsById.set(row.id, buildSessionRow(row, templatesById));
    }
  }
  const sessionRows = [...sessionRowsById.values()];
  const sessionsById = new Map(sessionRows.map((session) => [session.id, session]));
  const payoutRowsByProfile = new Map();
  for (const row of payouts.data || []) payoutRowsByProfile.set(row.profile_id, row);
  // The narrow assigned-collector RPC supplies authoritative applications.mobile;
  // it wins over any duplicated, stale payout-table phone on the same profile.
  for (const row of assignedPayouts.rows) payoutRowsByProfile.set(row.profile_id, row);
  return {
    sessions: sessionRows,
    templates: templateRows,
    hyroxCycles: (hyroxCycles.data || []).map(buildHyroxCycleRow),
    hyroxQueues: (hyroxQueues.data || []).map(buildHyroxQueueRow),
    bookings: (bookings.data || []).map((row) => buildBookingRow(row, sessionsById)),
    queues: (queues.data || []).map(buildQueueRow),
    receipts: (receipts.data || []).map(buildReceiptRow),
    assignments: (assignments.data || []).map(buildAssignmentRow),
    payouts: [...payoutRowsByProfile.values()].map(buildPayoutRow),
    payoutError: assignedPayouts.error,
    venueOverrides: (venueOverrides.data || []).map(buildVenueOverrideRow),
    rsvpCounts: rsvpCounts.rows,
    rsvpCountError: rsvpCounts.error,
  };
}

export async function ensureLiveSessionWindow() {
  if (!isLive() || !supabase) return null;
  const iso = new Date().toISOString().slice(0, 10);
  try {
    const { error } = await supabase.rpc("ensure_operational_sessions", {
      p_start_date: iso,
      p_weeks: 16,
    });
    if (error) throw operationalProblem(error);
    const { error: hyroxError } = await supabase.rpc("ensure_hyrox_cycles", {
      p_start_date: iso,
      p_weeks: 16,
    });
    if (hyroxError) throw operationalProblem(hyroxError);
  } catch (err) {
    console.warn("ensureLiveSessionWindow failed", err);
  }
  return null;
}

export async function hydrateOperationalState({ force = false, authenticated } = {}) {
  if (!isLive() || !supabase) return null;
  if (liveCache.loaded && !force) return liveCache;
  if (hydrationPromise) {
    const pending = hydrationPromise;
    if (!force) return pending;
    try { await pending; } catch {}
    if (hydrationPromise && hydrationPromise !== pending) return hydrationPromise;
    if (hydrationPromise === pending) hydrationPromise = null;
  }
  liveCache.loading = Promise.resolve().then(async () => {
    try {
      const payload = await fetchOperationalState({ authenticated });
      replaceState(payload);
      try { localStorage.setItem(cutoverMarker, "supabase"); } catch {}
      notifyListeners();
      return liveCache;
    } catch (err) {
      liveCache.error = operationalProblem(err);
      notifyListeners();
      throw liveCache.error;
    } finally {
      liveCache.loading = null;
    }
  });
  const pending = liveCache.loading;
  hydrationPromise = pending;
  try {
    return await pending;
  } finally {
    if (hydrationPromise === pending) hydrationPromise = null;
  }
}

export async function refreshOperationalState() {
  if (!isLive() || !supabase) return null;
  return hydrateOperationalState({ force: true });
}

export function subscribeOperationalState(onChange) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function operationalStateStatus() {
  return {
    loading: !!liveCache.loading,
    loaded: liveCache.loaded,
    error: liveCache.error ? String(liveCache.error.message || liveCache.error) : null,
    payoutError: liveCache.payoutError
      ? String(liveCache.payoutError.message || liveCache.payoutError)
      : null,
    rsvpCountError: liveCache.rsvpCountError
      ? String(liveCache.rsvpCountError.message || liveCache.rsvpCountError)
      : null,
    updatedAt: liveCache.updatedAt,
  };
}

export async function startScheduleRealtime(onChange = () => {}) {
  if (!isLive() || !supabase || scheduleSubscription) return scheduleSubscription;
  if (typeof supabase.channel !== "function") return null;
  const channel = supabase.channel("itc-schedule")
    .on("postgres_changes", { event: "*", schema: "public", table: "operational_sessions" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "operational_rsvp_counts" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "operational_activity_templates" }, onChange)
    .subscribe();
  scheduleSubscription = channel;
  return channel;
}

export async function stopScheduleRealtime() {
  if (!scheduleSubscription || !supabase) return;
  try { await supabase.removeChannel(scheduleSubscription); } catch {}
  scheduleSubscription = null;
}

function reconcileHyroxRealtime(table, payload, onChange) {
  const row = payload?.new || payload?.old || null;
  const deleted = payload?.eventType === "DELETE";
  if (table === "operational_hyrox_cycles" && row?.id) {
    if (deleted) liveCache.hyroxCycles.delete(row.id);
    else liveCache.hyroxCycles.set(row.id, buildHyroxCycleRow(row));
  }
  if (table === "operational_hyrox_queue_entries" && row?.id) {
    const index = liveCache.hyroxQueues.findIndex((entry) => entry.id === row.id);
    if (deleted) {
      if (index >= 0) liveCache.hyroxQueues.splice(index, 1);
    } else {
      const next = buildHyroxQueueRow(row);
      if (index >= 0) liveCache.hyroxQueues[index] = next;
      else liveCache.hyroxQueues.push(next);
    }
  }
  if (table === "operational_bookings" && row?.id) {
    const index = liveCache.bookings.findIndex((booking) => booking.id === row.id);
    if (deleted) {
      if (index >= 0) liveCache.bookings.splice(index, 1);
    } else {
      const next = buildBookingRow(row);
      if (index >= 0) liveCache.bookings[index] = next;
      else liveCache.bookings.push(next);
    }
  }
  if (table === "operational_booking_replacement_requests" && row?.id) {
    if (deleted) {
      liveCache.replacementRequests = liveCache.replacementRequests
        .filter((request) => request.requestId !== row.id);
    } else {
      cacheReplacementRequest(row);
    }
  }
  onChange(payload);
}

export async function startHyroxRealtime(onChange = () => {}) {
  if (!isLive() || !supabase || hyroxSubscription) return hyroxSubscription;
  if (typeof supabase.channel !== "function") return null;
  const channel = supabase.channel("itc-hyrox")
    .on("postgres_changes", { event: "*", schema: "public", table: "operational_hyrox_cycles" }, (payload) => reconcileHyroxRealtime("operational_hyrox_cycles", payload, onChange))
    .on("postgres_changes", { event: "*", schema: "public", table: "operational_hyrox_queue_entries" }, (payload) => reconcileHyroxRealtime("operational_hyrox_queue_entries", payload, onChange))
    .on("postgres_changes", { event: "*", schema: "public", table: "operational_bookings" }, (payload) => reconcileHyroxRealtime("operational_bookings", payload, onChange))
    .on("postgres_changes", { event: "*", schema: "public", table: "operational_booking_replacement_requests" }, (payload) => reconcileHyroxRealtime("operational_booking_replacement_requests", payload, onChange))
    .on("postgres_changes", { event: "*", schema: "public", table: "operational_booking_replacement_audit" }, (payload) => onChange(payload))
    .subscribe();
  hyroxSubscription = channel;
  return channel;
}

export async function stopHyroxRealtime() {
  if (!hyroxSubscription || !supabase) return;
  try { await supabase.removeChannel(hyroxSubscription); } catch {}
  hyroxSubscription = null;
}

export async function startOperationalRealtime() {
  if (!isLive() || !supabase || subscription) return subscription;
  if (typeof supabase.channel !== "function") return null;
  const tables = [
    "operational_sessions",
    "operational_bookings",
    "operational_queue_entries",
    "operational_receipts",
    "collector_assignments",
    "collector_payout_profiles",
    "operational_session_venue_overrides",
    "operational_rsvp_counts",
    ...(hyroxSubscription ? [] : [
      "operational_hyrox_cycles",
      "operational_hyrox_queue_entries",
      "operational_booking_replacement_requests",
      "operational_booking_replacement_audit",
    ]),
  ];
  let channel = supabase.channel("itc-operations");
  for (const table of tables) {
    channel = channel.on("postgres_changes", { event: "*", schema: "public", table },
      () => scheduleRealtimeRefresh());
  }
  channel = channel.subscribe();
  subscription = channel;
  return channel;
}

export async function stopOperationalRealtime() {
  if (!subscription || !supabase) return;
  try { await supabase.removeChannel(subscription); } catch {}
  subscription = null;
}

let realtimeRefreshTimer = null;
function scheduleRealtimeRefresh() {
  if (realtimeRefreshTimer) return;
  realtimeRefreshTimer = setTimeout(async () => {
    realtimeRefreshTimer = null;
    try { await refreshOperationalState(); } catch (err) { console.warn("operations refresh failed", err); }
  }, 50);
}

export async function runOperationalRpc(name, args, options = {}) {
  if (!isLive() || !supabase) {
    throw new Error("Live operations are unavailable in this deployment.");
  }
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw operationalProblem(error);
  options.applyResult?.(data);
  if (!options.skipRefresh) {
    try { await refreshOperationalState(); } catch (err) { console.warn("operations refresh after rpc failed", err); }
  }
  return data;
}

// Weekly venue overrides apply to live sessions too (e.g. the RSVP lunch),
// not just locally-seeded free events. Read paths merge the override in so
// every surface sees the current venue.
function applyLiveVenueOverride(session) {
  if (!session) return session;
  const o = liveCache.venueOverrides.get(session.id);
  if (!o) return session;
  const out = { ...session };
  if (o.location) out.location = o.location;
  if (o.mapsQuery) out.mapsQuery = o.mapsQuery;
  if (o.meetingLat != null && o.meetingLng != null) {
    out.meetingLat = o.meetingLat;
    out.meetingLng = o.meetingLng;
  }
  const display = String(out.location || "").trim();
  const query = String(out.mapsQuery || "").trim();
  if (display && display.toUpperCase() !== "TBC" && query && query.toUpperCase() !== "TBC") {
    out.venueTBC = false;
  }
  return out;
}

export function getLiveSession(id) {
  return applyLiveVenueOverride(liveCache.sessions.get(id)) || null;
}

export function listLiveSessions() {
  return [...liveCache.sessions.values()].map(applyLiveVenueOverride);
}

export function listLiveHyroxCycles() {
  return [...liveCache.hyroxCycles.values()];
}

export function getLiveHyroxCycle(id) {
  return liveCache.hyroxCycles.get(id) || null;
}

export async function ensureLiveHyroxCycle(cycleId) {
  if (!isLive() || !supabase) return null;
  const cached = liveCache.hyroxCycles.get(cycleId);
  if (cached) return cached;
  const cycleResult = await supabase
    .from("operational_hyrox_cycles")
    .select("*")
    .eq("id", cycleId)
    .maybeSingle();
  if (cycleResult.error) throw operationalProblem(cycleResult.error);
  if (!cycleResult.data) return null;
  const cycle = buildHyroxCycleRow(cycleResult.data);
  liveCache.hyroxCycles.set(cycle.id, cycle);

  const [bookingResult, queueResult] = await Promise.all([
    supabase.from("operational_bookings").select("*").eq("hyrox_cycle_id", cycleId),
    supabase.from("operational_hyrox_queue_entries").select("*").eq("cycle_id", cycleId),
  ]);
  if (bookingResult.error) throw operationalProblem(bookingResult.error);
  if (queueResult.error) throw operationalProblem(queueResult.error);
  const bookingRows = (bookingResult.data || []).map((row) => buildBookingRow(row));
  const bookingIds = new Set(bookingRows.map((row) => row.id));
  liveCache.bookings = liveCache.bookings.filter((row) => !bookingIds.has(row.id));
  liveCache.bookings.push(...bookingRows);
  const queueRows = (queueResult.data || []).map(buildHyroxQueueRow);
  const queueIds = new Set(queueRows.map((row) => row.id));
  liveCache.hyroxQueues = liveCache.hyroxQueues.filter((row) => !queueIds.has(row.id));
  liveCache.hyroxQueues.push(...queueRows);
  return cycle;
}

export function liveHyroxQueuesForCycle(id) {
  return hyroxQueueGroups(liveCache.hyroxQueues.filter((row) => row.cycleId === id));
}

export function liveActivityTemplates() {
  return liveCache.templates.slice();
}

export function listLiveBookings(filter = () => true) {
  return liveCache.bookings.filter(filter);
}

export function liveBookingsForUser(userId) {
  return liveCache.bookings.filter((b) => b.userId === userId);
}

export function liveBookingsForSession(sessionId) {
  return liveCache.bookings.filter((b) => b.sessionId === sessionId);
}

export function livePendingBookings() {
  return liveCache.bookings
    .filter((b) => b.status === "reserved" && b.paymentMarkedAt)
    .sort((a, b) => (a.dateISO || "").localeCompare(b.dateISO || ""));
}

export function liveHeldBookingsForSession(sessionId) {
  return heldBookingRowsForSession(liveCache.bookings, sessionId);
}

export function liveConfirmedBookingsForSession(sessionId) {
  return activeBookingRowsForSession(liveCache.bookings, sessionId);
}

export function liveRsvpCountFor(sessionId) {
  return liveCache.rsvpCounts.has(sessionId)
    ? liveCache.rsvpCounts.get(sessionId)
    : null;
}

export async function liveAttendeeNamesForSession(sessionId) {
  if (!isLive() || !supabase) return null;
  const { data, error } = await supabase.rpc("get_operational_attendee_names", {
    p_session_id: sessionId,
  });
  if (error) throw operationalProblem(error);
  return (data || [])
    .map((row) => String(row.display_name || "").trim())
    .filter(Boolean);
}

export function liveQueueForSession(sessionId) {
  const waitlist = liveCache.queues
    .filter((q) => q.sessionId === sessionId && q.status === "active" && q.kind === "waitlist")
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const interest = liveCache.queues
    .filter((q) => q.sessionId === sessionId && q.status === "active" && q.kind === "interest")
    .sort((a, b) => a.joinedAt - b.joinedAt);
  return { waitlist, interest };
}

export function liveAssigneeForWeek(saturdayISO) {
  return liveCache.assignments.get(saturdayISO) || null;
}

export function livePayoutFor(profileId) {
  return liveCache.payout.get(profileId) || null;
}

export function getLiveVenueOverride(sessionId) {
  return liveCache.venueOverrides.get(sessionId) || null;
}

export function listLiveVenueOverrides() {
  return [...liveCache.venueOverrides.values()];
}

export function liveReceiptsForUser(userId) {
  return liveCache.receipts.filter((r) => r.userId === userId);
}

export function liveReceiptForBooking(bookingId) {
  return liveCache.receipts.find((r) => r.bookingId === bookingId) || null;
}

export function liveBookingById(id) {
  return liveCache.bookings.find((b) => b.id === id) || null;
}

export function liveReplacementRequestForBooking(bookingId) {
  return liveCache.replacementRequests
    .filter((request) => request.bookingId === bookingId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
}

export function liveReplacementRequestByToken() {
  // Raw invite tokens are intentionally never cached in memory or localStorage.
  return null;
}

export function liveReceiptById(id) {
  return liveCache.receipts.find((r) => r.id === id) || null;
}

export async function hashReplacementToken(token) {
  const value = String(token || "");
  if (!value || !globalThis.crypto?.subtle) {
    throw new Error("Secure replacement invite hashing is unavailable.");
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function replacementExpiryISO(expiresAt) {
  const timestamp = expiresAt instanceof Date ? expiresAt.getTime() : Number(expiresAt);
  if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  const parsed = Date.parse(expiresAt);
  if (!Number.isFinite(parsed)) throw new Error("Replacement invite expiry is invalid.");
  return new Date(parsed).toISOString();
}

export async function liveCreateReplacementRequest(bookingId, tokenHash, expiresAt) {
  const row = await runOperationalRpc("create_operational_replacement_request", {
    p_booking_id: bookingId,
    p_token_hash: tokenHash,
    p_expires_at: replacementExpiryISO(expiresAt),
  });
  return cacheReplacementRequest(row);
}

export async function liveReplacementInvite(tokenHash) {
  const row = await runOperationalRpc("get_operational_replacement_invite", {
    p_token_hash: tokenHash,
  }, { skipRefresh: true });
  return buildReplacementRequestRow(row);
}

export async function liveAcceptReplacement(tokenHash) {
  const row = await runOperationalRpc("accept_operational_replacement_request", {
    p_token_hash: tokenHash,
  });
  return cacheReplacementRequest(row);
}

export async function liveDeclineReplacement(tokenHash) {
  const row = await runOperationalRpc("decline_operational_replacement_request", {
    p_token_hash: tokenHash,
  });
  return cacheReplacementRequest(row);
}

export async function liveCancelReplacement(requestId) {
  const row = await runOperationalRpc("cancel_operational_replacement_request", {
    p_request_id: requestId,
  });
  return cacheReplacementRequest(row);
}

export async function liveListReplacementRequests() {
  const rows = await runOperationalRpc("list_operational_replacement_requests", {}, { skipRefresh: true });
  const requests = (rows || []).map(buildReplacementRequestRow).filter(Boolean);
  liveCache.replacementRequests = requests;
  return requests;
}

export async function liveDecideReplacement(requestId, confirm, reason) {
  const row = await runOperationalRpc("admin_decide_operational_replacement", {
    p_request_id: requestId,
    p_confirm: !!confirm,
    p_reason: String(reason || "").trim() || null,
  });
  return cacheReplacementRequest(row);
}

export async function liveSweepHyroxDeadlines({ refresh = true, now = Date.now() } = {}) {
  try {
    const pNow = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    await runOperationalRpc(
      "send_hyrox_member_payment_reminders",
      { p_now: pNow },
      { skipRefresh: true }
    );
    const result = await runOperationalRpc(
      "sweep_hyrox_cycle_deadlines",
      { p_now: pNow },
      { skipRefresh: true }
    );
    await runOperationalRpc(
      "send_hyrox_collector_payment_reminder",
      { p_now: pNow },
      { skipRefresh: true }
    );
    await runOperationalRpc(
      "send_hyrox_venue_reminders",
      { p_now: pNow },
      { skipRefresh: true }
    );
    if (refresh) await refreshOperationalState();
    return result;
  } catch (error) {
    liveCache.error = operationalProblem(error);
    notifyListeners();
    throw liveCache.error;
  }
}

export const liveReserveHyroxCycle = (cycleId, preference, fallbackAcknowledged) =>
  runOperationalRpc("reserve_hyrox_cycle", {
    p_cycle_id: cycleId,
    p_preference: preference,
    p_fallback_acknowledged: fallbackAcknowledged,
  });

export const liveJoinHyroxCycleWaitlist = (cycleId, preference, fallbackAcknowledged) =>
  runOperationalRpc("join_hyrox_cycle_waitlist", {
    p_cycle_id: cycleId,
    p_preference: preference,
    p_fallback_acknowledged: fallbackAcknowledged,
  });

export const liveLeaveHyroxCycleQueue = (entryId) =>
  runOperationalRpc("leave_hyrox_cycle_queue", { p_entry_id: entryId });

export const liveRejectHyroxPayment = (bookingId, reason) =>
  runOperationalRpc("reject_hyrox_cycle_payment", {
    p_booking_id: bookingId,
    p_reason: reason,
  });

export async function liveSetOperationalAttendance(bookingId, arrived) {
  await runOperationalRpc("set_operational_attendance", {
    p_booking_id: bookingId,
    p_arrived: !!arrived,
  });
  return liveBookingById(bookingId);
}

export const liveScheduleHyroxCycle = (cycleId) =>
  runOperationalRpc("schedule_hyrox_cycle", { p_cycle_id: cycleId });

export const liveFinalizeHyroxVenuePlan = (cycleId) =>
  runOperationalRpc("finalize_hyrox_venue_plan", { p_cycle_id: cycleId });

export const liveSelectHyroxVenue = (bookingId, sessionId) =>
  runOperationalRpc("select_hyrox_cycle_venue", {
    p_booking_id: bookingId,
    p_target_session_id: sessionId,
  });

export const liveJoinHyroxVenueSwitchQueue = (bookingId, sessionId) =>
  runOperationalRpc("join_hyrox_venue_switch_queue", {
    p_booking_id: bookingId,
    p_target_session_id: sessionId,
  });

export const liveLeaveHyroxVenueSwitchQueue = (entryId) =>
  runOperationalRpc("leave_hyrox_venue_switch_queue", { p_entry_id: entryId });

export const liveCloseHyroxVenueAllocation = (cycleId) =>
  runOperationalRpc("close_hyrox_venue_allocation", { p_cycle_id: cycleId });

export const liveCancelHyroxCycle = (cycleId, reason) =>
  runOperationalRpc("cancel_hyrox_cycle", {
    p_cycle_id: cycleId,
    p_reason: reason,
  });

export async function liveReserveSession(sessionId) {
  const row = await runOperationalRpc("reserve_operational_session", { p_session_id: sessionId });
  return buildBookingRow(row);
}

export async function liveCancelSession(sessionId, reason) {
  return runOperationalRpc("cancel_operational_session", {
    p_session_id: sessionId,
    p_reason: reason,
  });
}

export async function liveReopenRsvp(sessionId) {
  return runOperationalRpc("reopen_operational_rsvp", {
    p_session_id: sessionId,
  });
}

// One-off events: an inactive template + a single session row, created and
// removed atomically server-side. Deletion is only allowed while the event
// has no active bookings; afterwards admins cancel instead.
export async function liveCreateEvent(payload) {
  const row = await runOperationalRpc("create_operational_event", {
    p_name: payload.name,
    p_session_date: payload.dateISO,
    p_start_time: payload.time,
    p_duration_minutes: payload.durationMin,
    p_venue: payload.location,
    p_maps_query: payload.mapsQuery || null,
    p_category: payload.category || "Other",
    p_price_hkd: payload.price ?? 0,
    p_capacity: Number(payload.price ?? 0) === 0 ? null : (payload.capacity ?? 20),
    p_requires_rsvp: Number(payload.price ?? 0) === 0,
  });
  return row;
}

export async function liveDeleteEvent(sessionId) {
  return runOperationalRpc("delete_operational_event", {
    p_session_id: sessionId,
  });
}

// RSVP withdraw is member self-service on price-0 sessions only.
export async function liveWithdrawRsvp(bookingId) {
  return runOperationalRpc("withdraw_operational_rsvp", {
    p_booking_id: bookingId,
  });
}

export async function liveReleaseReservation(bookingId) {
  const row = await runOperationalRpc("release_operational_reservation", {
    p_booking_id: bookingId,
  }, {
    applyResult(result) {
      if (!result?.id) return;
      const booking = buildBookingRow(result);
      const index = liveCache.bookings.findIndex((item) => item.id === booking.id);
      if (index >= 0) liveCache.bookings[index] = booking;
      else liveCache.bookings.push(booking);
    },
  });
  return buildBookingRow(row);
}

export async function liveMarkBookingPaid(bookingId, method, reference) {
  return runOperationalRpc("mark_operational_payment", {
    p_booking_id: bookingId,
    p_method: method,
    p_reference: reference || "",
  });
}

export async function liveApproveBookingPayment(bookingId) {
  return runOperationalRpc("approve_operational_payment", { p_booking_id: bookingId });
}

export async function liveDeferBooking(bookingId, targetSessionId) {
  return runOperationalRpc("defer_operational_booking", {
    p_booking_id: bookingId,
    p_target_session_id: targetSessionId,
  });
}

export async function liveJoinQueue(sessionId, kind) {
  return runOperationalRpc("join_operational_queue", {
    p_session_id: sessionId,
    p_kind: kind,
  });
}

export async function liveLeaveQueue(entryId) {
  return runOperationalRpc("leave_operational_queue", { p_entry_id: entryId });
}

export async function liveFinalizeGym(sessionId, note) {
  return runOperationalRpc("finalize_operational_gym", {
    p_session_id: sessionId,
    p_note: note || "",
  });
}

export async function liveSetSessionTime(sessionId, time) {
  return runOperationalRpc("set_operational_session_time", {
    p_session_id: sessionId,
    p_time: time,
  });
}

export async function liveSetVenueTBC(sessionId, enabled) {
  return runOperationalRpc("set_operational_venue_tbc", {
    p_session_id: sessionId,
    p_enabled: !!enabled,
  });
}

export async function liveSetSessionNotice(sessionId, notice) {
  return runOperationalRpc("set_operational_notice", {
    p_session_id: sessionId,
    p_notice: notice || "",
  });
}

export async function liveSetMidtownOpen(sessionId, enabled) {
  return runOperationalRpc("set_operational_midtown_open", {
    p_session_id: sessionId,
    p_enabled: !!enabled,
  });
}

export async function liveSetCollector(weekStart, profileId) {
  return runOperationalRpc("set_collector_assignment", {
    p_week_start: weekStart,
    p_profile_id: profileId,
  });
}

export async function liveUpdatePayout(profileId, paymeLink, fpsPhone) {
  return runOperationalRpc("update_collector_payout_profile", {
    p_profile_id: profileId,
    p_payme_link: paymeLink || "",
    p_fps_phone: fpsPhone || "",
  });
}

export async function liveSetWeekVenue(sessionId, {
  location, mapsQuery, wasTBC, meetingLat = null, meetingLng = null,
}) {
  const point = normalizeMeetingPoint(meetingLat, meetingLng);
  return runOperationalRpc("set_session_venue", {
    p_session_id: sessionId,
    p_location: String(location || "").trim() || null,
    p_maps_query: String(mapsQuery || "").trim() || null,
    p_was_tbc: !!wasTBC,
    p_meeting_lat: point?.lat ?? null,
    p_meeting_lng: point?.lng ?? null,
  }, {
    applyResult(result) {
      const row = Array.isArray(result) ? result[0] : result;
      if (!row?.session_id) return;
      const override = buildVenueOverrideRow(row);
      liveCache.venueOverrides.set(override.sessionId, override);
    },
  });
}

export function sessionCancellationCopy(session) {
  if (!session) return "";
  if (session.cancelledSource === "system" && session.cancelled && session.cancelReason) {
    return `Session cancelled by ITC — ${session.cancelReason}`;
  }
  if (session.cancelled && session.cancelReason) {
    return `Session cancelled by ITC — ${session.cancelReason}`;
  }
  if (session.cancelled) {
    return "Session cancelled by ITC";
  }
  return "";
}

export { LIVE_TABLES };
