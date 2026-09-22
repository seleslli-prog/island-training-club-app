export function isRsvpOccurrence(session) {
  return Boolean(session?.requiresRsvp || session?.kind === "rsvp")
    && Number(session?.price ?? 0) === 0;
}
