// Headless smoke test: render every view for every user state.
// Run: node --input-type=module < smoke.mjs  (from the app/ directory)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { assertFpsCopyBindings } from "./test-html.mjs";

// --- localStorage shim ---
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const store = await import("./js/store.js");
const views = await import("./js/views.js");
const data = await import("./js/data.js");
const hyroxCycle = await import("./js/hyrox-cycle.js");

const hktRolloverInstant = Date.parse("2026-08-05T16:30:00.000Z");
assert.equal(data.todayHktISO(hktRolloverInstant), "2026-08-06",
  "current HKT date must not depend on the browser timezone");
assert.equal(
  data.hktEventStartMs("2026-08-06", "00:30:00"),
  hktRolloverInstant,
  "Hong Kong event wall time must resolve to the same instant in every browser timezone",
);

let failures = 0;
async function check(label, fn) {
  try {
    const out = await Promise.resolve(fn());
    if (out && typeof out === "object" && out.redirect) {
      console.log(`ok(redirect) ${label} -> ${out.redirect}`);
      return out;
    }
    if (typeof out !== "string" || out.length < 50) {
      throw new Error(`suspicious output (len ${typeof out === "string" ? out.length : "obj"})`);
    }
    console.log(`ok  ${label}`);
    return out;
  } catch (err) {
    failures++;
    console.error(`FAIL ${label}: ${err.message}`);
    return "";
  }
}

const primaryNavLabels = (html) =>
  [...html.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]);

function assertPrimaryNav(user, expected, label) {
  const html = views.navHTML("home", user);
  const labels = primaryNavLabels(html);
  if (JSON.stringify(labels) !== JSON.stringify(expected)) {
    throw new Error(`${label} primary navigation labels were ${JSON.stringify(labels)}`);
  }
  if (labels.includes("Admin")) {
    throw new Error(`${label} primary navigation must not include Admin`);
  }
  if (labels.includes("Giving") !== !!user) {
    throw new Error(`Giving must appear only in signed-in primary navigation (${label})`);
  }
}

store.load();
const bftSeed = data.SEED_ACTIVITIES.find((activity) => activity.id === "hyrox-bft");
const quarryBaySeed = data.SEED_ACTIVITIES.find((activity) => activity.id === "hyrox-quarry-bay");
assert.ok(bftSeed, "BFT HYROX must use the canonical hyrox-bft activity id");
assert.equal(data.SEED_ACTIVITIES.some((activity) => activity.id === "hyrox"), false,
  "the ambiguous legacy hyrox activity id must not remain canonical");
assert.deepEqual(quarryBaySeed && {
  name: quarryBaySeed.name,
  weekday: quarryBaySeed.weekday,
  time: quarryBaySeed.time,
  durationMin: quarryBaySeed.durationMin,
  location: quarryBaySeed.location,
  mapsQuery: quarryBaySeed.mapsQuery,
  price: quarryBaySeed.price,
  capacity: quarryBaySeed.capacity,
}, {
  name: "ITC HYROX",
  weekday: 6,
  time: "11:00",
  durationMin: 60,
  location: "10/F, Island ECC, Quarry Bay",
  mapsQuery: "Island ECC, Quarry Bay, Hong Kong",
  price: 180,
  capacity: 30,
}, "IA-37 Quarry Bay HYROX must match the approved recurring-session details");
assert.equal(data.fmtMoney(180), "HK$180",
  "consumer-facing Hong Kong prices should use the standard HK$ symbol");
const legacyBftActivity = { ...bftSeed, id: "hyrox" };
localStorage.setItem("itc.prototype.v1", JSON.stringify({
  version: 16,
  sessionUserId: null,
  activities: [legacyBftActivity, {
    ...quarryBaySeed,
    location: "10/F, 633 King's Road, Quarry Bay, Hong Kong",
    mapsQuery: "10/F, 633 King's Road, Quarry Bay, Hong Kong",
  }],
  users: [],
  bookings: [{
    id: "legacy-bft-booking", userId: "legacy-member",
    sessionId: "hyrox-2099-01-03", status: "confirmed",
    deferredTo: "hyrox-2099-01-10",
    snapshot: { name: "ITC HYROX", dateISO: "2099-01-03", time: "11:15", location: "BFT Causeway Bay", price: 180 },
  }, {
    id: "legacy-quarry-booking", userId: "legacy-member",
    sessionId: "hyrox-quarry-bay-2099-01-03", status: "confirmed",
    snapshot: { name: "ITC HYROX", dateISO: "2099-01-03", time: "11:00", location: "10/F, 633 King's Road, Quarry Bay, Hong Kong", price: 180 },
  }],
  receipts: [{ id: "legacy-receipt", bookingId: "legacy-bft-booking", sessionId: "hyrox-2099-01-03" }],
  receiptCounter: 50,
  paymentPayouts: {}, campaigns: [], donations: [], prayers: [], oneOffEvents: [],
  sessionOverrides: { "hyrox-2099-01-03": { cancelled: "Legacy fixture" } },
  queues: { "hyrox-2099-01-03": { waitlist: [], interest: [] } },
  notifications: [{ id: "legacy-note", link: "#/activity/hyrox-2099-01-03" }],
  duty: {},
}));
const renamedState = store.load();
assert.equal(renamedState.version, 19, "legacy state must advance through the HYROX identifier, venue and pooled-cycle migrations");
assert.ok(renamedState.activities.some((activity) => activity.id === "hyrox-bft"));
assert.ok(renamedState.activities.some((activity) => activity.id === "hyrox-quarry-bay"));
assert.equal(renamedState.activities.some((activity) => activity.id === "hyrox"), false);
assert.equal(renamedState.bookings[0].sessionId, "hyrox-bft-2099-01-03");
assert.equal(renamedState.bookings[0].deferredTo, "hyrox-bft-2099-01-10");
assert.equal(renamedState.receipts[0].sessionId, "hyrox-bft-2099-01-03");
assert.ok(renamedState.queues["hyrox-bft-2099-01-03"]);
assert.ok(renamedState.sessionOverrides["hyrox-bft-2099-01-03"]);
assert.equal(renamedState.notifications[0].link, "#/activity/hyrox-bft-2099-01-03");
const migratedQuarryBay = renamedState.activities.find((activity) =>
  activity.id === "hyrox-quarry-bay"
);
assert.equal(migratedQuarryBay.location, "10/F, Island ECC, Quarry Bay");
assert.equal(migratedQuarryBay.mapsQuery, "Island ECC, Quarry Bay, Hong Kong");
assert.equal(
  renamedState.bookings.find((booking) => booking.id === "legacy-quarry-booking")?.snapshot.location,
  "10/F, Island ECC, Quarry Bay",
  "existing Quarry Bay booking snapshots must show the corrected venue"
);
store.resetLocalData();
const { existsSync, readFileSync } = await import("node:fs");
const { resolve, dirname } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const __dirnameSmoke = dirname(fileURLToPath(import.meta.url));
const storeSource = readFileSync(resolve(__dirnameSmoke, "js/store.js"), "utf8");
const weekVenueSource = storeSource.match(
  /export function setWeekVenue[\s\S]*?\/\/ --- Giving/
)?.[0] || "";
const orderedWeekVenueAuthorization = /const before = getSession\(sessionId\);\s*const fallbackActivityId = String\(sessionId\)\.replace\([^\n]+\);\s*const overrideActivityId = before\?\.activityId \|\| fallbackActivityId;\s*if \(!new Set\(\["wnt", "run", "water", "lunch"\]\)\.has\(overrideActivityId\)\) \{/;
if (!orderedWeekVenueAuthorization.test(weekVenueSource)) {
  throw new Error("setWeekVenue should resolve the session before fallback authorization and the allow-list");
}

for (const relativePath of [
  "js/config.js",
  "live-auth-smoke.mjs",
  "../supabase/migrations/20260804000000_profiles.sql",
  "../supabase/migrations/20260805000007_admin_application_decisions.sql",
  "../supabase/migrations/20260827000001_hyrox_indemnity_fields.sql",
  "../supabase/migrations/20260902000001_hyrox_bft_quarry_bay.sql",
  "../supabase/migrations/20260902000002_quarry_bay_island_ecc.sql",
  "../supabase/migrations/20260903000001_hyrox_cycle_schema.sql",
  "../supabase/migrations/20260903000002_hyrox_cycle_member_rpcs.sql",
  "../supabase/migrations/20260903000003_hyrox_cycle_reconciliation.sql",
  "../supabase/migrations/20260903000004_hyrox_cycle_allocation.sql",
  "../supabase/migrations/20260904000001_hyrox_cycle_auto_provision.sql",
]) {
  const absolutePath = resolve(__dirnameSmoke, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Payment Auth baseline missing ${relativePath}`);
  }
}
console.log("ok  Payment Auth baseline foundation files exist");

const profilesMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260804000000_profiles.sql"),
  "utf8"
);
const indemnityMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260827000001_hyrox_indemnity_fields.sql"),
  "utf8"
);
const assignedPayoutMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260829000005_assigned_collector_payout_rpc.sql"),
  "utf8"
);
const hyroxActivityMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260902000001_hyrox_bft_quarry_bay.sql"),
  "utf8"
);
const quarryBayVenueMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260902000002_quarry_bay_island_ecc.sql"),
  "utf8"
);
for (const marker of [
  "10/F, Island ECC, Quarry Bay",
  "Island ECC, Quarry Bay, Hong Kong",
  "activity_id = 'hyrox-quarry-bay'",
  "session_date >= (now() at time zone 'Asia/Hong_Kong')::date",
]) {
  assert.ok(quarryBayVenueMigrationSource.includes(marker),
    `Quarry Bay venue migration must include ${marker}`);
}
assert.equal((hyroxActivityMigrationSource.match(
  /drop constraint operational_activity_templates_activity_id_check/g
) || []).length, 2,
"HYROX activity migration must allow the legacy id during rename, then tighten the constraint");
const settleHyroxConstraintsAt = hyroxActivityMigrationSource.indexOf(
  "operational_rsvp_counts_session_id_fkey immediate;"
);
const tightenHyroxTemplateAt = hyroxActivityMigrationSource.indexOf(
  "-- Tighten the template id contract"
);
assert.ok(settleHyroxConstraintsAt >= 0 && settleHyroxConstraintsAt < tightenHyroxTemplateAt,
  "deferred rename constraints must settle before altering the template table again");
for (const marker of [
  "'hyrox-bft'",
  "'hyrox-quarry-bay'",
  "10/F, 633 King''s Road, Quarry Bay, Hong Kong",
  "'11:00'",
  "60",
  "12",
  "180",
  "default_open",
  "replace(id, 'hyrox-', 'hyrox-bft-')",
]) {
  assert.ok(hyroxActivityMigrationSource.includes(marker),
    `HYROX activity migration must include ${marker}`);
}
for (const marker of [
  "security definer",
  "set search_path = public",
  "current_user_role()",
  "collector_assignments",
  "collector_payout_profiles",
  "revoke all on function public.get_assigned_collector_payout_profiles() from public",
  "grant execute on function public.get_assigned_collector_payout_profiles() to authenticated",
]) {
  assert.ok(
    assignedPayoutMigrationSource.toLowerCase().includes(marker),
    `assigned collector payout migration missing ${marker}`
  );
}
console.log("ok  assigned collector payout RPC migration keeps least-privilege controls");

const applicationMobilePayoutMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260901000001_assigned_collector_application_mobile.sql"),
  "utf8"
);
const applicationMobilePayoutFunction = applicationMobilePayoutMigrationSource.match(
  /create or replace function public\.get_assigned_collector_payout_profiles\(\)[\s\S]*?\n\$\$;/i
)?.[0] || "";
assert.match(applicationMobilePayoutFunction,
  /left join public\.applications as application[\s\S]*?on application\.profile_id = assignment\.collector_profile_id/i,
  "assigned collector payout reads must preserve PayMe if Membership Details are temporarily unavailable");
assert.match(applicationMobilePayoutFunction,
  /left join public\.collector_payout_profiles as payout/i,
  "an assigned collector's FPS number must not require a saved payout profile");
assert.match(applicationMobilePayoutFunction,
  /application\.mobile\s+as fps_phone/i,
  "assigned collector FPS must come directly from applications.mobile");
assert.doesNotMatch(applicationMobilePayoutFunction,
  /payout\.fps_phone/i,
  "assigned collector payout reads must not trust the duplicated payout phone");
assert.match(applicationMobilePayoutFunction,
  /current_user_role\(\)[\s\S]*?'member'[\s\S]*?'admin'[\s\S]*?'super_admin'/i,
  "application mobile payout reads must remain approved-member-only");
console.log("ok  assigned collector FPS reads directly from applications.mobile");

const collectorIdentityMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260901000002_assigned_collector_display_identity.sql"),
  "utf8"
);
const collectorIdentityFunction = collectorIdentityMigrationSource.match(
  /create function public\.get_assigned_collector_payout_profiles\(\)[\s\S]*?\n\$\$;/i
)?.[0] || "";
assert.match(collectorIdentityMigrationSource,
  /drop function public\.get_assigned_collector_payout_profiles\(\)/i,
  "the forward identity migration must explicitly replace the RPC return type");
for (const field of ["full_name text", "preferred_name text"]) {
  assert.match(collectorIdentityFunction, new RegExp(field, "i"),
    `assigned collector identity RPC missing ${field}`);
}
assert.match(collectorIdentityFunction,
  /from public\.collector_assignments as assignment[\s\S]*?left join public\.profiles as profile[\s\S]*?left join public\.applications as application/i,
  "assigned collector identity must remain rooted in collector assignments");
assert.doesNotMatch(collectorIdentityFunction,
  /email|emergency_|guardian_|donor_/i,
  "assigned collector identity RPC must not expose unrelated member details");
assert.match(collectorIdentityFunction,
  /current_user_role\(\)[\s\S]*?'member'[\s\S]*?'admin'[\s\S]*?'super_admin'/i,
  "assigned collector display identity must remain approved-member-only");
console.log("ok  assigned collector RPC exposes only narrow display identity");

const lunchMeetingRpcMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260829000006_lunch_venue_meeting_point_rpc.sql"),
  "utf8"
);
const rsvpIntegrityMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260829000008_rsvp_integrity.sql"),
  "utf8"
);
const attendeeNamesMigrationPath = resolve(
  __dirnameSmoke, "../supabase/migrations/20260905000001_operational_attendee_names.sql"
);
if (!existsSync(attendeeNamesMigrationPath)) {
  throw new Error("approved attendee names migration must exist");
}
const attendeeNamesMigrationSource = readFileSync(attendeeNamesMigrationPath, "utf8");
const operationalIntegrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/tests/operational_backend_integration.sql"),
  "utf8"
);
for (const marker of [
  "get_operational_rsvp_counts",
  "requires_rsvp",
  "status = 'confirmed'",
  "at time zone 'Asia/Hong_Kong'",
  "reserve_operational_session",
  "withdraw_operational_rsvp",
  "grant execute on function public.get_operational_rsvp_counts() to anon, authenticated",
]) assert.ok(rsvpIntegrityMigrationSource.includes(marker));
const rsvpCountFunctionSource = rsvpIntegrityMigrationSource.match(
  /create or replace function public\.get_operational_rsvp_counts\(\)[\s\S]*?\n\$\$;/
)?.[0] || "";
const rsvpCountReturnColumns = rsvpCountFunctionSource.match(
  /returns table\s*\(([\s\S]*?)\)/i
)?.[1].replace(/\s+/g, " ").trim();
assert.equal(rsvpCountReturnColumns, "session_id text, going_count bigint",
  "public RSVP counts must expose only session ID and confirmed total");
assert.match(rsvpCountFunctionSource, /from public\.operational_rsvp_counts/,
  "the public RSVP aggregate must read only the identity-free count table");
assert.doesNotMatch(rsvpCountFunctionSource, /operational_bookings|profiles/,
  "the public RSVP aggregate must not read identity-bearing tables");
const rsvpCountTableSource = rsvpIntegrityMigrationSource.match(
  /create table(?: if not exists)? public\.operational_rsvp_counts[\s\S]*?\n\);/
)?.[0] || "";
for (const contract of [
  /session_id text primary key[\s\S]*?references public\.operational_sessions\(id\)/,
  /going_count bigint not null default 0[\s\S]*?check \(going_count >= 0\)/,
  /updated_at timestamptz not null default now\(\)/,
]) assert.match(rsvpCountTableSource, contract);
assert.match(rsvpIntegrityMigrationSource,
  /create table if not exists public\.operational_rsvp_counts/,
  "undeployed RSVP integrity migration must be safe to reapply in disposable integration tests");
assert.match(rsvpIntegrityMigrationSource,
  /alter table public\.operational_rsvp_counts enable row level security/);
assert.match(rsvpIntegrityMigrationSource,
  /drop policy if exists "public read operational RSVP counts"[\s\S]*?create policy "public read operational RSVP counts"/,
  "RSVP count policy recreation must be safe when the migration is reapplied");
assert.match(rsvpIntegrityMigrationSource,
  /create policy[\s\S]*?on public\.operational_rsvp_counts[\s\S]*?for select[\s\S]*?using \(true\)/);
assert.match(rsvpIntegrityMigrationSource,
  /revoke all on table public\.operational_rsvp_counts from public, anon, authenticated/);
assert.match(rsvpIntegrityMigrationSource,
  /grant select on table public\.operational_rsvp_counts to anon, authenticated/);
assert.doesNotMatch(rsvpIntegrityMigrationSource,
  /grant\s+(?:all|insert|update|delete|truncate|references|trigger)[\s\S]*?on\s+(?:table\s+)?public\.operational_rsvp_counts/i,
  "browser roles must never receive RSVP count-table writes");
assert.match(rsvpIntegrityMigrationSource,
  /create or replace function public\.recalculate_operational_rsvp_count\(\s*p_session_id text\s*\)[\s\S]*?security definer/);
assert.match(rsvpIntegrityMigrationSource,
  /create trigger sync_operational_rsvp_count[\s\S]*?after insert or update or delete[\s\S]*?on public\.operational_bookings/);
assert.match(rsvpIntegrityMigrationSource,
  /revoke all on function public\.recalculate_operational_rsvp_count\(text\) from public, anon, authenticated/);
assert.match(rsvpIntegrityMigrationSource,
  /revoke all on function public\.sync_operational_rsvp_count\(\) from public, anon, authenticated/);
assert.match(rsvpIntegrityMigrationSource,
  /insert into public\.operational_rsvp_counts[\s\S]*?left join public\.operational_bookings[\s\S]*?where t\.requires_rsvp/,
  "migration must backfill every existing RSVP session, including zero counts");
assert.match(rsvpIntegrityMigrationSource,
  /if not exists \([\s\S]*?from pg_publication_tables[\s\S]*?tablename = 'operational_rsvp_counts'[\s\S]*?\) then[\s\S]*?alter publication supabase_realtime add table public\.operational_rsvp_counts/,
  "RSVP count publication membership must be guarded for migration reapplication");
const reserveOperationalSessionSource = rsvpIntegrityMigrationSource.match(
  /create or replace function public\.reserve_operational_session\([\s\S]*?\n\$\$;/
)?.[0] || "";
assert.match(reserveOperationalSessionSource,
  /if v_is_rsvp then[\s\S]*?at time zone 'Asia\/Hong_Kong' <= now\(\)[\s\S]*?elsif v_session\.session_date <= \(now\(\) at time zone 'Asia\/Hong_Kong'\)::date then/,
  "RSVP must use its exact HKT start while paid reservations reject the entire HKT session date");
assert.match(rsvpIntegrityMigrationSource,
  /revoke all on function public\.reserve_operational_session\(text\) from public, anon/);
assert.match(rsvpIntegrityMigrationSource,
  /revoke all on function public\.withdraw_operational_rsvp\(uuid\) from public, anon/);
assert.doesNotMatch(rsvpIntegrityMigrationSource,
  /grant[^\n]*(?:all|select|insert|update|delete)[^\n]*on\s+(?:table\s+)?public\.operational_bookings/i,
  "RSVP count migration must not grant direct booking-table access");
const attendeeNamesFunctionSource = attendeeNamesMigrationSource.match(
  /create or replace function public\.get_operational_attendee_names\([^)]*\)[\s\S]*?\n\$\$;/
)?.[0] || "";
assert.match(attendeeNamesFunctionSource, /returns table\s*\(\s*display_name text\s*\)/i,
  "attendee names RPC must return display labels only");
assert.match(attendeeNamesFunctionSource, /security definer/i);
assert.match(attendeeNamesFunctionSource, /(?:auth\.uid\(\)|current_user_role\(\))/i);
assert.match(attendeeNamesFunctionSource, /role in \('member', 'admin', 'super_admin'\)/i);
assert.match(attendeeNamesFunctionSource, /status\s*=\s*'confirmed'/i);
assert.match(attendeeNamesFunctionSource, /operational_bookings[\s\S]*profiles/i);
assert.match(attendeeNamesMigrationSource,
  /revoke all on function public\.get_operational_attendee_names\(text\)\s+from public, anon, authenticated/);
assert.match(attendeeNamesMigrationSource,
  /grant execute on function public\.get_operational_attendee_names\(text\)\s+to authenticated/);
assert.doesNotMatch(attendeeNamesMigrationSource,
  /grant execute on function public\.get_operational_attendee_names\(text\)\s+to anon/);
assert.doesNotMatch(attendeeNamesMigrationSource,
  /grant\s+(?:all|select|insert|update|delete)[^\n]*on\s+(?:table\s+)?public\.operational_bookings/i,
  "attendee names migration must not grant direct booking-table access");
assert.doesNotMatch(attendeeNamesMigrationSource,
  /email|mobile|phone/i,
  "attendee names RPC must not expose contact details");
assert.doesNotMatch(operationalIntegrationSource,
  /from\s+(?:public\.)?reserve_operational_session\('hyrox-2026-/,
  "successful SQL reservation fixtures must use dynamic future sessions");
assert.doesNotMatch(operationalIntegrationSource,
  /join_operational_queue\('hyrox-midtown-\d{4}-\d{2}-\d{2}',\s*'(?:interest|waitlist)'\)/,
  "queue guard scenarios must use a deterministic future Midtown fixture");
assert.match(operationalIntegrationSource,
  /v_future_hk\s+timestamp := \(now\(\) \+ interval '1 hour'\) at time zone 'Asia\/Hong_Kong'/);
assert.match(operationalIntegrationSource,
  /v_boundary_before_session := 'event-rsvp-boundary-before-' \|\| v_future_hk::date::text/,
  "pre-start boundary ID must derive from the same future HKT timestamp as its date/time");
assert.match(operationalIntegrationSource,
  /v_boundary_at_session := 'event-rsvp-boundary-at-' \|\| v_at_start_hk::date::text/,
  "at-start boundary ID must derive from the same HKT timestamp as its date/time");
assert.equal(
  (operationalIntegrationSource.match(/\\ir \.\.\/migrations\/20260829000008_rsvp_integrity\.sql/g) || []).length,
  1,
  "integration must reapply the actual RSVP migration once after backfill fixtures exist",
);
const cancellationQueueIntegrationSource = operationalIntegrationSource.match(
  /-- Admin cancellation atomicity\.[\s\S]*?-- Cancellation rollback test:/
)?.[0] || "";
assert.match(operationalIntegrationSource,
  /cancel_midtown_session text not null/,
  "cancellation coverage must derive its closed Midtown fixture from the shared HKT-relative table");
assert.match(cancellationQueueIntegrationSource,
  /select cancel_session, cancel_midtown_session[\s\S]*?into v_session_id, v_midtown_session_id[\s\S]*?from operational_time_fixtures/,
  "cancellation coverage must select the dated Midtown session from the shared HKT-relative fixture");
assert.match(cancellationQueueIntegrationSource,
  /perform pg_temp\.op_assert\(\s*exists \([\s\S]*?where id = v_midtown_session_id[\s\S]*?and activity_id = 'hyrox-midtown'[\s\S]*?and session_date > \(now\(\) at time zone 'Asia\/Hong_Kong'\)::date[\s\S]*?and not is_open[\s\S]*?and cancelled_at is null[\s\S]*?\),[\s\S]*?'closed Midtown interest fixture exists with required properties'[\s\S]*?\);/,
  "cancellation coverage must explicitly prove the Midtown fixture exists, is future-derived, closed, and active");
assert.match(cancellationQueueIntegrationSource,
  /join_operational_queue\(v_midtown_session_id, 'interest'\)/,
  "cancellation coverage must join interest through the dynamic Midtown fixture variable");
assert.doesNotMatch(cancellationQueueIntegrationSource,
  /join_operational_queue\('hyrox-midtown-\d{4}-\d{2}-\d{2}', 'interest'\)/,
  "cancellation coverage must not call the interest queue with a dated Midtown literal");
const upcomingSessionsSource = storeSource.match(
  /export function upcomingSessions\(days = 14\)[\s\S]*?\n}\n\nexport function nextSession/
)?.[0] || "";
assert.match(upcomingSessionsSource,
  /end\.setDate\(end\.getDate\(\) \+ days - 1\)/,
  "live upcomingSessions must compute an inclusive calendar-day end date");
assert.match(upcomingSessionsSource,
  /s\.dateISO >= todayISO && s\.dateISO <= endISO/,
  "live upcomingSessions must apply its inclusive upper date bound");
assert.match(upcomingSessionsSource, /todayHktISO\(\)/,
  "upcomingSessions must anchor its calendar horizon to the current HKT date");
const nextSocialSessionSource = storeSource.match(
  /export function nextSocialSession\(\)[\s\S]*?\n}\n\n\/\/ --- Community/
)?.[0] || "";
assert.match(nextSocialSessionSource, /hktEventStartMs\(session\.dateISO, session\.time\)/,
  "nextSocialSession must compare Hong Kong event-start instants");
assert.doesNotMatch(nextSocialSessionSource, /setHours\(/,
  "nextSocialSession must not interpret Hong Kong wall time in the browser timezone");
const lunchMeetingRpcSixArgumentSource = lunchMeetingRpcMigrationSource.match(
  /create or replace function public\.set_session_venue\([\s\S]*?p_meeting_lat double precision,[\s\S]*?p_meeting_lng double precision[\s\S]*?\n\$\$;/
)?.[0] || "";
assert.match(lunchMeetingRpcSixArgumentSource,
  /set_session_venue\([\s\S]*?p_meeting_lat double precision,[\s\S]*?p_meeting_lng double precision/);
assert.match(lunchMeetingRpcSixArgumentSource,
  /v_activity_id not in \('wnt', 'run', 'water', 'lunch'\)/);
assert.match(lunchMeetingRpcSixArgumentSource,
  /v_is_wnt_tamar := v_activity_id = 'wnt'/);
assert.match(lunchMeetingRpcSixArgumentSource,
  /when 'lunch' then 'Post-Training Lunch'/);
assert.match(lunchMeetingRpcMigrationSource,
  /select public\.set_session_venue\([\s\S]*?p_was_tbc, null, null[\s\S]*?\);/);
const notificationRoutingMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260829000007_notification_destinations.sql"),
  "utf8"
);
const notificationEventRoutingMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260830000003_notification_event_destinations.sql"),
  "utf8"
);
const operationalBackendIntegrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/tests/operational_backend_integration.sql"),
  "utf8"
);
const normalizedNotificationRoutingMigrationSource = notificationRoutingMigrationSource.toLowerCase();
for (const marker of [
  "security definer",
  "set search_path = public",
  "before insert on public.notifications",
  "resolve_notification_destination",
  "resolve_historical_booking_notification_destination",
  "operational_booking_reserved",
  "#/pay/",
  "count(*)",
  "profile_id",
  "revoke all on function public.resolve_notification_destination",
  "revoke all on function public.resolve_historical_booking_notification_destination",
]) {
  if (!normalizedNotificationRoutingMigrationSource.includes(marker)) {
    throw new Error(`notification routing migration missing ${marker}`);
  }
}
if (/alter\s+table\s+public\.notifications\b[^;]*(?:enable|disable|force|no\s+force)\s+row\s+level\s+security/i.test(notificationRoutingMigrationSource)) {
  throw new Error("notification routing migration must not alter notification RLS");
}
if (/grant\s+[^;]*\b(?:all(?:\s+privileges)?|insert|update|delete|truncate|references|trigger)\b[^;]*\s+on\s+(?:table\s+)?public\.notifications\b/i.test(notificationRoutingMigrationSource)) {
  throw new Error("notification routing migration must not grant notification-table writes");
}
const notificationRoutingFunctionDeclarations = [
  ...notificationRoutingMigrationSource.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/gi),
].map((match) => match[1]).sort();
if (JSON.stringify(notificationRoutingFunctionDeclarations) !== JSON.stringify([
  "resolve_historical_booking_notification_destination",
  "resolve_notification_destination",
  "route_notification_destination",
])) {
  throw new Error("notification routing migration must declare only the exact, historical-booking, and trigger functions");
}
const notificationResolverBody = (functionName, source = notificationRoutingMigrationSource) => {
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${escapedName}\\s*\\([\\s\\S]*?\\)\\s*returns[\\s\\S]*?\\bas\\s+\\$\\$([\\s\\S]*?)\\$\\$;`,
    "i"
  ));
  if (!match) throw new Error(`notification routing migration missing ${functionName} body`);
  return match[1];
};
const exactNotificationResolverBody = notificationResolverBody("resolve_notification_destination");
if (/interval\s+'5 seconds'/i.test(exactNotificationResolverBody)
    || !/=\s*p_created_at\b/i.test(exactNotificationResolverBody)) {
  throw new Error("notification insert resolver must use exact event timestamps, never a fuzzy window");
}
const historicalBookingResolverBody = notificationResolverBody(
  "resolve_historical_booking_notification_destination"
);
if (!/interval\s+'5 seconds'/i.test(historicalBookingResolverBody)
    || !/public\.operational_bookings\b/i.test(historicalBookingResolverBody)) {
  throw new Error("historical booking resolver must retain bounded booking-only fuzzy matching");
}
if (/public\.operational_sessions\b|cancelled_at\b|operational_session_cancelled(?:_no_defer)?\b/i.test(historicalBookingResolverBody)) {
  throw new Error("historical booking resolver must not infer cancellation destinations");
}
console.log("ok  notification migration separates exact inserts from booking-only historical matching");
const eventExactResolverBody = notificationResolverBody(
  "resolve_notification_destination", notificationEventRoutingMigrationSource
);
for (const kind of ["operational_session_cancelled_no_defer", "operational_session_cancelled"]) {
  const branch = eventExactResolverBody.match(new RegExp(
    `if\\s+p_kind\\s*=\\s*'${kind}'[\\s\\S]*?\\n\\s*end\\s+if;`, "i"
  ))?.[0] || "";
  assert.match(branch, /s\.cancelled_at\s*=\s*p_created_at/i,
    `${kind} must use authoritative exact cancellation linkage`);
  assert.doesNotMatch(branch, /price_hkd\s*=\s*0|requires_rsvp/i,
    `${kind} must not exclude paid cancellations`);
  assert.match(branch, /return\s+'#\/activity\/'\s*\|\|\s*v_session_id/i,
    `${kind} must route a unique cancellation to Activity Details`);
}
const historicalEventResolverBody = notificationResolverBody(
  "resolve_historical_notification_event_destination", notificationEventRoutingMigrationSource
);
assert.doesNotMatch(historicalEventResolverBody, /interval\s+'5 seconds'|operational_sessions|cancelled_at/i,
  "historical cancellation resolver must not fuzzy-match session rows");
