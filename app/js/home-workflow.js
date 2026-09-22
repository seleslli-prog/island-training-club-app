import { sessionStarted } from "./data.js";

const inWeek = (item, weekStartISO, weekEndISO) => {
  const dateISO = item?.dateISO || item?.snapshot?.dateISO;
  return Boolean(dateISO && dateISO >= weekStartISO && dateISO <= weekEndISO);
};

export function projectHomeWeek({
  user = null,
  sessions = [],
  viewerBookings = [],
  weekStartISO,
  weekEndISO,
}) {
  const visibleSessions = sessions.filter((session) => inWeek(session, weekStartISO, weekEndISO));
  if (!user || user.status !== "approved") {
    return {
      rows: visibleSessions.filter((session) => session.kind === "free"),
      emptyMsg: "No open sessions this week — check back soon.",
      weekHeading: user ? "My Week" : "This week — open to all",
    };
  }

  const sessionsById = new Map(visibleSessions.map((session) => [session.id, session]));
  const pooledBookings = viewerBookings
    .filter((booking) => booking.cycleId && booking.status === "confirmed")
    .filter((booking) => !booking.sessionId || !sessionStarted(sessionsById.get(booking.sessionId) || booking.snapshot));
  const pooledSessionIds = new Set(pooledBookings.map((booking) => booking.sessionId).filter(Boolean));
  const bookedIds = new Set(
    viewerBookings
      .filter((booking) => booking.status === "confirmed" && !booking.cycleId && !sessionStarted(booking.snapshot))
      .map((booking) => booking.sessionId)
  );
  return {
    rows: [
      ...visibleSessions.filter((session) => bookedIds.has(session.id) && !pooledSessionIds.has(session.id)),
      ...pooledBookings,
    ],
    emptyMsg: "Nothing booked this week yet. <a href=\"#/schedule\" style=\"color:var(--accent)\">Find a session →</a>",
    weekHeading: "My Week",
  };
}
