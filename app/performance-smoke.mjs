import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const app = await read("./js/app.js");
const store = await read("./js/store.js");
const operations = await read("./js/operations.js");
const runbook = await read("../docs/runbooks/live-auth.md");

for (const mark of [
  "itc:shell-start",
  "itc:viewer-ready",
  "itc:first-route-commit",
  "itc:operations-ready",
]) assert.match(app, new RegExp(mark.replaceAll(":", "\\:")));

for (const loader of [
  "ensureHyroxCycleData",
  "ensureBookingData",
  "ensureHistoryData",
  "ensurePaymentData",
  "ensureQueueData",
  "ensureRsvpCountData",
  "ensureCollectorData",
  "ensureVenueData",
]) assert.match(app + store, new RegExp(loader));

for (const channel of ["itc-schedule", "itc-hyrox", "itc-operations"]) {
  assert.match(operations, new RegExp(channel));
}
assert.match(store, /skipHyrox: true/);
assert.match(store, /skipReceipts: true/);
assert.match(store, /skipQueues: true/);
assert.match(store, /skipCollectorOps: true/);
assert.match(store, /skipRsvpCounts: true/);
assert.match(store, /skipVenueOverrides: true/);
assert.match(runbook, /direct HYROX route/);
assert.match(runbook, /Booking History/);

console.log("Performance wiring smoke passed.");
