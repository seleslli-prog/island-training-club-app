# Island ECC HYROX Signup Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock Island ECC HYROX sign-up until Monday 18:00 HKT of that week, expire unpaid original holds Thursday 18:00, remind leftover unpaid members and the collector Friday 18:00, and nudge the collector Friday 21:00 to finalize with Island ECC and the coach.

**Architecture:** Reuse the existing two-slot Island ECC direct-session flow on `main`. Add shared HKT helpers used by local `store.js` and a forward Supabase migration that wraps reserve/queue, stamps pay-by instants, promotes waitlist into reserved bookings, and sends new (non-retired) notification kinds. Do not revive pool RPCs.

**Tech Stack:** Vanilla ES modules, localStorage `STATE_VERSION` 28, PostgreSQL/Supabase forward migrations, Node `app/smoke.mjs`, SQL integration tests.

**Spec:** `docs/superpowers/specs/2026-10-02-hyrox-island-ecc-windows-design.md`

## Global Constraints

- Branch from **`origin/main`**: `feature/hyrox-island-ecc-windows`. Do not start from `testing` or `feature/update-existing`.
- All Island ECC clocks are `Asia/Hong_Kong` (`Date.parse(\`${dateISO}T${hh}:${mm}:00+08:00\`)` locally; `(date + time) at time zone 'Asia/Hong_Kong'` in SQL).
- Exclusive one commitment per Saturday stays: error `Choose one Island ECC HYROX slot per Saturday.`
- Signup-lock error: `HYROX sign-up opens Monday at 6 PM HKT.`
- New notification kinds: `operational_island_ecc_payment_reminder`, `operational_island_ecc_collector_finalize_reminder`, `operational_island_ecc_collector_finalize_nudge`. Never add these to `RETIRED_POOL_NOTIFICATION_KINDS`.
- Do not edit already-applied migrations. New file: `supabase/migrations/20261002000001_island_ecc_signup_windows.sql`.
- Do not touch Shop, Giving, or merchandise. Do not show BFT/Midtown pool UI.
- `nextPayDeadline` for non–Island ECC paid sessions must keep current Friday 14:00 / 2-hour last-minute behaviour.

## Review Focus

- Browser TZ ≠ HKT: helpers must not use `setHours`.
- `payment_marked_at` set, collector not yet confirmed: must **not** expire at Thursday 18:00.
- Same-slot waitlist while full is allowed; other-slot waitlist while holding is not.
- No collector assignment: Friday collector notifications are skipped, not thrown.
- `applications.hyrox_payment_reminders = false`: skip member Friday 18:00 reminder only.

---

### Task 1: HKT helpers and branch from main

**Files:**
- Create (on the new branch): `docs/superpowers/specs/2026-10-02-hyrox-island-ecc-windows-design.md` (copy from this working tree if the file is not yet on `main`)
- Modify: `app/js/data.js` (after `hktEventStartMs`)
- Modify: `app/smoke.mjs` (pure helper assertions near existing Island ECC seed checks)

**Interfaces:**
- Consumes: Saturday `dateISO` (`YYYY-MM-DD`)
- Produces:
  - `islandEccSignupOpensAt(dateISO) -> number` — Monday 18:00 HKT (`S − 5`)
  - `islandEccPaymentDeadlineAt(dateISO) -> number` — Thursday 18:00 HKT (`S − 2`)
  - `islandEccLeftoverPayByAt(dateISO) -> number` — Friday 21:00 HKT (`S − 1`)
  - `islandEccMemberReminderAt(dateISO) -> number` — Friday 18:00 HKT (`S − 1`)
  - `islandEccCollectorFinalizeNudgeAt(dateISO) -> number` — Friday 21:00 HKT (`S − 1`)
  - `islandEccSignupOpen(dateISO, now = Date.now()) -> boolean`
  - `islandEccNextPayDeadline(dateISO, now = Date.now()) -> number` — Thursday 18:00 if `now` is before that, else Friday 21:00
  - `ISLAND_ECC_SIGNUP_LOCKED_ERROR = "HYROX sign-up opens Monday at 6 PM HKT."`

