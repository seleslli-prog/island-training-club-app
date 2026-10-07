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
];

const cutoverMarker = "itc.live.operations.backend.v1";

const PAID_ACTIVITY_METADATA = new Map(
  SEED_ACTIVITIES
    .filter((activity) => activity.kind === "paid")
    .map((activity) => [activity.id, activity])
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
  rsvpCountError: null,
  loaded: false,
  loading: null,
  error: null,
  payoutError: null,
  updatedAt: 0,
};

const listeners = new Set();
let subscription = null;
let hydrationEpoch = 0;
let lastAuthenticated = false;

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
  const metadata = PAID_ACTIVITY_METADATA.get(row.activity_id);
  const template = templatesById?.get(row.activity_id) ?? null;
  const oneOff = String(row.activity_id).startsWith("event-");
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
    // Paid sessions take the reserve/pay pipeline; price-0 sessions are RSVP
    // (headcount needed, e.g. the post-training lunch) when the template says
    // so, otherwise plain free show-up events.
    kind: Number(row.price_hkd) > 0 ? "paid" : (template?.requires_rsvp ? "rsvp" : "free"),
    category: template?.category || (oneOff ? "Other" : "HYROX"),
    weekday: date.getDay(),
    oneOff,
    dateISO,
    date,
    time: String(row.start_time || "").slice(0, 5),
    durationMin: row.duration_minutes,
    location: venue,
    mapsQuery,
    venue,
    photo: metadata?.photo || "../assets/itc/itc-hyrox-mood.webp",
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

function preferLiveBooking(incoming) {
  const existing = liveCache.bookings.find((item) => item.id === incoming.id);
  // A post-approval refresh can still read a reserved replica. Keep the
  // confirmed row the duty collector just applied from the RPC.
  if (existing?.status === "confirmed" && incoming.status === "reserved") {
    return existing;
  }
  return incoming;
}

function preferLiveSession(incoming) {
  const existing = liveCache.sessions.get(incoming.id);
  // Gym confirmation is written on the session. Keep a locally patched
  // confirmation if a concurrent refresh still reads a null replica.
  if (existing?.gymConfirmedAt && !incoming.gymConfirmedAt) {
    return {
      ...incoming,
      gymConfirmedAt: existing.gymConfirmedAt,
      gymConfirmedBy: existing.gymConfirmedBy,
      gymNote: existing.gymNote,
    };
  }
  return incoming;
}

