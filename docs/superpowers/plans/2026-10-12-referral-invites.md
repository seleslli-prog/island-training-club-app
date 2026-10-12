# Referral Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let approved members refer new applicants through single-use links, with a maximum of 3 accepted referrals per Hong Kong calendar month.

**Architecture:** A pure policy module owns quota, expiry, and eligibility decisions. `store.js` remains the only local persistence seam and mirrors Supabase RPCs in live mode. Views and the router stay presentational; Admin approval behavior does not change.

**Tech Stack:** Vanilla ES modules, localStorage, Supabase SQL RPCs, Node smoke tests.

**Spec:** `docs/superpowers/specs/2026-10-12-referral-invites-design.md`

## Global Constraints

- Approved Members, Admins, and Super Admins may create invites; visitors and pending applicants cannot.
- Entry point is Profile → Refer a Friend; the sub-page heading is title-cased `Refer a Friend`.
- Maximum 3 accepted referrals per referrer per Asia/Hong_Kong calendar month.
- Maximum 3 active pending invites per referrer.
- Invites are single-use, expire after 7 days, and count only after explicit `Accept invitation`.
- An accepted referral stays consumed if the application is abandoned or declined.
- A profile created before the invite, or any profile with an application, cannot accept. A pending profile created from the invite flow with no application can accept.
- The invite page shows only the referrer's preferred name.
- Acceptance enters the normal application and Admin approval flow.
- Admin queue copy is `Referred by [preferred name]` plus the acceptance date.
- Pending expired and cancelled records are deleted after 30 days; accepted records are retained.
- No rewards, payments, referral codes, public photos, contact details, or manual quota changes.
- Bump local state from v23 to v24 with an additive migration.

## Review Focus

- A pending profile created before the invite must be rejected even without an application; a profile created after the invite must be able to accept.
- An acceptance at 00:00 Asia/Hong_Kong on the first of the month counts in the new month, not the previous UTC month.
- Two people accepting one token must produce exactly one accepted invite and one consumed slot.
- A referrer with 2 accepted referrals and 3 pending invites cannot create another invite.
- An abandoned applicant keeps the consumed slot and can resume the same application without a new invite.

---

### Task 1: Referral policy

