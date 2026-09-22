# Route Performance Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Commit Home and Account routes promptly and make ordinary tab navigation independent of global operational hydration.

**Architecture:** Add a small, testable schedule-window read module and a keyed live-resource cache, then retain `store.js` as the compatibility facade for existing views and action handlers. Route startup resolves only viewer identity and the current route’s read model; provisioning, deadline sweep, avatar synchronization, and global legacy operations hydration become non-blocking best-effort work after the first route commit.

**Tech Stack:** Vanilla ES modules, browser Performance API, localStorage, Supabase JS v2, Node smoke scripts.

**Spec:** `docs/superpowers/specs/2026-09-22-workflow-modules-performance-design.md`

## Global Constraints

- Work only on `main`; do not add Shop/Giving merchandise changes.
- Keep vanilla ES modules, no build step and no npm runtime dependencies.
- Preserve all existing routes, copy, Supabase table/RPC names, historical migrations, and versioned localStorage shape.
- Keep Supabase RPCs and database constraints authoritative for all mutations.
- Do not introduce real payment processing or modify confirmed product behaviour.
- `views.js` must not import Supabase or `operations.js` for Schedule reads after this slice.
- Run `node app/smoke.mjs` and `node app/live-auth-smoke.mjs` from the `main` worktree before every commit.
- Stop implementation on the first failed test and investigate the root cause before changing another behaviour.

---

## File structure

| File | Responsibility |
| --- | --- |
| `app/js/live-resource.js` | Pure keyed asynchronous resource cache with explicit invalidation; no DOM, Supabase, localStorage, or workflow imports. |
| `app/js/schedule-workflow.js` | Schedule-window interface and local/live adapter composition; returns only visible schedule rows and viewer booking display state. |
| `app/js/operations.js` | Narrow live Schedule read adapter and its row normalization, without invoking global cache hydration. |
| `app/js/store.js` | Compatibility facade: application cache invalidation, cached avatar read, and Schedule workflow construction/export. |
| `app/js/views.js` | Home/Schedule consume the Schedule facade only; no direct `liveOps` import. |
| `app/js/app.js` | Route timing marks, non-blocking startup work, route-local Schedule error/retry state, and no unconditional application/avatar waits on ordinary navigation. |
| `app/smoke.mjs` | Local workflow and Home/Schedule regression coverage. |
| `app/live-auth-smoke.mjs` | Fake-Supabase cache, narrow Schedule read, startup ordering, and route-failure containment coverage. |

## Task 1: Add a keyed live-resource cache

**Files:**
- Create: `app/js/live-resource.js`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: a `loader(key)` function returning `Promise<T>` and an optional clock.
- Produces: `createLiveResource(loader, options)` returning `{ get(key, options?), peek(key), invalidate(key?), clear() }`.
- `get(key, { force: false })` returns the cached in-flight or resolved value until `ttlMs` expires; `force` starts one replacement load; rejected loads are not cached.

- [ ] **Step 1: Write failing cache tests in `app/live-auth-smoke.mjs`**

Add a direct ESM import and an isolated fake clock/load counter near the existing pure-module imports:

```js
import { createLiveResource } from "./js/live-resource.js";

let now = 1_000;
let calls = 0;
const resource = createLiveResource(async (key) => {
  calls += 1;
  return { key, call: calls };
}, { ttlMs: 30_000, now: () => now });

const first = await resource.get("member-1");
const second = await resource.get("member-1");
assert.equal(calls, 1, "a fresh key must load once");
assert.deepEqual(second, first, "a fresh cached value must be reused");
resource.invalidate("member-1");
const third = await resource.get("member-1");
assert.equal(calls, 2, "invalidating one key must reload only that key");
assert.notDeepEqual(third, first, "invalidated reads must return the replacement value");
```

Add a rejected-loader assertion proving that a transient failure does not poison the next retry:

```js
let failures = 0;
const flaky = createLiveResource(async () => {
  failures += 1;
  if (failures === 1) throw new Error("temporary failure");
  return "recovered";
});
await assert.rejects(() => flaky.get("only"), /temporary failure/);
assert.equal(await flaky.get("only"), "recovered");
assert.equal(failures, 2);
```

- [ ] **Step 2: Run the live smoke test and verify the missing-module failure**

Run:

```sh
cd .worktrees/main
node app/live-auth-smoke.mjs
```

Expected: failure reporting that `app/js/live-resource.js` cannot be imported.

- [ ] **Step 3: Create `app/js/live-resource.js` with the complete cache contract**