function replaceState(payload) {
  liveCache.sessions = new Map(payload.sessions.map((row) => {
    const session = preferLiveSession(row);
    return [session.id, session];
  }));
  liveCache.hyroxCycles = new Map(
    (payload.hyroxCycles || []).map((row) => [row.id, row])
  );
  liveCache.hyroxQueues = payload.hyroxQueues || [];
  liveCache.templates = payload.templates || [];
  liveCache.bookings = (payload.bookings || []).map(preferLiveBooking);
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
      if (session.kind === "rsvp") liveCache.rsvpCounts.set(session.id, 0);
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
  if (message.includes("Activity venue is fixed.")) return new Error("Activity venue is fixed.");
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

function rpcRecord(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

function patchLiveBooking(result) {
  const row = rpcRecord(result);
  if (!row?.id) return null;
  // Drop any in-flight full refresh so a stale bookings snapshot cannot
  // overwrite the RPC result the duty collector just confirmed.
  hydrationEpoch += 1;
  const existing = liveCache.bookings.find((item) => item.id === row.id);
  const booking = buildBookingRow(row);
  if (existing) {
    booking.snapshot = { ...existing.snapshot, ...booking.snapshot };
    booking.dateISO = booking.dateISO || existing.dateISO;
    booking.sessionId = booking.sessionId || existing.sessionId;
    booking.cycleId = booking.cycleId || existing.cycleId;
    booking.userId = booking.userId || existing.userId;
  }
  const index = liveCache.bookings.findIndex((item) => item.id === booking.id);
  if (index >= 0) liveCache.bookings[index] = booking;
  else liveCache.bookings.push(booking);
  notifyListeners();
  return booking;
}

function bookingRpcShape(booking, overrides = {}) {
  if (!booking) return null;
  return {
    id: booking.id,
    profile_id: booking.userId,
    session_id: booking.sessionId,
    hyrox_cycle_id: booking.cycleId,
    status: booking.status,
    created_at: booking.createdAt,
    reserved_at: booking.reservedAt,
    pay_deadline_at: booking.payDeadlineAt,
    payment_marked_at: booking.paymentMarkedAt,
    payment_method: booking.paidMethod,
    payment_reference: booking.paymentRef,
    paid_at: booking.paidAt,
    confirmed_by: booking.confirmedBy,
    snapshot: booking.snapshot,
    ...overrides,
  };
}

function confirmLiveBookingLocally(bookingId, rpcResult) {
  const patched = patchLiveBooking(rpcResult);
  if (patched?.status === "confirmed") return patched;
  const existing = liveCache.bookings.find((item) => item.id === bookingId);
  if (!existing) return patched;
  return patchLiveBooking(bookingRpcShape(existing, {
    status: "confirmed",
    paid_at: existing.paidAt || Date.now(),
  }));
}

function templatesByIdMap() {
  return new Map((liveCache.templates || []).map((template) => [template.activity_id, template]));
}

function patchLiveSession(result) {
  const row = rpcRecord(result);
  if (!row?.id) return null;
  hydrationEpoch += 1;
  const existing = liveCache.sessions.get(row.id);
  const session = {
    ...(existing || {}),
    ...buildSessionRow(row, templatesByIdMap()),
  };
  liveCache.sessions.set(session.id, session);
  notifyListeners();
  return session;
}

function confirmLiveGymLocally(sessionId, rpcResult, note) {
  const patched = patchLiveSession(rpcResult);
  if (patched?.gymConfirmedAt) {
    if (note != null && String(note).trim() && !patched.gymNote) {
      patched.gymNote = String(note).trim();
      liveCache.sessions.set(patched.id, patched);
    }
    return patched;
  }
  const existing = liveCache.sessions.get(sessionId);
  if (!existing) return patched;
  const next = {
    ...existing,
    gymConfirmedAt: existing.gymConfirmedAt || Date.now(),
    gymNote: String(note || existing.gymNote || "").trim() || null,
  };
  liveCache.sessions.set(sessionId, next);
  hydrationEpoch += 1;
  notifyListeners();
  return next;
}

async function fetchOperationalState({ authenticated } = {}) {
  if (!isLive() || !supabase) return null;
  if (authenticated === undefined) {
    if (liveCache.loaded) {
      authenticated = lastAuthenticated;
    } else {
      try {
        const { data } = await supabase.auth.getSession();
        authenticated = Boolean(data?.session);
      } catch {
        authenticated = false;
      }
    }
  }
  lastAuthenticated = Boolean(authenticated);
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
  const epoch = ++hydrationEpoch;
  let pending;
  pending = Promise.resolve().then(async () => {
    try {
      const payload = await fetchOperationalState({ authenticated });
      if (epoch !== hydrationEpoch) return liveCache;
      replaceState(payload);
      try { localStorage.setItem(cutoverMarker, "supabase"); } catch {}
      notifyListeners();
      return liveCache;
    } catch (err) {
      if (epoch !== hydrationEpoch) return liveCache;
      liveCache.error = operationalProblem(err);
      notifyListeners();
      throw liveCache.error;
    } finally {
      if (liveCache.loading === pending) liveCache.loading = null;
    }
  });
  liveCache.loading = pending;
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

export async function startOperationalRealtime() {
  if (!isLive() || !supabase || subscription) return subscription;
  if (typeof supabase.channel !== "function") return null;
  const channel = supabase.channel("itc-operations")
    .on("postgres_changes",
      { event: "*", schema: "public", table: "operational_sessions" },
      () => scheduleRealtimeRefresh())
    .on("postgres_changes",
      { event: "*", schema: "public", table: "operational_bookings" },
      () => scheduleRealtimeRefresh())
    .on("postgres_changes",
      { event: "*", schema: "public", table: "operational_queue_entries" },
      () => scheduleRealtimeRefresh())
    .on("postgres_changes",
      { event: "*", schema: "public", table: "operational_receipts" },
      () => scheduleRealtimeRefresh())
    .on("postgres_changes",
      { event: "*", schema: "public", table: "collector_assignments" },
      () => scheduleRealtimeRefresh())
    .on("postgres_changes",
      { event: "*", schema: "public", table: "collector_payout_profiles" },
      () => scheduleRealtimeRefresh())
    .on("postgres_changes",
      { event: "*", schema: "public", table: "operational_session_venue_overrides" },
      () => scheduleRealtimeRefresh())
    .on("postgres_changes",
      { event: "*", schema: "public", table: "operational_rsvp_counts" },
      () => scheduleRealtimeRefresh())
    .on("postgres_changes",
      { event: "*", schema: "public", table: "operational_hyrox_cycles" },
      () => scheduleRealtimeRefresh())
    .on("postgres_changes",
      { event: "*", schema: "public", table: "operational_hyrox_queue_entries" },
      () => scheduleRealtimeRefresh())
    .subscribe();
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

export function liveHyroxQueuesForCycle(id) {
  const rows = liveCache.hyroxQueues.filter((row) => row.cycleId === id);
  return {
    weeklyWaitlist: rows
      .filter((row) => row.kind === "weekly_waitlist")
      .sort((a, b) => (a.joinedAt - b.joinedAt) || a.id.localeCompare(b.id)),
    venueSwitches: rows
      .filter((row) => row.kind === "venue_switch")
      .sort((a, b) => (a.joinedAt - b.joinedAt) || a.id.localeCompare(b.id)),
  };
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
  return liveCache.bookings.filter(
    (b) => b.sessionId === sessionId && (b.status === "reserved" || b.status === "confirmed")
  );
}

export function liveConfirmedBookingsForSession(sessionId) {
  return liveCache.bookings.filter(
    (b) => b.sessionId === sessionId && b.status === "confirmed"
  );
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

export function liveReceiptById(id) {
  return liveCache.receipts.find((r) => r.id === id) || null;
}

export async function liveSweepHyroxDeadlines({ refresh = true, now = Date.now() } = {}) {
  try {
    const pNow = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    return await runOperationalRpc("sweep_hyrox_cycle_deadlines", { p_now: pNow }, { skipRefresh: !refresh });
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
    p_capacity: payload.capacity ?? 20,
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
  const row = await runOperationalRpc("approve_operational_payment", { p_booking_id: bookingId }, {
    skipRefresh: true,
    applyResult(result) {
      confirmLiveBookingLocally(bookingId, result);
    },
  });
  const confirmed = liveCache.bookings.find((item) => item.id === bookingId);
  if (confirmed?.status !== "confirmed") confirmLiveBookingLocally(bookingId, row);
  void refreshOperationalState().catch((err) => {
    console.warn("operations refresh after payment approval failed", err);
  });
  return row;
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
  const row = await runOperationalRpc("finalize_operational_gym", {
    p_session_id: sessionId,
    p_note: note || "",
  }, {
    skipRefresh: true,
    applyResult(result) {
      confirmLiveGymLocally(sessionId, result, note);
    },
  });
  const confirmed = liveCache.sessions.get(sessionId);
  if (!confirmed?.gymConfirmedAt) confirmLiveGymLocally(sessionId, row, note);
  void refreshOperationalState().catch((err) => {
    console.warn("operations refresh after gym confirmation failed", err);
  });
  return row;
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