- [ ] **Step 1: Create the branch from `origin/main`**

```bash
git fetch origin
git checkout -b feature/hyrox-island-ecc-windows origin/main
```

Copy the approved spec onto the branch if it is missing.

- [ ] **Step 2: Write the failing helper assertions in `app/smoke.mjs`**

Pin Saturday `2026-10-10`:

- `islandEccSignupOpensAt` equals `Date.parse("2026-10-05T18:00:00+08:00")`
- `islandEccPaymentDeadlineAt` equals `Date.parse("2026-10-08T18:00:00+08:00")`
- `islandEccMemberReminderAt` equals `Date.parse("2026-10-09T18:00:00+08:00")`
- `islandEccLeftoverPayByAt` and `islandEccCollectorFinalizeNudgeAt` equal `Date.parse("2026-10-09T21:00:00+08:00")`
- `islandEccSignupOpen("2026-10-10", Date.parse("2026-10-05T17:59:00+08:00")) === false`
- `islandEccSignupOpen("2026-10-10", Date.parse("2026-10-05T18:00:00+08:00")) === true`
- `islandEccNextPayDeadline("2026-10-10", Date.parse("2026-10-08T17:59:00+08:00"))` is Thursday 18:00
- `islandEccNextPayDeadline("2026-10-10", Date.parse("2026-10-08T18:00:00+08:00"))` is Friday 21:00
- `finalCheckpointFor` / `LAST_MINUTE_WINDOW_MS` still exist for non–Island ECC `nextPayDeadline`

- [ ] **Step 3: Run `node app/smoke.mjs`**

Expected: FAIL — helpers not exported.

- [ ] **Step 4: Implement the helpers in `app/js/data.js`**

Build each instant with `Date.parse(\`${iso}T${time}+08:00\`)` after shifting the calendar date in UTC date parts the same way `hyrox-cycle.js` used `shiftISO`, or by formatting HKT calendar days from `dateISO`. Do not call `setHours`.

- [ ] **Step 5: Re-run `node app/smoke.mjs`**

Expected: PASS (or only pre-existing failures unrelated to this task; this task’s new asserts pass).

- [ ] **Step 6: Commit**

```bash
git add app/js/data.js app/smoke.mjs docs/superpowers/specs/2026-10-02-hyrox-island-ecc-windows-design.md docs/superpowers/plans/2026-10-02-hyrox-island-ecc-windows.md
git commit -m "feat(hyrox): add Island ECC HKT signup and pay-by helpers"
```

---

### Task 2: Local reserve, waitlist, expiry, and reminders

**Files:**
- Modify: `app/js/store.js` (`STATE_VERSION`, `migrate`, `reserveApprovedSession`, `joinQueue`, `sweepCheckpoints`, `cascadeSession`)
- Modify: `app/smoke.mjs` (extend the Island ECC reserve block around the existing `hyrox-quarry-bay` reservation)

**Interfaces:**
- Consumes: Task 1 helpers; `isIslandEccHyroxSession`; `collectorFor(sessionId)`
- Produces: Island ECC local engine matching the spec clocks; `STATE_VERSION = 28`

- [ ] **Step 1: Write failing local behaviour asserts in `app/smoke.mjs`**

Use a future Saturday `S` where `islandEccSignupOpen(S, Date.now())` is false (e.g. two weeks out):

