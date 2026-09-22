import { sessionStarted } from "./data.js";

export function isRsvpOccurrence(session) {
  return Boolean(session?.requiresRsvp || session?.kind === "rsvp")
    && Number(session?.price ?? 0) === 0;
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