```js
export function createLiveResource(loader, { ttlMs = 30_000, now = () => Date.now() } = {}) {
  const entries = new Map();

  const valid = (entry) => entry && entry.value !== undefined && now() - entry.loadedAt < ttlMs;

  async function get(key, { force = false } = {}) {
    const entry = entries.get(key);
    if (!force && valid(entry)) return entry.value;
    if (!force && entry?.pending) return entry.pending;

    const pending = Promise.resolve()
      .then(() => loader(key))
      .then((value) => {
        entries.set(key, { value, loadedAt: now(), pending: null });
        return value;
      })
      .catch((error) => {
        if (entries.get(key)?.pending === pending) entries.delete(key);
        throw error;
      });
    entries.set(key, { value: entry?.value, loadedAt: entry?.loadedAt || 0, pending });
    return pending;
  }

  return {
    get,
    peek: (key) => valid(entries.get(key)) ? entries.get(key).value : null,
    invalidate: (key) => key === undefined ? entries.clear() : entries.delete(key),
    clear: () => entries.clear(),
  };
}
```

- [ ] **Step 4: Run the cache tests and the full live smoke suite**

Run:

```sh
cd .worktrees/main
node app/live-auth-smoke.mjs
```

Expected: PASS, including the new cache reuse, invalidation, and retry assertions.

- [ ] **Step 5: Commit the self-contained cache**

```sh
cd .worktrees/main
git add app/js/live-resource.js app/live-auth-smoke.mjs
git commit -m "feat: add keyed live resource cache"
```

## Task 2: Cache Membership application and avatar reads behind Store compatibility functions

**Files:**
- Modify: `app/js/store.js: live auth/profile/application helpers and avatar getters`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: `createLiveResource`, the existing `fetchApplicationForUser(user)`, `getOwnAvatar()`, application/profile mutation functions, and live auth transitions.
- Produces: unchanged `fetchApplicationForUser(user, options?)` and `getOwnAvatar(options?)`; add `invalidateLiveApplication(profileId?)` and `invalidateOwnAvatar()` for Store-internal callers.
- Mutation rule: successful application/profile/avatar writes invalidate their corresponding cached resource before the next read; sign-out clears both resources.

- [ ] **Step 1: Add failing application/own-avatar cache tests**

In the existing fake Supabase setup, count `applications` and avatar-table selects. Make three sequential `store.fetchApplicationForUser(authUser)` calls and assert one select occurs. Call the existing membership-details save path, then call `fetchApplicationForUser(authUser)` again and assert a second select occurs.

Use this assertion shape:

```js
const applicationReadsBefore = applicationSelectCount;
await store.fetchApplicationForUser(authUser);
await store.fetchApplicationForUser(authUser);
assert.equal(applicationSelectCount - applicationReadsBefore, 1,
  "unchanged route reads must reuse the cached application");

await store.updateMyMembershipDetails(validMembershipForm);
await store.fetchApplicationForUser(authUser);
assert.equal(applicationSelectCount - applicationReadsBefore, 2,
  "a successful membership update must invalidate cached application data");
```

Add the equivalent own-avatar assertion: two unchanged reads issue one select, while a successful avatar save or removal makes the next read issue one additional select.

- [ ] **Step 2: Run the targeted live smoke assertions and verify they fail**

Run:

```sh
cd .worktrees/main
node app/live-auth-smoke.mjs
```

Expected: failure because existing Store helpers select on every call.

- [ ] **Step 3: Implement keyed resources inside `store.js` without changing callers**

Near the existing live profile variables, construct resources keyed by profile ID and the current user ID:

```js
import { createLiveResource } from "./live-resource.js";

const liveApplications = createLiveResource(async (profileId) => {
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw error;
  return data;
});
```

Make `fetchApplicationForUser(user, { force = false } = {})` return
`liveApplications.get(user.id, { force })`. Preserve its existing null result
for local mode, missing user, and no application.

Implement `invalidateLiveApplication(profileId)` and call it immediately after
successful `saveMyApplication`, `updateMyMembershipDetails`,
`updateMyPrivacyPreferences`, acceptance writes that update application fields,
and role/session transitions that make the old viewer invalid. Apply the same
pattern to the existing avatar reader and its successful mutation paths.

Do not cache rejected responses. Do not write these live resources to
localStorage.

- [ ] **Step 4: Remove unconditional application/avatar waits from ordinary route commits**

In `app.js`, preserve application reads only for routes that render application
fields (`apply`, `account`, Admin approvals) or immediately follow a successful
Membership mutation. Replace the hashchange pre-render pair:

