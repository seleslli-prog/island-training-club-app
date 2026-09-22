import { hktEventStartMs } from "./data.js";

export function replacementEligibility(booking, { now = Date.now(), sessionCancelled = false } = {}) {
  if (!booking?.userId) return { ok: false, reason: "missing-owner" };
  if (booking.status !== "confirmed") return { ok: false, reason: "not-confirmed" };
  if (booking.replacementUserId) return { ok: false, reason: "already-replaced" };
  const snapshot = booking.snapshot || {};
  const isHyrox = snapshot.kind === "paid"
    && (String(snapshot.name || "").toUpperCase().includes("HYROX")
      || String(booking.sessionId || "").startsWith("hyrox-"));
  if (!isHyrox) return { ok: false, reason: "not-paid-hyrox" };
  if (sessionCancelled) return { ok: false, reason: "cancelled" };
  const startsAt = hktEventStartMs(snapshot.dateISO, snapshot.time);
  if (!Number.isFinite(startsAt) || startsAt <= now) return { ok: false, reason: "started" };
  return { ok: true, expiresAt: Math.min(startsAt, now + 24 * 60 * 60 * 1000) };
}