for (const functionName of [
  "resolve_notification_destination",
  "resolve_historical_booking_notification_destination",
  "resolve_historical_notification_event_destination",
  "route_notification_destination",
]) {
  assert.match(notificationEventRoutingMigrationSource, new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}[\\s\\S]*?security\\s+definer[\\s\\S]*?set\\s+search_path\\s*=\\s*public`, "i"
  ), `${functionName} must be SECURITY DEFINER with a fixed public search_path`);
  assert.match(notificationEventRoutingMigrationSource, new RegExp(
    `revoke\\s+all\\s+on\\s+function\\s+public\\.${functionName}`, "i"
  ), `${functionName} must revoke browser execution`);
}
console.log("ok  event notification resolver keeps paid cancellation routes authoritative and historical rows unresolved");
const normalizedNotificationEventRoutingSource = notificationEventRoutingMigrationSource.toLowerCase();
for (const marker of [
  "create or replace function public.resolve_notification_destination",
  "create or replace function public.resolve_historical_booking_notification_destination",
  "resolve_historical_notification_event_destination",
  "set search_path = public",
  "operational_booking_reserved",
  "operational_rsvp_confirmed",
  "operational_session_cancelled_no_defer",
  "operational_session_cancelled",
  "requires_rsvp",
  "price_hkd",
  "#/pay/",
  "#/activity/",
  "revoke all on function public.resolve_notification_destination",
  "revoke all on function public.resolve_historical_notification_event_destination",
]) {
  if (!normalizedNotificationEventRoutingSource.includes(marker)) {
    throw new Error(`forward notification event migration missing ${marker}`);
  }
}
if (!/left\(n\.destination,\s*2\)\s*<>\s*'#\/'/i.test(notificationEventRoutingMigrationSource)
    || !/b\.destination\s+is\s+not\s+null/i.test(notificationEventRoutingMigrationSource)) {
  throw new Error("forward notification backfill must preserve valid routes and update only resolved rows");
}
if (/grant\s+execute\s+on\s+function\s+public\.(?:resolve_notification_destination|resolve_historical_notification_event_destination)/i.test(notificationEventRoutingMigrationSource)
    || /alter\s+table\s+public\.notifications\b[^;]*(?:enable|disable|force|no\s+force)\s+row\s+level\s+security/i.test(notificationEventRoutingMigrationSource)) {
  throw new Error("forward notification resolvers must stay browser-inaccessible without changing notification RLS");
}
console.log("ok  forward notification migration classifies event routes without broadening browser access");
for (const marker of [
  "v_payment_marked_before",
  "v_payment_marked_after",
  "v_gym_finalized_before",
  "v_gym_finalized_after",
  "v_unique_cancel_session",
  "v_cancelled_admin_before",
  "v_cancelled_admin_after",
  "notification_routing_backfill_snapshot",
  "nearby-booking",
  "historical-rsvp-unique",
  "historical-rsvp-ambiguous",
  "historical-cancellation",
  "notification routing migration second reapplication is idempotent",
]) {
  if (!operationalBackendIntegrationSource.includes(marker)) {
    throw new Error(`notification integration evidence missing ${marker}`);
  }
}
for (const [pattern, label] of [
  [/v_payment_marked_after\s*-\s*v_payment_marked_before\s*=\s*2\b/i, "payment-marked producer count"],
  [/v_gym_finalized_after\s*-\s*v_gym_finalized_before\s*=\s*2\b/i, "gym-finalized producer count"],
  [/v_cancelled_member_after\s*-\s*v_cancelled_member_before\s*=\s*1\b/i, "member cancellation producer count"],
  [/v_cancelled_admin_after\s*-\s*v_cancelled_admin_before\s*=\s*2\b/i, "Admin cancellation producer count"],
]) {
  if (!pattern.test(operationalBackendIntegrationSource)) {
    throw new Error(`notification integration missing scoped ${label}`);
  }
}
if (!/v_expected_admin_recipients\s+constant\s+uuid\[\]\s*:=\s*array\[\s*'aa000000-0000-0000-0000-00000000a001'::uuid\s*,\s*'ff000000-0000-0000-0000-00000000f001'::uuid\s*\]/i.test(operationalBackendIntegrationSource)) {
  throw new Error("notification integration missing exact Admin recipient fixture");
}
const exactAdminRecipientAssertions = operationalBackendIntegrationSource.match(
  /array_agg\(profile_id\s+order\s+by\s+profile_id\)[\s\S]*?=\s*v_expected_admin_recipients/gi
) || [];
if (exactAdminRecipientAssertions.length !== 2) {
  throw new Error("notification integration must assert exact recipients for both Admin producers");
}
if (!/perform\s+(?:public\.)?cancel_operational_session\s*\(\s*v_unique_cancel_session\b/i.test(operationalBackendIntegrationSource)) {
  throw new Error("notification integration must exercise the real unique cancellation producer");
}
const notificationRoutingMigrationReapplications = [
  ...operationalBackendIntegrationSource.matchAll(
    /^\\ir\s+\.\.\/migrations\/20260829000007_notification_destinations\.sql\s*$/gm
  ),
];
if (notificationRoutingMigrationReapplications.length !== 2) {
  throw new Error("notification integration must reapply migration 00007 exactly twice");
}
for (const fixtureClass of [
  "nearby-booking",
  "unique-malformed",
  "ambiguous-same-profile",
  "foreign-only",
  "valid-explicit",
  "read-state",
  "historical-rsvp-unique",
  "historical-rsvp-ambiguous",
  "historical-cancellation",
]) {
  if (!operationalBackendIntegrationSource.includes(`'${fixtureClass}'`)) {
    throw new Error(`notification integration missing historical fixture class ${fixtureClass}`);
  }
}
for (const marker of [
  "operational_time_fixtures",
  "Asia/Hong_Kong",
  "v_paid_session",
  "v_rsvp_session",
  "v_unique_cancel_session",
  "historical_cancel_session",
  "v_historical_cancel_session",
]) {
  if (!operationalBackendIntegrationSource.includes(marker)) {
    throw new Error(`notification integration missing time-stable fixture marker ${marker}`);
  }
}
// Fixed HYROX dates are allowed only in the deterministic August fixture
// window. Any future-guarded workflow must use the HKT-relative fixture table;
// the lone static reservation is cancelled and therefore rejects before its
// date guard. This allowlist forces every new fixed date to document its source.
const explicitlyGeneratedFixedHyroxSessions = new Set([
  "hyrox-bft-2026-08-15",
  "hyrox-midtown-2026-08-15",
  "hyrox-bft-2026-08-22",
  "hyrox-midtown-2026-08-22",
  "hyrox-bft-2026-08-29",
  "hyrox-midtown-2026-08-29",
]);
const fixedHyroxSessionIds = new Set(
  operationalBackendIntegrationSource.match(/\bhyrox-(?:bft|midtown)-\d{4}-\d{2}-\d{2}\b/g) || []
);
const ungroundedFixedHyroxSessions = [...fixedHyroxSessionIds].filter(
  (sessionId) => !explicitlyGeneratedFixedHyroxSessions.has(sessionId)
);
if (ungroundedFixedHyroxSessions.length) {
  throw new Error(
    `notification integration retains fixed HYROX sessions outside its explicit generator: ${ungroundedFixedHyroxSessions.join(", ")}`
  );
}
if (!/ensure_operational_sessions\s*\(\s*date\s+'2026-08-01'\s*,\s*5\s*\)/i.test(operationalBackendIntegrationSource)) {
  throw new Error("notification integration missing the explicit five-week August HYROX fixture generator");
}
const staticFutureGuardedCalls = [
  ...operationalBackendIntegrationSource.matchAll(
    /\b(?:reserve_operational_session|join_operational_queue|defer_operational_booking)\s*\(\s*'([^']+-\d{4}-\d{2}-\d{2})'/g
  ),
].map((match) => match[0]).filter((call) =>
  !call.includes("reserve_operational_session('hyrox-bft-2026-08-15'")
);
if (staticFutureGuardedCalls.length) {
  throw new Error(`notification integration retains static future-guarded calls: ${staticFutureGuardedCalls.join(", ")}`);
}
for (const fixtureClass of [
  "ambiguous-same-profile",
  "foreign-only",
  "historical-rsvp-ambiguous",
  "historical-cancellation",
]) {
  const rowExistsOnceWithNull = new RegExp(
    `perform\\s+pg_temp\\.op_assert\\(\\s*\\(select\\s+count\\(\\*\\)[\\s\\S]*?where\\s+f\\.fixture_class\\s*=\\s*'${fixtureClass}'[\\s\\S]*?and\\s+n\\.destination\\s+is\\s+null\\s*\\)\\s*=\\s*1\\s*,`,
    "i"
  );
  if (!rowExistsOnceWithNull.test(operationalBackendIntegrationSource)) {
    throw new Error(`notification integration must prove ${fixtureClass} exists once with null destination`);
  }
}
if (/update\s+public\.notifications\s+\w+\s+set\s+destination\s*=\s*public\.resolve_notification_destination/is.test(operationalBackendIntegrationSource)) {
  throw new Error("notification integration must execute migration backfill instead of copying its update");
}
const invalidSessionGenerationCall = [
  ...operationalBackendIntegrationSource.matchAll(
    /ensure_operational_sessions\s*\(\s*date\s+'[^']+'\s*,\s*(\d+)\s*\)/gi
  ),
].find((match) => Number(match[1]) > 16);
if (invalidSessionGenerationCall) {
  throw new Error(`notification integration exceeds the 16-week session generation bound: ${invalidSessionGenerationCall[1]}`);
}
console.log("ok  notification SQL evidence exercises scoped producers and migration reapplication");
for (const column of [
  "waiver_signature_text",
  "waiver_signed_at",
  "waiver_form_version",
  "emergency_relationship",
]) {
  if (!indemnityMigrationSource.includes(column)) {
    throw new Error(`Hyrox indemnity migration missing ${column}`);
  }
}
const liveAuthRunbookSource = readFileSync(
  resolve(__dirnameSmoke, "../docs/runbooks/live-auth.md"),
  "utf8"
);
const readmeSource = readFileSync(resolve(__dirnameSmoke, "../README.md"), "utf8");
const deploymentDocs = `${readmeSource}\n${liveAuthRunbookSource}`;
for (const marker of [
  "20260805000011_giving_campaigns.sql",
  "20260806000001_donor_id.sql",
  "Admin Tools → Giving",
  "No fake campaign data is restored",
]) {
  if (!deploymentDocs.includes(marker)) {
    throw new Error(`Giving deployment recovery docs missing ${marker}`);
  }
}
console.log("ok  Giving deployment recovery is documented without fake campaign data");

if (!/values\s*\([\s\S]*?'pending'\s*\)/i.test(profilesMigrationSource)
    || /existing_count|count\s*\(\s*\*\s*\)[\s\S]*super_admin/i.test(profilesMigrationSource)) {
  throw new Error("fresh OAuth profiles must always bootstrap as pending");
}
for (const marker of ["trusted SQL", "known profile UUID", "role_changes", "Initial Super Admin bootstrap"]) {
  if (!liveAuthRunbookSource.includes(marker)) {
    throw new Error(`initial Super Admin bootstrap procedure missing ${marker}`);
  }
}
console.log("ok  fresh OAuth bootstrap is pending-only with an audited trusted procedure");

const appIndexSource = readFileSync(resolve(__dirnameSmoke, "index.html"), "utf8");
if (!appIndexSource.includes("window.SUPABASE_URL") || !appIndexSource.includes("window.SUPABASE_ANON_KEY")) {
  throw new Error("static Supabase configuration seam must remain explicit in app/index.html");
}
if (/## Vercel env vars|Vercel project settings[^\n]*Environment Variables/i.test(liveAuthRunbookSource)) {
  throw new Error("runbook must not claim Vercel env vars inject into static HTML");
}
for (const marker of ["static no-build deployment", "app/index.html", "does not inject", "service_role", "deployment-specific values"]) {
  if (!liveAuthRunbookSource.includes(marker)) {
    throw new Error(`static deployment procedure missing ${marker}`);
  }
}
console.log("ok  static Vercel documentation matches the app/index.html configuration seam");

const integrationSourceTips = {
  payment: "720dc732944dac692334e885db2d9418d024d9bc",
  notification: "5842839e08f5e486f4b9e175232acec3cb347eb2",
  giving: "3ef00adc4efb327826d5308b20610bc18a9102db",
  community: "40bb7c2acb5ee0a7460f840e73b283cfebce4d31",
};
if (new Set(Object.values(integrationSourceTips)).size !== 4) {
  throw new Error("integration source tips must stay explicit and distinct");
}
console.log("ok  integration source-tip provenance is explicit");

const integratedViewSource = readFileSync(resolve(__dirnameSmoke, "js/views.js"), "utf8");
const integratedAppSource = readFileSync(resolve(__dirnameSmoke, "js/app.js"), "utf8");
const integratedStyleSource = readFileSync(resolve(__dirnameSmoke, "styles.css"), "utf8");
assert.match(integratedViewSource, /export async function viewAdmin\(tab = "members"\)/,
  "Admin must default to Members");
assert.doesNotMatch(integratedViewSource, /\["approvals", "Approvals"\]/,
  "Approvals must be merged into Members instead of remaining a separate tab");
assert.match(integratedStyleSource, /@media \(max-width: 600px\)[\s\S]*?\.session-row\.hyrox-cycle-row\s*\{[\s\S]*?grid-template-columns:\s*44px minmax\(0, 1fr\);/,
  "HYROX cycle rows must switch to two columns on mobile");
assert.match(integratedStyleSource, /@media \(max-width: 600px\)[\s\S]*?\.hyrox-cycle-row \.row-end\s*\{[\s\S]*?grid-column:\s*2;/,
  "HYROX cycle status must move below the details on mobile");
assert.match(integratedViewSource, /class="hyrox-cycle-content"[\s\S]*?class="hyrox-cycle-venues"/,
  "HYROX cycle rows must expose stable hooks for readable mobile details");
assert.match(integratedViewSource, /function adminHyroxWeeklyBookingSetup\(\)[\s\S]*?HYROX weekly booking setup/);
assert.doesNotMatch(integratedViewSource, /function adminHyroxProvisioningInfo/);
assert.match(integratedViewSource, /function venueDisplayName\(session\)/);
assert.match(integratedViewSource, /Mark confirmed with \$\{esc\(venueName\)\}/);
assert.match(integratedViewSource, /function adminVenueStatusMetrics\(session\)/);
assert.match(readFileSync(resolve(__dirnameSmoke, "js/app.js"), "utf8"),
  /closest\("a\[href\^='#'\][^"]*"\)/,
  "App click delegate must intercept hash-only anchor links before the router runs");
assert.equal(typeof store.attendeeCountFor, "function",
  "store must export attendeeCountFor for identity-independent RSVP counts");
assert.equal((integratedViewSource.match(/store\.attendeeCountFor\(s\)/g) || []).length, 4,
  "Schedule Going/RSVP states, RSVP Activity Details, and Admin controls must use attendeeCountFor");
assert.doesNotMatch(integratedViewSource, /store\.attendeesFor\(s\)\.length/,
  "RSVP count surfaces must not derive counts from attendee identities");
const combinedRuntimeSource = `${integratedViewSource}\n${integratedAppSource}`;
for (const marker of [
  "Continue with Google",
  "notification-filter",
  "Giving &amp; Fundraising",
  "ITC Anniversary",
  "HYROX",
]) {
  if (!combinedRuntimeSource.includes(marker)) {
    throw new Error(`testing integration missing ${marker}`);
  }
}
console.log("ok  final cross-domain runtime markers coexist");
for (const marker of [
  "Continue with Google",
  "Membership Details",
  "Privacy &amp; Notifications",
  "Members",
  "HYROX",
  "Duty",
  "Session controls",
]) {
  if (!integratedViewSource.toLowerCase().includes(marker.toLowerCase())) {
    throw new Error(`integrated Payment/Auth UI missing ${marker}`);
  }
}
console.log("ok  composed Payment/Auth UI markers coexist");
for (const marker of ['case "pay"', 'case "form-reserve"', 'case "form-mark-paid"', "store.reserveSession", "store.markBookingPaid"]) {
  if (!integratedAppSource.includes(marker)) {
    throw new Error(`integrated Payment router missing ${marker}`);
  }
}
console.log("ok  Payment reserve and mark-paid routes remain delegated");
for (const marker of ['case "release-reservation"', 'case "defer-to"', 'case "copy-fps"']) {
  if (!integratedAppSource.includes(marker)) {
    throw new Error(`integrated Payment router missing ${marker}`);
  }
}
for (const retiredAction of [
  'case "demo-signin"', 'case "reset-demo"', 'case "form-checkout"',
  "store.payForSession", "use a demo profile",
]) {
  if (integratedAppSource.includes(retiredAction)) {
    throw new Error(`retired runtime action/copy remains: ${retiredAction}`);
  }
}
console.log("ok  rendered Payment controls are delegated and retired actions/copy are absent");
for (const marker of [
  "notificationBellHTML",
  "notification-filter",
  "notification-kind-badge",
  "notificationRelativeTime",
  "notificationHktTime",
]) {
  if (!integratedViewSource.includes(marker) && !integratedAppSource.includes(marker)) {
    throw new Error(`integrated Notification domain missing ${marker}`);
  }
}
console.log("ok  latest Notification domain markers coexist");
{
  const notificationFallbacks = new Map([
    ["operational_booking_reserved", "#/account/payments"],
    ["operational_rsvp_confirmed", "#/schedule"],
    ["operational_payment_approved", "#/account/payments"],
    ["operational_session_deferred", "#/account/payments"],
    ["operational_session_cancelled_no_defer", "#/schedule"],
    ["operational_payment_marked", "#/admin/payments"],
    ["operational_gym_finalized", "#/admin/payments"],
    ["operational_session_cancelled", "#/schedule"],
    ["operational_session_venue_updated", "#/schedule"],
    ["admin_application_submitted", "#/admin/approvals"],
    ["admin_application_approved", "#/admin/members"],
    ["admin_application_declined", "#/admin/members"],
    ["admin_role_promoted", "#/admin/members"],
    ["admin_role_demoted", "#/admin/members"],
    ["admin_membership_revoked", "#/admin/members"],
    ["admin_role_changed", "#/admin/members"],
    ["giving_campaign_published", "#/giving"],
    ["welcome", "#/account"],
  ]);
  const malformedDestinations = [
    "https://example.com/foreign",
    "/account/payments",
    "#account/payments",
    "javascript:alert(1)",
  ];
  for (const [kind, expected] of notificationFallbacks) {
    if (data.notificationDestination(kind) !== expected) {
      failures++;
      console.error(`FAIL ${kind} notification fallback should be ${expected}`);
    }
    if (data.notificationDestination(kind, "#/pay/booking-123") !== "#/pay/booking-123") {
      failures++;
      console.error(`FAIL explicit internal notification destination should win for ${kind}`);
    }
    for (const destination of malformedDestinations) {
      if (data.notificationDestination(kind, destination) !== expected) {
        failures++;
        console.error(`FAIL malformed notification destination should not win for ${kind}: ${destination}`);
      }
    }
  }
  if (data.notificationDestination("unknown_kind") !== "#/account") {
    failures++;
    console.error("FAIL unknown notification kinds should fall back to #/account");
  }
  console.log("ok  notification destinations use explicit internal routes or stable semantic fallbacks");
}
{
  // Live deployments: recurring activity defaults are seed/SQL-administered,
  // so the Admin activity editor must render read-only with an honest note
  // instead of silently writing device-local state behind a success toast.
  if (!/export function viewAdminActivity[\s\S]*?isLive\(\)/.test(integratedViewSource)) {
    throw new Error("viewAdminActivity must gate the recurring editor on isLive()");
  }
  if (!integratedViewSource.includes("form-fieldset")) {
    throw new Error("live activity editor must disable the form via a fieldset");
  }
  if (!integratedViewSource.includes("recurring defaults are bundled with the app build")) {
    throw new Error("live activity editor must explain that recurring defaults are bundled");
  }
  console.log("ok  live deployments render the recurring activity editor read-only");
}

const anniversary = data.ANNOUNCEMENTS[0];
if (
  data.ANNOUNCEMENTS.length !== 1 ||
  anniversary?.title !== "Island Training Club turns 2" ||
  anniversary?.milestones?.length !== 5
) {
  failures++;
  console.error("FAIL announcement seeds should contain only the structured ITC anniversary");
} else console.log("ok  announcement seeds contain only the ITC anniversary");
if (
  anniversary?.postedAt == null ||
  new Date(anniversary.postedAt).getFullYear() !== 2026 ||
  new Date(anniversary.postedAt).getMonth() !== 7 ||
  new Date(anniversary.postedAt).getDate() !== 6
) {
  failures++;
  console.error("FAIL announcement postedAt should resolve to 2026-08-06 local date");
} else console.log("ok  announcement postedAt resolves to 2026-08-06 local date");

// Weekly encouragement rotates on Hong Kong Sundays, regardless of the host
// calendar. Each expected reference is hand-derived from the fixed HKT epoch.
{
  const verseCases = [
    ["one second before the epoch boundary", "2026-07-25T15:59:59.000Z", "2 Timothy 4:7"],
    ["one millisecond before the epoch boundary", "2026-07-25T15:59:59.999Z", "2 Timothy 4:7"],
    ["at the epoch boundary", "2026-07-25T16:00:00.000Z", "Hebrews 12:1"],
    ["one millisecond before the next boundary", "2026-08-01T15:59:59.999Z", "Hebrews 12:1"],
    ["at the next boundary", "2026-08-01T16:00:00.000Z", "Isaiah 40:31"],
    ["one week before the epoch", "2026-07-18T16:00:00.000Z", "2 Timothy 4:7"],
    ["eight weeks before the epoch", "2026-05-30T16:00:00.000Z", "Hebrews 12:1"],
    ["nine weeks before the epoch", "2026-05-23T16:00:00.000Z", "2 Timothy 4:7"],
  ];
  for (const [label, instant, expectedRef] of verseCases) {
    const actualRef = data.weeklyVerse(new Date(instant)).ref;
    if (actualRef !== expectedRef) {
      throw new Error(`Weekly verse ${label} should be ${expectedRef}, got ${actualRef}`);
    }
  }

  const dataModuleURL = new URL("./js/data.js", import.meta.url).href;
  const fixedInstant = "2026-07-25T16:00:00.000Z";
  const childSource = `
    const RealDate = Date;
    const fixedInstant = ${JSON.stringify(fixedInstant)};
    globalThis.Date = class FixedDate extends RealDate {
      constructor(...args) { super(...(args.length ? args : [fixedInstant])); }
      static now() { return new RealDate(fixedInstant).getTime(); }
    };
    const { weeklyVerse } = await import(${JSON.stringify(dataModuleURL)});
    const supplied = weeklyVerse(new RealDate(fixedInstant)).ref;
    const defaulted = weeklyVerse().ref;
    process.stdout.write(JSON.stringify({ supplied, defaulted }));
  `;
  for (const timeZone of ["Asia/Hong_Kong", "America/Los_Angeles"]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "--eval", childSource], {
      encoding: "utf8",
      env: { ...process.env, TZ: timeZone },
    });
    if (child.status !== 0) {
      throw new Error(`Weekly verse ${timeZone} child failed: ${child.stderr.trim()}`);
    }
    const result = JSON.parse(child.stdout);
    if (result.supplied !== "Hebrews 12:1" || result.defaulted !== "Hebrews 12:1") {
      throw new Error(`Weekly verse should use the same HKT instant under ${timeZone}; got ${child.stdout}`);
    }
  }
  console.log("ok  weekly verse rotates at deterministic HKT Sunday boundaries");
  console.log("ok  weekly verse matches across HKT and Los Angeles host timezones");
}

// --- Visitor state ---
store.signOut();
const allUpcoming = store.upcomingSessions(14);
// booking tests need a session that hasn't started yet — today's sessions
// are unbookable once their start time passes
const paid = allUpcoming.find((s) => s.kind === "paid" && !data.sessionStarted(s));
const free = allUpcoming.find((s) => s.kind === "free");
if (!paid || !free) throw new Error("expected both paid and free sessions in window");
const localVisitorHome = views.viewHome();
if (!localVisitorHome.includes("<h2>This week — open to all</h2>")) {
  throw new Error("visitor Home must show the exact open-to-all h2");
}
if (localVisitorHome.includes("My Week")) {
  throw new Error("visitor Home must not show My Week");
}
const assertRenderedActivityLinksAreFree = (html, label) => {
  const linkedIds = [...html.matchAll(/href="#\/activity\/([^"]+)"/g)].map((match) => match[1]);
  if (!linkedIds.length) {
    // Mirror viewHome()'s visitor branch: when no free sessions exist in the
    // current Mon–Sun window, the empty state is the expected output and
    // there are no links to verify. The seed data (Mon/Tue/Wed only) makes
    // this the case on Thu–Sun — without this guard the suite was green only
    // on Mon–Wed.
    const weekStart = data.mondayOf(data.todayLocal());
    const weekEnd = data.addDays(weekStart, 6);
    const freeInWeek = allUpcoming.filter((session) => {
      if (session.kind !== "free") return false;
      const iso = session.dateISO || (session.snapshot && session.snapshot.dateISO);
      if (!iso) return false;
      const t = data.parseISO(iso).getTime();
      return t >= weekStart.getTime() && t <= weekEnd.getTime();
    });
    if (freeInWeek.length) {
      throw new Error(`${label} must render at least one activity link (${freeInWeek.length} free sessions this week)`);
    }
    if (!html.includes("No open sessions this week")) {
      throw new Error(`${label} should render the empty state when no free sessions are in the current week`);
    }
    return;
  }
  for (const id of linkedIds) {
    const session = allUpcoming.find((item) => item.id === id);
    if (!session || session.kind !== "free") {
      throw new Error(`${label} rendered a non-free activity link: ${id}`);
    }
  }
};
assertRenderedActivityLinksAreFree(localVisitorHome, "visitor Home");
{
  const weekStart = data.mondayOf(data.todayLocal());
  const weekEnd = data.addDays(weekStart, 6);
  const freeInWeek = allUpcoming.filter((session) => {
    if (session.kind !== "free") return false;
    const iso = session.dateISO || (session.snapshot && session.snapshot.dateISO);
    if (!iso) return false;
    const t = data.parseISO(iso).getTime();
    return t >= weekStart.getTime() && t <= weekEnd.getTime();
  });
  if (freeInWeek.length) {
    // free is guaranteed non-null in this branch — guard above found one.
    if (!localVisitorHome.includes(free.name) || localVisitorHome.includes(paid.name)) {
      throw new Error("visitor Home must show free sessions only");
    }
  } else {
    // Thu–Sun: no free sessions in window, so neither name should appear.
    if (localVisitorHome.includes(free.name) || localVisitorHome.includes(paid.name)) {
      throw new Error("visitor Home should not list session names when the current week has no free sessions");
    }
  }
  if (localVisitorHome.includes("This week — open to all") && localVisitorHome.includes(paid.name)) {
    throw new Error("visitor Home must show free sessions only");
  }
  if (!localVisitorHome.includes("This week — open to all")
      && !localVisitorHome.includes("No open sessions this week")) {
    throw new Error("visitor Home must fall back to the no-sessions copy");
  }
}
if (!localVisitorHome.includes("This week — open to all")
    && !localVisitorHome.includes("No open sessions this week")) {
  throw new Error("visitor Home must fall back to the no-sessions copy");
}
assertPrimaryNav(null, ["Home", "Schedule", "Community", "Account"], "visitor");
if (!localVisitorHome.includes('href="#/account">Sign in or join</a>')) {
  throw new Error("local signed-out Home must retain the Account sign-in link");
}
if (localVisitorHome.includes('data-action="sign-in-google"')) {
  throw new Error("local signed-out Home must not render the live Google action");
}
console.log("ok  signed-out Home uses the correct live/local sign-in action");
await check("home (visitor)", () => views.viewHome());
await check("schedule", () => views.viewSchedule());

// Member Schedule weeks run Sunday–Saturday. Boundary and selection values
// are hand-checked literals so a Monday fallback or off-by-seven navigation
// cannot satisfy the expectations by sharing the implementation's logic.
{
  if (typeof data.sundayOf !== "function") {
    throw new Error("Schedule requires an exported sundayOf helper");
  }
  for (const [dateISO, expectedSunday] of [
    ["2026-08-09", "2026-08-09"], // Sunday stays in its own week
    ["2026-08-10", "2026-08-09"], // Monday crosses back one day
    ["2026-08-15", "2026-08-09"], // Saturday closes the same week
  ]) {
    const actual = data.isoDate(data.sundayOf(data.parseISO(dateISO)));
    if (actual !== expectedSunday) {
      throw new Error(`sundayOf(${dateISO}) should be ${expectedSunday}, got ${actual}`);
    }
  }

  if (typeof views.scheduleSelectionForWeek !== "function") {
    throw new Error("Schedule requires a shared week-selection fallback");
  }
  const navigationCases = [
    ["2026-08-12", 0, "2026-08-12"], // current week keeps today selected
    ["2026-08-12", 1, "2026-08-16"], // next week opens Sunday
    ["2026-08-12", 2, "2026-08-23"], // next again moves seven days
    ["2026-08-12", -1, "2026-08-02"], // previous week opens Sunday
    ["2026-08-09", 1, "2026-08-16"], // Sunday boundary moves exactly seven days
  ];
  for (const [today, offset, expectedSelection] of navigationCases) {
    const actual = views.scheduleSelectionForWeek(data.parseISO(today), offset);
    if (actual !== expectedSelection) {
      throw new Error(`Schedule offset ${offset} from ${today} should select ${expectedSelection}, got ${actual}`);
    }
  }

  views.resetScheduleState();
  const currentSchedule = views.viewSchedule();
  const currentSunday = data.sundayOf(data.todayLocal());
  const stripLabels = [...currentSchedule.matchAll(/data-date="[^"]+">\s*([A-Z][a-z]{2})<strong/g)]
    .map((match) => match[1]);
  const expectedLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (JSON.stringify(stripLabels) !== JSON.stringify(expectedLabels)) {
    throw new Error(`Schedule strip should be Sunday-first; got ${stripLabels.join(" ")}`);
  }
  if (!currentSchedule.includes(`Week of ${data.fmtDateLong(currentSunday)}`)) {
    throw new Error("Schedule Week of date should be the current Sunday");
  }
  const currentSelectedPattern = new RegExp(
    `class="day-cell [^"]*active[^"]*"\\s*data-action="sched-day" data-date="${data.isoDate(data.todayLocal())}"`
  );
  if (!currentSelectedPattern.test(currentSchedule)) {
    throw new Error("Current Schedule week should keep the current date selected");
  }

  views.scheduleState.weekOffset = 1;
  views.scheduleState.selected = null;
  const nextSchedule = views.viewSchedule();
  const expectedNextSunday = data.addDays(currentSunday, 7);
  if (views.scheduleState.selected !== data.isoDate(expectedNextSunday)) {
    throw new Error("A non-current Schedule week should default to Sunday");
  }
  if (!nextSchedule.includes(`Week of ${data.fmtDateLong(expectedNextSunday)}`)) {
    throw new Error("Next Schedule week should move seven days to the next Sunday");
  }
  views.resetScheduleState();
  console.log("ok  Schedule uses Sunday boundaries and Sunday-first day labels");
  console.log("ok  Schedule navigation selects Sundays and returns to today");
}

// Schedule filters: only chronological activity categories remain.
{
  const schedHtml = views.viewSchedule();
  const expectedFilterOrder = ["all", "Run", "Water", "Strength", "HYROX", "Socials"];
  const renderedFilterOrder = [...schedHtml.matchAll(/data-filter="([^"]+)"/g)].map((match) => match[1]);
  if (JSON.stringify(renderedFilterOrder) !== JSON.stringify(expectedFilterOrder)) {
    failures++;
    console.error(`FAIL Schedule filter order should be ${expectedFilterOrder.join(", ")}; got ${renderedFilterOrder.join(", ")}`);
  } else console.log("ok  Schedule filters follow weekly event order without Free/Paid chips");
  for (const removed of ['data-filter="free"', 'data-filter="paid"']) {
    if (schedHtml.includes(removed)) {
      failures++;
      console.error(`FAIL Schedule should not render the ${removed} filter chip`);
    }
  }
  console.log("ok  Schedule keeps chronological category filters only");
}
const hyroxSid = store.nextSession().kind === "paid" ? store.nextSession().id : null;
await check("activity paid (visitor)", () => views.viewActivity(paid.id));
await check("activity free (visitor)", () => views.viewActivity(free.id));
await check("community", () => views.viewCommunity());
const commHtml = views.viewCommunity();
if (!commHtml.includes("Find your place in the crew.")) {
  failures++;
  console.error("FAIL visitor Community heading is not personalized");
} else console.log("ok  visitor Community heading is personalized");
for (const required of [
  "Socials",
  "Connect beyond training",
  "Meet up, share a meal, and find your people.",
  "View next social",
  "Latest from ITC",
  "Island Training Club turns 2",
  "Ways to connect",
  "Explore",
]) {
  if (!commHtml.includes(required)) {
    failures++;
    console.error(`FAIL Community Pulse missing ${required}`);
  }
}
const selectedCommunitySocial = store.nextSocialSession();
if (!selectedCommunitySocial
    || !commHtml.includes(`Next up: ${selectedCommunitySocial.name}`)
    || !commHtml.includes(data.fmtDate(selectedCommunitySocial.dateISO))
    || !commHtml.includes(`href="#/activity/${selectedCommunitySocial.id}"`)) {
  failures++;
  console.error("FAIL Community Pulse should show and link to the next Socials event");
}
if (commHtml.includes("Post-training lunch") || commHtml.includes("Every Saturday after HYROX")
    || commHtml.includes("See the next lunch")) {
  failures++;
  console.error("FAIL Community Pulse should not use lunch-specific preview copy");
}
const coexistenceSurface = `${integratedViewSource}\n${localVisitorHome}\n${commHtml}`;
for (const marker of ["Home", "notificationBellHTML", '#/giving', "community-pulse", "HYROX"]) {
  if (!coexistenceSurface.includes(marker)) {
    failures++;
    console.error(`FAIL combined domain coexistence missing ${marker}`);
  }
}
console.log("ok  Home, Notification bell, Giving nav, Community pulse, and HYROX admin coexist");
let commOk = true;
for (const link of [
  "#/community/prayers",
  "#/community/fellowship",
  "#/schedule",
  "#/community/announcements",
  "#/community/about",
]) {
  if (!commHtml.includes(`href="${link}"`)) {
    failures++;
    commOk = false;
    console.error(`FAIL Community missing ${link} card`);
  }
}
if (commOk) console.log("ok  Community shows the five destination links");
if (!commHtml.includes('#/community/about')) {
  failures++;
  console.error("FAIL Community Explore should still link to About ITC");
} else console.log("ok  About ITC remains reachable from Community");
if (commHtml.includes("Arnold Wong") || commHtml.includes("Our foundation")) {
  failures++;
  console.error("FAIL leaders/culture should live behind the About card");
} else console.log("ok  leaders & culture live behind the About card");
await check("community > prayers", () => views.viewCommunity("prayers"));
await check("community > fellowship", () => views.viewCommunity("fellowship"));
await check("community > meals -> redirect", () => views.viewCommunity("meals"));
const mealsRoute = views.viewCommunity("meals");
if (mealsRoute?.redirect !== "#/schedule") {
  failures++;
  console.error("FAIL community meals should redirect to the Schedule tab");
} else console.log("ok  community meals redirects to Schedule");
await check("community > announcements", () => views.viewCommunity("announcements"));
const announcementHtml = views.viewCommunity("announcements");
for (const required of [
  "Island Training Club turns 2",
  "620",
  "members strong",
  "14",
  "committed leaders",
  "unwavering vision",
  "clear mission",
  "God who made this all possible",
  "ITC Leadership and Coaching Team",
  "fitness, friendship, community and faith",
]) {
  if (!announcementHtml.includes(required)) {
    failures++;
    console.error(`FAIL anniversary story missing ${required}`);
  }
}
const savedAnnouncements = [...data.ANNOUNCEMENTS];
data.ANNOUNCEMENTS.splice(0);
let emptyCommunity = "";
let emptyAnnouncements = "";
try {
  emptyCommunity = views.viewCommunity();
  emptyAnnouncements = views.viewCommunity("announcements");
} finally {
  data.ANNOUNCEMENTS.splice(0, data.ANNOUNCEMENTS.length, ...savedAnnouncements);
}
if (!emptyCommunity.includes("No announcements yet") || !emptyAnnouncements.includes("No announcements yet")) {
  failures++;
  console.error("FAIL Community announcement empty states should render safely");
} else console.log("ok  Community announcement empty states render safely");
await check("community > about", () => views.viewCommunity("about"));
const commAbout = views.viewCommunity("about");
if (!commAbout.includes("Arnold Wong") || !commAbout.includes("Our foundation")) {
  failures++;
  console.error("FAIL Community About page missing leaders or culture content");
} else console.log("ok  Community About page carries leaders & culture");
if (!views.viewCommunity("prayers").includes('id="form-prayer"')) {
  failures++;
  console.error("FAIL prayers page missing the request form");
} else console.log("ok  prayers page has the request form");
for (const [section, title] of [
  ["prayers", "Prayers."],
  ["fellowship", "Fellowship."],
  ["announcements", "Island Training Club turns 2."],
  ["about", "More than a workout."],
]) {
  if (!views.viewCommunity(section).includes(title)) {
    failures++;
    console.error(`FAIL community > ${section} heading should read "${title}"`);
  }
}
console.log("ok  community sub-page headings title-cased");
if (!views.viewCommunity("nope").includes("Page not found")) {
  failures++;
  console.error("FAIL unknown Community section should 404");
} else console.log("ok  unknown Community section 404s");
await check("account (visitor)", () => views.viewAccount());
await check("apply", () => views.viewApply());
if (!views.viewApply().includes('name="donorId"')) {
  failures++;
  console.error("FAIL apply form missing optional Donor ID field");
} else console.log("ok  apply form collects optional Donor ID");

// --- apply form checkboxes render the read-and-accept links (all three docs) ---
// local mode: viewApply() dispatches to viewApplyLocal when isLive() is false
const applyLocalHtml = views.viewApply();
for (const [key, label] of [
  ["indemnity", "Indemnity"],
  ["privacy", "privacy policy"],
  ["guidelines", "community guidelines"],
]) {
  if (!applyLocalHtml.includes(`data-action="open-doc" data-doc="${key}"`)) {
    failures++;
    console.error(`FAIL local-mode apply form missing modal trigger for "${key}"`);
  }
  if (!applyLocalHtml.includes(`data-doc-accept="${key}"`)) {
    failures++;
    console.error(`FAIL local-mode apply form missing doc-accept container for "${key}"`);
  }
  if (!applyLocalHtml.includes(label)) {
    failures++;
    console.error(`FAIL local-mode apply form missing label text "${label}"`);
  }
}
if (!applyLocalHtml.includes("data-doc-checkbox")) {
  failures++;
  console.error("FAIL local-mode apply form checkboxes missing data-doc-checkbox attribute");
}
if (!applyLocalHtml.includes("Read the document to enable acceptance")) {
  failures++;
  console.error("FAIL local-mode apply form missing the read-first hint copy");
}
if (!applyLocalHtml.includes('name="mediaConsent" required') || applyLocalHtml.includes("(Optional) I consent")) {
  failures++;
  console.error("FAIL local-mode apply form photo consent should be required");
}
if (!applyLocalHtml.includes("Please contact ITC Committee if you have any questions/concerns about this.")) {
  failures++;
  console.error("FAIL apply form missing the ITC Committee contact line under photo consent");
}
if (!integratedViewSource.includes('name="photo_consent" ${checked("photo_consent")} required')) {
  failures++;
  console.error("FAIL live-mode apply form photo consent should be required");
}
console.log("ok  local-mode apply form wires all three documents (indemnity, privacy, guidelines)");
for (const name of ["emergencyRelationship", "indemnitySignature", "indemnitySignedAt"]) {
  if (!applyLocalHtml.includes(`name="${name}"`)) {
    failures++;
    console.error(`FAIL local apply form missing ${name}`);
  }
}
if (!applyLocalHtml.includes("Participant's full name as signature")) {
  failures++;
  console.error("FAIL local apply form missing signature label");
}
if (!/name="indemnity"[^>]*disabled[^>]*data-doc-checkbox/.test(applyLocalHtml)) {
  failures++;
  console.error("FAIL local indemnity checkbox should stay disabled until the modal is read");
}
if (!applyLocalHtml.includes(`value="${data.todayHktISO()}"`)) {
  failures++;
  console.error("FAIL local signing date should default to HKT today");
}
if (!applyLocalHtml.includes(`max="${data.todayHktISO()}"`)) {
  failures++;
  console.error("FAIL local signing date should be capped at HKT today");
}
console.log("ok  local-mode apply form collects emergencyRelationship, signature, and signing date");
for (const marker of [
  'emergencyRelationship: fd.get("emergencyRelationship") || ""',
  'indemnitySignature: fd.get("indemnitySignature") || ""',
  'indemnitySignedAt: fd.get("indemnitySignedAt") || ""',
]) {
  if (!integratedAppSource.includes(marker)) {
    failures++;
    console.error(`FAIL local apply handler missing structured indemnity contract: ${marker}`);
  }
}
console.log("ok  local apply handler bridges the structured indemnity contract");

// Live-mode apply form: old plain-checkbox copy and indemnity-only attributes
// must be gone. Source-level check: rendering viewApplyLive() requires
// Supabase state, so we assert against the integrated source instead.
for (const stale of [
  "I accept the participation waiver",
  "I accept the privacy policy. (⏳",
  "I accept the community guidelines. (⏳",
  'data-action="open-indemnity-doc"',
  "data-indemnity-checkbox",
]) {
  if (combinedRuntimeSource.includes(stale)) {
    failures++;
    console.error(`FAIL stale pre-registry pattern still present: "${stale}"`);
  }
}
console.log("ok  no stale plain-checkbox or indemnity-only patterns remain");
await check("checkout (visitor) -> redirect", () => views.viewCheckout(paid.id));
await check("admin (visitor) -> redirect", () => views.viewAdmin("members"));
await check("notfound", () => views.viewNotFound());

// free activity must never show booking/capacity language
const freeHtml = views.viewActivity(free.id);
for (const banned of ["spots left", "Book & pay", "capacity", "Confirm booking", "Add to bag"]) {
  if (freeHtml.toLowerCase().includes(banned.toLowerCase())) {
    failures++;
    console.error(`FAIL free activity contains banned phrase: "${banned}"`);
  }
}
console.log("ok  free activity has no booking/capacity language");
const freeCopyWntSession = store.upcomingSessions(14).find((session) => session.activityId === "wnt");
const freeCopyWntHtml = views.viewActivity(freeCopyWntSession.id);
if (!freeCopyWntHtml.includes("Everyone is welcome — just show up.")
    || freeCopyWntHtml.includes("look for the lime ITC flag")) {
  failures++;
  console.error("FAIL WNT free-event subtext should match the other free events");
} else console.log("ok  WNT free-event subtext matches the other free events");

// paid activity must show price + free/paid badges everywhere
const freeDetailHtml = views.viewActivity(free.id);
const freeBadgeMatch = freeDetailHtml.match(/<span class="badge free">([^<]*)<\/span>/);
if (freeBadgeMatch?.[1] !== "Free") {
  failures++;
  console.error("FAIL free activity badge should read only Free");
} else console.log("ok  free activity badge reads only Free");
const paidHtml = views.viewActivity(paid.id);
if (!paidHtml.includes("HK$") || !paidHtml.includes("badge paid")) {
  failures++;
  console.error("FAIL paid activity missing price or paid badge");
} else console.log("ok  paid activity shows price + badge");
if (!paidHtml.includes('badge paid">HK$180</span>') || paidHtml.includes("per session") || paidHtml.includes("Paid · HK$180")) {
  failures++;
  console.error("FAIL unbooked paid activity badge should read only its price");
} else console.log("ok  unbooked paid activity badge reads only its price");
const unpaidBadgeSession = allUpcoming.find((s) => s.kind === "paid" && s.activityId === "hyrox-bft" && !data.sessionStarted(s));
installLocalFixtures();
store.signIn("member@example.test");
const paidHtmlWithAttendeeNames = views.viewActivity(paid.id, ["Alex C.", "Sam L."]);
if (!paidHtmlWithAttendeeNames.includes("Alex C.")
    || !paidHtmlWithAttendeeNames.includes("Sam L.")
    || !paidHtmlWithAttendeeNames.includes("Who’s coming")) {
  failures++;
  console.error("FAIL approved attendee names should render on paid Activity Details");
} else console.log("ok  approved attendee names render on paid Activity Details");
if (!unpaidBadgeSession) {
  failures++;
  console.error("FAIL smoke needs an upcoming HYROX session for badge state checks");
} else {
  const unpaidReservation = store.reserveSession("fixture-member", unpaidBadgeSession.id);
  const unpaidBadgeHtml = views.viewActivity(unpaidBadgeSession.id);
  if (!unpaidBadgeHtml.includes('badge warn">To be paid</span>')) {
    failures++;
    console.error("FAIL reserved unpaid paid activity should show To be paid");
  } else console.log("ok  reserved unpaid paid activity shows To be paid");
  if (store.markBookingPaid(unpaidReservation.id, "FPS", "BADGE-STATE")) {
    const awaitingBadgeHtml = views.viewActivity(unpaidBadgeSession.id);
    if (!awaitingBadgeHtml.includes('badge warn">Awaiting confirmation</span>')) {
      failures++;
      console.error("FAIL marked-paid paid activity should show Awaiting confirmation");
    } else console.log("ok  marked-paid paid activity shows Awaiting confirmation");
  } else {
    failures++;
    console.error("FAIL badge-state fixture should mark its reservation paid");
  }
  store.signOut();
  store.signIn("admin@example.test");
  if (!store.confirmBookingPayment(unpaidReservation.id)) {
    failures++;
    console.error("FAIL badge-state fixture should confirm its paid reservation");
  } else {
    store.signOut();
    store.signIn("member@example.test");
    const confirmedBadgeHtml = views.viewActivity(unpaidBadgeSession.id);
    if (!confirmedBadgeHtml.includes('badge free">Paid</span>')) {
      failures++;
      console.error("FAIL confirmed paid activity should show Paid");
    } else console.log("ok  confirmed paid activity shows Paid");
  }
}
store.signOut();
const paidDirectionsSession = allUpcoming.find((s) => s.kind === "paid" && s.activityId === "hyrox-bft" && !data.sessionStarted(s));
const paidDirectionsHtml = paidDirectionsSession ? views.viewActivity(paidDirectionsSession.id) : "";
if (!paidDirectionsHtml.includes("Get directions")) {
  failures++;
  console.error("FAIL paid activity should expose Get directions");
} else console.log("ok  paid activity exposes Get directions");
if (paidDirectionsSession) {
  const paidActivity = store.activities().find((activity) => activity.id === paidDirectionsSession.activityId);
  const originalMapsQuery = paidActivity?.mapsQuery;
  if (paidActivity) paidActivity.mapsQuery = "";
  const locationFallbackHtml = views.viewActivity(paidDirectionsSession.id);
  if (paidActivity) paidActivity.mapsQuery = originalMapsQuery;
  if (!locationFallbackHtml.includes("Get directions")) {
    failures++;
    console.error("FAIL paid activity should fall back to its location for Get directions");
  } else console.log("ok  paid activity falls back to its location for Get directions");
}
if (!paidHtml.includes('data-photo-fallback="/assets/itc/hyrox.webp"')) {
  failures++;
  console.error("FAIL paid activity should provide a root asset fallback for its HYROX image");
} else console.log("ok  paid activity provides a HYROX image fallback");

// --- Application flow ---
const applyRes = store.applyForMembership({
  fullName: "Test Person",
  preferredName: "Test",
  email: "test@example.com",
  phone: "+852 1234 5678",
  emergencyName: "E Person",
  emergencyRelationship: "Sibling",
  emergencyPhone: "+852 8765 4321",
  heard: "A friend",
  ageConfirmed: true,
  mediaConsent: false,
  donorId: "Not applicable",
  indemnity: true,
  indemnitySignature: "Test Person",
  indemnitySignedAt: data.isoDate(data.todayLocal()),
});
if (!applyRes.ok) throw new Error("apply failed");
if (applyRes.user.donorId !== null) {
  failures++;
  console.error('FAIL "Not applicable" donor ID should normalize to null');
} else console.log("ok  N/A donor ID at signup normalizes to null");
if (!applyRes.user.indemnityAcceptedAt) {
  failures++;
  console.error("FAIL indemnity acceptance not recorded at application");
} else console.log("ok  indemnity acceptance recorded at application");
for (const [field, expected] of [
  ["emergencyRelationship", "Sibling"],
  ["indemnitySignature", "Test Person"],
  ["indemnitySignedAt", data.isoDate(data.todayLocal())],
  ["indemnityFormVersion", "v1"],
]) {
  if (applyRes.user[field] !== expected) {
    failures++;
    console.error(`FAIL application ${field} expected ${expected}, got ${applyRes.user[field]}`);
  }
}
if (!store.isIndemnityCurrent(applyRes.user)) {
  failures++;
  console.error("FAIL signed v1 application should have current indemnity");
}
const localApplicationFixture = (email, overrides = {}) => ({
  fullName: "Contact Check",
  preferredName: "Contact",
  email,
  phone: "+852 1234 5678",
  emergencyName: "E Person",
  emergencyRelationship: "Sibling",
  emergencyPhone: "+852 8765 4321",
  heard: "A friend",
  ageConfirmed: true,
  mediaConsent: false,
  donorId: "Not applicable",
  indemnity: true,
  indemnitySignature: "Contact Check",
  indemnitySignedAt: data.isoDate(data.todayLocal()),
  ...overrides,
});
for (const [label, email, overrides] of [
  ["missing emergency name", "missing-emergency-name@example.test", { emergencyName: "" }],
  ["missing emergency phone", "missing-emergency-phone@example.test", { emergencyPhone: "" }],
]) {
  let error = null;
  try { store.applyForMembership(localApplicationFixture(email, overrides)); } catch (err) { error = err; }
  if (!error || !/emergency contact name, relationship and phone/.test(error.message)) {
    failures++;
    console.error(`FAIL ${label} should reject with the canonical emergency-contact error`);
  }
}
if (store.isIndemnityCurrent({ ...applyRes.user, emergencyPhone: "" })) {
  failures++;
  console.error("FAIL indemnity currentness should require canonical emergency contact phone");
}
for (const [label, payload, pattern] of [
  ["short signature", { signature: "X", signedAt: data.isoDate(data.todayLocal()), emergencyRelationship: "Sibling" }, /full name as your signature/],
  ["invalid date", { signature: "Test Person", signedAt: "2026-02-31", emergencyRelationship: "Sibling" }, /valid signing date/],
  ["future date", { signature: "Test Person", signedAt: "2999-01-01", emergencyRelationship: "Sibling" }, /cannot be in the future/],
  ["missing relationship", { signature: "Test Person", signedAt: data.isoDate(data.todayLocal()), emergencyRelationship: "" }, /relationship/],
]) {
  let error = null;
  try { store.acceptIndemnity(applyRes.user.id, payload); } catch (err) { error = err; }
  if (!error || !pattern.test(error.message)) {
    failures++;
    console.error(`FAIL ${label} should reject with ${pattern}`);
  }
}
for (const [label, field] of [
  ["missing canonical emergency name", "emergencyName"],
  ["missing canonical emergency phone", "emergencyPhone"],
]) {
  const original = applyRes.user[field];
  applyRes.user[field] = "";
  let error = null;
  try {
    store.acceptIndemnity(applyRes.user.id, {
      signature: "Test Person",
      signedAt: data.isoDate(data.todayLocal()),
      emergencyRelationship: "Sibling",
    });
  } catch (err) {
    error = err;
  }
  applyRes.user[field] = original;
  if (!error || !/emergency contact name, relationship and phone/.test(error.message)) {
    failures++;
    console.error(`FAIL ${label} should block re-sign acceptance`);
  }
}

// --- Application draft persistence ---
{
  localStorage.removeItem("itc.device.id");
  localStorage.removeItem("itc.apply.draft.v1");

  if (store.getApplyDraft() !== null) {
    throw new Error("fresh application draft should be null");
  }

  const first = store.saveApplyDraft({ fields: { mobile: "+852 6123 4567" } });
  if (!first?.deviceId || first.version !== 1 || first.fields.mobile !== "+852 6123 4567") {
    throw new Error("application draft should persist its device, version and fields");
  }

  const merged = store.saveApplyDraft({ fields: { preferred_name: "Jiffriy" } });
  if (merged.fields.mobile !== "+852 6123 4567" || merged.fields.preferred_name !== "Jiffriy") {
    throw new Error("application draft saves should merge fields");
  }

  localStorage.setItem("itc.apply.draft.v1", JSON.stringify({
    version: 99,
    deviceId: first.deviceId,
    savedAt: Date.now(),
    fields: { mobile: "stale" },
  }));
  if (store.getApplyDraft() !== null || localStorage.getItem("itc.apply.draft.v1") !== null) {
    throw new Error("incompatible application draft should be discarded");
  }

  store.saveApplyDraft({ fields: { mobile: "+852 6999 0000" } });
  store.clearApplyDraft();
  if (store.getApplyDraft() !== null) {
    throw new Error("clearApplyDraft should remove the application draft");
  }
  console.log("ok  application drafts persist, merge, version and clear");
}

{
  store.signOut();
  store.clearApplyDraft();
  const homeWithoutDraft = views.viewHome();
  if (homeWithoutDraft.includes("Continue your application")) {
    throw new Error("fresh visitor home should not advertise a draft");
  }

  store.saveApplyDraft({ fields: { mobile: "+852 6123 4567" } });
  const homeWithDraft = views.viewHome();
  const accountWithDraft = await views.viewAccount();
  for (const [label, html] of [["home", homeWithDraft], ["account", accountWithDraft]]) {
    if (!html.includes("Continue your application") || !html.includes('data-action="discard-draft"')) {
      throw new Error(`${label} should expose Continue + Discard for a saved draft`);
    }
  }
  store.clearApplyDraft();
  store.signIn("test@example.com");
  console.log("ok  visitor Home and Account surface resumable drafts");
}

// donor ID format: last name, hyphen, then 4 or 5 digits (CHUI-08879 / CHUI-8879);
// dash variants and spaces as the separator normalize to a plain hyphen
for (const [input, expect] of [
  ["CHUI-08879", null],
  ["CHUI-8879", null],
  ["chui-8879", null],
  ["CHUI 08879", null],
  ["CHUI—08879", null], // em-dash (phone autocorrect)
  ["CHUI -08879", null],
  ["", null],
  ["Not applicable", null],
  ["CHUI08879", "format"], // no separator — rejected, user re-enters
  ["CHUI-887", "format"],
  ["CHUI-088797", "format"],
  ["CHUI-0887A", "format"],
]) {
  const got = data.donorIdProblem(input);
  if (got !== expect) {
    failures++;
    console.error(`FAIL donorIdProblem(${JSON.stringify(input)}) = ${got}, expected ${expect}`);
  }
}
console.log("ok  donor ID format validation");
await check("account (pending)", () => views.viewAccount());
const pendingHome = views.viewHome();
{
  // Pending applicants see "My Week" filtered to free sessions in the
  // current Mon–Sun window (same as the visitor branch). On Thu–Sun the
  // seed data yields no such sessions, so neither session name appears.
  const weekStart = data.mondayOf(data.todayLocal());
  const weekEnd = data.addDays(weekStart, 6);
  const freeInWeek = allUpcoming.filter((session) => {
    if (session.kind !== "free") return false;
    const iso = session.dateISO || (session.snapshot && session.snapshot.dateISO);
    if (!iso) return false;
    const t = data.parseISO(iso).getTime();
    return t >= weekStart.getTime() && t <= weekEnd.getTime();
  });
  if (freeInWeek.length) {
    if (!pendingHome.includes("My Week") || !pendingHome.includes(free.name) || pendingHome.includes(paid.name)) {
      throw new Error("pending Home must show My Week with free sessions only");
    }
  } else {
    if (!pendingHome.includes("My Week")) {
      throw new Error("pending Home must show My Week heading even when no sessions this week");
    }
    if (pendingHome.includes(free.name) || pendingHome.includes(paid.name)) {
      throw new Error("pending Home should not list session names when the current week has no free sessions");
    }
  }
  if (!pendingHome.includes("My Week")) {
    throw new Error("pending Home must show the My Week heading");
  }
  if (pendingHome.includes(free.name) && pendingHome.includes(paid.name)) {
    throw new Error("pending Home must not include paid sessions");
  }
}
assertRenderedActivityLinksAreFree(pendingHome, "pending Home");
const pendingCommunity = views.viewCommunity();
if (!pendingCommunity.includes("You’re welcome here.")) {
  failures++;
  console.error("FAIL pending Community heading is not personalized");
} else console.log("ok  pending Community heading is personalized");
// Use BFT (not Midtown) for the pending-user check — closed Midtown shows the
// generic "Members only" gate, while a bookable BFT shows the "Booking locked"
// message specifically for pending applicants.
const bftPaid = allUpcoming.find((s) => s.activityId === "hyrox-bft" && !data.sessionStarted(s));
const pendHtml = views.viewActivity(bftPaid.id);
if (!pendHtml.includes("Booking locked")) {
  failures++;
  console.error("FAIL pending user should see booking locked");
} else console.log("ok  pending user blocked from paid booking");

// --- Admin approval flow ---
installLocalFixtures(); store.signIn("admin@example.test");
const defaultAdminHtml = await views.viewAdmin();
if (!defaultAdminHtml.includes('href="#/admin/members" class="active"')
    || defaultAdminHtml.includes('href="#/admin/approvals"')
    || !defaultAdminHtml.includes("Test Person")) {
  throw new Error("Admin must default to Members and show pending applicants there without an Approvals tab");
}
for (const tab of ["members", "activities", "giving", "payments"]) {
  const adminHtml = await check(`admin ${tab}`, () => views.viewAdmin(tab));
  const activeTabs = adminHtml.match(/<a[^>]*aria-current="page"[^>]*>/g) || [];
  if (activeTabs.length !== 1 || !activeTabs[0].includes(`href="#/admin/${tab}"`)) {
    throw new Error(`Admin ${tab} must expose exactly one matching active tab`);
  }
}
console.log("ok  every Admin route exposes exactly one active tab");
const adminScheduleHtml = await views.viewAdmin("payments");
if (!adminScheduleHtml.includes("HYROX weekly booking setup")
    || adminScheduleHtml.includes("created automatically")
    || adminScheduleHtml.includes("BFT + Midtown parent cards")
    || adminScheduleHtml.includes("form-hyrox-cycle-schedule")) {
  throw new Error("Admin Payments must use the collapsed HYROX weekly booking setup section without redundant provisioning copy");
}
console.log("ok  Admin Payments uses the collapsed HYROX weekly booking setup section");

// --- Admin Giving (local mode) ---
// Empty local state still surfaces an actionable Create campaign link.
const localEmptyGivingHtml = await views.viewAdmin("giving");
if (!localEmptyGivingHtml.includes("No Giving campaigns yet.") ||
    !localEmptyGivingHtml.includes("+ Create campaign")) {
  failures++;
  console.error("FAIL local empty Admin Giving must show empty state and Create campaign link");
} else console.log("ok  local empty Admin Giving shows empty state and Create campaign link");

// Closed campaigns remain visible while the open-campaign guard lets a
// successor be drafted.
const closedCampaign = {
  id: "closed-fixture-1",
  title: "Closed Local Campaign",
  description: "A previously closed local Giving campaign.",
  goalHKD: 12000,
  fpsId: "1111111",
  fpsPayee: "Island Evangelical Community Church",
  status: "closed",
  creatorProfileId: "fixture-admin",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  publishedAt: "2026-07-02T00:00:00.000Z",
  closedAt: "2026-07-15T00:00:00.000Z",
};
store.campaigns().push(structuredClone(closedCampaign));
const localClosedGivingHtml = await views.viewAdmin("giving");
if (!localClosedGivingHtml.includes("Closed Local Campaign") ||
    !localClosedGivingHtml.includes('<span class="badge neutral">closed</span>') ||
    !localClosedGivingHtml.includes("+ Create campaign")) {
  failures++;
  console.error("FAIL local closed Admin Giving must keep history visible and unlock Create campaign");
} else console.log("ok  local closed Admin Giving keeps history visible and unlocks Create campaign");
// Restore baseline so other tests do not observe this fixture campaign.
store.campaigns().pop();

const navFixtureUser = store.currentUser();
const originalNavFixtureRole = navFixtureUser.role;
try {
  for (const [role, label] of [
    ["member", "member"],
    ["admin", "Admin"],
    ["superadmin", "Super Admin"],
  ]) {
    navFixtureUser.role = role;
    assertPrimaryNav(
      navFixtureUser,
      ["Home", "Schedule", "Community", "Giving", "Profile"],
      label
    );
  }
} finally {
  navFixtureUser.role = originalNavFixtureRole;
}
const adminProfile = await views.viewAccount();
if (!adminProfile.includes("Admin Tools") || !adminProfile.includes('href="#/admin"')) {
  throw new Error("Admin Tools must remain available from Profile");
}
await check("admin activity edit", () => views.viewAdminActivity("hyrox"));
await check("admin activity new", () => views.viewAdminActivity("new"));
{
  // Local prototype mode keeps the recurring editor fully editable; the
  // read-only live gate must not leak into local renders.
  const editHtml = views.viewAdminActivity("wnt");
  if (!editHtml.includes('id="form-activity"') || editHtml.includes("form-fieldset\" disabled"))
    throw new Error("local mode must keep the recurring activity editor editable");
  const listHtml = await views.viewAdmin("activities");
  if (!listHtml.includes('#/admin/activity/new'))
    throw new Error("local mode must offer + New activity");
  console.log("ok  recurring activity editor stays editable in local mode");
}
{
  const swimmingBeforeEdit = structuredClone(store.getActivity("water"));
  store.saveActivity({
    ...swimmingBeforeEdit,
    location: "TBC",
    mapsQuery: "",
    photo: "../assets/itc/main.webp",
  });
  if (store.getActivity("water").photo !== "../assets/itc/water.webp") {
    throw new Error("editing Swimming must preserve its existing photo");
  }

  const activityId = "photo-regression-new";
  store.saveActivity({
    id: activityId,
    title: "Photo Regression New",
    kind: "paid",
    location: "Main Hall",
    mapsQuery: "Main Hall, Hong Kong",
    photo: "../assets/itc/main.webp",
    weekday: 2,
    durationMin: 60,
    price: 50,
    capacity: 10,
  });
  if (store.getActivity(activityId).photo !== "../assets/itc/main.webp") {
    throw new Error("new activities may keep the generic photo");
  }
  store.activities().splice(store.activities().findIndex((activity) => activity.id === activityId), 1);
}
const newApplicant = store.pendingApplicants().find((u) => u.email === "test@example.com");
store.approveApplicant(newApplicant.id);
console.log("ok  admin approved new applicant");

// --- Member booking + payment flow ---
const signIn = store.signIn("test@example.com");
if (!signIn.ok || signIn.user.status !== "approved") throw new Error("approval did not take effect");
await check("account (new member)", () => views.viewAccount());
const approvedCommunity = views.viewCommunity();
if (!approvedCommunity.includes("Connect and grow with us.")) {
  failures++;
  console.error("FAIL approved Community heading is not personalized");
} else console.log("ok  approved Community heading is personalized");

// Profile sections are tappable rows that open sub-pages; row faces carry
// a one-line description, not live details
const newMemberAcct = await views.viewAccount();
let cardsOk = true;
for (const link of [
  "#/account/details",
  "#/account/indemnity",
  "#/account/donor",
  "#/account/payments",
  "#/account/privacy",
  "#/account/history",
]) {
  if (!newMemberAcct.includes(`href="${link}"`)) {
    failures++;
    cardsOk = false;
    console.error(`FAIL Profile missing ${link} row`);
  }
}
if (cardsOk) console.log("ok  Profile shows the six section rows");
if (newMemberAcct.includes("#/account/about")) {
  failures++;
  console.error("FAIL About card should have moved to the Community tab");
} else console.log("ok  About card moved off Profile");
for (const sub of [
  "Contact and emergency information",
  "Donor ID and e-receipt details",
  "Bookings, donations and orders",
  "Consent and communication choices",
  "Activity history",
]) {
  if (!newMemberAcct.includes(sub)) {
    failures++;
    console.error(`FAIL Profile row missing subtext "${sub}"`);
  }
}
console.log("ok  Profile rows show descriptive subtexts");
await check("profile > details", () => views.viewAccount("details"));
await check("profile > indemnity", () => views.viewAccount("indemnity"));
await check("profile > donor", () => views.viewAccount("donor"));
await check("profile > payments", () => views.viewAccount("payments"));
await check("profile > privacy", () => views.viewAccount("privacy"));
await check("profile > history", () => views.viewAccount("history"));
const membershipDetailsHtml = await views.viewAccount("details");
const membershipDetailsEditHtml = await views.viewAccount("details", "edit");
if (!membershipDetailsHtml.includes("Emergency contact relationship")) {
  failures++;
  console.error("FAIL Membership Details summary missing emergency contact relationship");
}
if (!membershipDetailsEditHtml.includes('name="emergency_relationship"')) {
  failures++;
  console.error("FAIL Membership Details edit form missing emergency_relationship field");
} else console.log("ok  Membership Details summary and edit include emergency relationship");

// sub-page headings are title-cased to match the row titles
for (const [section, title] of [
  ["details", "Membership Details."],
  ["indemnity", "Indemnity."],
  ["donor", "Donor Profile."],
  ["payments", "Payments &amp; Receipts."],
  ["privacy", "Privacy &amp; Notifications."],
  ["history", "History."],
]) {
  if (!(await views.viewAccount(section)).includes(title)) {
    failures++;
    console.error(`FAIL profile > ${section} heading should read "${title}"`);
  }
}
console.log("ok  sub-page headings title-cased");
if (!(await views.viewAccount("nope")).includes("Page not found")) {
  failures++;
  console.error("FAIL unknown Profile section should 404");
} else console.log("ok  unknown Profile section 404s");

// indemnity: accepted at application -> confirmed on Profile as a single
// "Indemnity confirmed on [date]" line; stale consent must be detected from
// store.isIndemnityCurrent(), not from the timestamp alone.
if (!newMemberAcct.includes("Indemnity confirmed on") || newMemberAcct.includes("Accepted on")) {
  failures++;
  console.error("FAIL Profile should show a single indemnity-confirmed-on-date line");
} else console.log("ok  Profile shows single-line indemnity confirmation");
const currentIndemnityHtml = await views.viewAccount("indemnity");
for (const marker of [
  "Indemnity confirmed on",
  "Signed by",
  "Test Person",
  "Date of signing",
  "Emergency contact relationship",
  "Sibling",
  "Document version",
  "v1",
]) {
  if (!currentIndemnityHtml.includes(marker)) {
    failures++;
    console.error(`FAIL current Indemnity page missing "${marker}"`);
  }
}
console.log("ok  current indemnity page shows the stored consent record");
store.currentUser().indemnityAcceptedAt = Date.now() - 86400000;
store.currentUser().indemnityFormVersion = "v0";
const legacyIndemnityProfile = await views.viewAccount();
if (legacyIndemnityProfile.includes("Indemnity confirmed on") || !legacyIndemnityProfile.includes("Legacy acceptance recorded on")) {
  failures++;
  console.error("FAIL timestamp-only or stale indemnity should stay stale on Profile");
} else console.log("ok  timestamp-only or stale indemnity stays stale on Profile");
const staleIndemnityHtml = await views.viewAccount("indemnity");
for (const marker of [
  "A new version of the Indemnity is available",
  'data-doc-accept="indemnity"',
  'name="signature"',
  'name="signedAt"',
  'name="emergencyRelationship"',
  "Accept &amp; Confirm",
  "Edit in Membership Details",
]) {
  if (!staleIndemnityHtml.includes(marker)) {
    failures++;
    console.error(`FAIL stale Indemnity page missing "${marker}"`);
  }
}
console.log("ok  stale indemnity page renders the re-sign flow");
if (staleIndemnityHtml.includes('name="indemnityAccept"') || !/data-doc-submit[^>]*disabled/.test(staleIndemnityHtml)) {
  failures++;
  console.error("FAIL stale Indemnity should use one modal acknowledgement to unlock Accept & Confirm");
} else console.log("ok  stale Indemnity uses one modal acknowledgement to unlock Accept & Confirm");
for (const marker of [
  'await store.acceptMyIndemnity({',
  'signature: fd.get("signature") || ""',
  'signedAt: fd.get("signedAt") || ""',
  'emergencyRelationship: fd.get("emergencyRelationship") || ""',
]) {
  if (!integratedAppSource.includes(marker)) {
    failures++;
    console.error(`FAIL Profile > Indemnity handler missing structured contract: ${marker}`);
  }
}
console.log("ok  Profile > Indemnity handler bridges the structured contract");
store.currentUser().indemnityAcceptedAt = null;
store.currentUser().indemnityFormVersion = null;
if (!(await views.viewAccount()).includes("To be accepted")) {
  failures++;
  console.error('FAIL unaccepted indemnity should read "To be accepted"');
} else console.log('ok  unaccepted indemnity reads "To be accepted"');
if (!(await views.viewAccount("indemnity")).includes("Accept &amp; Confirm")) {
  failures++;
  console.error("FAIL indemnity page missing Accept & Confirm");
} else console.log("ok  indemnity page offers Accept & Confirm");

// --- Profile > Indemnity: one modal acknowledgement + full document button ---
const indemnityPageHtml = await views.viewAccount("indemnity");
if (!indemnityPageHtml.includes("View as full document")) {
  failures++;
  console.error('FAIL Profile > Indemnity should expose a "View as full document" button');
} else console.log('ok  Profile > Indemnity exposes "View as full document" button');
if (!indemnityPageHtml.includes('data-action="open-doc" data-doc="indemnity"')) {
  failures++;
  console.error('FAIL Profile > Indemnity button should target the indemnity document');
} else console.log("ok  Profile > Indemnity button targets the indemnity document");
if (indemnityPageHtml.includes('class="doc-content"')) {
  failures++;
  console.error("FAIL Profile > Indemnity should not duplicate the full document inline");
} else console.log("ok  Profile > Indemnity uses the modal as its only document reader");
store.acceptIndemnity(store.currentUser().id, {
  signature: "Test Person",
  signedAt: data.isoDate(data.todayLocal()),
  emergencyRelationship: "Sibling",
});
if (!(await views.viewAccount()).includes("Indemnity confirmed on")) {
  failures++;
  console.error("FAIL acceptIndemnity did not confirm on Profile");
} else console.log("ok  acceptIndemnity confirms on Profile");
if (!views.viewHome().includes("Nothing booked this week")) {
  failures++;
  console.error('FAIL "My week" should prompt when the member has no bookings');
} else console.log('ok  "My week" empty state prompts to book');
await check("checkout (member)", () => views.viewCheckout(paid.id));

// --- document registry (indemnity + privacy + guidelines) ---
const docsModule = await import("./js/documents.js");
const DOCS = docsModule.DOCUMENTS;
if (docsModule.INDEMNITY_VERSION !== "v1") {
  failures++;
  console.error(`FAIL indemnity version should be v1, got ${docsModule.INDEMNITY_VERSION}`);
}
if (DOCS.indemnity?.title !== "Indemnity") {
  failures++;
  console.error(`FAIL indemnity title should be Indemnity, got ${DOCS.indemnity?.title}`);
}
for (const key of ["indemnity", "privacy", "guidelines"]) {
  if (!DOCS[key] || typeof DOCS[key].renderBody !== "function" || !DOCS[key].title) {
    failures++;
    console.error(`FAIL documents registry missing entry for "${key}"`);
  }
}
console.log("ok  documents registry exposes indemnity + privacy + guidelines");
for (const [key, expected] of [["indemnity", false], ["privacy", true], ["guidelines", true]]) {
  if (!!DOCS[key]?.provisional !== expected) {
    failures++;
    console.error(`FAIL ${key} provisional watermark flag expected ${expected}, got ${!!DOCS[key]?.provisional}`);
  }
}
console.log("ok  document registry scopes provisional watermarks by document");

const indemnityBody = DOCS.indemnity?.renderBody?.() || "";
for (const marker of [
  "ITC Hyrox Training - Liability Release &amp; Data Privacy Form",
  "Hyrox Training from the date of signing to 31 December 2026",
]) {
  if (!indemnityBody.includes(marker)) {
    failures++;
    console.error(`FAIL indemnity document missing opening marker "${marker}"`);
  }
}
for (const [clause, phrase] of [
  ["1", "to assume and accept all and any risks"],
  ["2", "to waive any and all claims"],
  ["3", "to release:"],
  ["4", "to hold harmless and indemnify:"],
  ["5", "that appropriate insurance shall be taken out by me"],
  ["6", "the leaders of ITC and/or IECC have the right"],
  ["7", "that my level of physical fitness is adequate"],
  ["8", "that this Form shall be effective and binding"],
  ["9", "that I agree to the personal data privacy statement"],
  ["10", "that the laws of Hong Kong shall govern this Form"],
]) {
  if (!indemnityBody.includes(`data-clause="${clause}"`) || !indemnityBody.includes(phrase)) {
    failures++;
    console.error(`FAIL indemnity document missing clause ${clause}: "${phrase}"`);
  }
}
if (!indemnityBody.includes("https://www.islandecc.hk/privacy-policy/")) {
  failures++;
  console.error("FAIL indemnity document missing the IECC privacy-policy URL");
}
for (const removed of [
  "Health declaration",
  "Participation at my own risk",
  "Draft — pending ITC leadership review",
]) {
  if (indemnityBody.includes(removed)) {
    failures++;
    console.error(`FAIL indemnity document still contains draft marker "${removed}"`);
  }
}
console.log("ok  indemnity registry exposes versioned Hyrox legal copy");

for (const [key, headings] of Object.entries({
  privacy: [
    "What we collect",
    "Why we collect it",
    "Who sees it",
    "Your choices",
  ],
  guidelines: [
    "Everyone is welcome",
    "Respect and encouragement",
    "Safety first",
    "Photos and media",
    "Conduct",
  ],
})) {
  const body = DOCS[key]?.renderBody?.() || "";
  for (const heading of headings) {
    if (!body.includes(heading)) {
      failures++;
      console.error(`FAIL ${key} document missing heading "${heading}"`);
    }
  }
}
console.log("ok  privacy and guidelines registry bodies still expose their section headings");

// --- modal component: scroll-end math (Task 2) ---
const components = await import("./js/components.js");
if (components.SCROLL_END_THRESHOLD_PX !== 4) {
  failures++;
  console.error(`FAIL scroll-end threshold should be 4, got ${components.SCROLL_END_THRESHOLD_PX}`);
} else console.log("ok  scroll-end threshold is 4px");

const scrollCases = [
  [100, 200, 300, true],   // 300 >= 296
  [50, 200, 300, false],   // 250 < 296
  [0, 200, 200, true],     // everything fits, 200 >= 196
  [0, 100, 50, true],      // degenerate: doc smaller than viewport
];
for (const [top, height, scroll, expected] of scrollCases) {
  const got = components.isAtScrollEnd(top, height, scroll);
  if (got !== expected) {
    failures++;
    console.error(`FAIL isAtScrollEnd(${top},${height},${scroll}) expected ${expected}, got ${got}`);
  }
}
console.log("ok  isAtScrollEnd math returns correct values for 4 cases");

// --- generalized modal API ---
if (typeof components.openReadAndAcceptModal !== "function") {
  failures++;
  console.error("FAIL components should export openReadAndAcceptModal");
} else console.log("ok  components exports openReadAndAcceptModal");

// --- applyDocumentAcceptance: scoped per document container ---
const mkContainer = () => {
  const checkbox = { disabled: true, checked: false };
  const submit = { disabled: true };
  const hint = { hidden: false };
  return {
    checkbox,
    submit,
    hint,
    el: {
      querySelector: (sel) =>
        sel === "[data-doc-checkbox]" ? checkbox
        : sel === "[data-doc-submit]" ? submit
        : sel === "[data-doc-hint]" ? hint
        : null,
    },
  };
};
const indemnityC = mkContainer();
const privacyC = mkContainer();
const guidelinesC = mkContainer();
const privacyTrigger = { closest: (sel) => (sel === "[data-doc-accept]" ? privacyC.el : null) };
if (components.applyDocumentAcceptance(privacyTrigger) !== true) {
  failures++;
  console.error("FAIL applyDocumentAcceptance should return true when a container is paired");
}
if (privacyC.checkbox.disabled !== false || privacyC.checkbox.checked !== true || privacyC.submit.disabled !== false || privacyC.hint.hidden !== true) {
  failures++;
  console.error("FAIL applyDocumentAcceptance did not unlock the privacy checkbox, submit button, and hint");
}
if (indemnityC.checkbox.checked || guidelinesC.checkbox.checked || indemnityC.submit.disabled !== true || guidelinesC.submit.disabled !== true || indemnityC.hint.hidden || guidelinesC.hint.hidden) {
  failures++;
  console.error("FAIL applyDocumentAcceptance mutated a container other than the trigger's");
}
const submitOnly = {
  submit: { disabled: true },
  hint: { hidden: false },
  querySelector: (sel) =>
    sel === "[data-doc-submit]" ? submitOnly.submit
    : sel === "[data-doc-hint]" ? submitOnly.hint
    : null,
};
const submitOnlyTrigger = { closest: (sel) => (sel === "[data-doc-accept]" ? submitOnly : null) };
if (components.applyDocumentAcceptance(submitOnlyTrigger) !== true || submitOnly.submit.disabled || !submitOnly.hint.hidden) {
  failures++;
  console.error("FAIL applyDocumentAcceptance should unlock a submit-only document container");
}
console.log("ok  applyDocumentAcceptance mutates only the trigger's document container");

// applyDocumentAcceptance: returns false when no container is paired (Profile trigger)
const orphanTrigger = { closest: () => null };
if (components.applyDocumentAcceptance(orphanTrigger) !== false) {
  failures++;
  console.error("FAIL applyDocumentAcceptance should return false when no container is found");
} else console.log("ok  applyDocumentAcceptance returns false for orphan triggers");

// --- modal CSS classes present (Task 3) ---
const stylesSource = readFileSync(resolve(__dirnameSmoke, "styles.css"), "utf8");
for (const cls of [
  ".modal-backdrop",
  ".modal-dialog",
  ".modal-header",
  ".modal-doc",
  ".modal-doc-body",
  ".modal-doc-ack",
  ".modal-link",
  ".check input[disabled] + span",
]) {
  if (!stylesSource.includes(cls)) {
    failures++;
    console.error(`FAIL styles.css missing rule for "${cls}"`);
  }
}
if (!stylesSource.includes(".modal-doc-body.doc-provisional::after")) {
  failures++;
  console.error("FAIL modal document watermark should be scoped to provisional documents");
}
if (stylesSource.includes(".modal-doc-body::after {")) {
  failures++;
  console.error("FAIL modal document watermark should not apply to every document body");
}
console.log("ok  styles.css contains all modal-related class definitions");

// --- HYROX payment system: reserve -> mark -> collector confirm (Task 2) ---
const bftSession = allUpcoming.find(
  (s) => s.activityId === "hyrox-bft" && !data.sessionStarted(s)
);
if (!bftSession) throw new Error("expected an upcoming BFT session");
const before = store.spotsLeft(bftSession);
const reservationNow = Date.now();
const r1 = store.reserveSession(signIn.user.id, bftSession, reservationNow);
if (r1.status !== "reserved") throw new Error("new booking should be reserved");
if (r1.payDeadlineAt !== data.nextPayDeadline(bftSession.dateISO, reservationNow))
  throw new Error("reservation deadline should follow the checkpoint rule");
const after = store.spotsLeft(bftSession);
if (after !== before - 1) throw new Error(`reserved spot not held (${before} -> ${after})`);
console.log(`ok  reservation holds a spot ${before} -> ${after}`);
const unpaidHistoryHtml = await views.viewAccount("history");
if (!unpaidHistoryHtml.includes("HK$180 to be paid") || unpaidHistoryHtml.includes("paid HK$180")) {
  throw new Error("History must label an unpaid paid-session reservation as HK$180 to be paid");
}
console.log("ok  History distinguishes an unpaid paid-session reservation");
let dup = null;
try { store.reserveSession(signIn.user.id, bftSession); } catch (e) { dup = e; }
if (!dup) throw new Error("double reservation should be rejected");
console.log("ok  double booking rejected");
store.markBookingPaid(r1.id, "PayMe", "REF123");
if (!store.getBooking(r1.id).paymentMarkedAt) throw new Error("payment not marked");
const tinaNotes = store.notificationsFor("fixture-admin");
const localPaymentNotification = tinaNotes.find((n) => n.kind === "payment-marked");
if (!localPaymentNotification)
  throw new Error("collector should be notified of a marked payment");
const markedHistoryHtml = await views.viewAccount("history");
if (!markedHistoryHtml.includes("paid HK$180") || markedHistoryHtml.includes("HK$180 to be paid")) {
  throw new Error("History must label a payment-marked paid-session booking as paid HK$180");
}
console.log("ok  member marks paid -> collector notified and History shows paid amount");

// Local notifications cross the same store seam as Supabase rows. Preserve
// local copy/identity while adapting unread state, destination, and time for
// the Inbox; marking the rendered row read must survive a localStorage reload.
localPaymentNotification.title = "Payment marked";
localPaymentNotification.message = localPaymentNotification.body;
store.signIn("admin@example.test");
const localNotificationRows = await store.listMyNotifications();
const localInboxRow = localNotificationRows.find((row) => row.id === localPaymentNotification.id);
if (!localInboxRow
    || localInboxRow.kind !== localPaymentNotification.kind
    || localInboxRow.title !== localPaymentNotification.title
    || localInboxRow.message !== localPaymentNotification.message
    || localInboxRow.body !== localPaymentNotification.body) {
  throw new Error("local notification seam must preserve id, kind, title, message, and body");
}
if (localInboxRow.read_at !== null
    || localInboxRow.destination !== localPaymentNotification.link
    || localInboxRow.created_at !== new Date(localPaymentNotification.createdAt).toISOString()) {
  throw new Error("local notification seam must normalize unread state, destination, and creation time");
}
const localUnreadBeforeClick = localNotificationRows.filter((row) => !row.read_at).length;
if (localUnreadBeforeClick < 1) {
  throw new Error("local notification count must include the unread row");
}
const localInboxHtml = await views.viewNotifications(new Date(), localNotificationRows);
if (!localInboxHtml.includes(`data-notification-id="${localPaymentNotification.id}"`)
    || !localInboxHtml.includes(`data-destination="${localPaymentNotification.link}"`)) {
  throw new Error("local Inbox must render the unread row with its exact destination");
}
await store.markNotificationRead(localPaymentNotification.id);
const persistedNotificationState = JSON.parse(localStorage.getItem("itc.prototype.v1"));
const persistedNotificationRecord = persistedNotificationState.notifications.find(
  (row) => row.id === localPaymentNotification.id
);
if (persistedNotificationRecord?.read !== true
    || Object.hasOwn(persistedNotificationRecord || {}, "read_at")
    || Object.hasOwn(persistedNotificationRecord || {}, "destination")
    || Object.hasOwn(persistedNotificationRecord || {}, "created_at")) {
  throw new Error("local mark-read must persist only the existing local notification shape");
}
store.load();
const persistedLocalRows = await store.listMyNotifications();
const persistedLocalRow = persistedLocalRows.find((row) => row.id === localPaymentNotification.id);
if (!persistedLocalRow?.read_at) {
  throw new Error("clicking a local notification must persist its existing read flag");
}
if (persistedLocalRows.filter((row) => !row.read_at).length !== localUnreadBeforeClick - 1) {
  throw new Error("local notification count must drop by one after the clicked row persists read");
}
const localInboxAfterClick = await views.viewNotifications(new Date(), persistedLocalRows);
if (localInboxAfterClick.includes(`data-notification-id="${localPaymentNotification.id}"`)) {
  throw new Error("the clicked local notification must hide from the unread-only Inbox");
}
console.log("ok  local notification Inbox, count, destination, and click persistence");
const conf = store.confirmBookingPayment(r1.id);
store.signIn(signIn.user.email);
if (conf.booking.status !== "confirmed") throw new Error("collector confirm should confirm");
if (conf.receipt.method !== "PayMe") throw new Error("receipt should record the method");
if (!store.receiptForBooking(r1.id)) throw new Error("receipt should attach to the booking");
console.log("ok  collector confirms -> booking confirmed + receipt (PayMe)");
const booking = conf.booking, receipt = conf.receipt;
const bookedActivityLink = `href="#/activity/${booking.sessionId}"`;
const approvedHome = views.viewHome();
if (!approvedHome.includes("My Week") || !approvedHome.includes(booking.snapshot.name)
    || !approvedHome.includes(bookedActivityLink)) {
  throw new Error("approved Home must show the confirmed future booking in My Week");
}
for (const session of allUpcoming.filter((item) => item.id !== booking.sessionId)) {
  if (approvedHome.includes(`href="#/activity/${session.id}"`)) {
    throw new Error("approved My Week must exclude unbooked sessions");
  }
}
for (const status of ["reserved", "deferred", "cancelled", "attended"]) {
  try {
    booking.status = status;
    if (views.viewHome().includes(bookedActivityLink)) {
      throw new Error(`approved My Week must exclude ${status} bookings`);
    }
  } finally {
    booking.status = "confirmed";
  }
}
const futureSnapshotDateISO = booking.snapshot.dateISO;
const futureSnapshotStartTime = booking.snapshot.startTime;
try {
  booking.snapshot.dateISO = "2000-01-01";
  booking.snapshot.startTime = "00:00";
  if (views.viewHome().includes(bookedActivityLink)) {
    throw new Error("approved My Week must exclude confirmed bookings whose snapshot has started");
  }
} finally {
  booking.snapshot.dateISO = futureSnapshotDateISO;
  booking.snapshot.startTime = futureSnapshotStartTime;
}
if (!views.viewHome().includes(bookedActivityLink)) {
  throw new Error("confirmed future booking fixture must be restored after My Week mutations");
}
await check("booking confirmation", () => views.viewBooking(booking.id));
await check("receipt", () => views.viewReceipt(receipt.id));
await check("activity (member, booked)", () => views.viewActivity(paid.id));

// the booked class is badged on Home "My week" and on the Schedule row;
// "My week" shows booked sessions only, so unbooked ones stay out
const homeBooked = views.viewHome();
if (!homeBooked.includes("Booked") || !homeBooked.includes("BFT Causeway Bay")) {
  failures++;
  console.error('FAIL home "My week" does not show the booked session');
} else console.log('ok  home "My week" shows the booked session');
if (homeBooked.includes("Midtown28 Fitness") || homeBooked.includes("Just show up")) {
  failures++;
  console.error('FAIL home "My week" shows sessions the member has not booked');
} else console.log('ok  home "My week" hides unbooked sessions');
const WEEK_MS = 7 * 24 * 3600 * 1000;
views.scheduleState.weekOffset = Math.round(
  (data.sundayOf(data.parseISO(paid.dateISO)) - data.sundayOf(data.todayLocal())) / WEEK_MS
);
views.scheduleState.selected = paid.dateISO;
if (!views.viewSchedule().includes("Booked")) {
  failures++;
  console.error("FAIL schedule does not badge the booked session");
} else console.log("ok  schedule badges booked session");
if ((await views.viewAccount()).includes(">Upcoming<")) {
  failures++;
  console.error("FAIL Profile still repeats the upcoming bookings list");
} else console.log("ok  Profile drops redundant upcoming list");

// donor ID skipped at signup ("Not applicable" above) can be added later;
// it lives inside the Donor Profile sub-page, not on the card face
store.updateDonorId(signIn.user.id, "IECC-99999");
if (store.currentUser().donorId !== "IECC-99999") throw new Error("donor ID not saved");
if ((await views.viewAccount()).includes("IECC-99999")) {
  failures++;
  console.error("FAIL donor ID should not appear on the Profile card face");
} else console.log("ok  Profile card face carries no donor details");
if (!(await views.viewAccount("donor")).includes("IECC-99999")) {
  failures++;
  console.error("FAIL donor ID missing from Donor Profile sub-page");
} else console.log("ok  donor ID shows on Donor Profile sub-page");
store.updateDonorId(signIn.user.id, "wong 1234");
if (store.currentUser().donorId !== "WONG-1234") {
  failures++;
  console.error("FAIL donor ID should be stored uppercase with a hyphen");
} else console.log("ok  donor ID stored uppercase with hyphen");

// the member's only booking is an upcoming confirmed session, so History
// is empty — past bookings live behind the History card, not inline on Profile
if ((await views.viewAccount()).includes("booking-card")) {
  failures++;
  console.error("FAIL Profile should not list history inline");
} else console.log("ok  Profile keeps history behind the card");
const histHtml = await views.viewAccount("history");
if (histHtml.includes("booking-card") || !histHtml.includes("Past sessions will appear here")) {
  failures++;
  console.error("FAIL History sub-page should hide upcoming confirmed bookings");
} else console.log("ok  History sub-page hides upcoming bookings");

// --- Seeded member view ---
installLocalFixtures(); store.signIn("member@example.test");
await check("account (seeded member)", () => views.viewAccount());
const memberAcct = await views.viewAccount();
// fixture-member has donorId TEST-1234
if (!(await views.viewAccount("donor")).includes("TEST-1234")) {
  failures++;
  console.error("FAIL seeded member donor ID not shown in Donor Profile");
} else console.log("ok  seeded member donor ID shown in Donor Profile");
if (memberAcct.includes("TEST-1234")) {
  failures++;
  console.error("FAIL donor ID should not appear on the Profile card face");
} else console.log("ok  seeded member card faces carry no donor details");
// Seeded receipts (ITC-2026-0048) are removed; Payments shows receipts created during the test.
if ((await views.viewAccount("payments")).includes("ITC-2026-0048")) {
  failures++;
  console.error("FAIL seeded receipts should not be present in fresh state");
} else console.log("ok  no demo receipts are present");
if (!memberAcct.includes("Indemnity confirmed on")) {
  failures++;
  console.error("FAIL seeded member should have indemnity confirmed");
} else console.log("ok  seeded member indemnity confirmed");
if (!memberAcct.includes('class="kicker">Profile</div>') || memberAcct.includes("Member Profile") || memberAcct.includes("’s training")) {
  failures++;
  console.error('FAIL Profile header should read "Profile" with no name headline');
} else console.log('ok  Profile header reads "Profile"');
if (memberAcct.includes("member@example.test")) {
  failures++;
  console.error("FAIL email should not appear on the Profile face");
} else console.log("ok  Profile face carries no contact details");
if (!(await views.viewAccount("details")).includes("member@example.test")) {
  failures++;
  console.error("FAIL email missing from Membership Details sub-page");
} else console.log("ok  email lives on Membership Details sub-page");
installLocalFixtures({ withMemberBooking: true });
store.signIn("member@example.test");
await check("home (member)", () => views.viewHome());
const memberHome = views.viewHome();
const fixtureMember = store.currentUser();
const fixtureBookings = store.bookingsForUser(fixtureMember.id);
const bookedMarker = fixtureBookings[0]?.snapshot?.location ?? "BFT Causeway Bay";
const otherMarker = "Midtown28 Fitness";
if (!memberHome.includes(bookedMarker) || memberHome.includes(otherMarker)) {
  failures++;
  console.error(`FAIL "My week" should show only the member's booked HYROX (${bookedMarker})`);
} else console.log(`ok  "My week" shows only the member's booked session (${bookedMarker})`);
// community: prayer request records locally (no public reader by design)
const member = store.currentUser();
const prayer = store.recordPrayer({ userId: member.id, name: member.fullName, request: "Smoke test request" });
if (!prayer.id || prayer.request !== "Smoke test request") throw new Error("prayer not recorded");
console.log("ok  prayer request records locally");

// --- ICS generation ---
const fellowship = views.viewCommunity("fellowship");
assert.ok(fellowship.includes("service starts 9:30 AM"),
  "fellowship copy must show the 9:30 AM Sunday service start");
assert.ok(!fellowship.includes("service starts 10:30 AM"),
  "fellowship copy must not retain the old 10:30 AM service start");
console.log("ok  fellowship service time is 9:30 AM");

const ics = data.buildICS({
  ...free,
  id: "calendar-test",
  name: "Session, with ITC",
  dateISO: "2026-09-30",
  time: "09:30",
  durationMin: 60,
  location: "Tamar Park; Hong Kong",
  blurb: "Bring water;\nMeet at the gate",
});
assert.match(ics, /BEGIN:VEVENT/, "ICS must contain an event");
assert.match(ics, /DTSTAMP:\d{8}T\d{6}Z/,
  "ICS must include a calendar event creation timestamp");
assert.match(ics, /DTSTART:20260930T013000Z/,
  "ICS start must be an absolute UTC instant for a 9:30 AM HKT event");
assert.match(ics, /DTEND:20260930T023000Z/,
  "ICS end must be an absolute UTC instant");
assert.match(ics, /SUMMARY:Session\\, with ITC — Island Training Club/,
  "ICS text fields must escape commas");
assert.match(ics, /LOCATION:Tamar Park\\; Hong Kong/,
  "ICS text fields must escape semicolons");
assert.match(ics, /DESCRIPTION:Bring water\\;\\nMeet at the gate/,
  "ICS descriptions must escape punctuation and line breaks");
if (!ics.endsWith("\r\n")) throw new Error("ICS must end with a CRLF");
const longIcs = data.buildICS({
  ...free,
  id: "calendar-folding-test",
  dateISO: "2026-09-30",
  time: "09:30",
  blurb: "Session details ".repeat(12),
});
assert.ok(
  longIcs.split("\r\n").filter(Boolean)
    .every((line) => new TextEncoder().encode(line).length <= 75),
  "long ICS lines must be folded at the RFC 5545 octet limit",
);
console.log("ok  ICS generation");

const appCalendarSource = readFileSync(resolve(__dirnameSmoke, "js/app.js"), "utf8");
assert.match(appCalendarSource, /navigator\.canShare/,
  "calendar export must detect Safari's file-sharing path");
assert.match(appCalendarSource, /navigator\.share/,
  "calendar export must offer a file-sharing fallback");
assert.match(appCalendarSource, /if \(!b\.sessionId\)/,
  "calendar export must not create an event before a HYROX venue is assigned");
assert.doesNotMatch(appCalendarSource, /snapshot\.time \|\| snapshot\.startTime \|\| "00:00"/,
  "calendar export must not invent midnight for an unassigned booking");
assert.match(appCalendarSource, /document\.body\.appendChild\(a\)/,
  "calendar download links must be attached before clicking");
assert.match(appCalendarSource, /setTimeout\(\(\) => \{[\s\S]*?URL\.revokeObjectURL\(url\);[\s\S]*?a\.remove\(\);/,
  "calendar Blob URLs must be revoked after the browser has consumed them");
console.log("ok  Safari calendar delivery safeguards are present");

// --- v7 migration: legacy hyphen-less donor IDs get repaired on load ---
store.resetLocalData();
{
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.version = 6;
  raw.users = [
    { id: "legacy-member", role: "member", status: "approved", fullName: "Legacy", email: "legacy1@example.test", donorId: "CHUI08879" },
    { id: "legacy-admin", role: "admin", status: "approved", fullName: "Legacy Admin", email: "legacy2@example.test", donorId: "not a real id" },
  ];
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
  const allUsers = store.allUsers();
  const fixed = allUsers.find((u) => u.id === "legacy-member")?.donorId;
  if (fixed !== "CHUI-08879") {
    failures++;
    console.error(`FAIL v7 migration should repair CHUI08879 -> CHUI-08879, got ${fixed}`);
  } else console.log("ok  v7 migration inserts the missing hyphen");
  const cleared = allUsers.find((u) => u.id === "legacy-admin")?.donorId;
  if (cleared !== null) {
    failures++;
    console.error(`FAIL v7 migration should clear unrecognizable donor ID, got ${cleared}`);
  } else console.log("ok  v7 migration clears unrecognizable donor ID");
}

// --- pooled HYROX registration: HKT checkpoints + allocation rules ---
{
  const saturday = "2026-09-05";
  assert.equal(hyroxCycle.hyroxCycleId(saturday), "hyrox-pool-2026-09-05");
  assert.throws(
    () => hyroxCycle.hyroxCycleId("2026-09-04"),
    /Saturday/,
  );
  assert.throws(
    () => hyroxCycle.hyroxPaymentDeadline("2026-02-30"),
    /Invalid HYROX cycle date/,
  );
  assert.equal(
    hyroxCycle.hyroxRegistrationOpensAt(saturday),
    Date.parse("2026-08-31T18:00:00+08:00"),
  );
  assert.equal(
    hyroxCycle.hyroxPaymentReminderAt(saturday),
    Date.parse("2026-09-03T17:00:00+08:00"),
  );
  assert.equal(
    hyroxCycle.hyroxPaymentDeadline(saturday),
    Date.parse("2026-09-03T18:00:00+08:00"),
  );
  assert.equal(
    hyroxCycle.hyroxHolderGraceDeadline(saturday),
    Date.parse("2026-09-03T19:00:00+08:00"),
  );
  assert.equal(
    hyroxCycle.hyroxPromotedPaymentDeadline(saturday),
    Date.parse("2026-09-03T20:00:00+08:00"),
  );
  assert.equal(
    hyroxCycle.hyroxChoiceDeadline(saturday),
    Date.parse("2026-09-04T21:00:00+08:00"),
  );

  const allocations = hyroxCycle.allocateHyroxVenues([
    { id: "paid-midtown", paidAt: 1, venuePreference: "midtown" },
    { id: "paid-bft", paidAt: 2, venuePreference: "bft" },
    { id: "paid-either", paidAt: 3, venuePreference: "either" },
  ], {
    bftSessionId: "hyrox-bft-2026-09-05",
    midtownSessionId: "hyrox-midtown-2026-09-05",
  });
  assert.deepEqual(allocations.map(({ bookingId, sessionId }) => [bookingId, sessionId]), [
    ["paid-midtown", "hyrox-midtown-2026-09-05"],
    ["paid-bft", "hyrox-bft-2026-09-05"],
    ["paid-either", "hyrox-bft-2026-09-05"],
  ]);

  const bftDemand = Array.from({ length: 21 }, (_, index) => ({
    id: `booking-${String(index + 1).padStart(2, "0")}`,
    paidAt: 100,
    venuePreference: "bft",
  })).reverse();
  const bftDemandAllocation = hyroxCycle.allocateHyroxVenues(bftDemand, {
    bftSessionId: "hyrox-bft-2026-09-05",
    midtownSessionId: "hyrox-midtown-2026-09-05",
  });
  assert.deepEqual(
    bftDemandAllocation.map((row) => row.bookingId),
    Array.from({ length: 21 }, (_, index) => `booking-${String(index + 1).padStart(2, "0")}`),
  );
  assert.equal(bftDemandAllocation.filter((row) => row.sessionId.includes("hyrox-bft")).length, 20);
  assert.equal(bftDemandAllocation.at(-1).sessionId, "hyrox-midtown-2026-09-05");
  console.log("ok  pooled HYROX checkpoints and deterministic venue allocation");
}
{
  const bft = store.activities().find((a) => a.id === "hyrox-bft");
  const mid = store.activities().find((a) => a.id === "hyrox-midtown");
  if (bft.capacity !== 20 || mid.capacity !== 12)
    throw new Error("HYROX capacities should be BFT 20 / Midtown 12");
  console.log("ok  seeds: capacities 20/12");
}
{
  const correctedWater = store.activities().find((activity) => activity.id === "water");
  if (correctedWater.location !== "TBC" || correctedWater.mapsQuery !== ""
      || correctedWater.photo !== "../assets/itc/water.webp") {
    throw new Error("Swimming must start TBC with its water photo");
  }
  const correctedMidtown = store.activities().find((activity) => activity.id === "hyrox-midtown");
  if (correctedMidtown.location !== "Midtown28 Fitness"
      || correctedMidtown.mapsQuery !== "Midtown28 Fitness, Hong Kong") {
    throw new Error("Midtown HYROX must use the precise Fitness venue");
  }
}
{
  // v9 migration: persist a v8-shaped snapshot and reload
  const raw = localStorage.getItem("itc.prototype.v1");
  const snap = JSON.parse(raw);
  snap.version = 8;
  delete snap.sessionOverrides; delete snap.queues; delete snap.duty; delete snap.notifications;
  const bft = snap.activities.find((a) => a.id === "hyrox-bft");
  const mid = snap.activities.find((a) => a.id === "hyrox-midtown");
  bft.capacity = 18; mid.capacity = 18;
  for (const u of snap.users) { delete u.paymeLink; delete u.fpsPhone; }
  localStorage.setItem("itc.prototype.v1", JSON.stringify(snap));
  store.load();
  const bft2 = store.activities().find((a) => a.id === "hyrox-bft");
  const mid2 = store.activities().find((a) => a.id === "hyrox-midtown");
  if (bft2.capacity !== 20 || mid2.capacity !== 12) throw new Error("v9 migration must fix capacities");
  console.log("ok  v9 migration: capacities fixed");
}

{
  const locationV13 = {
    version: 13,
    sessionUserId: null,
    activities: structuredClone(data.SEED_ACTIVITIES),
    users: [],
    bookings: [{
      id: "old-midtown-booking",
      snapshot: { location: "Midtown 28" },
    }],
    receipts: [],
    campaigns: [],
    donations: [],
    prayers: [],
    notifications: [],
    sessionOverrides: {},
    queues: {},
    duty: {},
    paymentPayouts: {},
  };
  const oldWater = locationV13.activities.find((activity) => activity.id === "water");
  Object.assign(oldWater, {
    location: "TBC",
    mapsQuery: "TBC",
    photo: "../assets/itc/main.webp",
  });
  const oldMidtown = locationV13.activities.find((activity) => activity.id === "hyrox-midtown");
  Object.assign(oldMidtown, {
    location: "Midtown 28",
    mapsQuery: "Midtown 28, Hong Kong",
  });
  localStorage.setItem("itc.prototype.v1", JSON.stringify(locationV13));
  store.load();
  const migratedV13 = JSON.parse(localStorage.getItem("itc.prototype.v1"));
  if (migratedV13.version !== 19) {
    throw new Error("v19 migration must persist version 19");
  }
  const repairedWater = store.activities().find((activity) => activity.id === "water");
  if (repairedWater.location !== "TBC" || repairedWater.mapsQuery !== ""
      || repairedWater.photo !== "../assets/itc/water.webp") {
    throw new Error("v14 migration must repair Swimming defaults");
  }
  const repairedMidtown = store.activities().find((activity) => activity.id === "hyrox-midtown");
  if (repairedMidtown.location !== "Midtown28 Fitness"
      || repairedMidtown.mapsQuery !== "Midtown28 Fitness, Hong Kong") {
    throw new Error("v14 migration must repair Midtown HYROX defaults");
  }
  const repairedBooking = JSON.parse(localStorage.getItem("itc.prototype.v1")).bookings[0];
  if (repairedBooking.snapshot.location !== "Midtown28 Fitness") {
    throw new Error("v14 migration must repair exact Midtown booking snapshots");
  }

  const preservedV13 = {
    version: 13,
    sessionUserId: null,
    activities: structuredClone(data.SEED_ACTIVITIES),
    users: [],
    bookings: [],
    receipts: [],
    campaigns: [],
    donations: [],
    prayers: [],
    notifications: [],
    sessionOverrides: {},
    queues: {},
    duty: {},
    paymentPayouts: {},
  };
  const customWater = preservedV13.activities.find((activity) => activity.id === "water");
  Object.assign(customWater, {
    location: "Custom Pool",
    mapsQuery: "Custom Pool, Hong Kong",
    photo: "../assets/itc/custom-pool.webp",
  });
  const customMidtown = preservedV13.activities.find((activity) => activity.id === "hyrox-midtown");
  Object.assign(customMidtown, {
    location: "Custom Midtown Venue",
    mapsQuery: "Custom Midtown Venue, Hong Kong",
  });
  localStorage.setItem("itc.prototype.v1", JSON.stringify(preservedV13));
  store.load();
  const preservedWater = store.activities().find((activity) => activity.id === "water");
  if (preservedWater.location !== "Custom Pool"
      || preservedWater.mapsQuery !== "Custom Pool, Hong Kong"
      || preservedWater.photo !== "../assets/itc/custom-pool.webp") {
    throw new Error("v14 migration must not overwrite custom swimming values");
  }
  const preservedMidtown = store.activities().find((activity) => activity.id === "hyrox-midtown");
  if (preservedMidtown.location !== "Custom Midtown Venue"
      || preservedMidtown.mapsQuery !== "Custom Midtown Venue, Hong Kong") {
    throw new Error("v14 migration must not overwrite custom Midtown values");
  }
}

// --- HYROX payment system: sweep + cascade (Task 3) ---
store.resetLocalData();
installLocalFixtures(); store.signIn("member@example.test");
{
  const sess = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox-bft" && !data.sessionStarted(s) &&
      !store.userBookingFor(store.currentUser().id, s.id)
  );
  // Fill the session with confirmed bookings so only the reservation holds a spot.
  // We register a fleet of fixture-member-* users and pay for them.
  const fill = store.reserveSession(store.currentUser().id, sess);
  const st = JSON.parse(localStorage.getItem("itc.prototype.v1"));
  const act = st.activities.find((a) => a.id === "hyrox-bft");
  const fleet = [];
  for (let i = 0; i < act.capacity - 1; i++) {
    const id = `cascade-fixture-${i}`;
    st.users.push({
      id, role: "member", status: "approved", fullName: `Cascade ${i}`,
      preferredName: `C${i}`, email: `${id}@example.test`, phone: "+852 5555 0000",
      emergencyName: "x", emergencyPhone: "+852 5555 9999", heard: "test",
      isMinor: false, appliedAt: Date.now() - 86400000,
      indemnityAcceptedAt: Date.now() - 86400000,
      privacyAcceptedAt: Date.now() - 86400000,
      whatsappReminders: false, emailReceipts: false, communityNews: false,
    });
    st.bookings.push({
      id: `cascade-b-${i}`, userId: id, sessionId: sess.id,
      status: "confirmed", createdAt: Date.now() - 86400000,
      snapshot: {
        name: sess.name, kind: sess.kind, dateISO: sess.dateISO,
        time: sess.time, durationMin: sess.durationMin, location: sess.location,
        price: sess.price,
      },
    });
    fleet.push(id);
  }
  st.queues = st.queues || {};
  st.queues[sess.id] = { waitlist: [{ userId: "fixture-admin", joinedAt: Date.now() }], interest: [] };
  localStorage.setItem("itc.prototype.v1", JSON.stringify(st));
  store.load();
  installLocalFixtures(); store.signIn("member@example.test");
  // expire the held reservation and sweep
  const st2 = JSON.parse(localStorage.getItem("itc.prototype.v1"));
  const held = st2.bookings.find((b) => b.id === fill.id);
  held.payDeadlineAt = Date.now() - 1000;
  localStorage.setItem("itc.prototype.v1", JSON.stringify(st2));
  store.load();
  if (store.getBooking(fill.id).status !== "expired") throw new Error("overdue reservation should expire");
  const promoted = store.userReservationFor("fixture-admin", sess.id);
  if (!promoted) throw new Error("freed spot should cascade to waitlist #1");
  const memberNotes = store.notificationsFor("fixture-member");
  if (!memberNotes.some((n) => n.kind === "reservation-expired")) throw new Error("member should be told their reservation expired");
  const adminNotes = store.notificationsFor("fixture-admin");
  if (!adminNotes.some((n) => n.kind === "waitlist-promoted")) throw new Error("promoted member should be notified");
  console.log("ok  sweep expires overdue reservation and cascades to waitlist #1");
}

// --- HYROX payment system: queues + tie-break (Task 4) ---
store.resetLocalData();
installLocalFixtures();
{
  const sess = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox-bft" && !data.sessionStarted(s) &&
      !store.userBookingFor("fixture-member", s.id) && !store.userReservationFor("fixture-member", s.id)
  );
  const p1 = store.joinWaitlist("fixture-member", sess.id);
  const p2 = store.joinWaitlist("fixture-admin", sess.id);
  if (p1 !== 1 || p2 !== 2) throw new Error("waitlist positions should be join order");
  if (store.waitlistPosition("fixture-admin", sess.id) !== 2) throw new Error("position lookup failed");
  store.leaveWaitlist("fixture-member", sess.id);
  if (store.waitlistPosition("fixture-admin", sess.id) !== 1) throw new Error("positions should close ranks");
  console.log("ok  waitlist join/leave keeps honest positions");
}
{
  // both-queues tie-break: reserved at BFT + reserved at Midtown (opened) +
  // waitlisted at BFT's sibling... paying for one releases the rest
  const sat = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox-bft" && !data.sessionStarted(s) &&
      !store.userBookingFor("fixture-member", s.id)
  );
  const mid = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox-midtown" && s.dateISO === sat.dateISO
  );
  const quarry = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox-quarry-bay" && s.dateISO === sat.dateISO
  );
  const st = JSON.parse(localStorage.getItem("itc.prototype.v1"));
  st.sessionOverrides[mid.id] = { midtownOpen: true };
  localStorage.setItem("itc.prototype.v1", JSON.stringify(st));
  store.load();
  const bBft = store.reserveSession("fixture-member", sat);
  const bMid = store.reserveSession("fixture-member", mid);
  const bQuarry = store.reserveSession("fixture-member", quarry);
  store.markBookingPaid(bBft.id, "FPS", "");
  store.confirmBookingPayment(bBft.id);
  if (store.getBooking(bMid.id).status !== "cancelled")
    throw new Error("paying for BFT should release the Midtown reservation");
  if (store.getBooking(bQuarry.id).status !== "cancelled")
    throw new Error("paying for BFT should release the Quarry Bay reservation");
  const promotedMid = store.notificationsFor("fixture-member");
  if (!promotedMid.some((n) => n.kind === "hold-released"))
    throw new Error("member should be told the other hold was released");
  console.log("ok  paying for one HYROX venue releases every other venue hold");
}
// queue join guards existing bookings
{
  const sess = store.upcomingSessions(21).find(
    (s) => s.activityId === "hyrox-bft" && !data.sessionStarted(s) &&
      !store.userBookingFor("fixture-member", s.id) && !store.userReservationFor("fixture-member", s.id)
  );
  const b = store.reserveSession("fixture-member", sess);
  let threw = null;
  try { store.joinWaitlist("fixture-member", sess.id); } catch (e) { threw = e; }
  if (!threw) throw new Error("joinWaitlist should reject a member who already holds the session");
  store.releaseReservation(b.id);
  console.log("ok  queue join rejects already-booked members");
}