```js
await store.getCurrentUser();
await store.fetchApplicationForUser(store.currentUser());
```

with identity refresh only:

```js
await store.getCurrentUser();
```

Do not remove route-specific reads inside the Membership views. Replace the
unconditional post-render `await store.getOwnAvatar()` with cached `peek` data
for the current route, then request avatar refresh only after avatar mutation or
session change.

- [ ] **Step 5: Run both regression suites**

Run:

```sh
cd .worktrees/main
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: PASS. The live suite must prove no application query occurs during an
unchanged Home → Schedule → Community → Account navigation sequence.

- [ ] **Step 6: Commit application/avatar cache isolation**

```sh
cd .worktrees/main
git add app/js/store.js app/js/app.js app/live-auth-smoke.mjs
git commit -m "perf: cache route membership resources"
```

## Task 3: Add a narrow Schedule-window workflow and remove view-level operational reads

**Files:**
- Create: `app/js/schedule-workflow.js`
- Modify: `app/js/operations.js: add liveScheduleWindow(startISO, endISO, viewerId)`
- Modify: `app/js/store.js: expose scheduleWindow(startDate, days, viewer)` facade
- Modify: `app/js/views.js: viewHome and viewSchedule`
- Modify: `app/js/app.js: Home/Schedule route loading and Schedule retry action`
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: existing session row normalizers in `operations.js`, `sessionsInRange`, `store.currentUser()`, and Schedule state.
- Produces: `createScheduleWorkflow({ readLocalWindow, readLiveWindow })`, with `loadWindow({ startDate, days, viewer })` resolving `{ sessions, cycles, viewerBookings }` sorted by HKT date/time.
- Compatibility facade: `store.scheduleWindow({ startDate, days, viewer, force? })` delegates to the workflow. Views receive a prepared schedule model and never import `liveOps`.

- [ ] **Step 1: Write failing pure workflow tests**

Add a local adapter test in `app/smoke.mjs`:

```js
import { createScheduleWorkflow } from "./js/schedule-workflow.js";

const calls = [];
const workflow = createScheduleWorkflow({
  isLive: () => false,
  readLocalWindow: async ({ startISO, endISO, viewer }) => {
    calls.push({ startISO, endISO, viewerId: viewer?.id || null });
    return { sessions: [{ id: "later", dateISO: "2026-09-28", time: "19:00" },
                        { id: "first", dateISO: "2026-09-28", time: "07:00" }],
             cycles: [], viewerBookings: [] };
  },
  readLiveWindow: async () => { throw new Error("live adapter must not run"); },
});
const windowModel = await workflow.loadWindow({
  startDate: new Date("2026-09-28T00:00:00"), days: 7, viewer: { id: "member-1" },
});
assert.deepEqual(windowModel.sessions.map((row) => row.id), ["first", "later"]);
assert.equal(calls.length, 1);
```

Add a live smoke assertion that Schedule-window loading performs the bounded
session/cycle reads and does not call `hydrateOperationalState()` or query
receipts, collector payouts, replacement requests, or all historical bookings.

- [ ] **Step 2: Run both suites and verify the missing-module failure**

Run:

```sh
cd .worktrees/main
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: failure because `schedule-workflow.js` and `store.scheduleWindow()` do not exist.

- [ ] **Step 3: Create the pure Schedule workflow module**

```js
import { addDays, isoDate } from "./data.js";

export function createScheduleWorkflow({ isLive, readLocalWindow, readLiveWindow }) {
  return {
    async loadWindow({ startDate, days = 7, viewer = null }) {
      const startISO = isoDate(startDate);
      const endISO = isoDate(addDays(startDate, days - 1));
      const source = isLive() ? readLiveWindow : readLocalWindow;
      const result = await source({ startISO, endISO, viewer });
      return {
        ...result,
        sessions: [...(result.sessions || [])].sort((a, b) =>
          a.dateISO.localeCompare(b.dateISO) || String(a.time).localeCompare(String(b.time))),
      };
    },
  };
}
```

- [ ] **Step 4: Add the bounded live adapter in `operations.js`**

Implement `liveScheduleWindow(startISO, endISO, viewerId)` using only:

```js
supabase.from("operational_sessions")
  .select("*")
  .gte("session_date", startISO)
  .lte("session_date", endISO)
  .order("session_date")
  .order("start_time");

supabase.from("operational_hyrox_cycles")
  .select("*")
  .gte("session_date", startISO)
  .lte("session_date", endISO)
  .order("session_date");
```

