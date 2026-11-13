// Turn live operational failures into a sentence a member can act on.
// Known product messages stay word for word. Database, auth, and network
// internals stay off the screen.

const FALLBACK = "Unable to save — try again.";

function textOf(error) {
  if (error == null) return "";
  if (typeof error === "string") return error.trim();
  if (typeof error.message === "string") return error.message.trim();
  return "";
}

function looksInternal(message) {
  return /jwt|password|secret|stack trace|syntax error|duplicate key|violates |relation |schema |pgrst|permission denied|function public\.|<\s*\/?[a-z]|select\s+.+\s+from|insert\s+into|update\s+.+\s+set|delete\s+from/i.test(message);
}

function looksLikeNetwork(message) {
  return /failed to fetch|networkerror|network request failed|load failed|the operation was aborted|timeout/i.test(message);
}

function looksLikeSignedOut(message) {
  return /jwt expired|invalid jwt|auth session missing|not authenticated|invalid claim/i.test(message);
}

function isSafeProductSentence(message) {
  if (!message || message.length > 200 || /[\r\n]/.test(message)) return false;
  if (!/^[\p{L}\p{N}]/u.test(message)) return false;
  return !looksInternal(message);
}

function knownProductMessage(error, message) {
  const code = error && typeof error === "object" ? String(error.code || "") : "";
  if (code === "PGRST202" && message.includes("operational_replacement")) {
    return "Replacement setup is temporarily unavailable. Please contact ITC.";
  }
  if (code === "PGRST202" && message.includes("set_operational_session_time_tbc")) {
    return "Mark time TBC needs the latest database update before it can save.";
  }
  if (message.includes("permission denied for function set_operational_session_time_tbc")) {
    return "Mark time TBC is installed, but signed-in admins are not allowed to run it yet.";
  }
  if (message.includes("time_tbc")) {
    return "Mark time TBC needs the latest database update before it can save.";
  }
  const exact = [
    ["Session is cancelled", "Session is cancelled."],
    ["Session is full", "Session is full."],
    ["Session is not open", "Session is not open."],
    ["Already booked", "Already booked."],
    ["Approved membership required", "Approved membership required."],
    ["Not authorized for this booking", "Not authorized for this booking."],
    ["Not authorized for this queue entry", "Not authorized for this queue entry."],
    ["Not authorized for this payout profile", "Not authorized for this payout profile."],
    ["Administrator access required", "Admin access required."],
    ["Cancellation reason is required", "Cancellation reason is required."],
    ["Payment has not been marked", "Payment has not been marked."],
    ["Payment has already been marked", "Payment has already been marked."],
    ["Payment has already been processed", "Payment has already been processed."],
    ["Booking is not awaiting approval", "Booking is not awaiting approval."],
    ["Only confirmed bookings can be deferred", "Only confirmed bookings can be deferred."],
    ["Target must be a session of the same activity", "Target must be a session of the same activity."],
    ["Target must be later than the current session", "Target must be later than the current session."],
    ["Target session is full", "Target session is full."],
    ["Session has already started", "Session has already started."],
    ["Session is already cancelled", "Session is already cancelled."],
    ["Gym confirmation has already been recorded", "Gym confirmation has already been recorded."],
    ["Session not found", "Session not found."],
    ["Booking not found", "Booking not found."],
    ["Queue entry not found", "Queue entry not found."],
    ["Authentication required", "Authentication required."],
    ["Waitlist is only for open sessions", "Waitlist is only for open sessions."],
    ["Waitlist is only for full sessions", "Waitlist is only for full sessions."],
    ["Session is not full", "Session is not full."],
    ["Activity venue is fixed.", "Activity venue is fixed."],
  ];
  const ranked = exact.slice().sort((a, b) => b[0].length - a[0].length);
  for (const [needle, copy] of ranked) {
    if (message.includes(needle)) return copy;
  }
  if (message.includes("replacement invite")
      || message.includes("replacement request")
      || message.includes("replacement")) {
    return looksInternal(message)
      ? "Replacement setup is temporarily unavailable. Please contact ITC."
      : message;
  }
  return "";
}

export function explainUserFacingError(error, fallback = FALLBACK) {
  const safeFallback = typeof fallback === "string" && fallback.trim()
    ? fallback.trim()
    : FALLBACK;
  const message = textOf(error);
  if (!message) return new Error(safeFallback);
  const known = knownProductMessage(error, message);
  if (known) return new Error(known);
  if (looksLikeSignedOut(message)) return new Error("Sign in again to continue.");
  if (looksLikeNetwork(message)) return new Error("The connection dropped. Try again.");
  if (looksInternal(message) || !isSafeProductSentence(message)) return new Error(safeFallback);
  return new Error(message);
}
