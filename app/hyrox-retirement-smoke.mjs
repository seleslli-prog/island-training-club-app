// Focused regression for the frontend BFT/Midtown retirement classifier.
// Run directly with: node app/hyrox-retirement-smoke.mjs

import assert from "node:assert/strict";
import {
  RETIRED_HYROX_ACTIVITY_IDS,
  isRetiredHyroxActivityId,
  isRetiredHyroxCycleId,
  isRetiredHyroxSession,
  isRetiredHyroxBooking,
  isRetiredHyroxReceipt,
  isRetiredHyroxNotification,
  isRetiredHyroxLegacyRouteId,
} from "./js/hyrox-retirement.js";

assert.deepEqual([...RETIRED_HYROX_ACTIVITY_IDS], ["hyrox-bft", "hyrox-midtown"]);
assert.equal(isRetiredHyroxActivityId("hyrox-bft"), true);
assert.equal(isRetiredHyroxActivityId("hyrox-midtown"), true);
assert.equal(isRetiredHyroxActivityId("hyrox-quarry-bay"), false);
assert.equal(isRetiredHyroxActivityId("hyrox-quarry-bay-early"), false);
assert.equal(isRetiredHyroxActivityId("event-hyrox-bft-party"), false);
assert.equal(isRetiredHyroxActivityId("HYROX-BFT"), false);
assert.equal(isRetiredHyroxCycleId("hyrox-pool-2099-01-03"), true);
assert.equal(isRetiredHyroxCycleId("hyrox-pool-1"), false);
assert.equal(isRetiredHyroxCycleId("island-ecc-cycle-2099-01-03"), false);
assert.equal(isRetiredHyroxSession({ activityId: "hyrox-bft" }), true);
assert.equal(isRetiredHyroxSession({ activity_id: "hyrox-midtown" }), true);
assert.equal(isRetiredHyroxSession({ activityId: "hyrox-quarry-bay" }), false);
assert.equal(isRetiredHyroxSession({ activityId: "hyrox-quarry-bay-early" }), false);
assert.equal(isRetiredHyroxSession({ id: "hyrox-bft-2099-01-03" }), false,
  "session IDs alone are not authoritative for hydrated records");

const sessions = new Map([
  ["retired-bft", { id: "retired-bft", activityId: "hyrox-bft" }],
  ["retired-midtown", { id: "retired-midtown", activity_id: "hyrox-midtown" }],
  ["ecc", { id: "ecc", activityId: "hyrox-quarry-bay" }],
]);
const getSession = (id) => sessions.get(id) || null;
assert.equal(isRetiredHyroxBooking({ cycleId: "hyrox-pool-2099-01-03" }, () => null), true);
assert.equal(isRetiredHyroxBooking({ hyrox_cycle_id: "hyrox-pool-2099-01-10" }, () => null), true);
assert.equal(isRetiredHyroxBooking({ cycleId: "hyrox-pool-1" }, () => null), false,
  "noncanonical pool-like cycle IDs are not authoritative");
assert.equal(isRetiredHyroxBooking({ cycleId: "island-ecc-cycle-2099-01-03" }, () => null), false,
  "Island ECC records may carry unrelated cycle IDs");
assert.equal(isRetiredHyroxBooking({ cycleId: "community-cycle-2099-01-03" }, () => null), false,
  "arbitrary truthy cycle IDs are not retired");
assert.equal(isRetiredHyroxBooking({ sessionId: "retired-bft" }, getSession), true);
assert.equal(isRetiredHyroxBooking({ session_id: "retired-midtown" }, getSession), true);
assert.equal(isRetiredHyroxBooking({ sessionId: "ecc" }, getSession), false);
assert.equal(isRetiredHyroxBooking({ sessionId: "hyrox-bft-lookalike" }, () => null), false);