- `reserveSession` and `joinWaitlist` throw `ISLAND_ECC_SIGNUP_LOCKED_ERROR`
- After fake `now = islandEccSignupOpensAt(S)`, reserve succeeds
- `payDeadlineAt === islandEccNextPayDeadline(S, now)`
- Second slot still throws `Choose one Island ECC HYROX slot per Saturday.`
- Sweep at Thursday 18:00 + 1ms: unmarked original `reserved` → `expired`; waitlist member becomes `reserved` with `payDeadlineAt === islandEccLeftoverPayByAt(S)`
- Booking with `paymentMarkedAt` set does **not** expire at that sweep
- Sweep at Friday 18:00: unpaid leftover gets kind `operational_island_ecc_payment_reminder` once; collector gets `operational_island_ecc_collector_finalize_reminder` once
- Sweep at Friday 21:00 + 1ms: unpaid leftover `reserved` → `expired`
- Sweep at Friday 21:00 with no `sessionOverrides[sessionId].gymConfirmedAt` on either slot: collector gets `operational_island_ecc_collector_finalize_nudge` once; second sweep does not duplicate; if both slots are gym-confirmed, no nudge
- Non–Island ECC `nextPayDeadline` still uses Friday 14:00 when called after Thursday 18:00

- [ ] **Step 2: Run `node app/smoke.mjs`**

Expected: FAIL on lock and/or reminder kinds.

- [ ] **Step 3: Implement in `app/js/store.js`**

- Bump `STATE_VERSION` to `28`. In `migrate`, for unpaid `reserved` Island ECC bookings with `snapshot.dateISO >= todayHktISO()`, set `payDeadlineAt = islandEccNextPayDeadline(dateISO, now)` using migrate `now = Date.now()`.
- `reserveApprovedSession` / `joinQueue`: if Island ECC and `!islandEccSignupOpen(session.dateISO, now)`, throw `ISLAND_ECC_SIGNUP_LOCKED_ERROR`.
- Island ECC `payDeadlineAt`: `islandEccNextPayDeadline`; other paid sessions: existing `nextPayDeadline`.
- `sweepCheckpoints`: keep expire-when-`now > payDeadlineAt` and `cascadeSession`. For Island ECC, do **not** send the 24-hour-before `payment-reminder`. At `now >= islandEccMemberReminderAt(dateISO)` send `operational_island_ecc_payment_reminder` once (`reminderSentAt`). At the same Friday 18:00, if `collectorFor` exists, notify once per Saturday (store a map on `state` e.g. `islandEccWeekOps[dateISO].collectorFinalizeReminderSentAt`). At Friday 21:00, if either Island ECC session that date has no gym confirmation (`gymConfirmedAt` / session override equivalent used by Admin finalize), send `operational_island_ecc_collector_finalize_nudge` once per Saturday.
- Member reminder copy: `Pay for ITC HYROX on ${fmtDate(dateISO)} by the deadline or the spot goes to the waitlist.` Link `#/pay/${id}`.
- Collector 18:00 copy: `Finalize both Island ECC HYROX sessions with Island ECC and the coach.` Link `#/admin/payments`.
- Collector 21:00 copy: `Still not finalized — please confirm with Island ECC and the coach if possible.` Link `#/admin/payments`.
- Honour `hyroxPaymentReminders === false` by skipping the member Friday reminder.

- [ ] **Step 4: Re-run `node app/smoke.mjs`**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/store.js app/smoke.mjs
git commit -m "feat(hyrox): lock Island ECC signup and run Thursday/Friday local sweeps"
```

---

### Task 3: Member UI lock and pay-by copy

**Files:**
- Modify: `app/js/views.js` (`sessionRow`, `viewActivity`, `viewCheckout` / pay how-it-works banner)
- Modify: `app/smoke.mjs` (HTML assertions)

**Interfaces:**
- Consumes: `islandEccSignupOpen`, `ISLAND_ECC_HYROX_ACTIVITY_IDS`, `hasOtherIslandEccCommitment` (export from store if views need it, or a small `store.islandEccSignupLocked(session)` / `store.islandEccOtherSlotTaken(session)`)
- Produces: locked and exclusive UI that does not render Reserve / waitlist CTA

- [ ] **Step 1: Write failing HTML asserts**

- Locked future Island ECC `viewActivity`: matches `Opens Monday at 6 PM`, does not include `Book & pay` or `form-reserve`
- Locked `sessionRow`: matches `Opens Monday at 6 PM`
- When the member already holds the other slot: other slot detail matches `already registered this Saturday` (exact sentence) and has no Book CTA
- Open unpaid pay/checkout copy: `Thursday 6 PM` when before Thursday 18:00; after Thursday 18:00 leftover copy `Friday 9 PM`

- [ ] **Step 2: Run `node app/smoke.mjs`**

Expected: FAIL on missing copy.

- [ ] **Step 3: Implement view branches**

Prefer store predicates so views stay string templates. Schedule row uses the same lock badge as detail.

- [ ] **Step 4: Re-run `node app/smoke.mjs`**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/views.js app/js/store.js app/smoke.mjs
git commit -m "feat(hyrox): show Island ECC Monday lock and exclusive-slot copy"
```