// --- HYROX payment system: Midtown open auto-converts (Task 5) ---
store.resetLocalData();
installLocalFixtures();
{
  const mid = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox-midtown" && !data.sessionStarted(s)
  );
  store.joinInterest("fixture-member", mid.id);
  store.joinInterest("fixture-admin", mid.id);
  // shrink capacity to 1 so only the first interested member converts
  const st = JSON.parse(localStorage.getItem("itc.prototype.v1"));
  const act = st.activities.find((a) => a.id === "hyrox-midtown");
  act.capacity = 1;
  localStorage.setItem("itc.prototype.v1", JSON.stringify(st));
  store.load();
  store.setMidtownOpen(mid.id, true);
  const converted = store.userReservationFor("fixture-member", mid.id);
  if (!converted) throw new Error("first interested member should get a reserved spot");
  if (store.waitlistPosition("fixture-admin", mid.id) !== 1)
    throw new Error("leftover interest should become the waitlist");
  if (!store.notificationsFor("fixture-member").some((n) => n.kind === "midtown-open"))
    throw new Error("converted member should be notified with a pay deadline");
  console.log("ok  Midtown open converts interest in order, rest waitlist");
}

// --- HYROX payment system: deferral + week cancellation (Task 6) ---
store.resetLocalData();
installLocalFixtures(); store.signIn("member@example.test");
{
  const sess = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox-bft" && !data.sessionStarted(s) &&
      !store.userBookingFor("fixture-member", s.id) && !store.userReservationFor("fixture-member", s.id)
  );
  const b = store.reserveSession("fixture-member", sess);
  store.markBookingPaid(b.id, "PayMe", "");
  store.signIn("admin@example.test");
  store.confirmBookingPayment(b.id);
  store.signIn("member@example.test");
  const confirmedBooking = store.getBooking(b.id);
  const targets = store.deferTargetsFor(confirmedBooking);
  if (!targets.length) throw new Error("expected future defer targets");
  if (targets.some((t) => t.id === sess.id)) throw new Error("own session is not a defer target");
  if (targets.some((t) => t.activityId !== sess.activityId))
    throw new Error("defer targets must be future sessions of the same activity");
  const wrongTypeTarget = store.upcomingSessions(35).find((session) =>
    session.activityId === "hyrox-midtown" && session.dateISO > sess.dateISO
  );
  if (!wrongTypeTarget) throw new Error("expected a different-activity paid target fixture");
  store.signIn("admin@example.test");
  store.setMidtownOpen(wrongTypeTarget.id, true);
  store.signIn("member@example.test");
  assert.throws(() => store.deferBooking(b.id, wrongTypeTarget.id), /same activity/,
    "the local write seam must reject a direct cross-activity deferral");
  if (store.getBooking(b.id).status !== "confirmed")
    throw new Error("rejected cross-activity deferral must preserve the confirmed booking");
  const confirmedView = views.viewBooking(b.id);
  assert.doesNotMatch(confirmedView, /Defer to this session|data-action="defer-to"|Can.t make it\? Defer/,
    "confirmed paid bookings must not surface defer actions under the no-deferral policy");
  console.log("ok  paid bookings honour the no-deferral policy on the booking detail screen");
}
{
  const sess = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox-bft" && !data.sessionStarted(s) &&
      !store.userBookingFor("fixture-member", s.id) && !store.userReservationFor("fixture-member", s.id)
  );
  const b = store.reserveSession("fixture-member", sess);
  store.markBookingPaid(b.id, "FPS", "");
  store.signIn("admin@example.test");
  store.confirmBookingPayment(b.id);

  store.joinWaitlist("fixture-admin", sess.id);
  store.cancelSessionWeek(sess.id, "HYROX race weekend — no session");
  const after = store.getSession(sess.id);
  if (!after.cancelled || after.cancelReason !== "HYROX race weekend — no session")
    throw new Error("cancelled week should carry the reason");
  if (store.getBooking(b.id).status !== "deferred")
    throw new Error("paid booking should auto-defer on week cancellation");
  if (store.waitlistPosition("fixture-admin", sess.id) !== null)
    throw new Error("waitlist should dissolve on week cancellation");
  const paidCancellationNote = store.notificationsFor("fixture-admin")
    .find((n) => n.kind === "session-cancelled");
  if (!paidCancellationNote) throw new Error("waitlisted member should be notified of the cancellation");
  if (paidCancellationNote.link !== `#/activity/${sess.id}`)
    throw new Error("paid cancellation should open the cancelled Activity Details page");
  if (!paidCancellationNote.body.startsWith("Session cancelled by ITC — HYROX race weekend — no session."))
    throw new Error("paid cancellation notification should use canonical copy");
  const paidCancellationHtml = views.viewActivity(sess.id);
  if (!paidCancellationHtml.includes("Paid bookings were moved to the next available session — check your account.")
      || paidCancellationHtml.includes("Stay tuned for the next available social."))
    throw new Error("paid cancellation Activity Details must render only the paid follow-up copy");

  store.signIn("member@example.test");
  const rsvp = store.upcomingSessions(21).find(
    (s) => s.kind === "rsvp" && !data.sessionStarted(s)
  );
  if (!rsvp) throw new Error("cancellation route coverage needs a future RSVP session");
  const rsvpBooking = await store.rsvpSession("fixture-member", rsvp);
  store.signIn("admin@example.test");
  store.cancelSessionWeek(rsvp.id, "Lunch venue unavailable");
  const rsvpCancellationNote = store.notificationsFor("fixture-member")
    .find((n) => n.kind === "session-cancelled" && n.body.includes("Lunch venue unavailable"));
  if (!rsvpCancellationNote) throw new Error("RSVP member should be notified of cancellation");
  if (rsvpCancellationNote.link !== `#/activity/${rsvp.id}`)
    throw new Error("RSVP cancellation should open Activity Details");
  if (!rsvpCancellationNote.body.startsWith("Session cancelled by ITC — Lunch venue unavailable."))
    throw new Error("RSVP cancellation notification should use canonical copy");
  if (store.getBooking(rsvpBooking.id).status !== "cancelled")
    throw new Error("cancelled RSVP booking should be cancelled");
  if (rsvpCancellationNote.link !== `#/activity/${rsvp.id}`)
    throw new Error("RSVP cancellation notification should open Activity Details");
  const rsvpCancellationHtml = views.viewActivity(rsvp.id);
  if (!rsvpCancellationHtml.includes("Stay tuned for the next available social.")
      || rsvpCancellationHtml.includes("Paid bookings were moved to the next available session — check your account."))
    throw new Error("RSVP cancellation Activity Details must render the exact social follow-up copy");
  console.log("ok  cancellations preserve canonical copy and route paid vs RSVP notifications");
}
{
  const sess = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox-bft" && !data.sessionStarted(s)
  );
  store.setSessionTime(sess.id, "10:00");
  store.setVenueTBC(sess.id, true);
  store.setSessionNotice(sess.id, "Weather watch — check WhatsApp Saturday morning");
  const s = store.getSession(sess.id);
  if (s.time !== "10:00" || !s.venueTBC || s.location !== "TBC" || !s.notice)
    throw new Error("session overrides should decorate the session");
  console.log("ok  session overrides: time change, venue TBC, notice");
}
{
  // Weekly venue override (free events): an Admin edit must surface on the
  // Schedule row and the dated activity detail; reset restores the default.
  const sess = store.upcomingSessions(21).find(
    (s) => s.activityId === "wnt" && !data.sessionStarted(s)
  );
  const seedLocation = store.getSession(sess.id).location;
  store.setWeekVenue(sess.id, {
    location: "Central Harbourfront",
    mapsQuery: "Central Harbourfront, Hong Kong",
  });
  const decorated = store.getSession(sess.id);
  if (decorated.location !== "Central Harbourfront"
    || decorated.mapsQuery !== "Central Harbourfront, Hong Kong")
    throw new Error("weekly venue override should decorate the session");
  views.scheduleState.weekOffset = Math.round(
    (data.sundayOf(data.parseISO(sess.dateISO)) - data.sundayOf(data.todayLocal())) / (7 * 86400000)
  );
  views.scheduleState.selected = sess.dateISO;
  views.scheduleState.filter = "all";
  if (!views.viewSchedule().includes("Central Harbourfront"))
    throw new Error("schedule row must show the overridden venue");
  if (!views.viewActivity(sess.id).includes("Central Harbourfront"))
    throw new Error("activity detail must show the overridden venue");
  store.setWeekVenue(sess.id, { location: null, mapsQuery: null });
  if (store.getSession(sess.id).location !== seedLocation)
    throw new Error("reset should restore the recurring default venue");
  views.scheduleState.weekOffset = 0;
  console.log("ok  weekly venue override: schedule row + detail + reset");
}

