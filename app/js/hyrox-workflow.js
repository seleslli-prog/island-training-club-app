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