const bookings = new Map([
  ["pooled-booking", { id: "pooled-booking", cycleId: "hyrox-pool-2099-01-03" }],
  ["bft-booking", { id: "bft-booking", sessionId: "retired-bft" }],
  ["ecc-booking", { id: "ecc-booking", sessionId: "ecc" }],
]);
const getBooking = (id) => {
  const booking = bookings.get(id);
  if (!booking) return null;
  const session = getSession(booking.sessionId);
  return session ? { ...booking, activityId: session.activityId ?? session.activity_id } : booking;
};
const bookingIsRetired = (booking) => isRetiredHyroxBooking(booking, getSession);
assert.equal(isRetiredHyroxReceipt({ bookingId: "pooled-booking" }, getBooking), true);
assert.equal(isRetiredHyroxReceipt({ booking_id: "bft-booking" }, getBooking), true);
assert.equal(isRetiredHyroxReceipt({ bookingId: "ecc-booking" }, getBooking), false);
assert.equal(isRetiredHyroxReceipt({ cycleId: "hyrox-pool-2099-01-03" }, getBooking), true);
assert.equal(isRetiredHyroxReceipt({ cycleId: "island-ecc-cycle-2099-01-03" }, getBooking), false);

assert.equal(isRetiredHyroxNotification({ kind: "operational_hyrox_reserved" }, getBooking), true);
assert.equal(isRetiredHyroxNotification({ kind: "operational_hyrox_payment_reminder" }, getBooking), true);
assert.equal(isRetiredHyroxNotification({ kind: "hyrox-waitlisted" }, getBooking), true,
  "device-local pool-only notification kinds retire without substring matching");
assert.equal(isRetiredHyroxNotification({ kind: "hyrox-replacement-confirmed" }, getBooking), false,
  "replacement kinds remain relationship-scoped for Island ECC");
assert.equal(isRetiredHyroxNotification({ kind: "operational_hyrox_quarry_bay_payment" }, getBooking), false,
  "unknown lookalike notification kinds are not hidden by a prefix match");
assert.equal(isRetiredHyroxNotification({ kind: "payment_confirmed", bookingId: "pooled-booking" }, getBooking), true);
assert.equal(isRetiredHyroxNotification({ kind: "payment_confirmed", cycleId: "hyrox-pool-2099-01-03" }, getBooking), true);
assert.equal(isRetiredHyroxNotification({ kind: "payment_confirmed", cycleId: "island-ecc-cycle-2099-01-03" }, getBooking), false);
assert.equal(isRetiredHyroxNotification({ kind: "payment_confirmed", destination: "#/booking/bft-booking" }, getBooking), true);
assert.equal(isRetiredHyroxNotification({ kind: "payment_confirmed", destination: "#/pay/pooled-booking" }, getBooking), true);
assert.equal(isRetiredHyroxNotification({ kind: "payment_confirmed", destination: "#/booking/ecc-booking" }, getBooking), false,
  "Island ECC payment notifications remain visible");
assert.equal(isRetiredHyroxNotification({ kind: "operational_payment_confirmed", destination: "#/pay/ecc-booking" }, getBooking), false);
assert.equal(isRetiredHyroxNotification({ kind: "operational_island_ecc_payment_reminder" }, getBooking), false);
assert.equal(isRetiredHyroxNotification({ kind: "operational_island_ecc_collector_finalize_reminder" }, getBooking), false);
assert.equal(isRetiredHyroxNotification({ kind: "operational_island_ecc_collector_finalize_nudge" }, getBooking), false);
assert.equal(isRetiredHyroxNotification({ kind: "event-hyrox-bft-party" }, getBooking, getSession), false);

assert.equal(isRetiredHyroxLegacyRouteId("hyrox-bft"), true);
assert.equal(isRetiredHyroxLegacyRouteId("hyrox-midtown-2099-01-03"), true);
assert.equal(isRetiredHyroxLegacyRouteId("hyrox-pool-2099-01-03"), true);
assert.equal(isRetiredHyroxLegacyRouteId("retired-pool-booking"), false,
  "arbitrary booking IDs require relationship-backed route tombstones");
assert.equal(isRetiredHyroxLegacyRouteId("hyrox-pool-1"), false);
assert.equal(isRetiredHyroxLegacyRouteId("hyrox-quarry-bay-2099-01-03"), false);
assert.equal(isRetiredHyroxLegacyRouteId("hyrox-quarry-bay-early-2099-01-03"), false);
assert.equal(isRetiredHyroxLegacyRouteId("event-hyrox-bft-party"), false);

// Also prove callback composition independently of the fixture helpers above.
assert.equal(bookingIsRetired(getBooking("ecc-booking")), false);

console.log("ok  exact frontend HYROX retirement classifier");