For an approved viewer, read only bookings whose session or cycle lies within
the window, using the existing RLS-scoped booking table and normalizers. Do not
read receipts, queues, payout profiles, assignments, replacement requests, or
Admin-only data. Normalize rows with the same `buildSessionRow`,
`buildHyroxCycleRow`, and `buildBookingRow` logic used by the existing adapter.
Return an empty viewer-booking list for visitors and pending members.

- [ ] **Step 5: Add the Store facade and migrate Home/Schedule rendering**

Construct the workflow in `store.js` with two adapters:

```js
const scheduleWorkflow = createScheduleWorkflow({
  isLive,
  readLocalWindow: async ({ startISO, endISO, viewer }) => localScheduleWindow(startISO, endISO, viewer),
  readLiveWindow: async ({ startISO, endISO, viewer }) =>
    liveOps.liveScheduleWindow(startISO, endISO, viewer?.id || null),
});

export function scheduleWindow(options) {
  return scheduleWorkflow.loadWindow(options);
}
```

Refactor `viewHome(model)` and `viewSchedule(model)` to consume supplied
Schedule rows while retaining existing pure markup helpers. In `app.js`, await
only `store.scheduleWindow()` for Home’s 14-day preview and Schedule’s selected
week. Store the currently committed model with the route generation; when a
window read fails, commit a Schedule/Home-local retry panel instead of throwing
through `bootPromise`.

Add one delegated action:

```js
case "retry-schedule-window":
  await renderWithFeedback();
  break;
```

The retry panel must use `data-action="retry-schedule-window"`, preserve the
shell/navigation, and state that sessions could not be loaded.

Remove `import * as liveOps from "./operations.js"` and its direct Schedule
calls from `views.js`.

- [ ] **Step 6: Run behavior and isolation tests**

Run:

```sh
cd .worktrees/main
node app/smoke.mjs
node app/live-auth-smoke.mjs
git grep -n 'liveOps\|supabase' -- app/js/views.js
```

Expected: both suites PASS. The grep output may retain no Schedule-related
operational or Supabase import/call in `views.js`; `sessionCancellationCopy`
may be re-exported by a pure helper only if its existing tests require it.

- [ ] **Step 7: Commit the Schedule read-model slice**

```sh
cd .worktrees/main
git add app/js/schedule-workflow.js app/js/operations.js app/js/store.js app/js/views.js app/js/app.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "perf: isolate schedule window reads"
```

## Task 4: Commit the first route before non-critical operational work

**Files:**
- Modify: `app/js/app.js: boot, renderWithFeedback, route error presentation`
- Modify: `app/js/store.js: background operational warm-up entry point`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: `store.getCurrentUser()`, cached Membership readers, `store.scheduleWindow()`, existing `hydrateLiveOperations()`, `renderWithFeedback()` generation control.
- Produces: `store.warmOperationalState()` returning a promise that never rejects to its caller; first-route timing marks named `itc:shell-start`, `itc:viewer-ready`, `itc:first-route-commit`, and `itc:operations-ready`.
- Ordering invariant: first Home/Account commit occurs before `warmOperationalState()` begins; background failure must not reject `bootPromise`.

- [ ] **Step 1: Write failing startup-order and failure-containment tests**

In `app/live-auth-smoke.mjs`, stub `store.warmOperationalState` and record
calls. Import the app boot module through the existing fake DOM harness. Assert:

```js
assert.ok(events.indexOf("first-route-commit") < events.indexOf("operations-warmup"),
  "Home/Account must commit before non-critical operations warm-up begins");
```

Make the warm-up stub reject. Assert the committed Home/Account markup remains
present and the captured `bootPromise` resolves after reporting a toast/error
panel, rather than rejecting.

Assert the timing mark names are emitted in chronological order using a fake
`performance.mark` collector.

- [ ] **Step 2: Run the live smoke suite and verify the ordering failure**

Run:

```sh
cd .worktrees/main
node app/live-auth-smoke.mjs
```

Expected: failure because current `boot()` awaits operational hydration before
first render and rethrows boot failures.

- [ ] **Step 3: Implement Store warm-up as a non-throwing background operation**

Add this Store facade near `hydrateLiveOperations`:

```js
export async function warmOperationalState() {
  try {
    await hydrateLiveOperations({ ensureWindow: true });
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error };
  }
}
```

Keep direct `hydrateLiveOperations()` available for routes that require
authoritative operational data. Do not change any RPC, session-window or
HYROX-deadline logic in this task.

