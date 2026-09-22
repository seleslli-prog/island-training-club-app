import { hktEventStartMs } from "./data.js";

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

export function hyroxVenueSwitchProblem({ booking, cycle, now = Date.now() }) {
  if (!cycle || cycle.venuePlan !== "both") return "Venue changes are available only when both gyms open.";
  if (booking?.status !== "confirmed" || booking?.allocationState !== "provisional") {
    return "Booking allocation is not changeable.";
  }
  if (now >= cycle.venueChoiceDeadlineAt) return "Venue changes closed Friday at 9 PM HKT.";
  return null;
}

export function hyroxActiveBookingRows(bookings, cycleId) {
  return (bookings || []).filter((booking) => booking.cycleId === cycleId
    && ["reserved", "confirmed"].includes(booking.status));
}

export function hyroxQueueGroups(entries) {
  const active = (entries || []).filter((entry) => entry.status === "active");
  const sort = (a, b) => (a.joinedAt - b.joinedAt) || String(a.id).localeCompare(String(b.id));
  return {
    weeklyWaitlist: active.filter((entry) => entry.kind === "weekly_waitlist").sort(sort),
    venueSwitches: active.filter((entry) => entry.kind === "venue_switch").sort(sort),
  };
}

export function hyroxActiveQueueEntryForUser(entries, userId, kind = null) {
  return (entries || []).find((entry) => entry.userId === userId
    && (!kind || entry.kind === kind) && entry.status === "active") || null;
}

export function hyroxQueuePositionForEntries(entries, userId, {
  kind = "weekly_waitlist",
  targetSessionId = null,
} = {}) {
  const queue = (entries || [])
    .filter((entry) => entry.status === "active" && entry.kind === kind
      && (targetSessionId == null || entry.targetSessionId === targetSessionId))
    .sort((a, b) => (a.joinedAt - b.joinedAt) || String(a.id).localeCompare(String(b.id)));
  const index = queue.findIndex((entry) => entry.userId === userId);
  return index < 0 ? null : index + 1;
}

export function hyroxVenueChoiceProblem({ mode, currentSessionId, targetSessionId, targetFull = false }) {
  if (mode === "queue" && currentSessionId === targetSessionId) {
    return "Choose the other venue in this HYROX cycle.";
  }
  if (mode === "select" && targetFull) return "Target venue is full.";
  return null;
}

export function hyroxVenueTargetProblem(cycle, sessionId) {
  if (!cycle || ![cycle.bftSessionId, cycle.midtownSessionId].includes(sessionId)) {
    return "Target venue is not part of this HYROX cycle.";
  }
  return null;
}

export function hyroxPaymentProblem({ reason, booking }) {
  if (!String(reason || "").trim()) return "Payment rejection reason is required.";
  if (!booking?.cycleId) return "Pooled HYROX booking not found.";
  if (booking.status !== "reserved" || !booking.paymentMarkedAt) {
    return "Booking has no pending payment claim.";
  }
  return null;
}

export function hyroxRegistrationProblem({
  cycle,
  now = Date.now(),
  preference,
  fallbackAcknowledged,
  alreadyJoined = false,
  hasQuarryBooking = false,
  activeCount = 0,
  mode = "reserve",
}) {
  if (!cycle) return "HYROX cycle not found.";
  if (!["bft", "midtown", "either"].includes(preference)) return "Choose BFT, Midtown, or Either.";
  if (!fallbackAcknowledged) return "Fallback acknowledgement is required.";
  if (cycle.registrationState === "cancelled") return "This HYROX cycle is cancelled.";
  if (now < cycle.registrationOpensAt) return "HYROX registration opens Monday at 6 PM HKT.";
  if (now >= cycle.paymentDeadlineAt) return "HYROX registration is closed.";
  if (cycle.registrationState !== "draft" && cycle.registrationState !== "open") return "HYROX registration is closed.";
  if (alreadyJoined) return "You already joined this HYROX registration.";
  if (hasQuarryBooking) return "You already have a HYROX booking for this Saturday.";
  if (mode === "waitlist" && activeCount < cycle.capacity) return "HYROX places are still available.";
  if (mode === "reserve" && activeCount >= cycle.capacity) return "HYROX registration is full. Join the weekly waitlist.";
  return null;
}

export function hyroxCycleStatus(cycle, now = Date.now()) {
  if (cycle.registrationState === "cancelled") return { label: "Cancelled", className: "danger" };
  if (now < cycle.registrationOpensAt) return {
    label: "Sign up opens Monday at 6 PM HKT",
    compactLabel: "Opens Mon · 6 PM",
    className: "neutral",
  };
  if (cycle.venuePlan === "bft_only") return { label: "BFT only", className: "free" };
  if (cycle.venuePlan === "both") {
    return {
      label: cycle.allocationClosedAt ? "Both gyms confirmed" : "Both gyms open",
      className: "free",
    };
  }
  if (cycle.registrationState === "reconciling") return { label: "Payment review", className: "warn" };
  return { label: "Registration open", className: "paid" };
}
