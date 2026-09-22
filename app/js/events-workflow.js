import { hktEventStartMs, sessionStarted } from "./data.js";

export function isRsvpOccurrence(session) {
  return Boolean(session?.requiresRsvp || session?.kind === "rsvp")
    && Number(session?.price ?? 0) === 0;
}

export function rsvpWithdrawProblem({ booking, session, now = Date.now() }) {
  if (!booking || booking.status !== "confirmed") return null;
  if (!session) return "Session not found.";
  if (!isRsvpOccurrence({ ...session, price: booking.snapshot?.price })) return null;
  const startsAt = hktEventStartMs(session.dateISO, session.time);
  if (!Number.isFinite(startsAt) || startsAt <= now) return "Session has already started";
  return null;
}

export function rsvpJoinProblem({ session, alreadyBooked = false, spots = null }) {
  if (!session) return "Unknown session";
  if (!isRsvpOccurrence(session)) return "Session is not an RSVP event";
  if (session.cancelled) return "Session is cancelled";
  if (sessionStarted(session)) return "Session has already started";
  if (spots !== null && spots <= 0) return "Session is full";
  if (alreadyBooked) return "Already booked";
  return null;
}