- [ ] **Step 4: Restructure `boot()` around first-route commit**

In `app.js`:

1. mark `itc:shell-start` before `store.load()`;
2. await only `store.getCurrentUser()` and mark `itc:viewer-ready`;
3. resolve the startup route and call `await renderWithFeedback()`;
4. mark `itc:first-route-commit` immediately after a successful route commit;
5. start `void store.warmOperationalState().then(...)` after the mark;
6. mark `itc:operations-ready` only on warm-up success; on warm-up failure,
   retain the committed route and show one non-blocking toast.

Use a defensive helper so older browsers/tests without the Performance API are
safe:

```js
function markPerformance(name) {
  try { performance?.mark?.(name); } catch {}
}
```

Replace the terminal `throw err` in `bootPromise` with an error-panel commit
that keeps the app shell usable. A route error panel must include
`data-route-error`, a Retry button with `data-action="retry-route"`, and the
message `We couldn’t load this page. Please try again.` Add the delegated retry
case to call `renderWithFeedback()`.

- [ ] **Step 5: Run full verification**

Run:

```sh
cd .worktrees/main
node app/smoke.mjs
node app/live-auth-smoke.mjs
git diff --check
```

Expected: PASS. The live suite must demonstrate first-route commit before
operational warm-up, preserved Home/Account markup after warm-up failure, and
ordered performance marks.

- [ ] **Step 6: Commit startup isolation**

```sh
cd .worktrees/main
git add app/js/app.js app/js/store.js app/live-auth-smoke.mjs
git commit -m "perf: defer operational startup work"
```

## Task 5: Verify route-level latency and prepare the deployment handoff

**Files:**
- Modify: `README.md: prototype verification guidance`
- Modify: `docs/runbooks/live-auth.md: browser verification section`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: the timing marks from Task 4 and the existing local/live smoke suites.
- Produces: a repeatable manual check that records first-route commit and verifies no application fetch occurs during ordinary tab navigation.

- [ ] **Step 1: Add a failing static/manual-check assertion**

In `app/live-auth-smoke.mjs`, assert the source includes all four timing marks
and the retry route error marker:

```js
for (const marker of [
  "itc:shell-start",
  "itc:viewer-ready",
  "itc:first-route-commit",
  "itc:operations-ready",
  "data-route-error",
]) {
  assert.ok(appSource.includes(marker), `app must expose ${marker}`);
}
```

- [ ] **Step 2: Run the assertion before documentation changes**

Run:

```sh
cd .worktrees/main
node app/live-auth-smoke.mjs
```

Expected: PASS because Task 4 created the runtime markers; this step guards
against accidental removal while documenting the release check.

- [ ] **Step 3: Document the manual performance check**

Add these exact instructions to `docs/runbooks/live-auth.md` and link them from
`README.md`:

```text
1. Open DevTools Performance and clear existing recordings.
2. Load /app/ while signed out; record the interval from navigation start to
   the itc:first-route-commit mark. Home or Account must be visible before
   itc:operations-ready.
3. Sign in with an approved test account, then switch Home → Schedule →
   Community → Account. Confirm the Network panel shows no applications query
   on unchanged navigation.
4. Block one HYROX/Schedule request. Confirm only that route shows its retry
   panel while Home and Account remain usable.
```

Do not document a numeric network threshold; compare the first-route mark to
operations-ready on the same browser/network because the prototype has no
production performance budget yet.

- [ ] **Step 4: Run final verification and inspect the staged diff**

Run:

```sh
cd .worktrees/main
node app/smoke.mjs
node app/live-auth-smoke.mjs
git diff --check
git diff -- README.md docs/runbooks/live-auth.md app/live-auth-smoke.mjs
```

Expected: both suites PASS, no whitespace errors, and documentation describes
only the implemented timing marks and failure behaviour.

- [ ] **Step 5: Commit the verification handoff**

```sh
cd .worktrees/main
git add README.md docs/runbooks/live-auth.md app/live-auth-smoke.mjs
git commit -m "docs: add route performance verification"
```

## Deferred workflow plans

This plan intentionally leaves these independent workflow extractions to their
own approved implementation plans:

- HYROX cycle, payment, allocation, replacement and attendance interface.
- Giving campaign and gift interface.
- Events/RSVP occurrence interface.
- Prayer interface.
- Admin read-model composition and scoped workflow Realtime subscriptions.

They continue using the existing Store compatibility facade until their own
plan passes local and live regression coverage.