// --- HYROX payment system: duty roster (Task 7) ---
assert.equal(
  store.normalizePayMeLink("payme.hsbc.com.hk/1/collector-code"),
  "https://payme.hsbc.com.hk/1/collector-code"
);
assert.equal(
  store.normalizePayMeLink("payme.hsbc/collector-code"),
  "https://payme.hsbc/collector-code"
);
assert.equal(store.normalizePayMeLink(""), "");
assert.equal(
  store.normalizePayMeLink("https://payme.hsbc.com.hk/2/collector-code/"),
  "https://payme.hsbc.com.hk/2/collector-code"
);
assert.equal(
  store.normalizePayMeLink("https://payme.hsbc.com.hk/1/collector-code/?next=/#step/"),
  "https://payme.hsbc.com.hk/1/collector-code?next=/#step/"
);
for (const invalid of [
  "https://payme.hsbc/",
  "https://payme.hsbc/collector-code/extra",
  "http://payme.hsbc/collector-code",
  "https://user:pass@payme.hsbc/collector-code",
  "https://payme.hsbc:443/collector-code",
  "https://payme.hsbc/%2F",
  "https://payme.hsbc/%5C",
  "https://payme.hsbc.com.hk/",
  "https://payme.hsbc.com.hk/1",
  "https://payme.hsbc.com.hk/home",
  "https://payme.hsbc.com.hk/home/collector-code",
  "https://payme.hsbc.com.hk/3/collector-code",
  "https://payme.hsbc.com.hk/01/collector-code",
  "https://payme.hsbc.com.hk/999/collector-code",
  "https://payme.hsbc.com.hk/not-a-collector",
  "http://payme.hsbc.com.hk/1/collector-code",
  "https://example.com/collector",
  "https://user:pass@payme.hsbc.com.hk/1/collector-code",
  "https://payme.hsbc.com.hk:444/1/collector-code",
  "https://payme.hsbc.com.hk:443/1/collector-code",
  "https://payme.hsbc.com.hk/1/%2F",
  "https://payme.hsbc.com.hk/1/%5C",
  "not a url",
]) {
  assert.throws(
    () => store.normalizePayMeLink(invalid),
    /personal PayMe link/
  );
}

