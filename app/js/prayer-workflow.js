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

export function prayerAdminTransition(prayer, status, now = Date.now()) {
  const valid = prayer?.status === "new"
    ? ["prayed_for", "closed"].includes(status)
    : prayer?.status === "prayed_for" && status === "closed";
  if (!valid) return { error: "Prayer request cannot be changed from its current state." };
  return {
    value: {
      ...prayer,
      status,
      updatedAt: now,
      closedAt: status === "closed" ? now : null,
    },
  };
}

export function prayerTransition(prayer, action, now = Date.now()) {
  const problem = prayerActionProblem(prayer?.status, action);
  if (problem) return { error: problem };
  return {
    value: {
      ...prayer,
      status: action === "close" ? "closed" : "withdrawn",
      request: action === "withdraw" ? null : prayer.request,
      closedAt: action === "close" ? now : null,
      withdrawnAt: action === "withdraw" ? now : null,
      updatedAt: now,
    },
  };
}

export function buildPrayerRequest({ id, ownerId, request, anonymousToLeaders = false, now = Date.now() }) {
  return {
    id,
    ownerId,
    request,
    anonymousToLeaders: anonymousToLeaders === true,
    status: "new",
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    withdrawnAt: null,
  };
}

export function orderMemberPrayerRequests(rows, ownerId) {
  return (rows || [])
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => (row?.ownerId ?? row?.owner_id ?? row?.userId) === ownerId)
    .sort((a, b) => Number(b.row.createdAt ?? b.row.created_at) - Number(a.row.createdAt ?? a.row.created_at)
      || b.index - a.index)
    .map(({ row }) => row);
}

export function orderAdminPrayerRequests(rows) {
  const order = { new: 1, prayed_for: 2, closed: 3 };
  return (rows || [])
    .filter((row) => row.status !== "withdrawn")
    .sort((a, b) => {
      const statusOrder = (order[a.status] || 4) - (order[b.status] || 4);
      if (statusOrder) return statusOrder;
      const createdA = Number(a.createdAt ?? a.created_at);
      const createdB = Number(b.createdAt ?? b.created_at);
      const createdOrder = a.status === "closed" ? createdB - createdA : createdA - createdB;
      return createdOrder || String(a.id).localeCompare(String(b.id));
    });
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