**Files:**
- Create: `app/js/referral-policy.js`
- Test: `app/referral-smoke.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `REFERRAL_MONTHLY_LIMIT = 3`
  - `REFERRAL_ACTIVE_LIMIT = 3`
  - `REFERRAL_INVITE_TTL_MS = 604800000`
  - `REFERRAL_RETENTION_MS = 2592000000`
  - `hongKongMonthKey(now: number | Date): string`
  - `referralQuota({ invites, referrerId, now }): { acceptedCount: number, activeCount: number, canCreate: boolean, reason: string | null }`
  - `referralAcceptanceProblem({ invite, invitee, hasApplication, now }): string | null`

- [ ] **Step 1: Write the failing policy tests**

Create `app/referral-smoke.mjs` with a localStorage shim, then assert:

- `hongKongMonthKey(Date.parse("2026-09-30T16:00:00.000Z")) === "2026-10"`
- `hongKongMonthKey(Date.parse("2026-09-30T15:59:59.000Z")) === "2026-09"`
- quota reason is `You have used all 3 referrals this month.` at 3 same-month acceptances
- quota reason is `You already have 3 active invites.` with 2 acceptances and 3 pending invites
- acceptance rejects `profileCreatedAt < invite.createdAt` with `You already have an ITC account or application.`
- acceptance allows a pending invitee created after the invite with `hasApplication: false`
- acceptance rejects `hasApplication: true`, self-acceptance, expired invites, and a second invitee for an accepted token

- [ ] **Step 2: Run the policy tests**

Run: `node app/referral-smoke.mjs`

Expected: FAIL because `app/js/referral-policy.js` does not exist.

- [ ] **Step 3: Implement the policy module**

Use `Asia/Hong_Kong` year and month formatting. Count only `accepted` invites whose `acceptedAt` falls in the current Hong Kong month. Count `pending` invites with `expiresAt > now` as active. Return the monthly reason before the active-invite reason.

- [ ] **Step 4: Re-run the policy tests**

Run: `node app/referral-smoke.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/referral-policy.js app/referral-smoke.mjs
git commit -m "test: define referral quota policy"
```

### Task 2: Local invite lifecycle

**Files:**
- Modify: `app/js/store.js`
- Test: `app/referral-smoke.mjs`

**Interfaces:**
- Consumes: Task 1 policy exports
- Produces:
  - `STATE_VERSION = 24`
  - `createReferralInvite(now = Date.now()): Promise<ReferralInvite & { inviteToken: string }>`
  - `cancelReferralInvite(inviteId: string, now = Date.now()): Promise<ReferralInvite>`
  - `sweepReferralInvites(now = Date.now()): void`
  - `referralInvitesForCurrentUser(now = Date.now()): ReferralInvite[]`
  - Referral record fields: `id`, `referrerId`, `tokenHash`, `inviteToken`, `status`, `createdAt`, `expiresAt`, `inviteeId`, `acceptedAt`, `applicationId`

- [ ] **Step 1: Add failing lifecycle tests**

Assert a v23 snapshot migrates to v24 with `referralInvites: []` and retains its users. Assert an approved member can create an invite expiring exactly 7 days later, cannot create a fourth active invite, can cancel only their own pending invite, and that pending/cancelled records disappear 30 days after expiry or cancellation.

- [ ] **Step 2: Run the lifecycle tests**

Run: `node app/referral-smoke.mjs`

Expected: FAIL because the store functions do not exist.

- [ ] **Step 3: Implement local persistence**

Add the v24 migration and store only the SHA-256 token hash plus the raw token on the returned object. Enforce role and quota through `referralQuota`. Sweep before create, cancel, and list.

- [ ] **Step 4: Re-run the lifecycle tests**

Run: `node app/referral-smoke.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/store.js app/referral-smoke.mjs
git commit -m "feat: store local referral invites"
```

### Task 3: Local acceptance and application resume

**Files:**
- Modify: `app/js/store.js`
- Test: `app/referral-smoke.mjs`

**Interfaces:**
- Consumes: Task 2 referral records
- Produces:
  - `startReferralAccount({ fullName, preferredName, email, now }): { ok: true, user } | { ok: false, reason: "duplicate" }`
  - `acceptReferralInvite(token: string, now = Date.now()): Promise<ReferralInvite>`
  - `referralInvitePreview(token: string): { referrerPreferredName: string, status: string, expiresAt: number }`
  - `referralForApplicant(userId: string): ReferralInvite | null`
  - `applyForMembership(form)` updates the accepted invitee's existing pending user instead of creating a second user

- [ ] **Step 1: Add failing acceptance tests**

Cover the Review Focus cases: pre-existing local profile rejection, post-invite account acceptance, one token accepted by only one invitee, abandoned application still counting, and the same applicant resuming through `applyForMembership` without another invite. Assert decline also leaves the accepted record consumed.

- [ ] **Step 2: Run the acceptance tests**

Run: `node app/referral-smoke.mjs`

Expected: FAIL because acceptance and account-start functions do not exist.

- [ ] **Step 3: Implement acceptance**

`startReferralAccount` creates a pending user with `appliedAt: null`. Acceptance checks `referralAcceptanceProblem`, then sets `accepted`, `inviteeId`, and `acceptedAt`. `applyForMembership` fills that user and sets `applicationId` to the user ID. A duplicate email or second acceptance throws the policy error.

- [ ] **Step 4: Re-run the acceptance tests**

Run: `node app/referral-smoke.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/store.js app/referral-smoke.mjs
git commit -m "feat: accept local referral invites"
```

### Task 4: Member routes and screens

**Files:**
- Modify: `app/js/app.js`
- Modify: `app/js/views.js`
- Modify: `app/js/store.js`
- Test: `app/referral-smoke.mjs`

**Interfaces:**
- Consumes: Task 3 store functions
- Produces:
  - `#/account/referrals`
  - `#/referral/<token>`
  - actions `referral-create`, `referral-cancel`, `referral-accept`
  - `viewAccount("referrals")`
  - `viewReferralInvite(token)`

- [ ] **Step 1: Add failing render tests**

Render the approved Profile and assert the row `Refer a Friend` links to `#/account/referrals`. Render the sub-page and assert `Refer a Friend`, `2 of 3 referrals used this month`, `1 of 3 active invites`, and disabled copy at either limit. Render `#/referral/<token>` signed in and assert `Invited by Ada.` and `Accept invitation`. Render it signed out and assert no acceptance occurred and no quota changed. Assert pending applicants do not see the creation row.

- [ ] **Step 2: Run the render tests**

Run: `node app/referral-smoke.mjs`

Expected: FAIL because the route and views do not exist.

- [ ] **Step 3: Implement the screens**

Add `referrals` to the account route allowlist and `referral` to account navigation. The sub-page lists active links with expiry and copy controls, plus accepted, expired, and cancelled history. The signed-out invite route shows the referrer's preferred name and a sign-in action, but it must not call acceptance. After sign-in, acceptance routes to `#/apply`.

- [ ] **Step 4: Re-run the render tests**

Run: `node app/referral-smoke.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/app.js app/js/views.js app/js/store.js app/referral-smoke.mjs
git commit -m "feat: add referral invite screens"
```

### Task 5: Admin referral context

**Files:**
- Modify: `app/js/views.js`
- Modify: `app/js/store.js`
- Test: `app/referral-smoke.mjs`