store.resetLocalData();
installLocalFixtures();
// Add a second admin so we can exercise a handover.
{
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.users.push({
    id: "fixture-super", role: "superadmin", status: "approved",
    fullName: "Test Super", preferredName: "Super",
    email: "super@example.test", phone: "+852 5000 0003",
    emergencyName: "Test", emergencyPhone: "+852 5000 9003", heard: "Test",
    isMinor: false, appliedAt: Date.now() - 86400000,
    indemnityAcceptedAt: Date.now() - 86400000,
    privacyAcceptedAt: Date.now() - 86400000,
    whatsappReminders: false, emailReceipts: false, communityNews: false,
  });
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
}
{
  const sess = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox-bft" && !data.sessionStarted(s)
  );
  // No duty set yet → collectorFor falls back to the first approved admin.
  if (store.collectorFor(sess.id)?.id !== "fixture-admin")
    throw new Error("default collector should fall back to fixture-admin");
  // Setting duty with a non-admin user is silently rejected.
  store.setDuty("fixture-member", sess.dateISO);
  if (store.collectorFor(sess.id)?.id !== "fixture-admin")
    throw new Error("setDuty should ignore non-admin users");
  // Handover to the second admin.
  store.setDuty("fixture-super", sess.dateISO);
  if (store.dutyFor(sess.id)?.userId !== "fixture-super")
    throw new Error("dutyFor should record the handover");
  if (store.collectorFor(sess.id)?.id !== "fixture-super")
    throw new Error("collectorFor should follow the handover");

  const legacy = JSON.parse(mem.get("itc.prototype.v1"));
  legacy.paymentPayouts["fixture-super"] = {
    paymeLink: "payme.hsbc.com.hk/1/legacy-super",
    fpsPhone: "+852 0000 0000",
  };
  mem.set("itc.prototype.v1", JSON.stringify(legacy));
  store.load();
  assert.equal(
    store.collectorPayoutsFor("fixture-super").paymeLink,
    "https://payme.hsbc.com.hk/1/legacy-super"
  );
  assert.equal(
    store.collectorFor(sess.id).paymeLink,
    "https://payme.hsbc.com.hk/1/legacy-super"
  );

  const invalidLegacy = JSON.parse(mem.get("itc.prototype.v1"));
  invalidLegacy.paymentPayouts["fixture-super"].paymeLink = "https://example.com/not-payme";
  mem.set("itc.prototype.v1", JSON.stringify(invalidLegacy));
  store.load();
  assert.equal(store.collectorPayoutsFor("fixture-super").paymeLink, "");
  assert.equal(store.collectorFor(sess.id).paymeLink, "");

  store.updateCollectorPayouts("fixture-super", {
    paymeLink: "payme.hsbc.com.hk/1/test-super",
  });
  assert.equal(
    JSON.parse(mem.get("itc.prototype.v1")).paymentPayouts["fixture-super"].paymeLink,
    "https://payme.hsbc.com.hk/1/test-super"
  );
  assert.throws(
    () => store.updateCollectorPayouts("fixture-super", { paymeLink: "not a url" }),
    /personal PayMe link/
  );
  assert.equal(
    JSON.parse(mem.get("itc.prototype.v1")).paymentPayouts["fixture-super"].paymeLink,
    "https://payme.hsbc.com.hk/1/test-super"
  );

  store.signIn("super@example.test");
  const payoutHtml = await views.viewAdmin("payments");
  if (payoutHtml.includes('name="fpsPhone"')
      || !payoutHtml.includes("https://payme.hsbc.com.hk/1/test-super")
      || !payoutHtml.includes("+852 5000 0003"))
    throw new Error("payout form should show normalized PayMe and the Membership Details phone without an FPS input");
  const c = store.collectorFor(sess.id);
  if (c.paymeLink !== "https://payme.hsbc.com.hk/1/test-super"
      || c.fpsPhone !== "+852 5000 0003")
    throw new Error("collector payout details should normalize PayMe and use the profile phone");
  console.log("ok  duty switch normalizes PayMe and uses the profile FPS phone");
}

// --- HYROX payment system: schedule & activity surfacing (Task 8) ---
store.resetLocalData();
installLocalFixtures();
{
  const sess = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox-bft" && !data.sessionStarted(s)
  );
  store.setSessionNotice(sess.id, "Weather watch — check WhatsApp");
  views.scheduleState.weekOffset = Math.round(
    (data.sundayOf(data.parseISO(sess.dateISO)) - data.sundayOf(data.todayLocal())) / (7 * 86400000)
  );
  views.scheduleState.selected = sess.dateISO;
  const row = views.viewSchedule();
  if (!row.includes("Weather watch"))
    throw new Error("schedule row should surface the notice");
  console.log("ok  schedule row surfaces session notice");
  store.cancelSessionWeek(sess.id, "HYROX race weekend — no session");
  views.scheduleState.selected = sess.dateISO;
  const sched = views.viewSchedule();
  if (!sched.includes("Cancelled") || !sched.includes("HYROX race weekend"))
    throw new Error("cancelled week must show in Schedule with badge + reason");
  const detail = views.viewActivity(sess.id);
  if (!detail.includes("HYROX race weekend"))
    throw new Error("detail page should show the reason");
  console.log("ok  cancelled week shows in Schedule (badge + reason) and detail");
  views.scheduleState.weekOffset = 0;
}
{
  const mid = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox-midtown" && !data.sessionStarted(s)
  );
  views.scheduleState.weekOffset = Math.round(
    (data.sundayOf(data.parseISO(mid.dateISO)) - data.sundayOf(data.todayLocal())) / (7 * 86400000)
  );
  views.scheduleState.selected = mid.dateISO;
  if (!views.viewSchedule().includes("Not yet open"))
    throw new Error("closed Midtown should read Not yet open in Schedule");
  store.signIn("member@example.test");
  const detail = views.viewActivity(mid.id);
  if (!detail.includes('data-action="join-interest"'))
    throw new Error("closed Midtown should offer wait-for-Midtown");
  console.log("ok  closed Midtown: badge + interest action");
  views.scheduleState.weekOffset = 0;
}

// --- HYROX payment system: member payment UI (Task 9) ---
store.resetLocalData();
installLocalFixtures();
const bookingCollectorPhone = '+852 5000 & "0001"';
store.signIn("admin@example.test");
store.currentUser().phone = bookingCollectorPhone;
store.updateCollectorPayouts("fixture-admin", {
  paymeLink: "payme.hsbc.com.hk/1/test-admin",
});
store.signIn("member@example.test");
{
  const sess = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox-bft" && !data.sessionStarted(s)
  );
  const co = views.viewCheckout(sess.id);
  if (typeof co !== "string" || co.includes("Card number") || !co.includes('id="form-reserve"'))
    throw new Error("checkout should be a reserve screen (no card form)");
  console.log("ok  checkout is now a reserve screen");
  const b = store.reserveSession("fixture-member", sess);
  b.id = "b-abc123";
  b.snapshot.location = 'BFT & "Bay" <Deck>';
  store.currentUser().fullName = 'Test & "Member" <Runner>';
  const pay = views.viewPay(b.id);
  const suggestedReference = "ITC-ABC123";
  for (const marker of [
    "Assigned collector / payee", "FPS mobile number", "Exact amount",
    "Suggested reference", suggestedReference,
    'data-action="copy-fps"', 'aria-label="Copy FPS number"',
    'data-action="copy-reference"', 'aria-label="Copy payment reference"',
    "Open your banking app", "pay by mobile number", "Paste the FPS number",
  ]) {
    if (!pay.includes(marker)) throw new Error(`same-device booking FPS UI missing ${marker}`);
  }
  if (!pay.includes(`value="${suggestedReference}"`)) {
    throw new Error("suggested booking reference must prefill reconciliation input");
  }
  assertFpsCopyBindings(pay, [
    {
      action: "copy-fps", kind: "number", label: "FPS mobile number",
      value: bookingCollectorPhone, escaped: "+852 5000 &amp; &quot;0001&quot;",
    },
    {
      action: "copy-reference", kind: "reference", label: "Suggested reference",
      value: suggestedReference, escaped: "ITC-ABC123",
    },
  ], "booking FPS screen");
  if (/QR|Scan with your banking app|amount is embedded/i.test(pay)) {
    throw new Error("booking FPS flow must not show or claim QR behavior");
  }
  if (!pay.includes("PayMe to") || !pay.includes("FPS to") || !pay.includes("HK$"))
    throw new Error("pay screen should show PayMe/FPS to the collector + amount");
  if (!pay.includes("Admin"))
    throw new Error("pay screen should name the on-duty collector");
  const expectedNote = `${sess.name} · ${data.fmtDate(sess.dateISO)} · BFT & "Bay" <Deck> · Test & "Member" <Runner>`;
  const escapedExpectedNote = `${sess.name} · ${data.fmtDate(sess.dateISO)} · BFT &amp; &quot;Bay&quot; &lt;Deck&gt; · Test &amp; &quot;Member&quot; &lt;Runner&gt;`;
  const noteControlTag = [...pay.matchAll(/<button\b[^>]*>/g)]
    .map((match) => match[0])
    .find((tag) => /\bdata-action="copy-payment-note"/.test(tag));
  const encodedNote = noteControlTag?.match(/\bdata-note="([^"]*)"/)?.[1];
  const decodedNote = String(encodedNote || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  if (!pay.includes('href="https://payme.hsbc.com.hk/1/test-admin"')
      || !pay.includes('target="_blank"')
      || !pay.includes(`<strong>${escapedExpectedNote}</strong>`)
      || encodedNote !== escapedExpectedNote
      || decodedNote !== expectedNote) {
    throw new Error("pay screen should escape visible/attribute notes and decode to the exact clipboard payload");
  }

  // A paid reservation notification must retain its exact booking route, and
  // following that route must render the final composed PayMe + same-device
  // FPS view rather than either branch's pre-integration payment fragment.
  const paymentDestination = `#/pay/${b.id}`;
  const previousPaidNotificationFilter = views.notificationFilters.kind;
  let paidInboxHtml;
  try {
    views.notificationFilters.kind = "all";
    paidInboxHtml = await views.viewNotifications(new Date(), [{
      id: "combined-paid-route",
      kind: "operational_booking_reserved",
      title: "Booking reserved",
      body: "Pay now to keep your spot.",
      destination: paymentDestination,
      read_at: null,
      created_at: "2026-08-05T02:00:00.000Z",
    }]);
  } finally {
    views.notificationFilters.kind = previousPaidNotificationFilter;
  }
  const paidNotificationControl = [...paidInboxHtml.matchAll(
    /<button class="notification-row[\s\S]*?<\/button>/g
  )].map((match) => match[0]).find(
    (tag) => tag.includes('data-notification-id="combined-paid-route"')
  ) || "";
  if (!paidNotificationControl.includes('data-action="notification-open"')
      || !paidNotificationControl.includes(`data-destination="${paymentDestination}"`)) {
    throw new Error("paid notification must render its exact Payment destination on the open control");
  }
  if (data.notificationDestination("operational_booking_reserved", paymentDestination)
      !== paymentDestination) {
    throw new Error("paid notification resolver must return the exact Payment destination");
  }
  const routedPaymentHtml = views.viewPay(paymentDestination.slice("#/pay/".length));
  if (typeof routedPaymentHtml !== "string") {
    throw new Error("paid notification destination must render its owned reserved Payment view");
  }
  const routedPayMeControl = [...routedPaymentHtml.matchAll(/<a\b[^>]*>[^<]*<\/a>/g)]
    .map((match) => match[0])
    .find((tag) => tag.includes(">PayMe to ")) || "";
  if (!routedPayMeControl.includes('href="https://payme.hsbc.com.hk/1/test-admin"')
      || !routedPayMeControl.includes('target="_blank"')
      || !routedPayMeControl.includes('rel="noopener"')) {
    throw new Error("notification-routed Payment view must keep the normalized safe PayMe handoff");
  }
  const routedNoteControl = [...routedPaymentHtml.matchAll(/<button\b[^>]*>/g)]
    .map((match) => match[0])
    .find((tag) => tag.includes('data-action="copy-payment-note"')) || "";
  if (!routedPaymentHtml.includes(`<strong>${escapedExpectedNote}</strong>`)
      || !routedNoteControl.includes(`data-note="${escapedExpectedNote}"`)) {
    throw new Error("notification-routed Payment view must keep the exact escaped PayMe note");
  }
  assertFpsCopyBindings(routedPaymentHtml, [
    {
      action: "copy-fps", kind: "number", label: "FPS mobile number",
      value: bookingCollectorPhone, escaped: "+852 5000 &amp; &quot;0001&quot;",
    },
    {
      action: "copy-reference", kind: "reference", label: "Suggested reference",
      value: suggestedReference, escaped: "ITC-ABC123",
    },
  ], "notification-routed booking FPS screen");
  if (/QR|Scan with your banking app|amount is embedded/i.test(routedPaymentHtml)) {
    throw new Error("notification-routed Payment view must remain QR-free");
  }
  console.log("ok  paid notification exact route renders composed safe PayMe + QR-free FPS view");

  const paymentFormStart = pay.indexOf('<form id="form-mark-paid"');
  const paymentSubmitStart = pay.indexOf('<button class="btn mt16" type="submit"', paymentFormStart);
  const paymentFormBeforeSubmit = pay.slice(paymentFormStart, paymentSubmitStart);
  const openDivClasses = [];
  let unmatchedPaymentDiv = false;
  let referenceInsideCardBody = false;
  let confirmationInsideCardBody = false;
  for (const tokenMatch of paymentFormBeforeSubmit.matchAll(
    /<div\b[^>]*>|<\/div>|<input\b[^>]*id="pay-ref"[^>]*>|confirms in-app/g
  )) {
    const token = tokenMatch[0];
    if (token.startsWith("<div")) {
      openDivClasses.push(token.match(/\bclass="([^"]*)"/)?.[1] || "");
    } else if (token === "</div>") {
      if (openDivClasses.length) openDivClasses.pop();
      else unmatchedPaymentDiv = true;
    } else if (token.startsWith("<input")) {
      referenceInsideCardBody = openDivClasses.includes("card-body");
    } else {
      confirmationInsideCardBody = openDivClasses.includes("card-body");
    }
  }
  assert.equal((paymentFormBeforeSubmit.match(/<div class="card">/g) || []).length, 1);
  assert.equal((paymentFormBeforeSubmit.match(/<div class="card-body">/g) || []).length, 1);
  assert.equal(unmatchedPaymentDiv, false, "payment confirmation card must not contain an unmatched closing div");
  assert.equal(openDivClasses.length, 0, "payment confirmation card wrappers must close before submit");
  assert.equal(referenceInsideCardBody, true, "payment reference field must remain inside card-body");
  assert.equal(confirmationInsideCardBody, true, "payment confirmation copy must remain inside card-body");

  const methodInput = (html, method) => [...html.matchAll(/<input\b[^>]*>/g)]
    .map((match) => match[0])
    .find((tag) => tag.includes(`name="method"`) && tag.includes(`value="${method}"`)) || "";
  const hasBooleanAttribute = (tag, attribute) =>
    new RegExp(`\\s${attribute}(?:\\s|>)`).test(tag);
  const paymeMethod = methodInput(pay, "PayMe");
  const fpsMethod = methodInput(pay, "FPS");
  if (!hasBooleanAttribute(paymeMethod, "checked")
      || hasBooleanAttribute(paymeMethod, "disabled")
      || hasBooleanAttribute(fpsMethod, "checked")
      || hasBooleanAttribute(fpsMethod, "disabled")) {
    throw new Error("pay screen with PayMe available should default to an enabled PayMe method");
  }
  if (pay.includes("amount ready")) {
    throw new Error("PayMe instructions must not claim the amount is prefilled");
  }
  const unpaidManage = views.viewBooking(b.id);
  assert.match(unpaidManage,
    new RegExp(`data-action="release-reservation"[^>]*data-booking="${b.id}"[^>]*>Cancel booking</button>`),
    "an unpaid booking owner must see the explicit Cancel booking action");
  assert.doesNotMatch(unpaidManage, /Release spot/,
    "member-facing unpaid cancellation must not use ambiguous release wording");
  store.signIn("admin@example.test");
  const adminViewingMemberReservation = views.viewBooking(b.id);
  assert.doesNotMatch(adminViewingMemberReservation, /data-action="release-reservation"|href="#\/pay\//,
    "a non-owner Admin must not receive member payment or cancellation controls");
  store.updateCollectorPayouts("fixture-admin", { paymeLink: "" });
  store.signIn("member@example.test");
  const fpsOnlyPay = views.viewPay(b.id);
  const fpsOnlyPayMeMethod = methodInput(fpsOnlyPay, "PayMe");
  const fpsOnlyFpsMethod = methodInput(fpsOnlyPay, "FPS");
  if (/<a[^>]*>PayMe to/.test(fpsOnlyPay) || !fpsOnlyPay.includes("use FPS")
      || !/<button[^>]*\sdisabled>PayMe unavailable<\/button>/.test(fpsOnlyPay)
      || !hasBooleanAttribute(fpsOnlyPayMeMethod, "disabled")
      || hasBooleanAttribute(fpsOnlyPayMeMethod, "checked")
      || !hasBooleanAttribute(fpsOnlyFpsMethod, "checked")
      || hasBooleanAttribute(fpsOnlyFpsMethod, "disabled")) {
    throw new Error("pay screen without a PayMe link should natively disable PayMe and default the form to FPS");
  }
  store.signIn("admin@example.test");
  store.currentUser().phone = "";
  store.updateCollectorPayouts("fixture-admin", { paymeLink: "", fpsPhone: "" });
  store.signIn("member@example.test");
  const missingFpsPay = views.viewPay(b.id);
  if (!missingFpsPay.includes("Not available")
      || missingFpsPay.includes('aria-label="Copy FPS number"')
      || !missingFpsPay.includes('aria-label="Copy payment reference"')
      || !missingFpsPay.includes("Ask an ITC leader for payment details")) {
    throw new Error("pay screen must safely explain missing FPS data without copying a blank destination");
  }
  console.log("ok  pay screen safely hands off PayMe with amount guidance, note, and FPS fallback");
  console.log("ok  pay screen shows same-device collector FPS details + amount/reference copies");
  store.markBookingPaid(b.id, "PayMe", "");
  const awaiting = views.viewBooking(b.id);
  if (!awaiting.includes("being confirmed"))
    throw new Error("booking should show awaiting confirmation");
  assert.doesNotMatch(awaiting, /data-action="release-reservation"|Cancel booking/,
    "payment-marked bookings must not expose unpaid cancellation");
  console.log("ok  booking shows awaiting-confirmation state");
  store.signIn("admin@example.test");
  store.confirmBookingPayment(b.id);
  store.signIn("member@example.test");
  const conf = views.viewBooking(b.id);
  assert.doesNotMatch(conf, /data-action="defer-to"|Can.t make it\? Defer|Defer to this session/,
    "confirmed bookings must not offer deferral under the no-deferral policy");
  if (conf.includes("Cancel & refund"))
    throw new Error("member refund flow should be gone");
  console.log("ok  confirmed booking honours no-deferral policy, no member refund");
}

// --- No-deferral policy --------------------------------------------------
// Confirmed paid bookings must not surface deferral UI or store-level
// deferral entry points. The store keeps `deferBooking` callable for
// store-level callers, but the booking detail screen and the click
// delegate must hide every defer path.
{
  store.resetLocalData();
  installLocalFixtures();
  const paid = store.upcomingSessions(14).find(
    (s) => s.kind === "paid" && !store.isMidtown(s) && !data.sessionStarted(s),
  );
  store.signIn("member@example.test");
  const b = store.reserveSession("fixture-member", paid);
  store.markBookingPaid(b.id, "PayMe", "");
  store.signIn("admin@example.test");
  store.confirmBookingPayment(b.id);
  store.signIn("member@example.test");
  const html = views.viewBooking(b.id);
  assert.doesNotMatch(html, /data-action="defer-to"/, "no-deferral: defer-to action must not render");
  assert.doesNotMatch(html, /Can.t make it\? Defer/, "no-deferral: defer card heading must not render");
  assert.equal(typeof store.deferTargetsFor, "function", "store must keep deferTargetsFor for store-level callers");
  assert.equal(typeof store.deferBooking, "function", "store must keep deferBooking for store-level callers");
  console.log("ok  no-deferral policy hides defer UI while keeping store hooks");
}

// --- HYROX payment system: admin ops (Task 10) ---
store.resetLocalData();
installLocalFixtures();
const opsCycleDate = data.isoDate(data.addDays(data.saturdayOnOrAfter(data.todayLocal()), 7));
const opsCycle = store.scheduleHyroxCycle(opsCycleDate);
store.sweepHyroxCycleDeadlines(opsCycle.registrationOpensAt);
store.signIn("member@example.test");
{
  const sess = store.upcomingSessions(14).find(
    (s) => s.activityId === "hyrox-bft" && !data.sessionStarted(s)
  );
  const b = store.reserveSession("fixture-member", sess);
  store.markBookingPaid(b.id, "FPS", "9921");
  const opsCycleClaim = store.reserveHyroxCycle("fixture-member", opsCycle.id, "either", true,
    opsCycle.registrationOpensAt);
  store.markBookingPaid(opsCycleClaim.id, "FPS", "9922");
  store.signIn("admin@example.test");
  const ops = await views.viewAdmin("payments");
  if (!ops.includes(">Payments</a>") || ops.includes(">HYROX</a>")
      || (ops.match(/aria-current="page"/g) || []).length !== 1)
    throw new Error("Admin payments tab should be labeled Payments and expose one active tab");
  if (ops.includes("Weekly Session Overrides") || ops.includes("form-cancel-week"))
    throw new Error("payments tab must not carry weekly session setup controls");
  if (!ops.includes('<details class="admin-section') || !ops.includes("<summary>"))
    throw new Error("payments tab sections must collapse behind their headers");
  if (!ops.includes("Pending payments") || !ops.includes("9921"))
    throw new Error("ops should list pending payments with references");
  if (!ops.includes('data-action="confirm-payment"'))
    throw new Error("pending payments need a confirm action");
  console.log("ok  ops lists pending payments for the collector");
  if (!ops.includes("HYROX weekly booking setup") || !ops.includes("Venue handoff") || !ops.includes("wa.me"))
    throw new Error("ops should include the HYROX booking and payment card with a WhatsApp link");
  const islandEccCard = ops.indexOf("ITC HYROX - Island ECC");
  if (!ops.includes("admin-hyrox-count-link") || !ops.includes("admin-status-anchor")
      || !ops.includes(`hyrox-status-${opsCycle.id}-confirmed`)
      || !ops.includes(`hyrox-status-${opsCycle.id}-claims`)
      || !/hyrox-venue-[a-z0-9-]+-confirmed/.test(ops)
      || !/hyrox-venue-[a-z0-9-]+-claims/.test(ops)) {
    throw new Error("Admin HYROX status counts (parent + venue) should be drill-down links with anchored targets");
  }
  if (!ops.includes("admin-claims-section") || !ops.includes("Payment claims to review")) {
    throw new Error("Only the claims tile should be a drill-down link to a collapsible claims list");
  }
  if (!ops.includes("<strong>Spots left</strong>") && !ops.includes(">Spots left<")) {
    throw new Error("Venue status grid should expose a Spots left counter");
  }
  if (ops.includes(">Capacity</span>")) {
    throw new Error("Venue status grid should not use the legacy Capacity label");
  }
  const parentCycleEnd = ops.indexOf('id="form-cancel-hyrox-cycle"');
  if (islandEccCard === -1 || !ops.includes("hyrox-island-ecc-card")
      || !ops.includes("Payment reconciliation")
      || !ops.includes("<p class=\"muted small mt8\">Registration:")
      || ops.includes("Venue: <strong>Island ECC</strong>")
      || islandEccCard < parentCycleEnd) {
    throw new Error("Island ECC reconciliation should follow its parent HYROX card without redundant venue copy");
  }
  if (ops.includes("admin-hyrox-count-link") && !ops.includes("data-claims-anchor")) {
    throw new Error("Only the parent cycle Payment claims tile should be a drill-down link");
  }
  if (!ops.toLowerCase().includes("duty"))
    throw new Error("ops should include the duty card");
  console.log("ok  ops has finalize-with-gym (WhatsApp) + duty cards");
  if (!ops.includes('class="admin-tabs') || !ops.includes("admin-tabs-scroll")) {
    throw new Error("Admin tabs should support horizontal overflow on small viewports");
  }
  const conf = store.confirmBookingPayment(b.id);
  if (!conf) throw new Error("collector confirm failed from ops flow");
  console.log("ok  collector confirms payment from ops");
}

// --- Generic Socials preview: rolling seven-day selector ---
store.resetLocalData();
installLocalFixtures();
store.signIn("admin@example.test");
{
  const todayHktISO = data.todayHktISO();
  const today = data.parseISO(todayHktISO);
  const datePlus = (days) => data.isoDate(data.addDays(today, days));
  assert.equal(datePlus(0), todayHktISO,
    "generic Social fixtures must use the HKT calendar date, not the host-local date");
  await store.createOneOffEvent({
    name: "Already Started Social",
    dateISO: datePlus(0),
    time: "00:00",
    durationMin: 90,
    location: "Central",
    mapsQuery: "Central, Hong Kong",
    category: "Socials",
    price: 0,
    capacity: 20,
  });
  const earliestSocial = await store.createOneOffEvent({
    name: "Community Breakfast",
    dateISO: datePlus(1),
    time: "08:00",
    durationMin: 90,
    location: "Central",
    mapsQuery: "Central, Hong Kong",
    category: "Socials",
    price: 0,
    capacity: 20,
  });
  await store.createOneOffEvent({
    name: "Community Dinner",
    dateISO: datePlus(2),
    time: "19:00",
    durationMin: 90,
    location: "Wan Chai",
    mapsQuery: "Wan Chai, Hong Kong",
    category: "Socials",
    price: 0,
    capacity: 20,
  });
  await store.createOneOffEvent({
    name: "Strength Workshop",
    dateISO: datePlus(1),
    time: "07:00",
    durationMin: 60,
    location: "Central",
    mapsQuery: "Central, Hong Kong",
    category: "Strength",
    price: 0,
    capacity: 20,
  });
  await store.createOneOffEvent({
    name: "Next Week Social",
    dateISO: datePlus(7),
    time: "08:00",
    durationMin: 90,
    location: "Central",
    mapsQuery: "Central, Hong Kong",
    category: "Socials",
    price: 0,
    capacity: 20,
  });
  const nextSocial = store.nextSocialSession();
  if (!nextSocial || nextSocial.id !== earliestSocial.id) {
    throw new Error("nextSocialSession should skip started socials and select the earliest rolling-window social");
  }
  console.log("ok  Socials selector skips started events and ignores later/non-Socials events");
}

// Isolate both rolling-window edges so an earlier fixture cannot make either
// assertion pass without evaluating the seven-day candidate itself.
{
  const RealDateForSocialBoundary = globalThis.Date;
  const fixedNow = "2026-08-05T02:00:00.000Z"; // 10:00 HKT
  globalThis.Date = class extends RealDateForSocialBoundary {
    constructor(...args) {
      super(...(args.length ? args : [fixedNow]));
    }
    static now() {
      return RealDateForSocialBoundary.parse(fixedNow);
    }
    static parse(value) {
      return RealDateForSocialBoundary.parse(value);
    }
    static UTC(...args) {
      return RealDateForSocialBoundary.UTC(...args);
    }
  };
  const resetWithoutSocials = () => {
    store.resetLocalData();
    installLocalFixtures();
    const boundaryState = JSON.parse(mem.get("itc.prototype.v1"));
    boundaryState.activities = boundaryState.activities
      .filter((activity) => activity.category !== "Socials");
    boundaryState.oneOffEvents = [];
    mem.set("itc.prototype.v1", JSON.stringify(boundaryState));
    store.load();
    store.signIn("admin@example.test");
  };
  try {
    resetWithoutSocials();
    const exactDaySeven = await store.createOneOffEvent({
      name: "Exact Day Seven Social",
      dateISO: "2026-08-12",
      time: "10:00",
      durationMin: 60,
      location: "Central",
      mapsQuery: "Central, Hong Kong",
      category: "Socials",
      price: 0,
      capacity: 20,
    });
    assert.equal(store.nextSocialSession()?.id, exactDaySeven.id,
      "a Social starting at the exact seven-day HKT instant must be included");

    resetWithoutSocials();
    await store.createOneOffEvent({
      name: "Beyond Day Seven Social",
      dateISO: "2026-08-12",
      time: "10:01",
      durationMin: 60,
      location: "Central",
      mapsQuery: "Central, Hong Kong",
      category: "Socials",
      price: 0,
      capacity: 20,
    });
    assert.equal(store.nextSocialSession(), null,
      "a Social starting beyond the seven-day HKT instant must be excluded");
    console.log("ok  Socials selector isolates exact and beyond-seven HKT boundaries");
  } finally {
    globalThis.Date = RealDateForSocialBoundary;
  }
}
store.resetLocalData();
installLocalFixtures();
{
  const fallbackState = JSON.parse(mem.get("itc.prototype.v1"));
  fallbackState.activities = fallbackState.activities.filter((activity) => activity.category !== "Socials");
  fallbackState.oneOffEvents = [];
  mem.set("itc.prototype.v1", JSON.stringify(fallbackState));
  store.load();
  const fallbackCommunity = views.viewCommunity();
  if (store.nextSocialSession() !== null || !fallbackCommunity.includes('href="#/schedule"')) {
    throw new Error("Community Pulse should fall back to Schedule when no Socials event starts within seven days");
  }
  console.log("ok  Community Socials preview falls back to Schedule when no event is available");
}
store.resetLocalData();
installLocalFixtures();