---

### Task 4: Live SQL windows, promotion, and reminders

**Files:**
- Create: `supabase/migrations/20261002000001_island_ecc_signup_windows.sql`
- Create: `supabase/tests/island_ecc_windows_integration.sql` (`begin;` … `rollback;`)
- Modify: `supabase/tests/verify_operational_backend.sh` (or the harness that already includes Island ECC slot tests) so the new file runs
- Modify: `app/smoke.mjs` migration marker list (same pattern as `'hyrox-quarry-bay-early'` / exclusivity markers)

**Interfaces:**
- Consumes: `private.operational_is_island_ecc_hyrox_activity(text)`
- Produces:
  - `private.island_ecc_signup_opens_at(date) returns timestamptz`
  - `private.island_ecc_payment_deadline_at(date) returns timestamptz`
  - `private.island_ecc_leftover_pay_by_at(date) returns timestamptz`
  - `private.island_ecc_member_reminder_at(date) returns timestamptz`
  - Wrapped `reserve_operational_session` / `join_operational_queue`: Island ECC rejects before signup open with `errcode = '23514'` and message `HYROX sign-up opens Monday at 6 PM HKT.`
  - Island ECC insert `pay_deadline_at = private.island_ecc_next_pay_deadline(session_date, now())`
  - `sweep_operational_deadlines`: after expire, for Island ECC waitlist promotions **insert** `operational_bookings` (reserved) with leftover/standard pay-by, skip members who fail exclusivity, mark queue `promoted`
  - `public.sweep_island_ecc_reminders(p_now timestamptz) returns integer` invoked at the end of `sweep_operational_deadlines` (or granted and called from the same job)
  - Table `public.operational_island_ecc_week_ops (session_date date primary key, collector_finalize_reminder_sent_at timestamptz, collector_finalize_nudge_sent_at timestamptz)`
  - Column `operational_bookings.island_ecc_payment_reminder_sent_at timestamptz`
  - Update future unpaid Island ECC reserved rows’ `pay_deadline_at` with `island_ecc_next_pay_deadline(session_date, now())` where `session_date >= (now() at time zone 'Asia/Hong_Kong')::date`

- [ ] **Step 1: Add failing SQL asserts in `island_ecc_windows_integration.sql`**

Fixture two Island ECC sessions on a Saturday whose Monday 18:00 is in the future:

- reserve before open → exception matching `HYROX sign-up opens Monday at 6 PM HKT.`
- `set_config` / call with `p_now` after Monday 18:00 → reserve ok; `pay_deadline_at` equals Thursday 18:00 at `Asia/Hong_Kong`
- second slot reserve → `Choose one Island ECC HYROX slot per Saturday.`
- unmarked original + waitlist; `sweep_operational_deadlines(thursday 18:00 + 1s)` → original `expired`, waitlist member has `reserved` with Friday 21:00 pay-by
- marked-unconfirmed original does not expire
- `sweep_island_ecc_reminders(friday 18:00)` inserts one member kind `operational_island_ecc_payment_reminder` and one collector `operational_island_ecc_collector_finalize_reminder`
- repeat sweep → same counts
- opted-out `hyrox_payment_reminders` → no member reminder
- `sweep_island_ecc_reminders(friday 21:00)` with both `gym_confirmed_at` null → one `operational_island_ecc_collector_finalize_nudge`; if both gym-confirmed, zero nudges
- BFT/Midtown reserve still rejected by retirement (`Session not found.` / retired path)