**Interfaces:**
- Consumes: `referralForApplicant(userId)`
- Produces: approval cards containing `Referred by Ada` and `Accepted 2 Oct`

- [ ] **Step 1: Add the failing Admin assertion**

Create an accepted referral, submit the normal application, render Admin Members, and assert the ready card contains `Referred by Ada` and the Hong Kong acceptance date. Assert an unreferred applicant has no referral line and approval still uses the existing approve/decline actions.

- [ ] **Step 2: Run the Admin test**

Run: `node app/referral-smoke.mjs`

Expected: FAIL because approval cards do not render referral context.

- [ ] **Step 3: Add referral context to approval data and cards**

Attach `referrerPreferredName` and `referralAcceptedAt` in local approval reads. Render those fields only when present. Do not add quota controls or change decision handlers.

- [ ] **Step 4: Re-run the Admin test**

Run: `node app/referral-smoke.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/views.js app/js/store.js app/referral-smoke.mjs
git commit -m "feat: show referral context in approvals"
```

### Task 6: Supabase referral workflow

**Files:**
- Create: `supabase/migrations/20261012000001_referral_invites.sql`
- Create: `supabase/tests/referral_invites_integration.sql`
- Modify: `docs/runbooks/live-auth.md`
- Test: `app/referral-smoke.mjs`

**Interfaces:**
- Consumes: Task 1 rules
- Produces RPCs:
  - `create_referral_invite(p_token_hash text, p_expires_at timestamptz) returns jsonb`
  - `get_referral_invite(p_token_hash text) returns jsonb`
  - `accept_referral_invite(p_token_hash text) returns jsonb`
  - `cancel_referral_invite(p_invite_id uuid) returns jsonb`
  - `list_my_referral_invites() returns jsonb`
  - `list_referral_context_for_admin() returns jsonb`
  - `sweep_referral_invites(p_now timestamptz) returns integer`

- [ ] **Step 1: Add source-contract tests**

Assert the migration defines `referral_invites`, stores `token_hash` uniquely, revokes direct browser writes, and grants execute only to `authenticated`. Assert acceptance checks role `pending`, no application row, `profiles.created_at >= referral_invites.created_at`, and one active token. Assert the runbook lists this migration after the current latest migration.

- [ ] **Step 2: Run the source-contract tests**

Run: `node app/referral-smoke.mjs`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Add the migration, SQL integration test, and runbook entry**

The table uses referrer, token hash, status, expiry, invitee, acceptance, and application references. RPCs enforce every Global Constraint atomically. The SQL test covers the concurrent token, month boundary, active-invite cap, and cleanup rules. The runbook adds the migration in deployment order without deployment credentials.

- [ ] **Step 4: Re-run the source-contract tests**

Run: `node app/referral-smoke.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261012000001_referral_invites.sql supabase/tests/referral_invites_integration.sql docs/runbooks/live-auth.md app/referral-smoke.mjs
git commit -m "feat: add referral invite database workflow"
```

### Task 7: Live adapter

**Files:**
- Modify: `app/js/operations.js`
- Modify: `app/js/store.js`
- Modify: `app/live-auth-smoke.mjs`
- Test: `app/referral-smoke.mjs`, `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: Task 6 RPC names
- Produces:
  - `hashReferralToken(token: string): Promise<string>`
  - `liveCreateReferralInvite(tokenHash: string, expiresAt: number): Promise<ReferralInvite>`
  - `liveAcceptReferralInvite(tokenHash: string): Promise<ReferralInvite>`
  - `liveCancelReferralInvite(inviteId: string): Promise<ReferralInvite>`
  - `liveReferralInvite(tokenHash: string): Promise<ReferralInvite>`
  - `liveListMyReferralInvites(): Promise<ReferralInvite[]>`
  - `liveListReferralContextForAdmin(): Promise<ReferralContext[]>`

- [ ] **Step 1: Add failing live-adapter tests**

Assert live mode calls the exact RPC names and arguments, never sends the raw token, and maps `PGRST202` to `Referral setup is temporarily unavailable. Please contact ITC.` Assert Admin approval hydration uses referral context without changing the decision RPC.

- [ ] **Step 2: Run the adapter tests**

Run: `node app/referral-smoke.mjs && node app/live-auth-smoke.mjs`

Expected: FAIL because the live referral adapter does not exist.

- [ ] **Step 3: Implement the adapter**

Route live store calls through operations RPCs and keep local behavior behind `isLive()`. Hash tokens with SHA-256 before every RPC. Preserve the raw token only in the create response and an in-memory map for the current creator.

- [ ] **Step 4: Run focused tests and the full local smoke suite**

Run: `node app/referral-smoke.mjs && node app/live-auth-smoke.mjs && node app/smoke.mjs`

Expected: all three PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/operations.js app/js/store.js app/live-auth-smoke.mjs app/referral-smoke.mjs
git commit -m "feat: connect referral invites to live mode"
```
