# Workflow Modules, Compatibility Facade, and Route Performance

**Date:** 2026-09-22
**Branch:** `main`
**Status:** Design approved in chat; awaiting written-spec review

## Problem

The browser currently treats the first route and each live-mode tab change as a
full operations load.

On first load, `boot()` waits for identity, application data, approved-avatar
synchronization, operational session provisioning, HYROX deadline sweeping, and
the operational cache before committing the first route. The cache reads
sessions, bookings, queues, receipts, collector data, templates, venue
overrides, RSVP counts, HYROX cycles, and queues as one unit. On tab changes,
the hash handler waits for identity and an application read before rendering.

This creates visible loading on the Home/sign-in landing path and between
unrelated tabs. It also creates a broad failure domain: an operations or
profile-adjacent failure can delay a public route that does not need that data.

The current modules have weak locality:

- `store.js` combines local persistence/migrations with Membership, Giving,
  HYROX, RSVP, attendance, Prayer, notifications, and Supabase delegation.
- `operations.js` combines every operational read, cache, Realtime subscription
  and mutation adapter.
- `app.js` owns routing plus a large cross-domain action switch.
- `views.js` has direct operational reads, bypassing the Store seam.

## Goals

1. Render Home and Account/sign-in as soon as their own data is ready.
2. Keep related workflow behaviour and persistence together while isolating
   unrelated workflows.
3. Preserve existing routes, local-mode behaviour, Supabase tables/RPCs,
   localStorage migrations, and smoke-test behaviour while migrating.
4. Make a workflow failure local to the route or action that needs it.
5. Reduce each live read to the data required by the active route.
6. Retain one Supabase project and existing relational integrity; this design
   changes browser modules and read ownership, not the database into separate
   products.

## Non-goals

- A framework, bundler, package dependency, or production backend rewrite.
- Rewriting historical Supabase migrations or localStorage snapshots.
- Changing confirmed product behaviour while restructuring.
- Introducing real payment processing.
- Moving Shop work onto `main`.

## Module map and ownership

### Platform modules

| Module | Owns | Does not own |
| --- | --- | --- |
| Session | OAuth/local sign-in, session restoration, sign-out, auth subscription, cached viewer, last-route recovery | application/profile fields, operational hydration |
| Route loader | route-to-read-model orchestration, loading/error/retry states, cancellation of stale route work | business rules or direct Supabase calls |
| Notifications | inbox read state and typed notification delivery interface | domain decisions that create notifications |
| Documents, ICS, map/venue helpers | pure document, export and presentation behaviour | workflow persistence |
| Payment transfer support | PayMe/FPS destination formatting and collector payout display | HYROX booking state or Giving gifts |

### Workflow modules

| Module | Owns its records, commands and read models |
| --- | --- |
| Membership | application, approval, profile, indemnity, privacy, donor ID and avatar |
| Home | greeting, visitor/pending/member Home projection, weekly verse, application-resume prompt and preview composition |
| Schedule | week/day/filter state; public/member schedule-window projection; chronological grouping and display state |
| HYROX | weekly pool registration, capacity, waitlist, payment claim/reconciliation, receipts, allocation, venue switching, replacement, attendance, cancellation outcome and Admin operational read models |
| Events/RSVP | dated free/RSVP occurrences, RSVP lifecycle, venue overrides, cancellation/reopen and Admin event read models |
| Giving | campaign, donor identity, gift, reconciliation, receipt/history and Admin campaign read models |
| Prayer | private prayer requests and member/leader actions |

Home and Schedule are read-model modules. They do not own bookings, payment,
HYROX allocation or Supabase mutations. Home composes Session, Membership and a
small schedule preview. Schedule composes Event/RSVP and HYROX display rows for
its visible window.

HYROX owns the full BFT/Midtown weekly workflow and related database relations:
cycle, pool booking, payment state, receipt, allocation, switch queue,
replacement, attendance and cancellation/credit outcome. Quarry Bay remains a
related but separately booked HYROX flow. Membership approval and indemnity are
preconditions supplied by Membership; they are not copied into HYROX.

Giving owns its campaign, donor/profile relationship, gift, reconciliation and
receipt/history. It must never use HYROX booking cache or tables as a shortcut.

## Interfaces and adapters

Each workflow presents one small interface to route loaders and views. Its
implementation may use private selectors and multiple queries internally.

Examples:

```js
session.restore()
session.viewer()
home.load({ viewer, date })
schedule.loadWindow({ startDate, days, viewer })
hyrox.getCycle(cycleId, viewer)
hyrox.reserve({ cycleId, preference, fallbackAcknowledged })
hyrox.recordAttendance({ bookingId, arrived })
giving.loadMemberState({ viewer })
```

Every persistence-owning workflow has two adapters:

- a local adapter for the prototype's versioned localStorage state;
- a Supabase adapter for live reads and scoped RPC mutations.

This is a real seam because both adapters are required. Route loaders and views
consume only the workflow interface. They do not import `supabase`,
`operations.js`, or localStorage-backed state.

During migration, `store.js` remains a compatibility facade. Existing callers
continue using their current Store functions while those functions delegate to
the new workflow modules. No route, template, persisted-state shape or RPC name
changes solely because an implementation moves.

## Route performance design

### First route

1. Load local state synchronously.
2. Restore the minimal session/viewer state only.
3. Commit the selected Home or Account route once its own projection is ready.
4. Start non-critical work after route commit. Operational provisioning,
   HYROX deadline sweeping, avatar synchronization, and unrelated workflow
   prefetches cannot block public Home or Account.
5. Show a route-local loading state only where live data is genuinely required.