// --- One-off events (local mode) ---
store.resetLocalData();
installLocalFixtures();
store.signIn("member@example.test");
try {
  await store.createOneOffEvent({ name: "Nope", dateISO: "2026-09-05", time: "10:00", durationMin: 60, location: "Somewhere" });
  throw new Error("members must not create one-off events");
} catch (err) {
  if (!/admin/i.test(err.message)) throw new Error(`expected admin guard, got: ${err.message}`);
}
store.signIn("admin@example.test");
{
  const oneOffDate = (daysAhead) => data.isoDate(data.addDays(data.parseISO(data.todayHktISO()), daysAhead));
  const paidEvent = await store.createOneOffEvent({
    name: "HYROX Race Day Send-off", dateISO: oneOffDate(1), time: "10:00",
    durationMin: 90, location: "Kai Tak", mapsQuery: "", category: "HYROX",
    price: 250, capacity: 12,
  });
  if (!paidEvent.oneOff || paidEvent.kind !== "paid" || !paidEvent.id.startsWith("event-"))
    throw new Error("paid one-off event should be flagged, priced and event-prefixed");
  if (!store.upcomingSessions(30).some((s) => s.id === paidEvent.id))
    throw new Error("one-off event should appear in upcoming sessions");
  if (!store.getSession(paidEvent.id)) throw new Error("getSession must resolve one-off events");
  const eventHtml = views.viewActivity(paidEvent.id);
  if (!eventHtml.includes("Book & pay") || !eventHtml.includes("HK$250"))
    throw new Error("paid one-off activity page should offer booking");
  const freeEvent = await store.createOneOffEvent({
    name: "Community Picnic", dateISO: oneOffDate(2), time: "15:00",
    durationMin: 120, location: "Tamar Park", category: "Other",
  });
  if (freeEvent.kind !== "free") throw new Error("zero-price one-off should be free");
  const freeEventHtml = views.viewActivity(freeEvent.id);
  if (!freeEventHtml.includes("Free · No booking needed"))
    throw new Error("free one-off should render the free banner");
  const freeCancelledEvent = await store.createOneOffEvent({
    name: "Cancelled Community Social", dateISO: oneOffDate(3), time: "15:00",
    durationMin: 90, location: "Tamar Park", category: "Socials",
  });
  store.cancelSessionWeek(freeCancelledEvent.id, "Weather warning");
  const freeCancellationHtml = views.viewActivity(freeCancelledEvent.id);
  if (!freeCancellationHtml.includes("Stay tuned for the next available social.")
      || freeCancellationHtml.includes("Paid bookings were moved to the next available session — check your account."))
    throw new Error("free cancellation Activity Details must render the exact social follow-up copy");
  const adminActivitiesHtml = await views.viewAdmin("activities");
  if (!adminActivitiesHtml.includes("One-off Events")
      || !adminActivitiesHtml.includes("form-one-off-event")
      || !adminActivitiesHtml.includes("HYROX Race Day Send-off"))
    throw new Error("Activities tab should list one-off events and the add form");
  const weeklyStart = adminActivitiesHtml.indexOf(">Weekly Event Controls<");
  const oneOffStart = adminActivitiesHtml.indexOf(">One-off Events<");
  const weeklyRegion = weeklyStart === -1 || oneOffStart === -1
    ? ""
    : adminActivitiesHtml.slice(weeklyStart, oneOffStart);
  const oneOffRegion = oneOffStart === -1 ? "" : adminActivitiesHtml.slice(oneOffStart);
  for (const event of [paidEvent, freeEvent]) {
    if (weeklyRegion.includes(event.name) || weeklyRegion.includes(event.id))
      throw new Error(`${event.name} must not receive recurring controls`);
    if (!oneOffRegion.includes(event.name) || !oneOffRegion.includes(event.id))
      throw new Error(`${event.name} must appear only in One-off Events`);
  }
  // Deletion is refused once a booking exists; cancellation still works and
  // voids the booking (no same-activity follow-up session to defer to).
  store.signIn("member@example.test");
  const oneOffBooking = store.reserveSession("fixture-member", paidEvent.id);
  store.signIn("admin@example.test");
  try {
    await store.deleteOneOffEvent(paidEvent.id);
    throw new Error("delete must refuse events with active bookings");
  } catch (err) {
    if (!/cancel the session instead/.test(err.message)) throw err;
  }
  await store.deleteOneOffEvent(freeEvent.id);
  if (store.getSession(freeEvent.id)) throw new Error("deleted free event should be gone");
  store.cancelSessionWeek(paidEvent.id, "Venue unavailable");
  if (store.getBooking(oneOffBooking.id).status !== "cancelled")
    throw new Error("cancelling a one-off should void its reservations");
  if (store.getSession(paidEvent.id)?.cancelled !== true)
    throw new Error("cancelled one-off should read as cancelled");
  console.log("ok  one-off events: create, list, book, delete guard, cancel");
}

// --- RSVP events (local): the recurring post-training lunch ---
store.resetLocalData();
installLocalFixtures();
{
  const lunch = store.upcomingSessions(21).find(
    (s) => s.kind === "rsvp" && !data.sessionStarted(s)
  );
  if (!lunch || lunch.category !== "Socials" || lunch.name !== "Post-Training Lunch")
    throw new Error("local seeds must include the recurring RSVP lunch");
  if (lunch.capacity !== null || store.spotsLeft(lunch) !== null)
    throw new Error("the lunch is uncapped — capacity and spots must be null");
  store.signIn("member@example.test");
  const lunchHtml = views.viewActivity(lunch.id);
  if (!lunchHtml.includes("Count me in") || lunchHtml.includes("Book & pay"))
    throw new Error("RSVP activity should offer Count me in, not checkout");
  const rsvp = await store.rsvpSession("fixture-member", lunch.id);
  if (rsvp.status !== "confirmed" || rsvp.snapshot.price !== 0)
    throw new Error("RSVP should confirm instantly with no payment");
  assert.equal(store.attendeeCountFor(lunch), 1,
    "local RSVP count must include the confirmed booking");
  assert.deepEqual(store.attendeesFor(lunch), ["Tester M."],
    "attendeesFor must preserve attendee name formatting independently of counts");
  const goingHtml = views.viewActivity(lunch.id);
  if (!goingHtml.includes("You're going") || !goingHtml.includes("rsvp-withdraw"))
    throw new Error("RSVP'd member should see the Going state and a withdraw action");
  const bookingPage = views.viewBooking(rsvp.id);
  if (!bookingPage.includes("You’re going") || bookingPage.includes("Can’t make it? Defer")
      || bookingPage.includes("View receipt"))
    throw new Error("RSVP booking page must not offer payment deferral or receipts");
  const checkout = views.viewCheckout(lunch.id);
  if (typeof checkout !== "string" || !checkout.includes("doesn’t exist"))
    throw new Error("RSVP sessions must not render checkout");

  // The exact RSVP notification route, Sunday-first Schedule row, Activity
  // Details banner, and dated card inside grouped Admin controls must agree on
  // the same literal count. Each surface is isolated to this lunch/session ID.
  const rsvpDestination = `#/activity/${lunch.id}`;
  const previousRsvpNotificationFilter = views.notificationFilters.kind;
  let rsvpInboxHtml;
  try {
    views.notificationFilters.kind = "all";
    rsvpInboxHtml = await views.viewNotifications(new Date(), [{
      id: "combined-rsvp-route",
      kind: "operational_rsvp_confirmed",
      title: "RSVP confirmed",
      body: "You are counted in.",
      destination: rsvpDestination,
      read_at: null,
      created_at: "2026-08-05T02:00:00.000Z",
    }]);
  } finally {
    views.notificationFilters.kind = previousRsvpNotificationFilter;
  }
  const rsvpNotificationControl = [...rsvpInboxHtml.matchAll(
    /<button class="notification-row[\s\S]*?<\/button>/g
  )].map((match) => match[0]).find(
    (tag) => tag.includes('data-notification-id="combined-rsvp-route"')
  ) || "";
  if (!rsvpNotificationControl.includes(`data-destination="${rsvpDestination}"`)
      || data.notificationDestination("operational_rsvp_confirmed", rsvpDestination)
        !== rsvpDestination) {
    throw new Error("RSVP notification must render and resolve the exact dated Activity destination");
  }

  const priorCombinedSchedule = { ...views.scheduleState };
  let combinedRsvpScheduleHtml;
  try {
    views.scheduleState.weekOffset = Math.round(
      (data.sundayOf(data.parseISO(lunch.dateISO)) - data.sundayOf(data.todayLocal()))
        / (7 * 86400000)
    );
    views.scheduleState.selected = lunch.dateISO;
    combinedRsvpScheduleHtml = views.viewSchedule();
  } finally {
    Object.assign(views.scheduleState, priorCombinedSchedule);
  }
  const combinedScheduleRowStart = combinedRsvpScheduleHtml.indexOf(
    `href="${rsvpDestination}"`
  );
  const combinedScheduleRowEnd = combinedRsvpScheduleHtml.indexOf(
    "</a>", combinedScheduleRowStart
  );
  const combinedScheduleRow = combinedScheduleRowStart < 0 || combinedScheduleRowEnd < 0
    ? ""
    : combinedRsvpScheduleHtml.slice(combinedScheduleRowStart, combinedScheduleRowEnd);
  if (!combinedScheduleRow.includes('<span class="badge free booked">Going</span>')
      || !combinedScheduleRow.includes('<span class="spots">1 going</span>')) {
    throw new Error("dated Sunday Schedule RSVP row must render the exact confirmed count of 1");
  }
  const combinedScheduleLabels = [...combinedRsvpScheduleHtml.matchAll(
    /data-date="[^"]+">\s*([A-Z][a-z]{2})<strong/g
  )].map((match) => match[1]);
  if (JSON.stringify(combinedScheduleLabels)
      !== JSON.stringify(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])) {
    throw new Error(`combined RSVP Schedule must remain Sunday-first; got ${combinedScheduleLabels.join(" ")}`);
  }
  const combinedActivityHtml = views.viewActivity(lunch.id);
  if (!combinedActivityHtml.includes("1 going — see you there.")) {
    throw new Error("exact RSVP Activity Details must render the confirmed count of 1");
  }

  let combinedAdminHtml;
  try {
    store.signIn("admin@example.test");
    combinedAdminHtml = await views.viewAdmin("activities");
  } finally {
    store.signIn("member@example.test");
  }
  const combinedWeeklyStart = combinedAdminHtml.indexOf(">Weekly Event Controls<");
  const combinedOneOffStart = combinedAdminHtml.indexOf(">One-off Events<", combinedWeeklyStart);
  const combinedWeeklyHtml = combinedWeeklyStart < 0 || combinedOneOffStart < 0
    ? ""
    : combinedAdminHtml.slice(combinedWeeklyStart, combinedOneOffStart);
  const combinedFreeStart = combinedWeeklyHtml.indexOf("Free &amp; RSVP Events");
  const combinedPaidStart = combinedWeeklyHtml.indexOf("Paid Sessions", combinedFreeStart);
  const combinedFreeRsvpHtml = combinedFreeStart < 0 || combinedPaidStart < 0
    ? ""
    : combinedWeeklyHtml.slice(combinedFreeStart, combinedPaidStart);
  const combinedLunchTarget = combinedFreeRsvpHtml.indexOf(`data-session="${lunch.id}"`);
  const combinedLunchCardStart = combinedFreeRsvpHtml.lastIndexOf(
    '<div class="card mt16 free-event-venue-card">', combinedLunchTarget
  );
  const combinedNextFreeCard = combinedFreeRsvpHtml.indexOf(
    '<div class="card mt16 free-event-venue-card">', combinedLunchTarget + 1
  );
  const combinedLunchCard = combinedLunchTarget < 0 || combinedLunchCardStart < 0
    ? ""
    : combinedFreeRsvpHtml.slice(
      combinedLunchCardStart,
      combinedNextFreeCard < 0 ? combinedFreeRsvpHtml.length : combinedNextFreeCard
    );
  if (!combinedWeeklyHtml.includes(">Weekly Event Controls<")
      || !combinedFreeRsvpHtml.includes("Free &amp; RSVP Events")
      || !combinedWeeklyHtml.includes("Paid Sessions")
      || !combinedLunchCard.includes("Post-Training Lunch")
      || !combinedLunchCard.includes('<p class="muted small mt8">1 going</p>')) {
    throw new Error("dated RSVP Admin card must render count 1 inside grouped Weekly Event Controls");
  }
  console.log("ok  RSVP exact route and count agree across Sunday Schedule, Activity, and grouped Admin");

  await store.withdrawRsvp(rsvp.id);
  if (store.getBooking(rsvp.id).status !== "cancelled")
    throw new Error("withdraw should cancel the RSVP booking");
  const repeatedRsvp = await store.rsvpSession("fixture-member", lunch.id, rsvp.createdAt + 1000);
  await store.withdrawRsvp(repeatedRsvp.id);
  repeatedRsvp.snapshot = { dateISO: lunch.dateISO };
  const repeatedRsvpHistoryHtml = await views.viewAccount("history");
  if ((repeatedRsvpHistoryHtml.match(/class="card booking-card"/g) || []).length !== 1
      || !repeatedRsvpHistoryHtml.includes(`href="#/booking/${repeatedRsvp.id}"`)
      || repeatedRsvpHistoryHtml.includes(`href="#/booking/${rsvp.id}"`)
      || !repeatedRsvpHistoryHtml.includes("Cancelled")
      || !repeatedRsvpHistoryHtml.includes("RSVP")
      || repeatedRsvpHistoryHtml.includes("paid HK$0")) {
    throw new Error("History must deduplicate RSVP join/withdraw records, retain cancellation, and show RSVP");
  }
  if (!repeatedRsvpHistoryHtml.includes("75 min")) {
    throw new Error("History must fill a local RSVP snapshot gap from the authoritative session");
  }
  console.log("ok  History deduplicates repeated local RSVPs and fills snapshot gaps");
  const schedHtml = views.viewSchedule();
  if (!schedHtml.includes(">Socials<"))
    throw new Error("Schedule should offer a Socials filter chip");
  const badgeHtml = views.viewActivity(lunch.id);
  if (!badgeHtml.includes('badge free">RSVP</span>'))
    throw new Error("unbooked RSVP session badge should read RSVP");
  if (lunch.location !== "TBC")
    throw new Error("lunch venue should seed as TBC until a weekly override is set");
  store.signIn("admin@example.test");
  await store.setWeekVenue(lunch.id, { location: "Cafe Deco, Central", mapsQuery: "Cafe Deco, Central" });
  const overriddenLunch = store.getSession(lunch.id);
  if (overriddenLunch.location !== "Cafe Deco, Central")
    throw new Error("local weekly venue override must apply to the lunch session");
  const adminActsHtml = await views.viewAdmin("activities");
  if (!adminActsHtml.includes("Post-Training Lunch") || !adminActsHtml.includes(">RSVP</span>"))
    throw new Error("Activities list should badge the lunch as RSVP");
  const weeklyControlsRegion = adminActsHtml.split(">Weekly Event Controls<")[1]?.split(">One-off Events<")[0] || "";
  const freeRsvpRegion = weeklyControlsRegion.split("Free &amp; RSVP Events")[1]?.split("Paid Sessions")[0] || "";
  const paidSessionsRegion = weeklyControlsRegion.split("Paid Sessions")[1] || "";
  if (paidSessionsRegion.includes("lunch-") || paidSessionsRegion.includes("Post-Training Lunch"))
    throw new Error("Paid Sessions must stay paid-only — the lunch lives in Free & RSVP Events");
  if (!freeRsvpRegion.includes("Post-Training Lunch") || !freeRsvpRegion.includes("Cancel this week's event"))
    throw new Error("the lunch venue card must offer the per-week cancel control");
  if (freeRsvpRegion.includes("cap"))
    throw new Error("the uncapped lunch must not show a capacity");
  store.signIn("member@example.test");
  store.signOut();
  console.log("ok  RSVP lunch: join, going state, withdraw, Socials filter, no checkout");
}

// --- Reset ---
store.resetLocalData();
console.log("ok  reset");

// --- v10 cleanup: fresh state, no demo UI, no simulated demand, no demo queues/duty ---
{
  const fresh = JSON.parse(mem.get("itc.prototype.v1"));
  if (Array.isArray(fresh.users) && fresh.users.length) {
    failures++;
    console.error("FAIL v10 fresh state must have zero users");
  } else console.log("ok  v10 fresh state has zero users");
  if (Array.isArray(fresh.bookings) && fresh.bookings.length) {
    failures++;
    console.error("FAIL v10 fresh state must have zero bookings");
  } else console.log("ok  v10 fresh state has zero bookings");
  if (Array.isArray(fresh.receipts) && fresh.receipts.length) {
    failures++;
    console.error("FAIL v10 fresh state must have zero receipts");
  } else console.log("ok  v10 fresh state has zero receipts");
  if (!fresh.paymentPayouts || Array.isArray(fresh.paymentPayouts)
      || Object.keys(fresh.paymentPayouts).length) {
    failures++;
    console.error("FAIL v14 fresh state must have an empty UUID-keyed payout map");
  } else console.log("ok  v14 fresh state has an empty UUID-keyed payout map");
  if (!Array.isArray(fresh.oneOffEvents) || fresh.oneOffEvents.length) {
    failures++;
    console.error("FAIL fresh state must have an empty one-off events list");
  } else console.log("ok  fresh state has an empty one-off events list");
  if (!fresh.activities.some((a) => a.id === "lunch" && a.kind === "rsvp" && a.category === "Socials")) {
    failures++;
    console.error("FAIL fresh state must seed the recurring RSVP lunch");
  } else console.log("ok  fresh state seeds the recurring RSVP lunch");
  if (Array.isArray(fresh.activities)) {
    for (const a of fresh.activities) {
      if ("baseBooked" in a) {
        failures++;
        console.error(`FAIL v10 fresh state activity ${a.id} must not carry baseBooked`);
      }
    }
  }
  // No seed collectors or duty assignments in fresh state
  if (fresh.duty && Object.keys(fresh.duty).length > 0) {
    failures++;
    console.error("FAIL v10 fresh state must not carry demo duty assignments");
  } else console.log("ok  v10 fresh state has no demo duty");
  if (fresh.queues && Object.keys(fresh.queues).length > 0) {
    failures++;
    console.error("FAIL v10 fresh state must not carry seed queue entries");
  } else console.log("ok  v10 fresh state has no seed queues");
  const accountHtml = await views.viewAccount();
  for (const removed of ["demo-signin", "reset-demo", "one-tap demo", "seeded email"]) {
    if (accountHtml.toLowerCase().includes(removed)) {
      failures++;
      console.error(`FAIL Account still renders removed demo content: ${removed}`);
    }
  }
  for (const email of ["super@example.test", "admin@example.test", "member@example.test",
    "marco@example.test", "jenny@example.test"]) {
    if (accountHtml.includes(email)) {
      failures++;
      console.error(`FAIL Account still exposes demo email ${email}`);
    }
  }
}

// --- v10 mixed migration: known demo records removed, genuine records preserved ---
{
  store.resetLocalData();
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.version = 9;
  raw.users = [
    { id: "u-super", role: "superadmin", status: "approved", fullName: "Demo Super", email: "owner@itc.hk" },
    { id: "u-admin", role: "admin", status: "approved", fullName: "Demo Admin", email: "admin@itc.hk" },
    { id: "u-member", role: "member", status: "approved", fullName: "Demo Member", email: "member@itc.hk" },
    { id: "real-member", role: "member", status: "approved", fullName: "Real Member", email: "real@example.test" },
  ];
  raw.sessionUserId = "u-member";
  raw.bookings = [
    { id: "b-seed-1", userId: "u-member" },
    { id: "b-user-1", userId: "real-member" },
  ];
  raw.receipts = [
    { id: "r-seed-1", bookingId: "b-seed-1", userId: "u-member" },
    { id: "r-user-1", bookingId: "b-user-1", userId: "real-member" },
  ];
  raw.queues = {
    "hyrox-2026-09-05": {
      waitlist: [
        { userId: "u-member", joinedAt: 1 },
        { userId: "real-member", joinedAt: 2 },
      ],
      interest: ["u-member", "real-member"],
    },
  };
  raw.duty = {
    "2026-08-15": { userId: "u-admin", setAt: 1 },
    "2026-08-22": { userId: "real-member", setAt: 1 },
  };
  raw.activities[0].baseBooked = 7;
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
  const migrated = JSON.parse(mem.get("itc.prototype.v1"));
  if (!migrated.users.some((u) => u.id === "real-member")) {
    failures++;
    console.error("FAIL v10 migration must keep genuine users");
  } else console.log("ok  v10 migration keeps genuine users");
  for (const demoId of ["u-super", "u-admin", "u-member"]) {
    if (migrated.users.some((u) => u.id === demoId)) {
      failures++;
      console.error(`FAIL v10 migration must remove demo user ${demoId}`);
    }
  }
  if (migrated.bookings.some((b) => b.id === "b-seed-1")) {
    failures++;
    console.error("FAIL v10 migration must remove demo-owned bookings");
  } else console.log("ok  v10 migration removes demo-owned bookings");
  if (!migrated.bookings.some((b) => b.id === "b-user-1")) {
    failures++;
    console.error("FAIL v10 migration must keep genuine bookings");
  } else console.log("ok  v10 migration keeps genuine bookings");
  // Demo entries are removed in both current object and legacy string shapes;
  // genuine entries and their original shape survive.
  const q = migrated.queues?.["hyrox-bft-2026-09-05"];
  if (q?.waitlist.some((entry) => entry.userId === "u-member") || q?.interest.includes("u-member")) {
    failures++;
    console.error("FAIL v13 migration must remove current and legacy demo queue entries");
  } else console.log("ok  v13 migration removes current and legacy demo queue entries");
  if (!q?.waitlist.some((entry) => entry.userId === "real-member" && entry.joinedAt === 2)
      || !q?.interest.includes("real-member")) {
    failures++;
    console.error("FAIL v13 migration must keep current and legacy genuine queue entries");
  } else console.log("ok  v13 migration keeps current and legacy genuine queue entries");
  // Duty reassignment for removed demo collector, but genuine duty survives.
  if (migrated.duty?.["2026-08-15"]?.userId === "u-admin") {
    failures++;
    console.error("FAIL v10 migration must clear duty assignments for removed demo users");
  } else console.log("ok  v10 migration clears demo duty assignments");
  if (migrated.duty?.["2026-08-22"]?.userId !== "real-member") {
    failures++;
    console.error("FAIL v10 migration must keep genuine duty assignments");
  } else console.log("ok  v10 migration keeps genuine duty assignments");
  if (migrated.activities.some((a) => "baseBooked" in a)) {
    failures++;
    console.error("FAIL v10 migration must strip baseBooked from every activity");
  } else console.log("ok  v10 migration strips simulated demand");
  if (migrated.sessionUserId !== null) {
    failures++;
    console.error("FAIL v10 migration must clear session tied to a removed demo user");
  } else console.log("ok  v10 migration clears removed session");
  if (migrated.version !== 19) {
    failures++;
    console.error(`FAIL integrated migration must advance version to 19, got ${migrated.version}`);
  } else console.log("ok  integrated migration advances genuine v9 state to v19");
}

{
  store.resetLocalData();
  const v13 = JSON.parse(mem.get("itc.prototype.v1"));
  v13.version = 13;
  v13.users = [{
    id: "real-v13-member",
    role: "member",
    status: "approved",
    fullName: "Real Member",
    email: "real-v13@example.test",
    indemnityAcceptedAt: 123456789,
  }];
  mem.set("itc.prototype.v1", JSON.stringify(v13));
  store.load();
  const v14 = JSON.parse(mem.get("itc.prototype.v1"));
  const migratedUser = v14.users.find((user) => user.id === "real-v13-member");
  if (v14.version !== 19 || !migratedUser) throw new Error("v19 migration lost the genuine member");
  for (const field of ["indemnitySignature", "indemnitySignedAt", "indemnityFormVersion", "emergencyRelationship"]) {
    if (!(field in migratedUser) || migratedUser[field] !== null) {
      throw new Error(`v14 migration should initialize ${field} to null`);
    }
  }
  if (migratedUser.indemnityAcceptedAt !== 123456789) {
    throw new Error("v14 migration must preserve indemnityAcceptedAt");
  }
  if (store.isIndemnityCurrent(migratedUser)) {
    throw new Error("timestamp-only v13 acceptance must be stale in v14");
  }
  console.log("ok  v14 migration preserves legacy acceptance and initializes consent fields");
}

