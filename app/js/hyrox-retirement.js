// Exact frontend defence-in-depth boundary for the retired BFT/Midtown pool.
// Hydrated records are classified by canonical fields and relationships. Only
// the explicitly route-only helper may inspect a legacy ID shape.

export const RETIRED_HYROX_ACTIVITY_IDS = new Set(["hyrox-bft", "hyrox-midtown"]);

// Island ECC window kinds (operational_island_ecc_payment_reminder,
// operational_island_ecc_collector_finalize_reminder,
// operational_island_ecc_collector_finalize_nudge) must never be added here.
const RETIRED_POOL_NOTIFICATION_KINDS = new Set([
  "hyrox-collector-payment-reminder",
  "hyrox-cycle-cancelled",
  "hyrox-cycle-cancelled-no-deferral",
  "hyrox-cycle-deferred",
  "hyrox-holder-grace",
  "hyrox-moved-to-waitlist",
  "hyrox-payment-rejected",
  "hyrox-payment-reminder",
  "hyrox-promoted",
  "hyrox-promotion-expired",
  "hyrox-registration-opened",
  "hyrox-reserved",
  "hyrox-switch-waitlisted",
  "hyrox-venue-allocated",
  "hyrox-venue-changed",
  "hyrox-venue-choice-reminder",
  "hyrox-venue-finalization-reminder",
  "hyrox-venue-switch-matched",
  "hyrox-waitlist-closed",
  "hyrox-waitlist-promoted",
  "hyrox-waitlisted",
  "operational_hyrox_allocation_final",
  "operational_hyrox_capacity_reached",
  "operational_hyrox_collector_payment_reminder",
  "operational_hyrox_cycle_cancelled",
  "operational_hyrox_cycle_cancelled_no_deferral",
  "operational_hyrox_cycle_deferred",
  "operational_hyrox_grace_summary",
  "operational_hyrox_holder_demoted",
  "operational_hyrox_holder_grace",
  "operational_hyrox_payment_closed",
  "operational_hyrox_payment_rejected",
  "operational_hyrox_payment_reminder",
  "operational_hyrox_reconciliation_started",
  "operational_hyrox_registration_opened",
  "operational_hyrox_reservation_released",
  "operational_hyrox_reserved",
  "operational_hyrox_switch_matched",
  "operational_hyrox_switch_waitlisted",
  "operational_hyrox_venue_allocated",
  "operational_hyrox_venue_changed",
  "operational_hyrox_venue_choice_reminder",
  "operational_hyrox_venue_finalization_reminder",
  "operational_hyrox_waitlist_promoted",
  "operational_hyrox_waitlisted",
]);

export const isRetiredHyroxActivityId = (id) =>
  RETIRED_HYROX_ACTIVITY_IDS.has(String(id || ""));

export const isRetiredHyroxCycleId = (id) =>
  /^hyrox-pool-\d{4}-\d{2}-\d{2}$/.test(String(id || ""));

export const isRetiredHyroxSession = (session) =>
  isRetiredHyroxActivityId(session?.activityId ?? session?.activity_id);

export const isRetiredHyroxBooking = (booking, getSession = () => null) =>
  isRetiredHyroxCycleId(booking?.cycleId ?? booking?.hyrox_cycle_id)
  || isRetiredHyroxSession(booking)
  || isRetiredHyroxSession(getSession(booking?.sessionId ?? booking?.session_id));

export const isRetiredHyroxReceipt = (receipt, getBooking = () => null) =>
  isRetiredHyroxCycleId(receipt?.cycleId ?? receipt?.hyrox_cycle_id)
  || isRetiredHyroxBooking(receipt)
  || isRetiredHyroxBooking(getBooking(receipt?.bookingId ?? receipt?.booking_id));

const notificationBookingId = (notification) => {
  const direct = notification?.bookingId ?? notification?.booking_id;
  if (direct) return direct;
  const destination = String(notification?.destination ?? notification?.link ?? "");
  const match = destination.match(/^#\/(?:booking|pay)\/([^/?#]+)$/);
  return match?.[1] || null;
};

export const isRetiredHyroxNotification = (notification, getBooking = () => null) =>
  RETIRED_POOL_NOTIFICATION_KINDS.has(String(notification?.kind || ""))
  || isRetiredHyroxBooking(notification)
  || isRetiredHyroxBooking(getBooking(notificationBookingId(notification)));

export const isRetiredHyroxLegacyRouteId = (id) => {
  const value = String(id || "");
  return isRetiredHyroxActivityId(value)
    || isRetiredHyroxCycleId(value)
    || /^hyrox-(?:bft|midtown)-\d{4}-\d{2}-\d{2}$/.test(value);
};