The Home visitor projection must require only public schedule-preview data.
The Account visitor/sign-in projection must require no operational data. A
member Home projection requests only that member's upcoming rows, not global
receipts, queues, collector data, or Admin rosters.

### Tab changes

- Do not re-fetch the application on every hash change. Session/Membership
  caches the resolved application and invalidates it only after an application
  or profile mutation, sign-in/sign-out, or an explicit refresh.
- Cache the current avatar independently and refresh it after avatar changes;
  do not await it for every route commit.
- Schedule loads only its selected date window and the viewer-specific booking
  display state needed for that window.
- HYROX, Giving, Prayer, Payments and Admin data load on entry to their own
  routes. Their route loaders own a retry card and preserve the last committed
  route while a newer load is pending.
- Notification badge reads remain detached from ordinary route rendering.

### Operations and Realtime

Replace the global operational cache with workflow-scoped caches. A workflow
loads and refreshes only the tables/RPC results in its interface. For example:

- Schedule: dated session/cycle display rows for the visible range.
- HYROX: the selected cycle, viewer booking, or Admin cycle roster as needed.
- Payments/Admin: payment claims and collector data only for the active Admin
  route.
- Giving: active campaign and viewer gift history only on Giving routes.

Realtime subscriptions are scoped to the loaded workflow. A HYROX attendance
update may refresh the HYROX/Admin roster but must not trigger a global refresh
of Giving, Prayer, Home or Account.

Longer-term operational jobs such as ensuring session windows and sweeping
HYROX deadlines should run on a server-side schedule. Until then they can run
best-effort after the relevant route has committed and must expose their own
failure state without preventing rendering.

### External and asset loading

The Supabase ESM import is an additional initial-network dependency. Keep its
loading isolated from the rendering of local/public shell content, and measure
its timing separately. Do not replace Supabase authentication with ad-hoc
browser fetches. Defer non-critical images, use explicit image dimensions, and
prioritize only the small visible header asset; this is a secondary improvement,
not the fix for tab-change latency.

## Failure containment

- A route loader catches workflow failures and returns a route-local error card
  with Retry. It does not throw through boot or leave the whole shell blank.
- Mutation commands preserve the current UI until authoritative success, then
  refresh only their workflow cache. A successful mutation followed by a refresh
  failure reports a recoverable stale-data state rather than reporting the
  mutation as failed.
- Every live workflow command normalizes known server errors at its own seam.
  Broad message matching in the global operations module is retired gradually.
- Stale route generations cannot commit after a newer navigation.
- `bootPromise` must surface an error card rather than rethrow an unhandled
  route-render error after it has reported a toast.

## Delivery sequence

1. **Baseline and instrumentation**
   - Preserve and run local and live smoke suites.
   - Add testable timing marks around shell start, viewer readiness, first route
     commit, route load and workflow data readiness. Measurements are diagnostic
     only and do not send personal data.

2. **Session/startup and Home/Schedule read path**
   - Extract Session cache and invalidation rules behind the Store facade.
   - Extract Schedule window and Home preview read models behind the facade.
   - Render Home/Account before background operational work.
   - Add route-local Schedule loading/retry states.
   - Do not change database schema, HYROX mutations, Giving or Admin in this
     stage.

3. **HYROX workflow**
   - Move cycle, booking, payment, allocation, replacement and attendance
     selectors/commands behind one HYROX interface.
   - Keep existing Supabase relations and atomic RPCs. Add only forward
     migrations if a missing invariant is discovered.
   - Replace the global HYROX portion of operational hydration with scoped
     HYROX cache/subscription reads.

4. **Giving, Events/RSVP, Prayer and Admin composition**
   - Move each workflow independently behind the same compatibility facade.
   - Make Admin read models compose workflow interfaces rather than query
     shared/global cache directly.

5. **Retire compatibility implementation**
   - Delete a delegated legacy path only after all callers and tests cross the
     replacement module interface. Keep localStorage migrations and public Store
     compatibility only as long as callers require them.

Each stage is independently deployable. Stop at the first failing smoke, live
smoke or route-equivalence check; do not combine a performance change with a
product-policy change.

## Testing and acceptance criteria

- Existing `node app/smoke.mjs` and `node app/live-auth-smoke.mjs` pass after
  every stage.
- New workflow-interface tests use local and Supabase-fake adapters, asserting
  observable output and commands rather than implementation details.
- Home visitor and Account visitor routes commit without waiting for HYROX,
  Giving, Admin, attendance, collector or receipt reads.
- Switching Home, Schedule, Community and Account does not issue an application
  query when the cached application remains valid.
- A forced HYROX/Giving/Prayer failure leaves other tabs usable and renders a
  retry state only in the failing workflow route.
- Schedule uses only visible-window rows and does not import Supabase or the
  HYROX adapter from `views.js`.
- HYROX attendance, replacement, payment and allocation behaviours remain
  covered by local and live smoke tests.
- Browser timing marks demonstrate a materially earlier first-route commit and
  no blocking operational hydration on ordinary tab navigation.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Compatibility facade changes behaviour | Delegate one workflow at a time and compare existing route/smoke outcomes before removing a path. |
| Local/live parity drifts | Test both adapters through the same workflow interface. |
| Database integrity weakens during extraction | Keep all existing Supabase RPCs and constraints authoritative; move browser callers, not transactional database rules. |
| Stale cache shows incorrect payment/attendance state | Invalidate after successful mutation, use scoped Realtime refresh, and display an explicit recoverable stale-data state on refresh failure. |
| A background job changes a route after navigation | Preserve generation ownership and only commit route-owned results. |
| Scope becomes a rewrite | Stages 1 and 2 are additive and schema-free; later stages require separate approval before implementation. |
