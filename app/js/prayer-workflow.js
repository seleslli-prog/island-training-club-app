const PRAYER_STATUSES = new Set(["new", "prayed_for", "closed", "withdrawn"]);

export function prayerActionProblem(status, action) {
  if (action === "close") {
    return ["new", "prayed_for"].includes(status)
      ? null
      : "Prayer request cannot be closed from its current state.";
  }
  if (action === "withdraw") {
    return status === "withdrawn" ? "Prayer request is already withdrawn." : null;
  }
  return "Prayer request action must be close or withdraw.";
}

export function validatePrayerText(request) {
  const trimmed = String(request ?? "").trim();
  const length = Array.from(trimmed).length;
  if (length < 1 || length > 2000) {
    throw new Error("Prayer request must be between 1 and 2,000 characters.");
  }
  return trimmed;
}

export function normalizePrayerRequest(row) {
  const field = (camel, snake) => row?.[snake] !== undefined ? row[snake] : row?.[camel];
  return {
    id: row?.id ?? null,
    request: field("request", "request_text") ?? null,
    anonymousToLeaders: field("anonymousToLeaders", "anonymous_to_leaders") === true,
    status: PRAYER_STATUSES.has(row?.status) ? row.status : "new",
    createdAt: field("createdAt", "created_at") ?? null,
    updatedAt: field("updatedAt", "updated_at") ?? null,
    closedAt: field("closedAt", "closed_at") ?? null,
    withdrawnAt: field("withdrawnAt", "withdrawn_at") ?? null,
  };
}