// --- HYROX pooled local registration engine (Task 7) -----------------------
{
  const v18 = store.resetLocalData();
  v18.version = 18;
  delete v18.hyroxCycles;
  delete v18.hyroxCycleQueues;
  v18.bookings = [{
    id: "v18-booking", userId: "fixture-member", sessionId: "hyrox-bft-2099-01-03",
    status: "confirmed", snapshot: { name: "ITC HYROX", dateISO: "2099-01-03" },
  }];
  localStorage.setItem("itc.prototype.v1", JSON.stringify(v18));
  const migrated = store.load();
  if (migrated.version !== 19 || !migrated.hyroxCycles || !migrated.hyroxCycleQueues
      || migrated.bookings[0]?.id !== "v18-booking") {
    throw new Error("v19 migration must add pooled collections without losing v18 bookings");
  }
  console.log("ok  v19 migration preserves bookings and initializes pooled collections");
}
{
  store.resetLocalData();
  installLocalFixtures();
  const local = JSON.parse(localStorage.getItem("itc.prototype.v1"));
  const fixtureTemplate = local.users.find((user) => user.id === "fixture-member");
  for (let i = 1; i <= 32; i++) {
    local.users.push({
      ...structuredClone(fixtureTemplate),
      id: `hyrox-local-${i}`,
      email: `hyrox-local-${i}@example.test`,
      fullName: `HYROX Local ${i}`,
      preferredName: `Local ${i}`,
    });
  }
  local.users.push({
    ...structuredClone(fixtureTemplate), id: "hyrox-local-waitlist",
    email: "hyrox-local-waitlist@example.test", fullName: "HYROX Waitlist",
  });
  localStorage.setItem("itc.prototype.v1", JSON.stringify(local));
  store.load();
  const cycle = store.scheduleHyroxCycle("2099-01-03");
  if (cycle.id !== "hyrox-pool-2099-01-03" || cycle.registrationState !== "draft") {
    throw new Error("scheduled local HYROX cycle should start as a locked draft");
  }
  if (cycle.registrationOpensAt !== Date.parse("2098-12-29T18:00:00+08:00")
      || cycle.paymentDeadlineAt !== Date.parse("2099-01-01T18:00:00+08:00")
      || cycle.holderGraceDeadlineAt !== Date.parse("2099-01-01T19:00:00+08:00")
      || cycle.promotedPaymentDeadlineAt !== Date.parse("2099-01-01T20:00:00+08:00")) {
    throw new Error("local HYROX cycle must use the approved HKT checkpoints");
  }
  assert.throws(() => store.reserveHyroxCycle(
    "fixture-member", cycle.id, "midtown", true,
    Date.parse("2098-12-29T17:59:59+08:00")
  ), /opens Monday at 6 PM/);
  store.sweepHyroxCycleDeadlines(Date.parse("2098-12-29T18:00:00+08:00"));
  const pooled = store.reserveHyroxCycle(
    "fixture-member", cycle.id, "midtown", true,
    Date.parse("2098-12-29T18:00:01+08:00")
  );
  if (pooled.sessionId !== null || pooled.cycleId !== cycle.id
      || pooled.venuePreference !== "midtown") {
    throw new Error("pooled local reservation must hold the cycle without a venue session");
  }
  assert.throws(() => store.reserveHyroxCycle(
    "hyrox-local-1", cycle.id, "bft", false,
    Date.parse("2098-12-29T18:01:00+08:00")
  ), /fallback/i);
  for (let i = 1; i <= 31; i++) {
    store.reserveHyroxCycle(
      `hyrox-local-${i}`, cycle.id, "either", true,
      Date.parse("2098-12-29T18:02:00+08:00") + i
    );
  }
  assert.throws(() => store.reserveHyroxCycle(
    "hyrox-local-32", cycle.id, "bft", true,
    Date.parse("2098-12-29T18:03:00+08:00")
  ), /full/);
  const queued = store.joinHyroxCycleWaitlist(
    "hyrox-local-waitlist", cycle.id, "midtown", true,
    Date.parse("2098-12-29T18:03:01+08:00")
  );
  if (queued.kind !== "weekly_waitlist"
      || queued.venuePreference !== "midtown"
      || store.hyroxCycleQueuePosition("hyrox-local-waitlist", cycle.id, "weekly_waitlist") !== 1
      || store.getBooking("hyrox-local-waitlist")) {
    throw new Error("full pooled registration must create a preference-bearing waitlist entry only");
  }
  store.releaseReservation(pooled.id, Date.parse("2098-12-29T18:04:00+08:00"));
  const promoted = store.bookingsForUser("hyrox-local-waitlist")
    .find((booking) => booking.cycleId === cycle.id && booking.status === "reserved");
  if (!promoted || promoted.payDeadlineAt !== cycle.holderGraceDeadlineAt
      || store.hyroxCycleQueuePosition("hyrox-local-waitlist", cycle.id, "weekly_waitlist") !== null) {
    throw new Error("unpaid pooled cancellation should promote the oldest waitlist member with holder grace");
  }
  console.log("ok  local HYROX registration enforces HKT opening, 32-place capacity and waitlist preference");
}
{
  store.resetLocalData();
  installLocalFixtures();
  const local = JSON.parse(localStorage.getItem("itc.prototype.v1"));
  const fixtureTemplate = local.users.find((user) => user.id === "fixture-member");
  local.users.push({
    ...structuredClone(fixtureTemplate), id: "hyrox-sweep-waitlist",
    email: "hyrox-sweep-waitlist@example.test", fullName: "Sweep Waitlist",
  });
  localStorage.setItem("itc.prototype.v1", JSON.stringify(local));
  store.load();
  const cycle = store.scheduleHyroxCycle("2099-01-03");
  const opening = cycle.registrationOpensAt;
  store.reserveHyroxCycle("fixture-member", cycle.id, "either", true, opening + 1000);
  store.sweepHyroxCycleDeadlines(cycle.paymentDeadlineAt - 1);
  const reminderCount = store.notificationsFor("fixture-member")
    .filter((note) => note.kind === "hyrox-payment-reminder").length;
  store.sweepHyroxCycleDeadlines(cycle.paymentDeadlineAt - 1);
  if (!cycle.paymentReminderSentAt || reminderCount !== store.notificationsFor("fixture-member")
    .filter((note) => note.kind === "hyrox-payment-reminder").length) {
    throw new Error("HYROX payment reminders should be timestamped and idempotent");
  }
  store.sweepHyroxCycleDeadlines(cycle.paymentDeadlineAt + 1);
  if (!cycle.holderGraceStartedAt || cycle.registrationState !== "reconciling") {
    throw new Error("Thursday 6 PM should start pooled holder grace and reconciliation");
  }
  const sweepState = JSON.parse(localStorage.getItem("itc.prototype.v1"));
  sweepState.hyroxCycleQueues[cycle.id].push({
    id: "hyrox-sweep-preexisting", cycleId: cycle.id, userId: "hyrox-sweep-waitlist",
    kind: "weekly_waitlist", targetSessionId: null, venuePreference: "midtown",
    fallbackAcknowledgedAt: cycle.registrationOpensAt, status: "active",
    joinedAt: cycle.holderGraceDeadlineAt - 1000, resolvedAt: null,
  });
  localStorage.setItem("itc.prototype.v1", JSON.stringify(sweepState));
  store.load();
  const atSeven = cycle.holderGraceDeadlineAt + 1;
  store.sweepHyroxCycleDeadlines(atSeven);
  const original = store.bookingsForUser("fixture-member").find((booking) => booking.cycleId === cycle.id);
  const promoted = store.bookingsForUser("hyrox-sweep-waitlist").find((booking) => booking.cycleId === cycle.id);
  if (original?.status !== "expired" || !promoted?.promotedFromWaitlistAt
      || promoted.payDeadlineAt !== cycle.promotedPaymentDeadlineAt) {
    throw new Error("7 PM should demote original holders and promote only pre-existing waitlist entries");
  }
  store.sweepHyroxCycleDeadlines(cycle.promotedPaymentDeadlineAt + 1);
  if (store.getBooking(promoted.id).status !== "expired"
      || store.hyroxCycleQueues(cycle.id).weeklyWaitlist.length !== 0) {
    throw new Error("8 PM should expire unmarked promotions without cascading promotion");
  }
  console.log("ok  local HYROX checkpoint sweep is idempotent and uses one promotion round");
}
{
  store.resetLocalData();
  installLocalFixtures();
  const local = JSON.parse(localStorage.getItem("itc.prototype.v1"));
  const fixtureTemplate = local.users.find((user) => user.id === "fixture-member");
  const addMembers = (prefix, count) => {
    for (let i = 1; i <= count; i++) {
      local.users.push({ ...structuredClone(fixtureTemplate), id: `${prefix}-${i}`,
        email: `${prefix}-${i}@example.test`, fullName: `${prefix} ${i}` });
    }
  };
  addMembers("hyrox-threshold", 20);
  addMembers("hyrox-switch", 32);
  localStorage.setItem("itc.prototype.v1", JSON.stringify(local));
  store.load();
  const bftOnly = store.scheduleHyroxCycle("2099-01-10");
  const bftOnlyOpening = bftOnly.registrationOpensAt;
  const bftOnlyBookings = [];
  for (let i = 1; i <= 20; i++) {
    const booking = store.reserveHyroxCycle(`hyrox-threshold-${i}`, bftOnly.id, "bft", true, bftOnlyOpening);
    store.markBookingPaid(booking.id, "PayMe", `threshold-${i}`, bftOnlyOpening + i);
    store.confirmBookingPayment(booking.id, bftOnlyOpening + i + 1);
    bftOnlyBookings.push(booking.id);
  }
  const bftPlan = store.finalizeHyroxVenuePlan(bftOnly.id, bftOnly.paymentDeadlineAt + 1);
  if (bftPlan.venuePlan !== "bft_only" || !bftPlan.allocationClosedAt
      || bftOnlyBookings.some((id) => store.getBooking(id).sessionId !== bftOnly.bftSessionId
        || store.getBooking(id).allocationState !== "final")) {
    throw new Error("20 confirmed pooled payments should finalize BFT-only assignments");
  }
  const thresholdBoth = store.scheduleHyroxCycle("2099-01-17");
  const thresholdOpening = thresholdBoth.registrationOpensAt;
  let thresholdBooking = null;
  for (let i = 1; i <= 21; i++) {
    thresholdBooking = store.reserveHyroxCycle(`hyrox-switch-${i}`, thresholdBoth.id, "bft", true, thresholdOpening);
    store.markBookingPaid(thresholdBooking.id, "PayMe", `threshold-both-${i}`, thresholdOpening + i);
    store.confirmBookingPayment(thresholdBooking.id, thresholdOpening + i + 1);
  }
  const thresholdPlan = store.finalizeHyroxVenuePlan(thresholdBoth.id, thresholdBoth.paymentDeadlineAt + 1);
  if (thresholdPlan.venuePlan !== "both" || store.getBooking(thresholdBooking.id).allocationState !== "provisional") {
    throw new Error("21 confirmed pooled payments should open both venues provisionally");
  }
  const both = store.scheduleHyroxCycle("2099-01-24");
  const bothOpening = both.registrationOpensAt;
  const bothBookings = [];
  for (let i = 1; i <= 32; i++) {
    const booking = store.reserveHyroxCycle(`hyrox-switch-${i}`, both.id, "bft", true, bothOpening);
    store.markBookingPaid(booking.id, "PayMe", `switch-${i}`, bothOpening + i);
    store.confirmBookingPayment(booking.id, bothOpening + i + 1);
    bothBookings.push(booking.id);
  }
  const bothPlan = store.finalizeHyroxVenuePlan(both.id, both.paymentDeadlineAt + 1);
  const bftAssigned = bothBookings.filter((id) => store.getBooking(id).sessionId === both.bftSessionId);
  const midtownAssigned = bothBookings.filter((id) => store.getBooking(id).sessionId === both.midtownSessionId);
  if (bothPlan.venuePlan !== "both" || bftAssigned.length !== 20 || midtownAssigned.length !== 12) {
    throw new Error("32 confirmed pooled payments should respect the 20/12 venue capacities");
  }
  const midtownBooking = store.getBooking(midtownAssigned[0]);
  const bftBooking = store.getBooking(bftAssigned[0]);
  const beforeSession = midtownBooking.sessionId;
  const switchEntry = store.joinHyroxVenueSwitchQueue(midtownBooking.id, both.bftSessionId,
    both.paymentDeadlineAt + 2);
  if (switchEntry.kind !== "venue_switch" || store.getBooking(midtownBooking.id).sessionId !== beforeSession
      || store.hyroxCycleQueuePosition(midtownBooking.userId, both.id, "venue_switch", both.bftSessionId) !== 1) {
    throw new Error("full pooled target should preserve assignment and queue a guaranteed venue switch");
  }
  const opposite = store.joinHyroxVenueSwitchQueue(bftBooking.id, both.midtownSessionId,
    both.paymentDeadlineAt + 3);
  if (store.getBooking(midtownBooking.id).sessionId !== both.bftSessionId
      || store.getBooking(bftBooking.id).sessionId !== both.midtownSessionId
      || opposite.status !== "matched") {
    throw new Error("opposite pooled switch requests should atomically swap assignments");
  }
  if (store.deferTargetsFor(midtownBooking).length !== 0) {
    throw new Error("pooled HYROX bookings must not expose deferral targets");
  }
  try {
    store.deferBooking(midtownBooking.id, both.bftSessionId, both.paymentDeadlineAt + 4);
    throw new Error("pooled HYROX deferral should be rejected");
  } catch (err) {
    if (!/Paid pooled HYROX bookings cannot be deferred/.test(err.message)) throw err;
  }
  try {
    store.confirmGymBooking(both.bftSessionId, "too early", both.venueChoiceDeadlineAt);
    throw new Error("pooled child gym finalization should be blocked before allocation close");
  } catch (err) {
    if (!/Pooled HYROX child sessions/.test(err.message)) throw err;
  }
  store.closeHyroxVenueAllocation(both.id, both.venueChoiceDeadlineAt + 1);
  if (!both.allocationClosedAt || store.getBooking(midtownBooking.id).allocationState !== "final") {
    throw new Error("Friday allocation close should finalize provisional pooled bookings");
  }
  store.confirmGymBooking(both.bftSessionId, "finalized", both.venueChoiceDeadlineAt + 1);
  const rejectCycle = store.scheduleHyroxCycle("2099-01-31");
  const rejected = store.reserveHyroxCycle("fixture-member", rejectCycle.id, "bft", true,
    rejectCycle.registrationOpensAt);
  store.markBookingPaid(rejected.id, "FPS", "reject-before", rejected.payDeadlineAt - 1000);
  store.rejectHyroxCyclePayment(rejected.id, "Receipt mismatch", rejected.payDeadlineAt - 1);
  if (store.getBooking(rejected.id).status !== "reserved" || store.getBooking(rejected.id).paymentMarkedAt) {
    throw new Error("pre-deadline HYROX payment rejection should reopen the reservation");
  }
  store.markBookingPaid(rejected.id, "FPS", "reject-after", rejected.payDeadlineAt);
  store.rejectHyroxCyclePayment(rejected.id, "Still unmatched", rejected.payDeadlineAt + 1);
  if (store.getBooking(rejected.id).status !== "expired") {
    throw new Error("post-deadline HYROX payment rejection should expire the reservation");
  }
  const carryTarget = store.scheduleHyroxCycle("2099-02-07");
  store.sweepHyroxCycleDeadlines(carryTarget.registrationOpensAt);
  const oldCycleBooking = store.getBooking(thresholdBooking.id);
  store.cancelHyroxCycle(thresholdBoth.id, "Gym unavailable", carryTarget.registrationOpensAt);
  const carried = store.getBooking(oldCycleBooking.deferredTo);
  if (oldCycleBooking.status !== "deferred" || carried?.cycleId !== carryTarget.id
      || carried.status !== "confirmed") {
    throw new Error("paid HYROX bookings should carry forward to the next available pooled cycle");
  }
  console.log("ok  local HYROX reconciliation derives thresholds and serializes venue switches");
}
{
  store.resetLocalData();
  installLocalFixtures();
  const cycleDate = data.isoDate(data.addDays(data.saturdayOnOrAfter(data.todayLocal()), 7));
  views.resetScheduleState();
  views.scheduleState.weekOffset = Math.floor((data.parseISO(cycleDate) - data.sundayOf(data.todayLocal()))
    / (7 * 24 * 60 * 60 * 1000));
  views.scheduleState.selected = cycleDate;
  const legacySchedule = views.viewSchedule();
  if (!legacySchedule.includes(`href=\"#/activity/hyrox-bft-${cycleDate}\"`)
      || !legacySchedule.includes(`href=\"#/activity/hyrox-midtown-${cycleDate}\"`)) {
    throw new Error("unscheduled HYROX dates should preserve separate legacy venue cards");
  }
  const cycle = store.scheduleHyroxCycle(cycleDate);
  views.scheduleState.weekOffset = Math.floor((data.parseISO(cycleDate) - data.sundayOf(data.todayLocal()))
    / (7 * 24 * 60 * 60 * 1000));
  views.scheduleState.selected = cycleDate;
  const lockedSchedule = views.viewSchedule();
  if ((lockedSchedule.match(new RegExp(`href=\\"#/hyrox/${cycle.id}\\"`, "g")) || []).length !== 1
      || !lockedSchedule.includes("ITC HYROX<br><span>BFT + Midtown Pool</span>")
      || !lockedSchedule.includes("<time>11 AM</time>")
      || !lockedSchedule.includes("Midtown28 Fitness · 11 AM")
      || !lockedSchedule.includes("BFT Causeway Bay · 11:15 AM")
      || !lockedSchedule.includes("Opens Mon · 6 PM")
      || lockedSchedule.includes("2 starts")
      || lockedSchedule.indexOf("Midtown28 Fitness · 11 AM") > lockedSchedule.indexOf("BFT Causeway Bay · 11:15 AM")
      || lockedSchedule.includes(`href=\"#/activity/${cycle.bftSessionId}\"`)
      || lockedSchedule.includes(`href=\"#/activity/${cycle.midtownSessionId}\"`)
      || !lockedSchedule.includes("Quarry Bay")) {
    throw new Error("scheduled HYROX weeks should render one locked pool card and a separate Quarry Bay row");
  }
  const lockedDetail = views.viewHyroxCycle(cycle.id);
  if (!lockedDetail.includes("BFT Causeway Bay") || !lockedDetail.includes("Midtown")
      || !lockedDetail.includes("Sign up opens Monday at 6 PM HKT")) {
    throw new Error("HYROX detail should expose both venues and the locked opening checkpoint");
  }
  if (lockedDetail.includes('class="hyrox-pool-card card"')) {
    throw new Error("HYROX pool card should not be wrapped in an outer card");
  }
  if (!lockedDetail.includes('class="hyrox-pool-card"')) {
    throw new Error("HYROX pool card should render as a flat container");
  }
  store.sweepHyroxCycleDeadlines(cycle.registrationOpensAt);
  const registration = views.viewHyroxRegistration(cycle.id);
  for (const marker of [
    "Your preference helps us plan. It does not reserve a particular gym.",
    'value="bft"', 'value="midtown"', 'value="either"',
    "If 20 or fewer people have paid", "If more than 20 people have paid",
    "Thursday 6 PM", "Friday 9 PM", 'name="fallbackAcknowledged"',
    "I understand that my booking will be at BFT at 11:15 if only BFT opens.",
    "Reserve &amp; continue to pay",
  ]) {
    if (!registration.includes(marker)) throw new Error(`HYROX registration missing ${marker}`);
  }
  console.log("ok  pooled HYROX Schedule and registration views explain the automatic venue plan");
}
{
  store.resetLocalData();
  installLocalFixtures();
  const cycleDate = data.isoDate(data.addDays(data.saturdayOnOrAfter(data.todayLocal()), 7));
  const cycle = store.scheduleHyroxCycle(cycleDate);
  const booking = store.reserveHyroxCycle("fixture-member", cycle.id, "either", true,
    cycle.registrationOpensAt);
  store.signIn("member@example.test");
  const payHtml = views.viewPay(booking.id);
  if (!payHtml.includes("Pay HK$180 by Thursday 6 PM")
      || !payHtml.includes(cycleDate) || payHtml.includes("BFT Causeway Bay")
      || payHtml.includes("Midtown28 Fitness")) {
    throw new Error("pooled payment should show weekly payment timing without assigning a venue");
  }
  const pendingHtml = views.viewBooking(booking.id);
  if (!pendingHtml.includes("Pay HK$180 by Thursday 6 PM")) {
    throw new Error("pooled reservation should show the standard payment heading");
  }
  store.markBookingPaid(booking.id, "PayMe", "task10", cycle.registrationOpensAt + 1);
  const confirmingHtml = views.viewBooking(booking.id);
  if (!confirmingHtml.includes("Payment being confirmed")) {
    throw new Error("pooled marked payment should show collector confirmation state");
  }
  store.signOut();
  store.signIn("admin@example.test");
  store.confirmBookingPayment(booking.id, cycle.registrationOpensAt + 2);
  store.signIn("member@example.test");
  const confirmedHtml = views.viewBooking(booking.id);
  if (!confirmedHtml.includes("Your weekly HYROX place is confirmed")
      || !confirmedHtml.includes("Venue pending")
      || confirmedHtml.includes("defer-to")
      || confirmedHtml.includes("release-reservation")) {
    throw new Error("unallocated pooled booking should show a confirmed weekly place without deferral or cancellation");
  }
  const homeHtml = views.viewHome();
  const historyHtml = await views.viewAccount("history");
  const paymentsHtml = await views.viewAccount("payments");
  if (![homeHtml, historyHtml, paymentsHtml].every((html) => html.includes(data.fmtDate(cycleDate)) && html.includes("Venue pending"))) {
    throw new Error("pooled booking surfaces should show the weekly date and Venue pending before allocation");
  }
  store.signOut();
  store.signIn("admin@example.test");
  store.finalizeHyroxVenuePlan(cycle.id, cycle.paymentDeadlineAt + 1);
  store.signIn("member@example.test");
  const allocatedHtml = views.viewBooking(booking.id);
  if (!allocatedHtml.includes("Your venue is final") || !allocatedHtml.includes("BFT Causeway Bay")
      || !store.receiptForBooking(booking.id)) {
    throw new Error("allocated pooled booking surfaces should show one final venue and its receipt");
  }
  store.signOut();
  store.signIn("admin@example.test");
  const adminHtml = await views.viewAdmin("payments");
  if (!adminHtml.includes("<h2>ITC HYROX<br><span>Payment reconciliation</span></h2>")
      || !adminHtml.includes('<summary><h2>HYROX weekly booking setup</h2></summary>')
      || adminHtml.includes("BFT + Midtown parent cards are created automatically")
      || !/admin-hyrox-count-link[\s\S]*?<strong>0<\/strong><span>Payment claims to review/.test(adminHtml)
      || !adminHtml.includes("form-cancel-hyrox-cycle")) {
    throw new Error("pooled Admin should show one authoritative cycle card with payment reconciliation");
  }
  console.log("ok  pooled HYROX payment and weekly booking states render without a session");
}

// --- Install neutral fixtures for local authenticated paths (no demo seeds) ---
function installLocalFixtures({ withMemberBooking = false } = {}) {
  const clean = JSON.parse(mem.get("itc.prototype.v1"));
  const preserved = (clean.users || []).filter((u) =>
    !["fixture-admin", "fixture-member", "fixture-super"].includes(u.id)
  );
  clean.sessionUserId = "fixture-admin";
  clean.users = [
    ...preserved,
    {
      id: "fixture-admin", role: "admin", status: "approved", fullName: "Test Admin",
      preferredName: "Admin", email: "admin@example.test", phone: "+852 5000 0001",
      emergencyName: "Test Contact", emergencyRelationship: "Sibling", emergencyPhone: "+852 5000 9001", heard: "Test fixture",
      isMinor: false, appliedAt: Date.now() - 86400000, indemnityAcceptedAt: Date.now() - 86400000,
      indemnitySignature: "Test Admin", indemnitySignedAt: data.isoDate(data.todayLocal()), indemnityFormVersion: "v1",
      privacyAcceptedAt: Date.now() - 86400000, whatsappReminders: false, emailReceipts: false,
      communityNews: false,
    },
    {
      id: "fixture-member", role: "member", status: "approved", fullName: "Test Member",
      preferredName: "Tester", email: "member@example.test", phone: "+852 5000 0002",
      emergencyName: "Test Contact", emergencyRelationship: "Sibling", emergencyPhone: "+852 5000 9002", heard: "Test fixture",
      mediaConsent: true, donorId: "TEST-1234", isMinor: false,
      appliedAt: Date.now() - 172800000, indemnityAcceptedAt: Date.now() - 172800000,
      indemnitySignature: "Test Member", indemnitySignedAt: data.isoDate(data.todayLocal()), indemnityFormVersion: "v1",
      privacyAcceptedAt: Date.now() - 172800000, whatsappReminders: false,
      emailReceipts: false, communityNews: false,
    },
  ];
  if (withMemberBooking) {
    const upcoming = store.upcomingSessions(14);
    const fixtureMemberSession = upcoming.find((s) => s.activityId === "hyrox-bft" && !data.sessionStarted(s));
    if (fixtureMemberSession) {
      clean.bookings = [
        ...(clean.bookings || []),
        {
          id: "fixture-booking", userId: "fixture-member", sessionId: fixtureMemberSession.id,
          status: "confirmed", createdAt: Date.now(),
          snapshot: {
            name: fixtureMemberSession.name, kind: fixtureMemberSession.kind,
            dateISO: fixtureMemberSession.dateISO, time: fixtureMemberSession.time,
            durationMin: fixtureMemberSession.durationMin, location: fixtureMemberSession.location,
            price: fixtureMemberSession.price,
          },
        },
      ];
    }
  }
  mem.set("itc.prototype.v1", JSON.stringify(clean));
  store.load();
}

// --- Integrated Giving + shape-aware v13 contracts ---
for (const marker of [
  'case "giving"', 'case "giving-amount"', 'case "giving-confirm"',
  'case "campaign-publish"', 'case "campaign-close"', 'case "form-campaign"',
]) {
  if (!integratedAppSource.includes(marker)) {
    failures++;
    console.error(`FAIL integrated Giving router missing ${marker}`);
  }
}
for (const marker of [
  'case "hyrox":', 'views.viewHyroxRegistration(arg)', 'views.viewHyroxCycle(arg)',
  'case "form-hyrox-reserve":', 'store.reserveHyroxCycle(',
]) {
  if (!integratedAppSource.includes(marker)) {
    failures++;
    console.error(`FAIL HYROX router missing ${marker}`);
  }
}
for (const api of [
  "viewHyroxCycle", "viewHyroxRegistration",
]) {
  if (typeof views[api] !== "function") {
    failures++;
    console.error(`FAIL pooled HYROX view missing ${api}`);
  }
}
for (const api of [
  "updateMyDonorId", "campaigns", "activeGivingCampaign", "listGivingCampaigns",
  "getActiveGivingCampaign", "saveGivingCampaign", "publishGivingCampaign",
  "closeGivingCampaign", "campaignRaised", "donationsForUser", "recordDonation",
]) {
  if (typeof store[api] !== "function") {
    failures++;
    console.error(`FAIL integrated Giving store missing ${api}`);
  }
}

// Exercise the approved-member amount/FPS/thanks/history path and role gates.
const givingFixture = {
  version: 13, sessionUserId: "giving-admin", activities: structuredClone(data.SEED_ACTIVITIES),
  users: [
    { id: "giving-admin", role: "admin", status: "approved", fullName: "Giving Admin", email: "giving-admin@example.test" },
    { id: "giving-member", role: "member", status: "approved", fullName: "Giving Member", email: "giving-member@example.test" },
    { id: "giving-other", role: "member", status: "approved", fullName: "Giving Other", email: "giving-other@example.test" },
    { id: "giving-pending", role: "pending", status: "pending", fullName: "Giving Pending", email: "giving-pending@example.test" },
    { id: "giving-declined", role: "pending", status: "declined", fullName: "Giving Declined", email: "giving-declined@example.test" },
  ],
  bookings: [], receipts: [], campaigns: [], donations: [], prayers: [], notifications: [],
  sessionOverrides: {}, queues: {}, duty: {},
};
mem.set("itc.prototype.v1", JSON.stringify(givingFixture));
store.load();

// Payment access belongs at the state seam, including mutations called
// without rendering their gated controls first.
const paymentGateSession = store.upcomingSessions(14).find(
  (session) => session.kind === "paid" && !data.sessionStarted(session) && !store.isMidtown(session)
);
if (!paymentGateSession) throw new Error("Payment seam checks need an upcoming paid session");
for (const blockedId of ["giving-pending", "giving-declined", "missing-member"]) {
  for (const mutate of [
    () => store.reserveSession(blockedId, paymentGateSession),
    () => store.joinWaitlist(blockedId, paymentGateSession.id),
    () => store.leaveWaitlist(blockedId, paymentGateSession.id),
    () => store.joinInterest(blockedId, paymentGateSession.id),
    () => store.leaveInterest(blockedId, paymentGateSession.id),
  ]) {
    try {
      mutate();
      throw new Error(`${blockedId} Payment mutation should be rejected`);
    } catch (err) {
      if (!/Approved member access required/.test(err.message)) throw err;
    }
  }
}
const authoritySessions = store.upcomingSessions(42).filter(
  (session) => session.kind === "paid" && !data.sessionStarted(session) && !store.isMidtown(session)
);
const cancelledAuthoritySession = authoritySessions.find((session) => session.id !== paymentGateSession.id);
const tamperAuthoritySession = authoritySessions.find(
  (session) => session.id !== paymentGateSession.id && session.id !== cancelledAuthoritySession?.id
);
if (!cancelledAuthoritySession || !tamperAuthoritySession) {
  throw new Error("reservation authority regression needs three upcoming paid sessions");
}
store.cancelSessionWeek(cancelledAuthoritySession.id, "Authority regression cancellation");
store.signIn("giving-member@example.test");
try {
  store.reserveSession("giving-member", {
    ...cancelledAuthoritySession, cancelled: false, price: 1, capacity: 999,
  });
  throw new Error("forged uncancelled session should not bypass authoritative cancellation");
} catch (err) {
  if (!/Session is cancelled/.test(err.message)) throw err;
}
try {
  store.reserveSession("giving-member", { id: "unknown-weekly-session", kind: "paid", price: 1, capacity: 999 });
  throw new Error("unknown session ID should not reserve");
} catch (err) {
  if (!/Unknown session/.test(err.message)) throw err;
}
const freeAuthoritySession = store.upcomingSessions(14).find((session) => session.kind === "free");
try {
  store.reserveSession("giving-member", { ...freeAuthoritySession, kind: "paid", price: 1, capacity: 999 });
  throw new Error("forged paid session should not bypass authoritative eligibility");
} catch (err) {
  if (!/Session is not paid/.test(err.message)) throw err;
}
const tamperReservation = store.reserveSession("giving-member", {
  ...tamperAuthoritySession, price: 1, capacity: 999,
});
const authoritativeTamperSession = store.getSession(tamperAuthoritySession.id);
if (tamperReservation.snapshot.price !== authoritativeTamperSession.price
    || tamperReservation.snapshot.capacity !== authoritativeTamperSession.capacity) {
  throw new Error("reservation snapshot must use authoritative price and capacity");
}
if (!store.releaseReservation(tamperReservation.id)) {
  throw new Error("tamper regression cleanup should release the reservation");
}
const beforeFullFixture = JSON.parse(mem.get("itc.prototype.v1"));
for (let i = 0; i < authoritativeTamperSession.capacity; i++) {
  beforeFullFixture.bookings.push({
    id: `authority-full-${i}`, userId: `authority-user-${i}`,
    sessionId: authoritativeTamperSession.id, status: "confirmed", createdAt: Date.now(),
    snapshot: { price: authoritativeTamperSession.price, capacity: authoritativeTamperSession.capacity },
  });
}
mem.set("itc.prototype.v1", JSON.stringify(beforeFullFixture));
store.load();
store.signIn("giving-member@example.test");
try {
  store.reserveSession("giving-member", { ...tamperAuthoritySession, capacity: 999 });
  throw new Error("forged capacity should not bypass an authoritatively full session");
} catch (err) {
  if (!/Session is full/.test(err.message)) throw err;
}
beforeFullFixture.bookings = beforeFullFixture.bookings.filter(
  (booking) => !booking.id.startsWith("authority-full-")
);
mem.set("itc.prototype.v1", JSON.stringify(beforeFullFixture));
store.load();
store.signIn("giving-member@example.test");
const approvedReservation = store.reserveSession("giving-member", paymentGateSession.id);
if (approvedReservation.sessionId !== paymentGateSession.id || approvedReservation.status !== "reserved") {
  throw new Error("approved member should reserve a normal authoritative session by ID");
}
console.log("ok  reservations resolve authoritative sessions and reject forged/unknown input");
store.joinWaitlist("giving-member", "authz-waitlist-session");
store.joinInterest("giving-member", "authz-interest-session");
const assertPaymentImpersonationRejected = (label, mutate) => {
  try {
    mutate();
    throw new Error(`${label} Payment impersonation should be rejected`);
  } catch (err) {
    if (!/Approved actor access required|Approved Admin access required|Payment mutation not authorized/.test(err.message)) throw err;
  }
};
for (const actor of [
  { label: "pending", email: "giving-pending@example.test" },
  { label: "declined", email: "giving-declined@example.test" },
  { label: "approved non-admin", email: "giving-other@example.test" },
  { label: "signed-out", email: null },
]) {
  if (actor.email) store.signIn(actor.email);
  else store.signOut();
  for (const mutate of [
    () => store.reserveSession("giving-member", paymentGateSession),
    () => store.markBookingPaid(approvedReservation.id, "FPS", `IMPERSONATED-${actor.label}`),
    () => store.joinWaitlist("giving-member", `authz-join-waitlist-${actor.label}`),
    () => store.leaveWaitlist("giving-member", "authz-waitlist-session"),
    () => store.joinInterest("giving-member", `authz-join-interest-${actor.label}`),
    () => store.leaveInterest("giving-member", "authz-interest-session"),
  ]) assertPaymentImpersonationRejected(actor.label, mutate);
}
if (store.getBooking(approvedReservation.id).paymentMarkedAt
    || store.waitlistPosition("giving-member", "authz-waitlist-session") !== 1
    || store.interestPosition("giving-member", "authz-interest-session") !== 1) {
  throw new Error("rejected Payment impersonation must not mutate state");
}
store.signIn("giving-admin@example.test");
givingFixture.users.find((user) => user.id === "giving-member").status = "declined";
mem.set("itc.prototype.v1", JSON.stringify({
  ...JSON.parse(mem.get("itc.prototype.v1")),
  users: givingFixture.users,
}));
store.load();
try {
  store.markBookingPaid(approvedReservation.id, "FPS", "BLOCKED-PAYMENT");
  throw new Error("declined reservation owner should not mark payment paid");
} catch (err) {
  if (!/Approved member access required/.test(err.message)) throw err;
}
givingFixture.users.find((user) => user.id === "giving-member").status = "approved";
mem.set("itc.prototype.v1", JSON.stringify({
  ...JSON.parse(mem.get("itc.prototype.v1")),
  users: givingFixture.users,
}));
store.load();
store.signIn("giving-member@example.test");
if (!store.markBookingPaid(approvedReservation.id, "FPS", "APPROVED-PAYMENT")) {
  throw new Error("approved booking owner should retain self-service payment access");
}
try {
  store.confirmBookingPayment(approvedReservation.id);
  throw new Error("approved booking owner must not self-confirm payment");
} catch (err) {
  if (!/Approved Admin access required/.test(err.message)) throw err;
}
if (store.getBooking(approvedReservation.id).status !== "reserved"
    || store.receiptForBooking(approvedReservation.id)) {
  throw new Error("rejected self-confirmation must not issue a receipt");
}
for (const actor of [
  { label: "pending", email: "giving-pending@example.test" },
  { label: "declined", email: "giving-declined@example.test" },
  { label: "approved non-admin", email: "giving-other@example.test" },
  { label: "signed-out", email: null },
]) {
  if (actor.email) store.signIn(actor.email);
  else store.signOut();
  assertPaymentImpersonationRejected(
    `${actor.label} confirmation`,
    () => store.confirmBookingPayment(approvedReservation.id)
  );
}
store.signIn("giving-admin@example.test");
const authorizedConfirmation = store.confirmBookingPayment(
  approvedReservation.id, Date.now(), "arbitrary-collector-id"
);
if (!authorizedConfirmation) {
  throw new Error("Admin should confirm payment for an approved affected profile");
}
if (authorizedConfirmation.booking.confirmedBy !== "giving-admin") {
  throw new Error("payment confirmation must derive confirmedBy from the authenticated Admin");
}
const deferTarget = store.deferTargetsFor(authorizedConfirmation.booking)[0];
if (!deferTarget) throw new Error("authorization regression needs a deferral target");
store.signIn("giving-other@example.test");
for (const mutate of [
  () => store.deferBooking(approvedReservation.id, deferTarget.id),
  () => store.cancelBooking(approvedReservation.id),
  () => store.setSessionTime(paymentGateSession.id, "11:00"),
  () => store.setSessionNotice(paymentGateSession.id, "Unauthorized note"),
  () => store.setVenueTBC(paymentGateSession.id, true),
  () => store.setMidtownOpen(paymentGateSession.id, true),
  () => store.setDuty("giving-other", paymentGateSession.dateISO),
  () => store.updateCollectorPayouts("giving-other", { paymeLink: "bad", fpsPhone: "bad" }),
  () => store.confirmGymBooking(paymentGateSession.id, "Unauthorized"),
]) {
  try {
    mutate();
    throw new Error("non-Admin cross-user/operational Payment mutation should be rejected");
  } catch (err) {
    if (!/Approved Admin access required|Payment mutation not authorized/.test(err.message)) throw err;
  }
}
store.signIn("giving-member@example.test");
try {
  store.cancelBooking(approvedReservation.id);
  throw new Error("booking owner must not use the Admin cancellation/refund seam");
} catch (err) {
  if (!/Approved Admin access required/.test(err.message)) throw err;
}
const movedByOwner = store.deferBooking(approvedReservation.id, deferTarget.id);
if (movedByOwner.userId !== "giving-member" || movedByOwner.status !== "confirmed") {
  throw new Error("approved booking owner should be able to defer their booking");
}
const releaseSession = store.upcomingSessions(28).find((session) =>
  session.kind === "paid" && !data.sessionStarted(session) && !store.isMidtown(session)
  && session.id !== movedByOwner.sessionId
);
if (!releaseSession) throw new Error("authorization regression needs a release session");
const ownerReservation = store.reserveSession("giving-member", releaseSession);
store.signIn("giving-other@example.test");
try {
  store.releaseReservation(ownerReservation.id);
  throw new Error("non-owner member must not release another member's reservation");
} catch (err) {
  if (!/Payment mutation not authorized/.test(err.message)) throw err;
}
store.signIn("giving-member@example.test");
if (!store.releaseReservation(ownerReservation.id)
    || store.getBooking(ownerReservation.id).status !== "cancelled") {
  throw new Error("approved booking owner should be able to release their reservation");
}
store.signIn("giving-admin@example.test");
if (!store.cancelBooking(movedByOwner.id)
    || store.receiptForBooking(movedByOwner.id)?.status !== "refunded") {
  throw new Error("Admin cancellation should cancel and refund a confirmed booking");
}
store.setSessionTime(paymentGateSession.id, "11:00");
store.setSessionNotice(paymentGateSession.id, "Admin note");
store.setVenueTBC(paymentGateSession.id, true);
store.confirmGymBooking(paymentGateSession.id, "Confirmed by Admin", Date.now());
const administeredSession = store.getSession(paymentGateSession.id);
if (administeredSession.time !== "11:00" || !administeredSession.notice
    || !administeredSession.venueTBC || !administeredSession.gymConfirmedAt) {
  throw new Error("approved Admin should retain weekly session operations");
}
store.leaveWaitlist("giving-member", "authz-waitlist-session");
store.leaveInterest("giving-member", "authz-interest-session");
console.log("ok  Payment seams enforce self-service/Admin boundaries and derive confirmation identity");

const givingFpsId = `FPS<&"'>`;
const givingCampaign = await store.saveGivingCampaign({
  title: "Member campaign", description: "Support the community.", goalHKD: 1000,
  fpsId: givingFpsId, fpsPayee: "Island Training Club",
});
await store.publishGivingCampaign(givingCampaign.id);
store.signIn("giving-member@example.test");
const memberGivingHtml = await views.viewGiving();
if (!/form-giving|Give via FPS/.test(memberGivingHtml)) throw new Error("approved members must access Giving transfer controls");
views.givingState.step = 2;
views.givingState.amount = 250;
views.givingState.name = "Giving Member";
const givingCopyReference = `GIVE-<&"'>`;
views.givingState.ref = givingCopyReference;
views.givingState.campaignId = givingCampaign.id;
const givingFpsHtml = await views.viewGiving();
for (const marker of [
  "FPS ID", "Payee", "HK$250",
  'data-action="copy-fps"', 'aria-label="Copy FPS ID"',
  'data-action="copy-reference"', 'aria-label="Copy Giving reference"',
  "Open your banking app", "pay using the FPS ID", "Paste the FPS ID",
]) {
  if (!givingFpsHtml.includes(marker)) throw new Error(`same-device Giving FPS UI missing ${marker}`);
}
if (/QR|scan|bank deep.link/i.test(givingFpsHtml)) {
  throw new Error("Giving FPS flow must not show QR or universal deep-link claims");
}
assertFpsCopyBindings(givingFpsHtml, [
  {
    action: "copy-fps", kind: "id", label: "FPS ID",
    value: givingFpsId, escaped: "FPS&lt;&amp;&quot;&#39;&gt;",
  },
  {
    action: "copy-reference", kind: "giving-reference", label: "Reference",
    value: givingCopyReference, escaped: "GIVE-&lt;&amp;&quot;&#39;&gt;",
  },
], "Giving FPS screen");
console.log("ok  Giving shows same-device FPS ID + reference copy guidance without QR claims");
views.givingState.ref = "GIVE-TEST";
await store.updateMyDonorId("member-1234");
if (store.currentUser().donorId !== "MEMBER-1234") throw new Error("Giving donor ID must normalize and persist");
const gift = store.recordDonation({ userId: "giving-member", name: "Giving Member", amount: 250, ref: "GIVE-TEST", campaignId: givingCampaign.id });
if (gift.status !== "pending" || store.campaignRaised(givingCampaign) !== 250 || !store.donationsForUser("giving-member").length) {
  throw new Error("Giving amount/FPS/history persistence failed");
}
const derivedGift = store.recordDonation({ name: "Derived Owner", amount: 100, ref: "GIVE-DERIVED", campaignId: givingCampaign.id });
if (derivedGift.userId !== "giving-member") throw new Error("Giving must derive donation ownership from currentUser().id");
for (const badUserId of ["giving-admin", null, ""]) {
  try {
    store.recordDonation({ userId: badUserId, name: "Wrong Owner", amount: 10, ref: `WRONG-${badUserId}`, campaignId: givingCampaign.id });
    throw new Error(`Giving should reject caller userId ${JSON.stringify(badUserId)}`);
  } catch (err) {
    if (!/Donation owner must match the approved member/.test(err.message)) throw err;
  }
}
console.log("ok  Giving donation ownership is derived and caller IDs must match");
store.signOut();
try {
  store.recordDonation({ name: "No Identity", amount: 10, ref: "NO-IDENTITY", campaignId: givingCampaign.id });
  throw new Error("Giving should reject absent identity");
} catch (err) {
  if (!/Approved member access required/.test(err.message)) throw err;
}
store.signIn("giving-member@example.test");
views.givingState.step = 3;
views.givingState.name = "Giving Member";
views.givingState.amount = 250;
views.givingState.ref = "GIVE-TEST";
views.givingState.campaignId = givingCampaign.id;
if (!(await views.viewGiving()).includes("Thank you, Giving")) throw new Error("Giving thank-you step missing");
for (const email of ["giving-pending@example.test", "giving-declined@example.test"]) {
  store.signIn(email);
  const locked = await views.viewGiving();
  if (!locked.includes("approved ITC members") || locked.includes("FPS ID")) throw new Error(`${email} must be gated from Giving`);
  try {
    store.recordDonation({ userId: store.currentUser().id, name: "Blocked", amount: 10, ref: `BLOCKED-${email}` });
    throw new Error(`${email} must not record gifts`);
  } catch (err) {
    if (!/Approved member access required/.test(err.message)) throw err;
  }
}
store.signIn("giving-admin@example.test");
await store.closeGivingCampaign(givingCampaign.id);
if (await store.getActiveGivingCampaign()) throw new Error("closed campaigns must not remain active");
const emptyGivingHtml = await views.viewGiving();
if (!emptyGivingHtml.includes("No active Giving campaign at the moment")
    || !emptyGivingHtml.includes("Check back soon for the next opportunity to support the ITC community.")) {
  throw new Error("closed campaigns must render the exact Giving empty state");
}
console.log("ok  Giving access, donor ID, campaign, FPS, thanks, history, and close flow");

const sourceSnapshots = [
  { version: 9, prayers: [{ id: "p-real" }] },
  {
    version: 10,
    paymentPayouts: null,
    queues: {
      real: {
        waitlist: [{ userId: "real-user", joinedAt: 123 }],
        interest: ["real-user"],
      },
    },
    duty: { "2026-08-08": { userId: "real-user" } },
  },
  { version: 11, paymentPayouts: [], notifications: [{ id: "n-real", userId: "real-user" }] },
  {
    version: 12,
    paymentPayouts: { "real-admin": { paymeLink: "https://payme.example/real", fpsPhone: "+852 6000 0000" } },
    campaigns: [{ id: "c-real", title: "Member campaign" }],
    donations: [{ id: "d-real", userId: "real-user" }],
  },
];
for (const fixture of sourceSnapshots) {
  const snapshot = {
    version: fixture.version,
    sessionUserId: null,
    users: [], activities: structuredClone(data.SEED_ACTIVITIES), bookings: [], receipts: [],
    ...fixture,
  };
  mem.set("itc.prototype.v1", JSON.stringify(snapshot));
  store.load();
  const migrated = JSON.parse(mem.get("itc.prototype.v1"));
  const serialized = JSON.stringify(migrated);
  const suppliedIds = JSON.stringify(fixture).match(/[pcnd]-real|real-user/g) || [];
  const payoutMapValid = migrated.paymentPayouts
    && typeof migrated.paymentPayouts === "object"
    && !Array.isArray(migrated.paymentPayouts);
  const suppliedPayoutsPreserved = fixture.version !== 12
    || migrated.paymentPayouts["real-admin"]?.fpsPhone === "+852 6000 0000";
  if (migrated.version !== 19 || suppliedIds.some((id) => !serialized.includes(id))
      || !payoutMapValid || !suppliedPayoutsPreserved) {
    failures++;
    console.error(`FAIL genuine v${fixture.version} fixture must reach v19 intact`);
  } else console.log(`ok  genuine v${fixture.version} fixture reaches v19 intact`);
}