- [ ] **Step 2: Run the SQL harness (or a dry compile)**

Expected: FAIL — migration missing.

- [ ] **Step 3: Write `20261002000001_island_ecc_signup_windows.sql`**

Wrap existing `reserve_operational_session` / `join_operational_queue` (they already delegate to legacy after exclusivity). Add the Monday lock **before** the exclusivity block. Stamp Island ECC `pay_deadline_at` in the legacy insert path via a small `private.island_ecc_apply_pay_deadline` used only when `operational_is_island_ecc_hyrox_activity`. Do not change non–Island ECC deadline stamping.

Collector identity: same `collector_assignments` lookup as `send_hyrox_collector_payment_reminder` (latest `week_start <= session_date`). Those pool reminder functions stay revoked; do not grant them again.

Grant `sweep_operational_deadlines` / `sweep_island_ecc_reminders` to `authenticated` like the current deadline job.

- [ ] **Step 4: Add smoke markers** that the new migration contains `HYROX sign-up opens Monday at 6 PM HKT.`, `operational_island_ecc_payment_reminder`, `operational_island_ecc_week_ops`, `at time zone 'Asia/Hong_Kong'`.

- [ ] **Step 5: Run `node app/smoke.mjs` and the SQL integration harness**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261002000001_island_ecc_signup_windows.sql supabase/tests/island_ecc_windows_integration.sql supabase/tests/verify_operational_backend.sh app/smoke.mjs
git commit -m "feat(hyrox): enforce Island ECC Monday lock and Friday reminders in Supabase"
```

---

### Task 5: Notification maps, retirement boundary, runbook

**Files:**
- Modify: `app/js/data.js` (`NOTIFICATION_DESTINATIONS`, `WEB_PUSH_OPS_KINDS`, `notificationCategory` map if kinds need a category)
- Modify: `app/js/hyrox-retirement.js` — **do not** add the three new kinds to `RETIRED_POOL_NOTIFICATION_KINDS`
- Modify: `app/hyrox-retirement-smoke.mjs` (assert the three kinds are **not** retired)
- Modify: `supabase/migrations/20261002000001_island_ecc_signup_windows.sql` (or the same file from Task 4 if still open) to extend `operational_notification_destination` / community CASE for the three kinds: member → `#/pay/{id}` already on the row; collector kinds default `#/admin/payments`
- Modify: `docs/runbooks/operational-backend.md` and `docs/runbooks/live-auth.md` current HYROX timeline bullets only (do not rewrite historical specs)

**Interfaces:**
- Consumes: kinds from Task 2/4
- Produces: visible in-app notifications and web-push allowlist entries for the three kinds

- [ ] **Step 1: Failing retirement-smoke assert** that `isRetiredHyroxNotification({ kind: "operational_island_ecc_payment_reminder" }) === false`

- [ ] **Step 2: Run `node app/hyrox-retirement-smoke.mjs`**

Expected: FAIL or missing kind coverage.

- [ ] **Step 3: Add destinations and `WEB_PUSH_OPS_KINDS` entries.** Member destination stays the inserted `#/pay/{bookingId}`. Collector kinds `#/admin/payments`.

- [ ] **Step 4: Run `node app/smoke.mjs`, `node app/hyrox-retirement-smoke.mjs`, and `git diff --check`**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/data.js app/js/hyrox-retirement.js app/hyrox-retirement-smoke.mjs docs/runbooks/operational-backend.md docs/runbooks/live-auth.md supabase/migrations/20261002000001_island_ecc_signup_windows.sql
git commit -m "feat(hyrox): route Island ECC window notifications outside the retired pool filter"
```

---

After merge to `main`, fast-forward `testing` only with `git merge --ff-only origin/main` as in the spec. That is not part of this feature branch.