for (const invalidCounter of [null, -1, 1.5, "broken"]) {
  mem.set("itc.prototype.v1", JSON.stringify({
    version: 13,
    activities: structuredClone(data.SEED_ACTIVITIES),
    users: [], bookings: [], receipts: [],
    receiptCounter: invalidCounter,
  }));
  store.load();
  const repairedCounter = JSON.parse(mem.get("itc.prototype.v1")).receiptCounter;
  if (!Number.isInteger(repairedCounter) || repairedCounter < 0) {
    throw new Error(`v13 must normalize invalid receiptCounter ${JSON.stringify(invalidCounter)}`);
  }
}
console.log("ok  v13 normalizes invalid receiptCounter shapes");

// Migration acceptance must prove resulting behavior, not only retained IDs.
// This v12 snapshot deliberately omits receiptCounter, then exercises the real
// reserve -> mark paid -> Admin confirm path that issues a receipt.
const receiptMigrationFixture = {
  version: 12,
  sessionUserId: "receipt-member",
  activities: structuredClone(data.SEED_ACTIVITIES),
  users: [
    { id: "receipt-admin", role: "admin", status: "approved", fullName: "Receipt Admin", email: "receipt-admin@example.test" },
    { id: "receipt-member", role: "member", status: "approved", fullName: "Receipt Member", email: "receipt-member@example.test" },
  ],
  bookings: [], receipts: [], campaigns: [], donations: [], prayers: [], notifications: [],
  sessionOverrides: {}, queues: {}, duty: {},
};
mem.set("itc.prototype.v1", JSON.stringify(receiptMigrationFixture));
store.load();
const receiptSession = store.upcomingSessions(14).find(
  (session) => session.kind === "paid" && !data.sessionStarted(session) && !store.isMidtown(session)
);
if (!receiptSession) throw new Error("post-migration receipt check needs an upcoming paid session");
const migratedReservation = store.reserveSession("receipt-member", receiptSession, Date.now());
store.markBookingPaid(migratedReservation.id, "FPS", "MIGRATED-RECEIPT", Date.now());
store.signIn("receipt-admin@example.test");
const migratedConfirmation = store.confirmBookingPayment(migratedReservation.id, Date.now());
const migratedReceiptState = JSON.parse(mem.get("itc.prototype.v1"));
if (!migratedConfirmation?.receipt
    || !/^ITC-\d{4}-\d{4,}$/.test(migratedConfirmation.receipt.number)
    || migratedConfirmation.receipt.number.includes("NaN")
    || !Number.isInteger(migratedReceiptState.receiptCounter)
    || migratedReceiptState.receiptCounter < 0) {
  throw new Error("post-migration receipt issuance must use a valid normalized counter");
}
console.log("ok  v13 migration normalizes receiptCounter before real receipt issuance");

// --- Free-event venue overrides (Task 3) ---
store.resetLocalData();
installLocalFixtures();
// Add a second Admin and a pending user to exercise actor + non-member exclusions.
{
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.users.push({
    id: "fixture-other-admin", role: "superadmin", status: "approved",
    fullName: "Test Other Admin", preferredName: "Other",
    email: "other-admin@example.test",
    isMinor: false, appliedAt: Date.now() - 86400000,
    indemnityAcceptedAt: Date.now() - 86400000,
    privacyAcceptedAt: Date.now() - 86400000,
    whatsappReminders: false, emailReceipts: false, communityNews: false,
  });
  raw.users.push({
    id: "fixture-pending-user", role: "pending", status: "pending",
    fullName: "Test Pending", preferredName: "Pending",
    email: "pending-user@example.test",
    isMinor: false, appliedAt: Date.now() - 3600000,
    whatsappReminders: false, emailReceipts: false, communityNews: false,
  });
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
}
const wntSession = store.upcomingSessions(21).find(
  (s) => s.activityId === "wnt" && !data.sessionStarted(s)
);
if (!wntSession) throw new Error("expected an upcoming wnt session for venue tests");
store.signIn("admin@example.test");

// A partial TBC override remains incomplete: it may retain the independent
// maps query, but it must not consume member dedupe or claim confirmation.
const partialSwimmingSession = store.upcomingSessions(21).find(
  (s) => s.activityId === "water" && !data.sessionStarted(s)
);
if (!partialSwimmingSession) throw new Error("expected an upcoming Swimming session for partial venue tests");
store.setWeekVenue(partialSwimmingSession.id, {
  location: "",
  mapsQuery: "Victoria Park Swimming Pool, Hong Kong",
});
const partialSwimming = store.getSession(partialSwimmingSession.id);
const partialSwimmingOverride = store.weekVenueOverride(partialSwimmingSession.id);
const partialMemberNotes = store.notificationsFor("fixture-member").filter(
  (n) => n.kind === "operational_session_venue_updated"
    && n.destination === `#/activity/${partialSwimmingSession.id}`
);
if (partialSwimming.location !== "TBC" || partialSwimming.venueTBC === false) {
  throw new Error("a maps-query-only Swimming override must remain TBC");
}
if (partialSwimmingOverride.venueMemberNotifiedAt || partialMemberNotes.length !== 0) {
  throw new Error("an incomplete Swimming override must not consume member notification dedupe");
}

// Legacy free-event venueTBC flags must be superseded by both direct reset
// and save-then-reset so the recurring default becomes visible again.
const recurringRun = store.getActivity("run");
store.saveActivity({
  ...recurringRun,
  location: "Recurring Run Venue",
  mapsQuery: "Recurring Run Venue, Hong Kong",
});
const legacyRunSession = store.upcomingSessions(21).find(
  (s) => s.activityId === "run" && !data.sessionStarted(s)
);
if (!legacyRunSession) throw new Error("expected an upcoming Run session for legacy venueTBC tests");
store.setVenueTBC(legacyRunSession.id, true);
store.setWeekVenue(legacyRunSession.id, { location: null, mapsQuery: null });
let restoredLegacyRun = store.getSession(legacyRunSession.id);
if (restoredLegacyRun.location !== "Recurring Run Venue" || restoredLegacyRun.venueTBC) {
  throw new Error("reset must supersede a legacy venueTBC flag and restore the recurring venue");
}
store.setVenueTBC(legacyRunSession.id, true);
store.setWeekVenue(legacyRunSession.id, {
  location: "Dated Run Venue",
  mapsQuery: "Dated Run Venue, Hong Kong",
});
store.setWeekVenue(legacyRunSession.id, { location: null, mapsQuery: null });
restoredLegacyRun = store.getSession(legacyRunSession.id);
if (restoredLegacyRun.location !== "Recurring Run Venue" || restoredLegacyRun.venueTBC) {
  throw new Error("save then reset must not expose a legacy venueTBC flag");
}

store.setWeekVenue(wntSession.id, { location: null, mapsQuery: null });
store.signIn("member@example.test");
const wntTbcDetail = views.viewActivity(wntSession.id);
if (!wntTbcDetail.includes("Meeting point to be confirmed — check back before Wednesday. Bring water and a friend.")) {
  throw new Error("WNT TBC detail must include the complete meeting-point note");
}
store.signIn("admin@example.test");
store.setWeekVenue(wntSession.id, {
  location: "Central Harbourfront — 7pm sharp",
  mapsQuery: "Central Harbourfront, Hong Kong",
});
const decorated = store.getSession(wntSession.id);
if (decorated.location !== "Central Harbourfront — 7pm sharp"
    || decorated.mapsQuery !== "Central Harbourfront, Hong Kong"
    || decorated.venueTBC) {
  throw new Error("weekly venue must decorate the dated free session");
}
store.signIn("member@example.test");
const wntConfirmedDetail = views.viewActivity(wntSession.id);
if (!wntConfirmedDetail.includes("Bring water and a friend.")
    || wntConfirmedDetail.includes("Meeting point to be confirmed")) {
  throw new Error("confirmed WNT detail must remove the TBC meeting-point wording");
}
store.signIn("admin@example.test");
const wntActivity = store.getActivity("wnt");
store.saveActivity({ ...wntActivity, memberNote: "Meet by the red flag." });
if (store.getSession(wntSession.id).memberNote !== "Meet by the red flag.") {
  throw new Error("custom WNT leader notes must not be overwritten by venue text");
}
store.saveActivity({ ...wntActivity, memberNote: "Meeting point to be confirmed — check back before Wednesday. Bring water." });
const venueNotesFor = (userId, sessionId) => store.notificationsFor(userId).filter(
  (n) => n.kind === "operational_session_venue_updated"
    && n.link === `#/activity/${sessionId}`
);
const memberNotes = venueNotesFor("fixture-member", wntSession.id);
const otherAdminNotes = venueNotesFor("fixture-other-admin", wntSession.id);
const actorNotes = venueNotesFor("fixture-admin", wntSession.id);
const pendingNotes = venueNotesFor("fixture-pending-user", wntSession.id);
if (memberNotes.length !== 1) {
  throw new Error("first confirmation must notify each member exactly once");
}
if (otherAdminNotes.length !== 1) {
  throw new Error("other admin must receive audit notification on actual save");
}
if (actorNotes.length) {
  throw new Error("actor must not receive its own audit notification");
}
if (pendingNotes.length) {
  throw new Error("pending profile must not receive venue notifications");
}
const memberDestination = memberNotes[0];
if (memberDestination?.link !== `#/activity/${wntSession.id}`) {
  throw new Error("member notification must point at the dated activity route");
}
for (const notification of [...memberNotes, ...otherAdminNotes]) {
  if (Object.hasOwn(notification, "read_at")
      || Object.hasOwn(notification, "destination")
      || Object.hasOwn(notification, "created_at")) {
    throw new Error("local venue notifications must persist only the existing local notification shape");
  }
}
if (memberDestination?.body !== `Wednesday Night Training on ${wntSession.dateISO} is at Central Harbourfront — 7pm sharp. Check the activity page for details.`) {
  throw new Error(`member venue copy must use the activity display name; got: ${memberDestination?.body}`);
}
if (otherAdminNotes[0]?.body !== `Test Admin set the venue for ${wntSession.id} to Central Harbourfront — 7pm sharp.`) {
  throw new Error(`admin venue copy must identify the actor; got: ${otherAdminNotes[0]?.body}`);
}
// No-op save must not notify anyone.
store.setWeekVenue(wntSession.id, {
  location: "Central Harbourfront — 7pm sharp",
  mapsQuery: "Central Harbourfront, Hong Kong",
});
if (venueNotesFor("fixture-member", wntSession.id).length !== 1) {
  throw new Error("no-op save must not duplicate member notification");
}
// Edit must notify only other Admins (not members).
store.setWeekVenue(wntSession.id, {
  location: "Wan Chai Promenade — 7pm sharp",
  mapsQuery: "Wan Chai Promenade, Hong Kong",
});
if (venueNotesFor("fixture-member", wntSession.id).length !== 1) {
  throw new Error("subsequent edits must not re-notify members");
}
if (venueNotesFor("fixture-other-admin", wntSession.id).length !== 2) {
  throw new Error("second save must notify other Admins again");
}
// Reset clears location/mapsQuery but preserves venueMemberNotifiedAt.
store.setWeekVenue(wntSession.id, { location: null, mapsQuery: null });
const resetDecorated = store.getSession(wntSession.id);
if (resetDecorated.location === "Central Harbourfront — 7pm sharp"
    || resetDecorated.mapsQuery === "Central Harbourfront, Hong Kong") {
  throw new Error("reset should restore the activity-template venue values");
}
if (venueNotesFor("fixture-member", wntSession.id).length !== 1) {
  throw new Error("reset must not re-notify members");
}
// Reconfirmation does not re-notify members.
store.setWeekVenue(wntSession.id, {
  location: "Causeway Bay Promenade — 7pm sharp",
  mapsQuery: "Causeway Bay Promenade, Hong Kong",
});
if (venueNotesFor("fixture-member", wntSession.id).length !== 1) {
  throw new Error("reconfirmation after reset must not re-notify members");
}
const weekOverride = store.weekVenueOverride(wntSession.id);
if (weekOverride.location !== "Causeway Bay Promenade — 7pm sharp"
    || weekOverride.mapsQuery !== "Causeway Bay Promenade, Hong Kong") {
  throw new Error("weekVenueOverride must expose the latest saved values");
}

const tamarSession = store.upcomingSessions(21).find(
  (s) => s.activityId === "wnt" && s.id !== wntSession.id && !data.sessionStarted(s)
);
if (!tamarSession) throw new Error("expected another upcoming WNT for dated meeting-point tests");
store.setWeekVenue(tamarSession.id, {
  location: "Tamar Park",
  mapsQuery: "Tamar Park",
  meetingLat: 22.2825,
  meetingLng: 114.1659,
});
let tamarDecorated = store.getSession(tamarSession.id);
if (tamarDecorated.meetingLat !== 22.2825 || tamarDecorated.meetingLng !== 114.1659) {
  throw new Error("dated Tamar point must decorate the session");
}
let tamarOverride = store.weekVenueOverride(tamarSession.id);
if (tamarOverride.meetingLat !== 22.2825 || tamarOverride.meetingLng !== 114.1659) {
  throw new Error("Admin override read must retain the dated Tamar point");
}
const otherWnt = store.upcomingSessions(21).find(
  (s) => s.activityId === "wnt"
    && s.id !== wntSession.id && s.id !== tamarSession.id
    && !data.sessionStarted(s)
);
if (!otherWnt || "meetingLat" in store.getSession(otherWnt.id)) {
  throw new Error("dated Tamar point must not leak into another WNT occurrence");
}
const memberBeforeMove = venueNotesFor("fixture-member", tamarSession.id).length;
const adminBeforeMove = venueNotesFor("fixture-other-admin", tamarSession.id).length;
store.setWeekVenue(tamarSession.id, {
  location: "Tamar Park",
  mapsQuery: "Tamar Park",
  meetingLat: 22.2827,
  meetingLng: 114.1661,
});
if (venueNotesFor("fixture-member", tamarSession.id).length !== memberBeforeMove) {
  throw new Error("coordinate-only edit must not repeat member fan-out");
}
if (venueNotesFor("fixture-other-admin", tamarSession.id).length !== adminBeforeMove + 1) {
  throw new Error("coordinate-only edit must create one Admin audit notification");
}
store.setWeekVenue(tamarSession.id, {
  location: "Island ECC 9/F",
  mapsQuery: "Island ECC",
  meetingLat: 22.2827,
  meetingLng: 114.1661,
});
tamarDecorated = store.getSession(tamarSession.id);
if ("meetingLat" in tamarDecorated || "meetingLng" in tamarDecorated) {
  throw new Error("non-Tamar save must clear stale meeting coordinates");
}
for (const point of [
  { meetingLat: 22.28, meetingLng: null },
  { meetingLat: 91, meetingLng: 114.16 },
]) {
  try {
    store.setWeekVenue(tamarSession.id, {
      location: "Tamar Park", mapsQuery: "Tamar Park", ...point,
    });
    throw new Error("invalid Tamar point must fail");
  } catch (err) {
    if (err.message !== "Choose a valid meeting point.") throw err;
  }
}
store.setWeekVenue(tamarSession.id, {
  location: null, mapsQuery: null, meetingLat: null, meetingLng: null,
});
if ("meetingLat" in store.getSession(tamarSession.id)) {
  throw new Error("venue reset must remove the dated meeting point");
}
console.log("ok  local WNT override persists, clears, validates, and resets meeting coordinates");

store.setWeekVenue(wntSession.id, {
  location: "Island ECC 11/F", mapsQuery: "Island ECC",
});
let venueDetail = views.viewActivity(wntSession.id);
if (!venueDetail.includes("island-ecc-11.jpg")
    || !venueDetail.includes("The Well · 11/F Island ECC")
    || venueDetail.includes('id="activity-map"')) {
  throw new Error("11/F WNT detail must render only the 11/F guide");
}
store.setWeekVenue(wntSession.id, {
  location: "Island ECC 9/F", mapsQuery: "Island ECC",
});
venueDetail = views.viewActivity(wntSession.id);
if (!venueDetail.includes("island-ecc-9.jpg")
    || !venueDetail.includes("Kid’s Club Hall · 9/F Island ECC")
    || venueDetail.includes('id="activity-map"')) {
  throw new Error("9/F WNT detail must render only the 9/F guide");
}
store.setWeekVenue(wntSession.id, {
  location: "Tamar Park", mapsQuery: "Tamar Park",
  meetingLat: 22.2825, meetingLng: 114.1659,
});
venueDetail = views.viewActivity(wntSession.id);
if (!venueDetail.includes('data-map-lat="22.2825"')
    || !venueDetail.includes('data-map-lng="114.1659"')
    || !venueDetail.includes("destination=22.2825%2C114.1659")) {
  throw new Error("Tamar detail and directions must use the exact dated point");
}
store.setWeekVenue(wntSession.id, {
  location: "Causeway Bay Promenade — 7pm sharp",
  mapsQuery: "Causeway Bay Promenade, Hong Kong",
});
console.log("ok  WNT Activity Details selects ECC guides and exact Tamar directions");

// View: free event with a mapsQuery renders the inline map host + Get directions.
const freeDetail = views.viewActivity(wntSession.id);
if (!freeDetail.includes('id="activity-map"')
    || !freeDetail.includes("Loading map")
    || !freeDetail.includes("data-marker-label=")
    || !freeDetail.includes("Get directions")) {
  throw new Error("mapped free event must render the inline map host and directions");
}
const noMapsSession = store.upcomingSessions(21)
  .filter((s) => s.activityId === "wnt" && !data.sessionStarted(s))
  .find((s) => s.id !== wntSession.id);
if (!noMapsSession) throw new Error("expected a second upcoming wnt session for the no-map case");
store.setVenueTBC(noMapsSession.id, true);
const tbcDetail = views.viewActivity(noMapsSession.id);
if (tbcDetail.includes('id="activity-map"')) {
  throw new Error("free events without mapsQuery must not render the inline map");
}
const hyroxDetailSample = store.upcomingSessions(21).find((s) => s.activityId === "hyrox-bft" && !data.sessionStarted(s));
const hyroxDetail = views.viewActivity(hyroxDetailSample.id);
if (!hyroxDetail.includes("Get directions") || hyroxDetail.includes('id="activity-map"')) {
  throw new Error("paid HYROX sessions must expose Get directions without the inline map");
}
const midtownSample = store.upcomingSessions(21).find((s) => s.activityId === "hyrox-midtown" && !data.sessionStarted(s));
const midtownDetail = views.viewActivity(midtownSample.id);
if (!midtownDetail.includes("Get directions") || midtownDetail.includes('id="activity-map"')) {
  throw new Error("closed Midtown must expose Get directions without the inline map");
}
// Admin Activities separates recurring defaults from one-off free-session venue overrides.
const swimmingSession = store.upcomingSessions(21).find(
  (s) => s.activityId === "water" && !data.sessionStarted(s)
);
if (!swimmingSession) throw new Error("expected an upcoming swimming session for admin IA checks");
store.setWeekVenue(swimmingSession.id, {
  location: "Victoria Park Swimming Pool",
  mapsQuery: "Victoria Park Swimming Pool, Hong Kong",
});
const completedSwimmingOverride = store.weekVenueOverride(swimmingSession.id);
const completedSwimmingNotes = venueNotesFor("fixture-member", swimmingSession.id);
if (!completedSwimmingOverride.venueMemberNotifiedAt || completedSwimmingNotes.length !== 1) {
  throw new Error("completing a partial Swimming override must notify members exactly once");
}
if (completedSwimmingNotes[0].body !== `ITC Swimming on ${swimmingSession.dateISO} is at Victoria Park Swimming Pool. Check the activity page for details.`) {
  throw new Error(`Swimming member copy must use its display name; got: ${completedSwimmingNotes[0].body}`);
}
store.signIn("admin@example.test");
store.setWeekVenue(wntSession.id, {
  location: "Tamar Park", mapsQuery: "Tamar Park",
  meetingLat: 22.2825, meetingLng: 114.1659,
});
const activitiesHtml = await views.viewAdmin("activities");
const hyroxAdminHtml = await views.viewAdmin("payments");
if (!activitiesHtml.includes("Recurring Activity Defaults")
    || !activitiesHtml.includes("Only this session")
    || !activitiesHtml.includes("Google Maps search")
    || !activitiesHtml.includes("Save Weekly Venue")
    || !activitiesHtml.includes("Reset to Recurring Default")
    || !activitiesHtml.includes("Meeting point · Only this session")
    || !activitiesHtml.includes('name="meetingLat" value="22.2825"')
    || !activitiesHtml.includes('name="meetingLng" value="114.1659"')) {
  throw new Error("Activities must separate recurring defaults and render the dated WNT picker");
}
if (!activitiesHtml.includes("Current venue: <strong>Victoria Park Swimming Pool</strong>")
    || !activitiesHtml.includes("Recurring default: <strong>TBC</strong>")) {
  throw new Error("Activities must show distinct current and recurring venues for overridden Swimming");
}
if (activitiesHtml.includes("BFT Causeway Bay (BFT)")
    || activitiesHtml.includes("Midtown28 Fitness (Midtown)")) {
  throw new Error("Admin Activities must not append redundant HYROX venue suffixes");
}
if (activitiesHtml.includes("confirmed in-app")
    || activitiesHtml.includes("awaiting payment")
    || activitiesHtml.includes("Not open")) {
  throw new Error("Activities must not contain HYROX booking/payment status");
}
if (hyroxAdminHtml.includes("BFT Causeway Bay (BFT)")
    || hyroxAdminHtml.includes("Midtown28 Fitness (Midtown)")) {
  throw new Error("Admin Payments must not append redundant HYROX venue suffixes");
}
if ((activitiesHtml.match(/>Weekly Event Controls</g) || []).length !== 1
    || !activitiesHtml.includes("Free &amp; RSVP Events")
    || !activitiesHtml.includes("Paid Sessions")) {
  throw new Error("Activities should group weekly controls by free/RSVP and paid sessions");
}
const paidControlsSource = integratedViewSource
  .split("function adminPaidSessionControls()")[1]?.split("function adminFinalizeGym()")[0] || "";
const freeControlsSource = integratedViewSource
  .split("function adminFreeEventControls()")[1]?.split("function adminWeeklyEventControls()")[0] || "";
if (!paidControlsSource.includes('<div class="empty mt8">No upcoming paid sessions.</div>')) {
  throw new Error("Paid Sessions must retain its concise empty-group state");
}
if (!freeControlsSource.includes('<div class="empty mt8">No upcoming free or RSVP events.</div>')) {
  throw new Error("Free & RSVP Events must retain its concise empty-group state");
}
if (activitiesHtml.includes(">Weekly Venue Overrides<")
    || activitiesHtml.includes(">Weekly Session Overrides<")) {
  throw new Error("legacy weekly override headings should be removed");
}
const weeklyControlsStart = activitiesHtml.indexOf(">Weekly Event Controls<");
const oneOffEventsStart = activitiesHtml.indexOf(">One-off Events<");
const weeklyControlsHtml = weeklyControlsStart === -1 || oneOffEventsStart === -1
  ? ""
  : activitiesHtml.slice(weeklyControlsStart, oneOffEventsStart);
for (const marker of [
  'data-action="form-week-venue"',
  'data-action="reset-week-venue"',
  "Cancel this week's event",
  'id="form-session-time"',
  'id="form-session-notice"',
  'data-action="venue-tbc-toggle"',
  'id="form-cancel-week"',
]) {
  if (!weeklyControlsHtml.includes(marker)) {
    throw new Error(`Weekly Event Controls must preserve ${marker}`);
  }
}
if (!/\d+ going/.test(weeklyControlsHtml)) {
  throw new Error("Weekly Event Controls must preserve the RSVP count");
}
if (!(activitiesHtml.indexOf("Recurring Activity Defaults") < weeklyControlsStart
    && weeklyControlsStart < oneOffEventsStart)
    || !/aria-labelledby="paid-sessions-title">[\s\S]*<\/section>\s*<\/details>\s*<details class="admin-section mt24">\s*<summary><h2>One-off Events<\/h2>/.test(activitiesHtml)) {
  throw new Error("One-off Events must remain a separate section after Weekly Event Controls");
}
if (!activitiesHtml.includes("Club Operations") || activitiesHtml.includes("Club ops.")) {
  throw new Error("Admin heading must read Club Operations");
}
if (!activitiesHtml.includes('<details class="admin-section') || !activitiesHtml.includes("<summary>")) {
  throw new Error("Activities sections must collapse behind their headers");
}
if (hyroxAdminHtml.includes("Weekly Event Controls")
    || hyroxAdminHtml.includes('data-action="form-week-venue"')) {
  throw new Error("Payments must not contain weekly event controls");
}
if (!hyroxAdminHtml.includes(">Payments</a>")
    || hyroxAdminHtml.includes(">HYROX</a>")
    || hyroxAdminHtml.includes("Payments / Ops")) {
  throw new Error("the final Admin tab must be Payments");
}
store.signOut();
// Members cannot set a weekly venue.
store.signIn("member@example.test");
try {
  store.setWeekVenue(wntSession.id, {
    location: "Should not save",
    mapsQuery: "Should not save",
  });
  throw new Error("members must not be allowed to set a weekly venue");
} catch (err) {
  if (!err.message.toLowerCase().includes("admin")) {
    throw new Error(`member actor error should explain admin requirement, got: ${err.message}`);
  }
}
// HYROX session id is rejected with the exact spec message.
const hyroxSample = store.upcomingSessions(21).find(
  (s) => s.activityId === "hyrox-bft" && !data.sessionStarted(s)
);
if (!hyroxSample) throw new Error("expected an upcoming hyrox session for the guard test");
try {
  store.setWeekVenue(hyroxSample.id, {
    location: "Should not save",
    mapsQuery: "Should not save",
  });
  throw new Error("HYROX venues must not be overridable");
} catch (err) {
  if (err.message !== "Activity venue is fixed.") {
    throw new Error(`HYROX error should match spec, got: ${err.message}`);
  }
}
console.log("ok  free-event weekly venue state, fan-out, dedupe, and HYROX guard");

// --- WNT venue-specific guidance ---
const venue = await import("./js/venue.js");
const sameVenueValue = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: ${JSON.stringify(actual)}`);
  }
};
if (venue.normalizeVenueLocation("  ISLAND ECC 11 / F ") !== "island ecc 11/f") {
  throw new Error("11/F venue formatting must canonicalize");
}
if (venue.normalizeVenueLocation("Island ECC 9F") !== "island ecc 9/f") {
  throw new Error("9F venue formatting must canonicalize");
}
if (venue.normalizeVenueLocation("Tamar Park, Admiralty") !== "tamar park") {
  throw new Error("Tamar alias must canonicalize");
}
if (venue.normalizeVenueLocation("Tamar Street") === "tamar park") {
  throw new Error("unrelated Tamar text must not specialize");
}
sameVenueValue(
  venue.normalizeMeetingPoint("22.2816182", "114.1655613"),
  { lat: 22.2816182, lng: 114.1655613 },
  "valid meeting point"
);
for (const [lat, lng] of [[null, 114], [91, 114], [22, -181], ["x", 114]]) {
  if (venue.normalizeMeetingPoint(lat, lng) !== null) {
    throw new Error(`invalid meeting point accepted: ${lat},${lng}`);
  }
}
sameVenueValue(venue.venuePresentationFor({
  id: "wnt-2026-09-02", activityId: "wnt", location: "Island ECC 11/F",
  mapsQuery: "Island ECC", markerLabel: "WNT · 2 Sep · 7:30 PM",
}), {
  kind: "image",
  src: "../assets/itc/venues/island-ecc-11.jpg",
  alt: "Route to The Well on 11/F at Island ECC",
  caption: "The Well · 11/F Island ECC",
  fallbackQuery: "Island ECC",
}, "11/F image presentation");
sameVenueValue(venue.venuePresentationFor({
  id: "wnt-2026-09-09", activityId: "wnt", location: "Island ECC 9F",
  mapsQuery: "Island ECC", markerLabel: "WNT · 9 Sep · 7:30 PM",
}), {
  kind: "image",
  src: "../assets/itc/venues/island-ecc-9.jpg",
  alt: "Route to Kid’s Club Hall on 9/F at Island ECC",
  caption: "Kid’s Club Hall · 9/F Island ECC",
  fallbackQuery: "Island ECC",
}, "9/F image presentation");
sameVenueValue(venue.venuePresentationFor({
  id: "wnt-2026-09-16", activityId: "wnt", location: "Tamar Park",
  mapsQuery: "Tamar Park", markerLabel: "WNT · 16 Sep · 7:30 PM",
}), {
  kind: "coordinates", lat: 22.2816182, lng: 114.1655613,
  markerLabel: "WNT · 16 Sep · 7:30 PM",
}, "default Tamar presentation");
sameVenueValue(venue.venuePresentationFor({
  id: "run-2026-09-14", activityId: "run", location: "Island ECC 9/F",
  mapsQuery: "Island ECC", markerLabel: "Run",
}), { kind: "geocode", query: "Island ECC", markerLabel: "Run" },
"non-WNT generic presentation");
for (const path of [
  "../assets/itc/venues/island-ecc-11.jpg",
  "../assets/itc/venues/island-ecc-9.jpg",
]) {
  if (!existsSync(resolve(__dirnameSmoke, path))) throw new Error(`missing venue guide: ${path}`);
}
console.log("ok  WNT venue resolver selects ECC images, Tamar point, and generic fallback");

// --- Inline free-event venue map (Task 5) ---
const map = await import("./js/map.js");
if (JSON.stringify(map.parseGeocodeCache('{"Central":{"lat":22.281,"lon":114.159}}'))
  !== JSON.stringify({ Central: { lat: 22.281, lon: 114.159 } })) {
  throw new Error("parseGeocodeCache should read valid entries");
}
if (JSON.stringify(map.parseGeocodeCache("not-json")) !== "{}") {
  throw new Error("parseGeocodeCache should drop invalid JSON");
}
if (JSON.stringify(map.parseGeocodeCache('{"Bad":{"lat":"NaN","lon":114}}')) !== "{}") {
  throw new Error("parseGeocodeCache should drop non-finite coords");
}
if (JSON.stringify(map.normalizeGeocodeResult([{ lat: "22.281", lon: "114.159" }]))
  !== JSON.stringify({ lat: 22.281, lon: 114.159 })) {
  throw new Error("normalizeGeocodeResult should coerce string coordinates");
}
if (map.normalizeGeocodeResult([]) !== null) {
  throw new Error("normalizeGeocodeResult should reject empty arrays");
}
if (map.normalizeGeocodeResult([{ lat: "x", lon: "114" }]) !== null) {
  throw new Error("normalizeGeocodeResult should reject non-finite coordinates");
}

// Exact meeting-point maps must bypass Nominatim and use the dated point.
const originalDocument = globalThis.document;
const originalLeaflet = globalThis.L;
const exactSetViews = [];
const exactMarkers = [];
globalThis.document = {
  createElement: () => ({ textContent: "", children: [], appendChild(child) { this.children.push(child); } }),
};
globalThis.L = {
  map: () => ({ setView(coords, zoom) { exactSetViews.push([coords, zoom]); } }),
  tileLayer: () => ({ addTo() {} }),
  marker: (coords) => ({
    addTo() { exactMarkers.push(coords); return this; },
    bindPopup() {},
  }),
};
const exactMapHost = {
  id: "activity-map",
  dataset: {
    mapLat: "22.2825", mapLng: "114.1659", markerLabel: "WNT meeting point",
  },
  isConnected: true,
  innerHTML: "<p>Loading map…</p>",
};
const exactMounted = await map.mountActivityMap(exactMapHost, {
  fetchImpl: async () => { throw new Error("exact map must not geocode"); },
  loadLeaflet: async () => {},
});
globalThis.document = originalDocument;
globalThis.L = originalLeaflet;
if (!exactMounted
    || JSON.stringify(exactSetViews) !== JSON.stringify([[[22.2825, 114.1659], 15]])
    || JSON.stringify(exactMarkers) !== JSON.stringify([[22.2825, 114.1659]])) {
  throw new Error(`exact map must mount at the dated point without geocoding: mounted=${exactMounted} views=${JSON.stringify(exactSetViews)} markers=${JSON.stringify(exactMarkers)}`);
}

// mountActivityMap must start geocoding and Leaflet loading concurrently.
let releaseGeocode;
const geocodeGate = new Promise((resolve) => { releaseGeocode = resolve; });
const starts = [];
const concurrentHost = {
  id: "activity-map",
  dataset: {
    mapsQuery: "task-5-concurrency-imaginary-place",
    markerLabel: "ITC Swimming",
  },
  isConnected: true,
  innerHTML: "<p>Loading map…</p>",
};
mem.set("itc.geocode.v1", "{}");
const concurrentMount = map.mountActivityMap(concurrentHost, {
  fetchImpl: async () => {
    starts.push("geocode");
    await geocodeGate;
    return { ok: true, json: async () => [] };
  },
  loadLeaflet: async () => { starts.push("leaflet"); },
});
await Promise.resolve();
const startedConcurrently = JSON.stringify(starts) === JSON.stringify(["geocode", "leaflet"]);
releaseGeocode();
const concurrentResult = await concurrentMount;
if (!startedConcurrently) {
  throw new Error(`geocoding and Leaflet must start concurrently; saw ${JSON.stringify(starts)}`);
}
if (concurrentResult !== false) {
  throw new Error("empty geocode result must still resolve to false");
}

// mountActivityMap must resolve to false and render fallback when no result is found.
const mapHost = {
  id: "activity-map",
  dataset: { mapsQuery: "nowhere-imaginary-place", markerLabel: "Test session" },
  isConnected: true,
  innerHTML: "<p>Loading map\u2026</p>",
};
mem.set("itc.geocode.v1", "{}");
let emptyResultLoaderStarted = false;
const mountedMissing = await map.mountActivityMap(mapHost, {
  fetchImpl: async () => ({
    ok: true,
    json: async () => [],
  }),
  loadLeaflet: async () => { emptyResultLoaderStarted = true; },
});
if (mountedMissing !== false) {
  throw new Error("missing geocode must not mount a map");
}
if (!emptyResultLoaderStarted) {
  throw new Error("the concurrent Leaflet loader must start even when geocoding returns empty");
}
if (!/Couldn.t find the venue on the map/.test(mapHost.innerHTML)
  || !/tap Get directions instead/.test(mapHost.innerHTML)) {
  throw new Error(`fallback copy not rendered: ${mapHost.innerHTML}`);
}

// Leaflet loading rejection is independent from an empty geocode result and
// must settle on the same fallback.
const rejectedLoaderQuery = "loader-rejection-imaginary-place";
mem.set("itc.geocode.v1", JSON.stringify({
  [rejectedLoaderQuery]: { lat: 22.281, lon: 114.159 },
}));
const rejectedLoaderHost = {
  id: "activity-map",
  dataset: { mapsQuery: rejectedLoaderQuery, markerLabel: "Rejected loader" },
  isConnected: true,
  innerHTML: "<p>Loading map…</p>",
};
const rejectedLoaderResult = await map.mountActivityMap(rejectedLoaderHost, {
  loadLeaflet: async () => { throw new Error("simulated Leaflet loader rejection"); },
});
if (rejectedLoaderResult !== false
    || !/Couldn.t find the venue on the map/.test(rejectedLoaderHost.innerHTML)) {
  throw new Error("Leaflet loader rejection must return false with fallback copy");
}

// Leaflet may load successfully and still throw while constructing the map.
// That rendering exception must not be reported as a successful mount.
const renderingExceptionQuery = "rendering-exception-imaginary-place";
mem.set("itc.geocode.v1", JSON.stringify({
  [renderingExceptionQuery]: { lat: 22.282, lon: 114.16 },
}));
const renderingExceptionHost = {
  id: "activity-map",
  dataset: { mapsQuery: renderingExceptionQuery, markerLabel: "Rendering exception" },
  isConnected: true,
  innerHTML: "<p>Loading map…</p>",
};
const previousLeafletGlobal = globalThis.L;
globalThis.L = {
  map() { throw new Error("simulated Leaflet rendering exception"); },
};
const renderingExceptionResult = await map.mountActivityMap(renderingExceptionHost, {
  loadLeaflet: async () => {},
});
globalThis.L = previousLeafletGlobal;
if (renderingExceptionResult !== false
    || !/Couldn.t find the venue on the map/.test(renderingExceptionHost.innerHTML)) {
  throw new Error("Leaflet rendering exceptions must return false with fallback copy");
}
console.log("ok  inline free-event map renders fallback for lookup, loader, and rendering failures");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll smoke tests passed.");
process.exit(failures ? 1 : 0);
