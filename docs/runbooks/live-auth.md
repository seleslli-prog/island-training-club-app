# Live Auth — Operational Runbook

This runbook covers the combined Testing candidate's live Supabase Auth,
identity, notifications, Giving, Admin, and approval workflows.

## Candidate ownership and surfaces

- **Supabase owns in configured live mode:** identity, roles, applications,
  notifications, private prayer requests, Giving campaigns, donor profiles,
  and the full operational workflow: activity templates, dated sessions,
  paid/RSVP bookings, queue entries, receipts, collector duty, payout profiles,
  and gym finalization. Live prayer submission, member history, Admin review,
  status changes, and withdrawal are authoritative RPC operations and never
  fall back to device rows after a live failure. Browser mutations route
  through scoped SECURITY DEFINER RPCs. Realtime
  invalidates authorized rows and identity-free RSVP totals; an assigned
  collector's foreign payout row is refreshed through its narrow RPC on
  Payment route entry and tab restore because payout-table RLS can suppress
  that Realtime event.
- **`localStorage` owns:** local-mode prototype state plus device-local
  Community interactions and application drafts. Historical and newly created
  local-mode prayer rows remain device-only compatibility data; enabling live
  mode never uploads or merges them automatically. Live payout saves may cache
  the UUID-keyed handoff details on that device only after Supabase settles;
  forced operational hydration remains authoritative.
- **Navigation:** Notification bell plus a signed-in-only Giving tab.
- **Admin tabs:** Members, Activities, Prayer Requests, Giving, and Payments.
  Dated controls appear under **Activities → Weekly Event Controls**, split
  into Free & RSVP Events and Paid Sessions. Each Admin route exposes exactly
  one active tab.
- **State compatibility:** the current local state is v24; v9 through v23
  persisted snapshots are accepted and migrated while preserving genuine
  non-pool records.

Pending and declined profiles can browse public surfaces but cannot render or
invoke Payment reservation, queue, or pay controls, and cannot use Giving
transfer controls. Signing out clears the Supabase session while leaving only
prototype-local drafts/interactions and any post-settlement payout handoff
cache on the device; authoritative live operational rows remain in Supabase.

## Static Vercel configuration

This is a **static no-build deployment**. Vercel serves `app/index.html` as
committed and **does not inject** project environment variables into its inline
script. `vercel.json` pins `framework` and `buildCommand` to `null` and
`outputDirectory` to `.` so CI's root `package.json` cannot make Vercel look
for a `public/` folder. Setting `SUPABASE_URL` or `SUPABASE_ANON_KEY` in Vercel
project settings alone has no effect on this prototype.

The actual configuration seam is the inline script in `app/index.html`:

```js
window.SUPABASE_URL = "...";
window.SUPABASE_ANON_KEY = "...";
```

Use this safe deployment process:

1. Choose the target Supabase project and apply the ordered migrations. Verify
   RLS and the pending-only profile bootstrap before connecting a public URL.
2. Obtain that project's URL and browser-safe anon/publishable key. Never put a
   `service_role` key, database password, or other secret in HTML, Git, Vercel
   output, or browser storage.
3. Edit only those two assignments in `app/index.html` with the
   **deployment-specific values**. An anon key is public by design; RLS is the
   security boundary. Do not duplicate the values in this runbook.
4. Configure every exact authentication redirect URL as described below,
   including the deployed `/app/` path.
5. Serve the candidate locally, inspect `window.SUPABASE_URL` in the browser,
   sign in to the intended project, and run the smoke suites before committing
   and deploying that exact revision.
6. After Vercel deploys, inspect the served page and repeat a sign-in check on
   the deployed origin. To switch projects, update `app/index.html`, review the
   diff for anon values only, and redeploy; changing Vercel env vars is not a
   substitute.

For localStorage-only operation, set both assignments to empty strings in a
local, uncommitted copy.

## Canonical production URL

The canonical member-facing URL is:

```text
https://island-training-club.vercel.app/
```

Attach that alias to the production Vercel project before promoting this
routing configuration. Vercel internally rewrites `/` to `app/index.html`,
while the document uses explicit `/app/` and `/assets/` URLs for static files.
It deliberately has no `<base>` element, so hash-only navigation remains on the
canonical root without reloading. The previous Vercel hostnames and exact
`/app/` document path redirect to the canonical root. Query strings must be
retained so authentication callbacks are not discarded; hash routes remain
browser-side.

## Google sign-in (Identity Services)

Google sign-in uses Google Identity Services on the current origin, then
Supabase `signInWithIdToken`. The browser must **not** open
`https://krxbvgyolxvmzgysfjkj.supabase.co/auth/v1/callback`.

Google binds the client to **hostnames**, not Git SHAs. A hashed Vercel
preview such as `island-training-club-l74iadepr-seles-labs.vercel.app` is a
different origin from the git-feature alias even when both deployments are
the same commit. Google does not accept `*.vercel.app`. If that exact host
is missing from Authorized JavaScript origins, Continue with Google toasts
`Google sign-in isn’t available on this URL.` and includes the current
origin. Test on the git-feature alias (already listed below), or add the
hashed host before using a unique preview URL.

Safari often skips GIS One Tap. In that case the app opens Google’s account
picker with `redirect_uri` on **this** origin (`/app/`), not supabase.co.

In Google Cloud Console, on the existing Web client, add these **Authorized
JavaScript origins** (no path):

- `https://islandtrainingclub.app`
- `https://island-training-club.vercel.app`
- `https://island-training-club-app-git-testing-seles-labs.vercel.app`
- `https://island-training-club-app-git-feature-hyrox-is-083ff7-seles-labs.vercel.app`
- `http://127.0.0.1:4173`

Add matching **Authorized redirect URIs** (GIS One Tap does not use them;
the Safari/OIDC fallback does):

- `https://islandtrainingclub.app/app/`
- `https://island-training-club.vercel.app/app/`
- `https://island-training-club-app-git-testing-seles-labs.vercel.app/app/`
- `https://island-training-club-app-git-feature-hyrox-is-083ff7-seles-labs.vercel.app/app/`
- `http://127.0.0.1:4173/app/`

Leave the existing Authorized redirect URI that points at Supabase’s
`/auth/v1/callback` in place. GIS does not use it. Do not rotate the client
ID or secret. Do not disable the Google provider in Supabase. Remove any
`/api/auth/callback/google` URI — this app has no Auth.js route.

The public Google client ID is `window.GOOGLE_CLIENT_ID` in `app/index.html`.
The client secret stays only in Supabase.

## Email magic-link redirect URLs

Email magic links still request the allowlisted `/app/` callback trampoline
on the current origin:

```js
new URL("/app/", window.location.origin).toString()
```

In Supabase Dashboard → Authentication → URL Configuration, set the Site URL
to `https://island-training-club.vercel.app/` and add the exact production
callback `https://islandtrainingclub.app/app/` and
`https://island-training-club.vercel.app/app/` to Redirect URLs for **email**
links. Vercel then redirects that callback to the canonical root while
preserving its query string. Preview and production domains are different
origins, so add every deployed preview URL that will be tested. A missing or
mismatched trailing `/app/` path causes a magic-link callback to return to an
unapproved URL.

For local authentication testing, also add `http://127.0.0.1:4173/app/` (and
the exact `localhost` form separately if you use it).

## Email magic links and custom SMTP

Google remains the primary sign-in button. Email magic links are the secondary
path for members without Google accounts. Supabase Auth creates and verifies
the token. Until ITC owns a domain, Gmail SMTP delivers it from the approved
interim operational account.

Interim launch configuration:

1. Enable the Email provider in Supabase Authentication settings. Leave new
   user creation enabled: the database trigger creates a `pending` profile,
   never an approved member.
2. Use sender name **Island Training Club** and sender email
   `itc.admin.ops@gmail.com`. This shared mailbox also handles approved admin
   operations, payments, and enquiries; its wider blast radius is accepted
   temporarily until ITC owns a domain.
3. Enable two-step verification on the Google account and generate a dedicated
   Google App Password labelled for Supabase SMTP. Do not use the account's
   ordinary Google password.
4. In Supabase custom SMTP settings, configure:
   - host: `smtp.gmail.com`;
   - port: `465` with SSL or `587` with STARTTLS, according to the dashboard;
   - username/sender email: `itc.admin.ops@gmail.com`;
   - password: the dedicated Google App Password;
   - sender name: `Island Training Club`.
5. Keep the App Password only in Supabase project settings. Never add it to
   `app/index.html`, Git, browser storage, client JavaScript, screenshots, or
   this runbook. Preserve Google recovery methods and backup codes separately.
6. Add the exact local, preview, and canonical production `/app/` callback
   URLs to Supabase's redirect allowlist. Magic links use the same exact
   callback path as Google.
7. Set the Email OTP expiry to exactly `900` seconds so the configured lifetime
   matches the 15-minute security statement in the branded templates. Configure
   Supabase request throttling as well. The browser already suppresses duplicate
   in-flight submissions; Gmail/Supabase limits remain the authoritative abuse
   control.
8. Use the account only for its approved low-volume operations and
   authentication. Do not use it for newsletters or bulk marketing. Monitor
   Gmail quota, throttling, bounces, and delivery failures; free Gmail SMTP is
   not a transactional-delivery guarantee.

### Branded template deployment

The email-safe Night Circuit bodies, exact subjects, and acceptance checklist
are in `supabase/email-templates/README.md`. The two templates deliberately
have different messages:

- **Confirm signup** explains that email confirmation continues an application
  and does not grant membership approval.
- **Magic Link** provides secure returning-account access without a password.

Both templates load the optimized approved logo from an immutable public GitHub
asset URL pinned in their HTML. This avoids depending on an unpromoted Vercel
build. Verify the URL returns `image/png` without authentication before pasting
the templates into Supabase. Move the asset to an ITC-owned public host when one
is available. Keep `{{ .ConfirmationURL }}` unchanged.

When ITC owns a domain, replace this interim sender with a dedicated domain
address through a transactional provider and configure SPF, DKIM, and DMARC.

The browser always responds with generic copy — **Check your inbox** on success
or a generic retry message on failure — and never says whether an address was
already registered. Phase one supports opening the link on the same device
that requested it. If a link has expired or was already used, return to Account
and request a new one. Cross-device callback behavior must be recorded during
deployment acceptance; a numeric email-code fallback is not implemented.

Before production enablement, test identity continuity against the actual
Supabase project in both directions:

1. Sign in with Google, record the `auth.users.id`, role, bookings, and receipts,
   then request a magic link for the same exact verified email. All values must
   remain attached to the original UUID.
2. Create a magic-link identity first, record its UUID, then sign in with Google
   using the same exact verified email. The UUID must remain unchanged.

A Gmail alias, `+tag`, work address, or other different address is a separate
identity. Do not normalize or merge it in browser code. If the same exact email
produces a second UUID in either acceptance test, block rollout and correct the
Supabase identity-linking/provider configuration before continuing.

Production acceptance also covers branded inbox delivery, spam placement,
expired and reused links, rate limits, and current Safari/iOS, Chrome/Android,
and desktop Chrome. Zero-cost Gmail SMTP is an interim expectation, not a
permanent availability or delivery guarantee.

Rollback is configuration-first: disable the Supabase Email provider, then
remove the email form in a follow-up deploy. Google OAuth remains available.
Do not delete identities, profiles, applications, bookings, or receipts during
rollback.

## Local development

Without Supabase configuration, local state starts empty. A membership
application creates a pending local profile that can sign in again by email.
There are no seeded identities or administrative controls in local mode.

For administrative testing, configure Supabase live mode or use the historical
`archive/demo` branch. The archive is demonstration-only and must not be used
as a production source branch.

To use live mode locally, edit `app/index.html`'s inline `<script>` block to set
`window.SUPABASE_URL` and `window.SUPABASE_ANON_KEY` to your dev Supabase
project's values. Refresh the page after changes. Manage live identities in
Supabase Admin; this cleanup does not change the schema or delete live users.

## HYROX pool retirement: backend-first deployment

Island ECC is the only active HYROX venue, with 9:15 AM and 10:30 AM Saturday
sessions. Both keep the direct paid-session reservation, waitlist, payment,
receipt, attendance, replacement, collector, and venue-confirmation behavior.
Sign-up for each Saturday opens Monday at 6 PM HKT; unpaid original holds expire
Thursday 6 PM HKT; leftover unpaid holders and the collector are reminded Friday
6 PM HKT; the collector is nudged Friday 9 PM HKT if either slot is not gym-finalized.
Retained BFT/Midtown pool test records are
hidden from browser roles, not deleted. Retirement sends no cancellation or
member notification.

Known retired HYROX deep links render `This session is no longer available.`;
unknown IDs keep the existing safe not-found behavior; neither redirects to
Island ECC.

### Post-application promotion (authoritative)

Controller-verified state on `krxbvgyolxvmzgysfjkj`, 2026-09-23: **POST-APPLICATION**. All three migrations are applied and recorded exactly once:

| Applied migration | Verified SHA-256 |
|---|---|
| `20260922000001_retire_bft_midtown_hyrox_pool.sql` | `81f66371c360d9e6aed31f4130f38df891aad4100abdbddf2aa1c0d92e7aadb8` |
| `20260922000002_harden_retired_hyrox_boundary.sql` | `1bb968bdbe435d4cad66a1fec993946c5b67692e8f1b25e53b1bde85e2edb6eb` |
| `20260922000003_reassert_retired_hyrox_pool_acls.sql` | `48a8f4b5d9dc22f8002e69b2c19b4a736ee83584527d269d7bdd1793150a0857` |

`resolve-profile-avatars` resolver v8 is already deployed with `verify_jwt = true`. `ITC_APP_ORIGINS` restoration and verification are complete; it contains exactly these two supported origins (no paths or wildcard):

- `https://island-training-club.vercel.app`
- `https://island-training-club-git-testing-island-training-club.vercel.app`

Fixture recovery completed; baseline restored. Retained sessions/cycles/bookings/receipts/notifications are **46/18/14/1/45**, with unchanged retained digests; total notifications **131**. **Testing browser acceptance PASS** (Chrome/Safari, 375px). Catalog pin `5a0ecdeb48872f4ec2aacebc1d037c14`; pool ACLs closed.

Never edit, replay, reapply, or repair `00001`, `00002`, or `00003`. Do not rerun completed recovery or acceptance fixtures, redeploy the resolver, or replace the verified origins for this promotion. Production history gaps are not permission to use `db push`, `--include-all` or history repair. Any discrepancy means STOP for separate review.

Controller evidence: `promotion-review.md` and the final **FINAL Admin-only acceptance — controller CORS repair verified** section of `task-7-step5-browser-report.md`, retained in the private task evidence. Earlier failures are superseded. This documentation update did not re-query production. No secret values or private fixture identifiers belong in promotion evidence.

### Applied pool boundary (verification only)

00003's immutable artifact has 23 statements. Its complete 18 pool-only functions are derived exactly from 00001: six retired-job revocations plus all twelve revocations in **Pool-only browser RPCs**.
This includes `ensure_hyrox_cycles(date,integer)`, `schedule_hyrox_cycle(text)`,
`sweep_hyrox_cycle_deadlines(timestamptz)`,
`send_hyrox_member_payment_reminders(timestamptz)`,
`send_hyrox_collector_payment_reminder(timestamptz)` and
`send_hyrox_venue_reminders(timestamptz)`, plus the pool reservation/queue/payment
rejection/venue/cancellation/Midtown-open RPCs listed in the operational runbook.
It closes any subset of historical re-grants to PUBLIC/anon/authenticated, with both
pool policy drops/table SELECT revocations and a final schema-cache notify.
Service/operator access and all reviewed bodies remain unchanged. Already-absent
grants are catalog no-ops; unrelated drift still means STOP.
Do not revoke shared guarded authenticated RPCs: `get_operational_attendee_names`,
`reserve_operational_session`, `mark_operational_payment`, `join_operational_queue`,
`release_operational_reservation`, `approve_operational_payment`,
`defer_operational_booking`, `set_operational_attendance`, or
`suppress_opted_out_hyrox_payment_reminder`. There is no separate
`approve_hyrox_cycle_payment` function; approval uses the shared guarded RPC.
The repaired catalog must equal pinned `5a0ecdeb48872f4ec2aacebc1d037c14`.
Unexpected findings mean STOP.

### HISTORICAL — certain-stop application/recovery (executed 2026-09-23)

**Reviewed precedent/rollback reference only; not the next operation on this target. Do not rerun completed recovery.** The one-time 00003 application/recording and separately reviewed exact-fixture recovery completed under controller authorization. The reviewed process preserved the original certain journal, required fresh hash/count-bound acknowledgement, durable lock/receipt and provenance/FK closure, and used the unchanged SERIALIZABLE exact-ID/xmin/full-row-digest compiler. Its rule was to never clear uncertainty or retry an ambiguous commit.

Organic-session normalization required exact baseline equality after subtracting only verified generator additions, preserving every organic row and recording IDs in a mode-0600 receipt. The rule was to never adopt or delete unrelated rows. The non-retired generator remained active outside the locked cleanup. Definitive postcommit checks preceded journal removal. Baseline restoration and subsequent Testing cleanup are complete, not pending promotion tasks. The detailed historical sequence and separate **clean disposable database only** replay instructions remain in the [operational runbook](operational-backend.md#hyrox-pool-retirement-backend-first-deployment).

### Executable promotion sequence

1. **Verify the applied backend boundary (read-only).** Verify applied versions/hashes and backend invariants: exact catalog pin, pool ACLs closed, template/helper/notification/shared-RPC contracts, retained counts/digests and notification baseline. Use count-only evidence; retain the approved pool RPC denial and Island ECC active-RPC checks without mutating RPCs or fixture creation. The notification inventory includes retired/unmatched `hyrox_replacement_review` notices but excludes a notice proven active-ECC-only. Any mismatch blocks promotion.
2. **Verify the deployed resolver and origins (read-only).** Verify resolver v8 with `verify_jwt = true`, its approved artifact revision and exactly the two supported origins. Retain direct authenticated endpoint evidence: retired neutral 404, ECC success and classifier-failure fail-closed from the disposable replica. Do not redeploy, change secrets or inject failures in shared services.
3. **Confirm completed Testing acceptance.** Verify the reviewed preview revision and controller's Testing browser acceptance PASS, including credited browser UI and Island ECC lifecycle, final CORS and selector probes. Bind the accepted runtime artifact; any runtime change needs new review. Do not rerun completed recovery or acceptance fixtures.
4. **Promote the exact accepted snapshot.** With separate promotion authorization, promote only the accepted frontend artifact; confirm its served revision and repeat bounded read-only route/denial/configuration/count checks. Do not create fixtures or repeat lifecycle mutations.

As part of read-only verification, confirm service_role has only the session classifier among retirement helpers; the restored attendee helper denies PUBLIC/anon/authenticated/service_role and matches the exact latest `20260910000002_operational_attendee_names_rsvp.sql` body with postgres owner, stable SECURITY DEFINER and fixed search_path. Leave the guarded public wrapper unchanged. Verify notifications: anon has no privileges; authenticated has only SELECT and UPDATE(read_at), never other column UPDATE or INSERT/DELETE/TRUNCATE/TRIGGER/REFERENCES. Keep both reviewed RLS policies unchanged. Check effective ACLs without executing destructive statements. Run local paid/replacement/free RSVP roster and own-active-notification read/mark-read tests with rollback; production read-only verification must not invoke mutating RPCs or create fixtures. Global defaults and unrelated legacy/job grants are not changed by this narrow correction. Confirm all three applied versions exactly once without changing older history; the resolver is already deployed and Testing acceptance is complete.

A failed verification or missing approved evidence blocks promotion. A mismatch does not authorize reapplication, resolver redeployment or another recovery/fixture run.

### Forward-only rollback

Rollback is a **forward-only rollback**. Preserve retained rows and add a new, separately reviewed forward migration for any intentional restoration of template state, grants, policies, functions, or provisioning, followed by a compatible frontend deployment and compatible avatar Edge Function artifact in backend-first order. Preserve the fail-closed resolver while retirement remains intended; never redeploy the old service-role resolver. For intentional reopening, review all three artifacts, deploy SQL prerequisites then the compatible resolver, rerun direct endpoint gates, then accept the frontend.

Never edit or replay applied migration history. Never delete or mark down the applied retirement migration, alter historical migrations, drop retained tables, or expose the old pool UI while the retirement backend remains active. A frontend-only rollback must remain compatible with the retirement backend and keep retired entry points unavailable.

## Private prayer requests: deployment, acceptance, and rollback

Private prayer requests are Supabase-authoritative whenever live mode is
configured. The browser has no direct table access: approved members and
Admins use five narrow security-definer RPCs. Existing local-mode prayer rows
remain preserved on that device for prototype compatibility and are never
uploaded, merged, or used as a fallback automatically.

The reviewed prayer backend artifact is exactly
`supabase/migrations/20260921000001_prayer_requests.sql`. At this revision its
SHA-256 is
`131fcc13dad14af187b0f5bef458556ea2ac6520605207be47bfaf2df2b9a950`.
A declined-profile acceptance account additionally requires the forward-only
source-tip repair
`supabase/migrations/20260921000002_declined_profile_decisions.sql`, whose
SHA-256 is
`78cd8651b91e6fe6fd01a13d3d472daefed7dbdd344bd4a85f0441a84ed726f1`.
Before any deployment, recompute both digests from the reviewed checkout and
stop if either differs:

```bash
PRAYER_MIGRATION=supabase/migrations/20260921000001_prayer_requests.sql
DECISION_MIGRATION=supabase/migrations/20260921000002_declined_profile_decisions.sql
shasum -a 256 "$PRAYER_MIGRATION" "$DECISION_MIGRATION"
bash supabase/tests/prayer_requests_safety.sh
bash supabase/tests/declined_profile_decisions_safety.sh
```

The decision repair exists because production history can report historical
migration `20260805000007_admin_application_decisions.sql` as applied while its
constraint and policy end state is absent. **Never replay, edit, repair, or mark
`20260805000007_admin_application_decisions.sql` as part of this rollout.** Do
not change its source file. Apply only the new forward migration after the
prayer backend baseline is verified.

The release record must contain the reviewed Git commit, both local SHA-256
digests, the target project reference, the Supabase SQL Editor's UTC completion
timestamp, and the pass/fail result of each read-only check below. Record only
request UUIDs and timestamps during acceptance. Never put credentials, session
tokens, database URLs, request text, or screenshots containing request text in
shell output, CI logs, deployment notes, or tickets.

### Clean local migration and rollback-scoped integration gate

From the repository root, first prove that migration versions are unique and
that the current source tip is the reviewed HYROX forward correction. The
prayer and decision migrations must remain ordered before retirement and its
forward correction; a non-empty duplicate-version result or any other final
filename blocks rollout:

```bash
test -z "$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' \
  -exec basename {} \; | cut -d_ -f1 | sort | uniq -d)"
test "$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' \
  -exec basename {} \; | sort | tail -1)" = \
  "20260922000003_reassert_retired_hyrox_pool_acls.sql"
test -f supabase/migrations/20260921000001_prayer_requests.sql
test -f supabase/migrations/20260921000002_declined_profile_decisions.sql
```

Start from a clean disposable local Supabase database and replay the unmodified
source migration chain. Do not temporarily rename or renumber migrations:

```bash
supabase stop --no-backup || true
supabase start --yes \
  -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
```

The startup output must list each migration version once, apply
`20260921000001_prayer_requests.sql`, then
`20260921000002_declined_profile_decisions.sql`, then
`20260922000001_retire_bft_midtown_hyrox_pool.sql`,
`20260922000002_harden_retired_hyrox_boundary.sql`, and finally
`20260922000003_reassert_retired_hyrox_pool_acls.sql`. Run both integration files
inside the disposable database container with stop-on-error enabled:

```bash
docker cp supabase/tests/declined_profile_decisions_integration.sql \
  supabase_db_island-training-club-app:/tmp/declined_profile_decisions_integration.sql
docker exec supabase_db_island-training-club-app \
  psql -U postgres -d postgres -X -P pager=off -v ON_ERROR_STOP=1 \
  -f /tmp/declined_profile_decisions_integration.sql
docker cp supabase/tests/prayer_requests_integration.sql \
  supabase_db_island-training-club-app:/tmp/prayer_requests_integration.sql
docker exec supabase_db_island-training-club-app \
  psql -U postgres -d postgres -X -P pager=off -v ON_ERROR_STOP=1 \
  -f /tmp/prayer_requests_integration.sql
supabase stop --no-backup
```

Each integration must emit its boundary success notice, end with `ROLLBACK`,
and exit zero. They are intentionally transaction-scoped; never point them at
production, Testing, staging, a shared database, or a database containing real
users. Stopping with `--no-backup` is part of the gate so the next run cannot
inherit disposable state.

### Production drift boundary and migration evidence

The production project has known historical migration drift. **Never run
`supabase db push --include-all` for this rollout**, and do not use an
unqualified `db push`, replay the local chain, repair an older version, or mark
unverified history as applied. In particular, never replay, edit, repair, or
mark `20260805000007_admin_application_decisions.sql`; its applied-history row
is not proof of its schema end state. First compare local filenames with remote
history and confirm the linked project in the browser and CLI:

```bash
export SUPABASE_PROJECT_REF="krxbvgyolxvmzgysfjkj"
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase migration list --linked
```

Stop if the displayed project or history is unexpected. Use this exact order;
each production write requires explicit authorization:

1. **Confirm the prayer backend baseline.** Verify that reviewed migration
   `20260921000001_prayer_requests.sql` has already been applied and passes all
   prayer table, grant, signature, owner, and redaction checks below. If it is
   absent, apply it unchanged in the verified project's SQL Editor, complete
   those checks, and only then record that exact version. Do not re-execute an
   already verified migration.
2. **Apply the forward profile-decision repair.** In Supabase Dashboard →
   project `krxbvgyolxvmzgysfjkj` → SQL Editor, reconfirm the project reference,
   open reviewed local migration
   `supabase/migrations/20260921000002_declined_profile_decisions.sql`, confirm
   its SHA-256, paste the file unchanged, and execute it once. Save only the SQL
   Editor UTC completion timestamp in the deployment record.
3. **Verify the repaired decision boundary.** Run the constraint/policy catalog
   gate below before creating or changing any acceptance profile. Any mismatch
   blocks migration-history repair and declined-profile acceptance.
4. **Record only the forward repair version.** After the decision gate passes,
   mark `20260921000002` applied and immediately re-list linked history. Do not
   repair any historical version as a workaround.
5. **Create the declined acceptance fixture.** Only after both backend gates and
   linked history pass may an Admin decline a fresh submitted pending
   application for the controlled prayer acceptance matrix.

If the prayer backend itself is being applied for the first time, record it only
after its checks pass, then continue with the forward repair:

```bash
supabase migration repair 20260921000001 --status applied --linked --yes
supabase migration list --linked
```

For the production drift repair, record only the new source-tip version:

```bash
supabase migration repair 20260921000002 --status applied --linked --yes
supabase migration list --linked
```

A failed check leaves the dependent acceptance blocked and the corresponding
migration-history repair unperformed.

### Read-only schema, constraint, grant, and signature checks

After applying the forward decision repair, run this trusted read-only gate.
The first query must return one constraint row whose definition permits exactly
`pending`, `member`, `admin`, `super_admin`, and `declined`. The second must
return `admin decide pending` as
the only one of the two candidate policy names, with `cmd = UPDATE`; its
`qual` must require the authoritative Admin role and existing `pending` row.
Its `with_check` must independently repeat that authoritative Admin predicate,
reject self-target decisions, allow only `member`/`declined`, and require a
matching application whose `submitted_at` is not null:

```sql
select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'public.profiles'::regclass
   and conname = 'profiles_role_check';

select policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename = 'profiles'
   and policyname in ('admin approve pending', 'admin decide pending')
 order by policyname;
```

Also confirm that `self update non-role` and `super_admin update all` are still
present and unchanged, profile columns and rows remain present, and no broad
authenticated profile UPDATE policy or direct grant was added. Stop before
history repair or fixture creation if any condition differs. The rollback SQL
integration is the required runtime proof of ordinary-member denial, draft
application denial, terminal-row immutability, pending/member/declined/Admin
self-transition denial, Super Admin preservation, and non-role self-update.

Then run the prayer checks below in trusted SQL after applying the exact prayer
migration and before any dependent frontend deployment. The table query must
return one row with `rls_enabled = true`; the constraint query must return seven
rows, each with the expected definition:

```sql
select n.nspname as schema_name,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname = 'prayer_requests'
   and c.relkind = 'r';

with expected(constraint_name) as (
  values
    ('prayer_requests_pkey'),
    ('prayer_requests_owner_id_fkey'),
    ('prayer_requests_status_changed_by_fkey'),
    ('prayer_requests_status_check'),
    ('prayer_request_text_state'),
    ('prayer_request_closed_state'),
    ('prayer_request_withdrawn_state')
)
select e.constraint_name,
       c.contype,
       pg_get_constraintdef(c.oid) as definition,
       c.oid is not null as present
  from expected e
  left join pg_constraint c
    on c.conrelid = 'public.prayer_requests'::regclass
   and c.conname = e.constraint_name
 order by e.constraint_name;
```

The expected list contains seven constraints; every `present` value must be
`true`. Browser roles must have no direct table privilege; every value below
must be `false`:

```sql
select role_name,
       has_table_privilege(role_name, 'public.prayer_requests', 'SELECT') as can_select,
       has_table_privilege(role_name, 'public.prayer_requests', 'INSERT') as can_insert,
       has_table_privilege(role_name, 'public.prayer_requests', 'UPDATE') as can_update,
       has_table_privilege(role_name, 'public.prayer_requests', 'DELETE') as can_delete
  from (values ('anon'), ('authenticated')) roles(role_name)
 order by role_name;
```

The five public RPCs and both private role helpers must exist with exactly the
seven signatures below, be security-definer functions pinned to
`search_path=public`, and be owned by the explicitly approved trusted role.
For an unchanged SQL Editor application that role is `postgres`; the literal is
deliberate. Public RPCs must deny `anon` and allow only the authenticated
transport role, while the two private helpers must deny both browser roles.
Retain the seven result rows, require every `ok` value to be `true`, and run the
following read-only catalog gate in the same trusted SQL session:

```sql
with expected(signature, function_class, approved_owner) as (
  values
    ('public.submit_prayer_request(text,boolean)', 'public_rpc', 'postgres'),
    ('public.list_my_prayer_requests()', 'public_rpc', 'postgres'),
    ('public.set_my_prayer_request_state(uuid,text)', 'public_rpc', 'postgres'),
    ('public.list_admin_prayer_requests()', 'public_rpc', 'postgres'),
    ('public.set_admin_prayer_request_status(uuid,text)', 'public_rpc', 'postgres'),
    ('public.prayer_assert_approved()', 'private_helper', 'postgres'),
    ('public.prayer_assert_admin()', 'private_helper', 'postgres')
), checks as (
  select e.signature,
         e.function_class,
         e.approved_owner,
         p.oid is not null as function_exists,
         coalesce(p.prosecdef, false) as security_definer,
         coalesce('search_path=public' = any(p.proconfig), false) as fixed_search_path,
         pg_get_userbyid(p.proowner) as actual_owner,
         coalesce(pg_get_userbyid(p.proowner) = e.approved_owner, false) as trusted_owner,
         coalesce(has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_execute,
         coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false)
           as authenticated_execute
    from expected e
    left join pg_proc p on p.oid = to_regprocedure(e.signature)
)
select *,
       function_exists
         and security_definer
         and fixed_search_path
         and trusted_owner
         and not anon_execute
         and case
               when function_class = 'public_rpc' then authenticated_execute
               else not authenticated_execute
             end as ok
  from checks
 order by signature;

-- Fail the SQL Editor run unless the same seven-signature contract is true.
do $verification$
declare
  verified_count integer;
  failed_signatures text;
begin
  with expected(signature, function_class, approved_owner) as (
    values
      ('public.submit_prayer_request(text,boolean)', 'public_rpc', 'postgres'),
      ('public.list_my_prayer_requests()', 'public_rpc', 'postgres'),
      ('public.set_my_prayer_request_state(uuid,text)', 'public_rpc', 'postgres'),
      ('public.list_admin_prayer_requests()', 'public_rpc', 'postgres'),
      ('public.set_admin_prayer_request_status(uuid,text)', 'public_rpc', 'postgres'),
      ('public.prayer_assert_approved()', 'private_helper', 'postgres'),
      ('public.prayer_assert_admin()', 'private_helper', 'postgres')
  ), checks as (
    select e.signature,
           coalesce(
             p.oid is not null
               and p.prosecdef
               and 'search_path=public' = any(p.proconfig)
               and pg_get_userbyid(p.proowner) = e.approved_owner
               and not has_function_privilege('anon', p.oid, 'EXECUTE')
               and case
                     when e.function_class = 'public_rpc'
                       then has_function_privilege('authenticated', p.oid, 'EXECUTE')
                     else not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   end,
             false
           ) as ok
      from expected e
      left join pg_proc p on p.oid = to_regprocedure(e.signature)
  )
  select count(*) filter (where ok),
         coalesce(string_agg(signature, ', ' order by signature) filter (where not ok), '')
    into verified_count, failed_signatures
    from checks;

  if verified_count <> 7 then
    raise exception 'Prayer function trust check failed (%/7 verified): %',
      verified_count, failed_signatures;
  end if;

  raise notice 'Prayer function trust check passed (7/7; approved owner postgres).';
end
$verification$;
```

If `actual_owner` differs from `postgres`, an `ok` value is false, or the block
raises, stop the rollout before migration repair or frontend deployment. Do not
change or replace `postgres` merely to make the check pass, and do not accept
the role reported by the catalog as trusted by default. Identify how that role
acquired ownership and have the authorized database owner either transfer each
exact function signature back to `postgres`, or obtain and record explicit
security approval for a different trusted owner before changing the literal.
Then rerun the seven-row query and failing gate; all seven functions must name
the same explicitly approved owner.

Both Admin RPC result contracts must expose only the documented display label
and request fields—never `owner_id`, email, or another stable owner field. The
query must return two rows with `identity_columns_absent = true`:

```sql
with admin_functions(function_name) as (
  values
    ('list_admin_prayer_requests'),
    ('set_admin_prayer_request_status')
), outputs as (
  select p.proname,
         array_agg(p.proargnames[s.i] order by s.i) as output_columns
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join admin_functions a on a.function_name = p.proname
    cross join lateral generate_subscripts(p.proargnames, 1) s(i)
   where n.nspname = 'public'
     and p.proargmodes[s.i] in ('o', 't')
   group by p.proname
)
select proname,
       output_columns,
       not (output_columns && array['owner_id', 'email']::text[])
         and output_columns = array[
           'id', 'display_name', 'request_text', 'anonymous_to_leaders',
           'status', 'created_at', 'updated_at', 'closed_at'
         ]::text[] as identity_columns_absent
  from outputs
 order by proname;
```

Catalog inspection proves the return shape, not runtime role checks or the
anonymous display value. The rollback-scoped SQL integration and controlled
authenticated acceptance are both mandatory evidence for those behaviors.

### Backend-first rollout order

1. **Apply and verify the backend migration.** Complete the safety test, clean
   local chain, rollback-scoped integration, reviewed SQL Editor application,
   read-only checks, and exact-version history repair. Any failure blocks the
   frontend.
2. **Verify RPC grants and anonymous redaction.** Retain the read-only outputs,
   then use controlled authenticated fixtures to prove pending/declined denial,
   member ownership isolation, Admin authorization, and the anonymous display
   contract. Record only request IDs, roles, and timestamps.
3. **Deploy the Testing frontend.** Push/open a PR only after separate
   authorization, wait for the Testing Vercel deployment to succeed, verify it
   targets the migrated project, and keep the production frontend unchanged.
4. **Complete authenticated member/Admin acceptance.** Use separate approved
   member A, member B, Admin, Super Admin, pending, and declined accounts on
   current mobile Safari and Chrome. Every matrix row below must pass before
   promotion.
5. **Promote the production frontend.** Only after reviewed Testing evidence,
   open the separately authorized `main` PR, wait for production Vercel
   success, and repeat a minimal disposable request lifecycle at the canonical
   root. This heading describes the gate; it is not evidence that promotion has
   happened.

### Testing acceptance matrix

| Actor / surface | Acceptance evidence |
| --- | --- |
| Signed out, pending, declined | Public explanation only; no submission, history, Admin queue, or prayer mutation controls. |
| Approved member A | Submit identified and anonymous cases; history appears only after the RPC settles; refresh preserves authoritative rows. |
| Approved member B | Cannot list, close, or withdraw member A's request IDs; member A cannot access member B's rows. |
| Admin | Queue groups New, Prayed for, and Closed; identified cases show the member display name; anonymous cards and markup contain no owner UUID, email, or stable identifying value. |
| Admin / Super Admin | Legal status transitions succeed once; stale, repeated, unauthorized, and illegal transitions fail without a success toast or misleading state. |
| Owner lifecycle | Close an active case, withdraw active and closed cases, reload, and confirm withdrawn history has no request body and the Admin queue excludes it. |
| Failure handling | Force list, submit, member mutation, and Admin mutation failures; entered text/form state remains where applicable, no success feedback appears, and live mode never shows local prayer rows. |
| Navigation / responsive | Profile and Admin back behavior is consistent; each page has one unclipped heading at 375 px; the obsolete Schedule footer is absent; browser Back restores the expected route. |
| Browser coverage | Repeat member/Admin critical paths on current mobile Safari and Chrome, including disabled/loading states, focus order, wrapping, and no horizontal overflow. |

Use disposable acceptance copy and withdraw it when the check ends. Deployment
notes and screenshots must exclude request text, credentials, tokens, and
personal data. A request UUID and bounded UTC timestamps are sufficient to
correlate trusted read-only evidence.

### Rollback

Frontend rollback is safe before database cleanup: redeploy the last known-good
frontend (or a reviewed revision that removes Prayer member/Admin entry points)
and verify browsers no longer invoke any prayer RPC. The private table can
remain behind RLS while the incident is assessed.

For a database access rollback, **revoke the five public RPCs first** in trusted
SQL before considering any schema or data change:

```sql
begin;
revoke all on function public.submit_prayer_request(text, boolean)
  from public, anon, authenticated;
revoke all on function public.list_my_prayer_requests()
  from public, anon, authenticated;
revoke all on function public.set_my_prayer_request_state(uuid, text)
  from public, anon, authenticated;
revoke all on function public.list_admin_prayer_requests()
  from public, anon, authenticated;
revoke all on function public.set_admin_prayer_request_status(uuid, text)
  from public, anon, authenticated;
commit;
```

Confirm both browser roles can no longer execute any of the five signatures.
Preserve the table and all remaining content pending an explicitly approved
retention/export decision; do not drop it, truncate it, edit the applied
migration, or copy request content into rollback notes. Any later export or
deletion requires a separately reviewed forward migration and approved privacy
handling.

**Withdrawal clears request text** atomically, clears `closed_at`, records
`withdrawn_at`, remains visible only as redacted member history, and disappears
from Admin output. A frontend rollback must not imply that older unwithdrawn
content was erased; preserve it under revoked access until retention is decided.
After rollback, rerun the smoke, prayer safety, and clean disposable integration
suites and record only command results, revision IDs, request UUIDs, and
timestamps.

## Free-event RSVP cancellation: deployment and acceptance

Migration `20260920000001_free_event_rsvp_cancellation.sql` makes `wnt`, `run`,
and `water` authoritative recurring free sessions in live mode. It also makes
zero-price one-offs explicit uncapped RSVP sessions and adds RSVP-aware
cancellation, reopening, and targeted change notifications. RSVP remains
optional: these events have no payment, checkout, capacity, waitlist, or
attendance gate, and walk-ins remain welcome.

Approved members may use **I’m coming**, **Can’t make it**, and the member-only
**Who’s coming** roster with existing private avatar rules. Visitors and
pending/declined profiles may see public event and cancellation information but
not attendee identities or participation controls. Admin and Super Admin see
the expected count and can change venue/time, cancel one dated occurrence with
a required reason, or reopen it before its Hong Kong start. Active RSVPs are
cancelled and never deferred. Reopening does not restore cancelled RSVPs;
members must choose **I’m coming** again.

Cancellation, reopening, venue, and time notifications are in-app only. Web
Push, push subscriptions, service workers, phone notification sounds, email,
and SMS are deferred. This feature does not require a new Edge Function
deployment. Keep the exact Testing frontend origin in the existing
`ITC_APP_ORIGINS` allowlist where profile-photo functions are exercised; do not
replace it with a wildcard.

### Required disposable integration gate

Before any production change, the reset-safe disposable SQL integration is a
**required release gate**. Run it only when both
`ITC_FREE_EVENT_TEST_DATABASE_URL` is an explicitly disposable, empty,
reset-safe URL and `ITC_ALLOW_DATABASE_RESET=1` is present. The operational
wrapper checks the target before applying the ordered migration chain; the
focused integration then runs transactional RSVP, withdrawal, cancel, reopen,
venue/time notification, role, grant, and no-deferral assertions and rolls its
fixtures back:

```bash
ITC_OPERATIONS_TEST_DATABASE_URL="$ITC_FREE_EVENT_TEST_DATABASE_URL" \
ITC_ALLOW_DATABASE_RESET="$ITC_ALLOW_DATABASE_RESET" \
  bash supabase/tests/verify_operational_backend.sh

psql "$ITC_FREE_EVENT_TEST_DATABASE_URL" -X -P pager=off \
  -v ON_ERROR_STOP=1 \
  -f supabase/tests/free_event_rsvp_cancellation_integration.sql
```

Never connect either command to production, staging, a shared database, or a
database containing user/application data. If either required variable is
absent, do not connect: record this gate as **unexecuted** and block the release.
It is not optional and must never be reported as passing without its output.

Before live acceptance, also run the static and headless regression suites from
the repository root:

```bash
node app/avatar-smoke.mjs
node app/smoke.mjs
node app/live-auth-smoke.mjs
node app/replacement-operations-smoke.mjs
node app/rsvp-whos-coming-smoke.mjs
bash supabase/tests/free_event_rsvp_cancellation_safety.sh
```

### Production migration review and application

The production project has known migration-history drift. Do not use `db push`,
`--include-all`, or any command that could replay the local migration chain. Do
not mark unverified historical versions as applied. Confirm the target project,
backup/PITR status, reviewed commit, and disposable-gate evidence first.

The following command forms were checked against Supabase CLI 2.117.0 help.
Establish the project link once, verify the project shown by the link operation,
and use only the supported `--linked` form after that; do not combine
`--linked` with `--project-ref`:

```bash
export SUPABASE_PROJECT_REF="<confirmed-project-ref>"
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase migration list --linked
```

Stop if the project is wrong, the migration list is unexpected, or the remote
schema does not contain the operational backend required by this migration.
Apply **only** the reviewed contents of
`supabase/migrations/20260920000001_free_event_rsvp_cancellation.sql`, preferably
through the trusted Supabase SQL Editor. The explicitly approved alternative is
a trusted workstation with a production URL loaded ephemerally from the secret
manager:

```bash
psql "$ITC_PRODUCTION_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260920000001_free_event_rsvp_cancellation.sql
```

Never print, log, paste into shell history, or store the production database
URL; disable shell tracing and unset the variable when finished. Command success
alone is insufficient. Run every read-only production verification below. Only
when all rows and invariants pass, record this one migration version and re-list
history:

```bash
supabase migration repair --status applied 20260920000001 --linked
supabase migration list --linked
```

Do not repair any older version as part of this release. Reconcile historical
drift separately through a reviewed schema audit.

### Read-only production verification before any frontend

Run these statements in trusted SQL after applying the backend migration and
before deploying this frontend revision anywhere. They are read-only and must
not be replaced with browser-table mutations.

First verify the recurring template contract and generated occurrence window.
The first query must return exactly `wnt`, `run`, and `water`, each with
`price_hkd = 0`, `capacity is null`, `requires_rsvp = true`, and weekday
`3`, `1`, and `2` respectively:

```sql
select activity_id, weekday, start_time, price_hkd, capacity, requires_rsvp,
       active
  from public.operational_activity_templates
 where activity_id in ('wnt', 'run', 'water')
 order by activity_id;

select s.id, s.activity_id, s.session_date, s.start_time, s.price_hkd,
       s.capacity, s.cancelled_at, s.cancel_reason
  from public.operational_sessions s
 where s.activity_id in ('wnt', 'run', 'water')
   and s.session_date >= (now() at time zone 'Asia/Hong_Kong')::date
   and s.session_date < (now() at time zone 'Asia/Hong_Kong')::date + 112
 order by s.session_date, s.activity_id;

select s.activity_id, count(*) as invalid_occurrences
  from public.operational_sessions s
  join public.operational_activity_templates t using (activity_id)
 where s.activity_id in ('wnt', 'run', 'water')
   and s.session_date >= (now() at time zone 'Asia/Hong_Kong')::date
   and (extract(isodow from s.session_date)::integer <> t.weekday
        or s.price_hkd <> 0 or s.capacity is not null
        or not t.requires_rsvp)
 group by s.activity_id;

select activity_id, price_hkd, capacity, requires_rsvp
  from public.operational_activity_templates
 where activity_id like 'event-%' and price_hkd = 0
 order by activity_id;
```

The occurrence query must show one dated row per template weekday throughout
the generated window; the invalid-occurrences query must return no rows. Every
zero-price `event-%` result must be RSVP-enabled and uncapped.

Next verify the exact deployed RPC signatures, security-definer setting, fixed
`search_path`, and execute privileges. Every returned `ok` value must be `true`;
`anon` may execute only the session-window generator, while `authenticated` may
execute every listed RPC:

```sql
with expected(signature, anon_execute, authenticated_execute) as (
  values
    ('public.ensure_operational_sessions(date,integer)', true, true),
    ('public.create_operational_event(text,date,time without time zone,integer,text,text,text,integer,integer,boolean)', false, true),
    ('public.reserve_operational_session(text)', false, true),
    ('public.get_operational_attendee_names(text)', false, true),
    ('public.join_operational_queue(text,text)', false, true),
    ('public.leave_operational_queue(uuid)', false, true),
    ('public.withdraw_operational_rsvp(uuid)', false, true),
    ('public.cancel_operational_session(text,text)', false, true),
    ('public.reopen_operational_rsvp(text)', false, true),
    ('public.set_session_venue(text,text,text,boolean)', false, true),
    ('public.set_session_venue(text,text,text,boolean,double precision,double precision)', false, true),
    ('public.set_operational_session_time(text,time without time zone)', false, true)
), checks as (
  select e.signature,
         p.oid is not null as function_exists,
         coalesce(p.prosecdef, false) as security_definer,
         coalesce('search_path=public' = any(p.proconfig), false) as fixed_search_path,
         coalesce(has_function_privilege('anon', p.oid, 'EXECUTE'), false)
           as anon_execute,
         coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false)
           as authenticated_execute,
         coalesce(
           p.oid is not null
             and p.prosecdef
             and 'search_path=public' = any(p.proconfig)
             and has_function_privilege('anon', p.oid, 'EXECUTE') = e.anon_execute
             and has_function_privilege('authenticated', p.oid, 'EXECUTE') = e.authenticated_execute,
           false
         ) as ok
    from expected e
    left join pg_proc p on p.oid = to_regprocedure(e.signature)
)
select * from checks order by signature;
```

Finally confirm browser roles have no direct mutation privilege on the feature's
authoritative tables. This query must return no rows:

```sql
with checked(role_name, table_name) as (
  select role_name, table_name
    from (values ('anon'), ('authenticated')) roles(role_name)
   cross join (values
     ('operational_activity_templates'),
     ('operational_sessions'),
     ('operational_bookings'),
     ('operational_queue_entries'),
     ('operational_rsvp_counts'),
     ('operational_session_venue_overrides'),
     ('notifications')
   ) tables(table_name)
)
select role_name, table_name
  from checked
 where has_table_privilege(
   role_name,
   format('public.%I', table_name),
   'INSERT,UPDATE,DELETE'
 );
```

### Staged rollout and production promotion

1. **Apply the backend migration** only after the required disposable gate, using
   the reviewed SQL-only path above. No frontend deployment may precede it.
2. **Run read-only production verification** for templates, generated sessions,
   exact RPC signatures, security-definer settings, execute grants, and direct
   table privileges. Repair only migration history version `20260920000001`
   after these checks pass.
3. **Deploy the controlled Testing/preview frontend** only after steps 1–2. Point
   it at the same migrated project, restrict access to the named acceptance
   testers, and do not promote that revision to the production frontend URL.
   Verify the exact Testing origin remains configured where `ITC_APP_ORIGINS`
   is used; no new Edge Function deployment is required.
4. **Complete authenticated RSVP/cancel/reopen/venue/time/notification acceptance**
   with the checklist and read-only notification query below. This controlled
   acceptance must pass before production frontend promotion.
5. **Promote the production frontend** only after the disposable gate, backend
   verification, preview acceptance, and notification recipient/non-recipient
   evidence all pass. A failed or unexecuted gate blocks promotion.

### Authenticated browser and mobile acceptance

Use distinct approved member, withdrawn member, unrelated approved member,
Admin, pending/declined, and signed-out sessions. Exercise current Safari/iOS,
Chrome/Android, and desktop Chrome; include 375 px portrait and a narrow
landscape viewport.

1. As the approved member, open future Wednesday Night Training, Run Club,
   Swimming, and a free one-off. Confirm each remains labelled **Free**, says
   RSVP is optional/walk-ins are welcome, has no price, checkout, capacity, or
   waitlist, and remains usable without an RSVP.
2. Tap **I’m coming**. Confirm the going state and expected count update once,
   then open **Who’s coming** and verify the member's name and private avatar
   (or initials fallback). Confirm signed-out and pending/declined sessions see
   neither the action nor roster identities.
3. In the distinct withdrawn-member session, tap **I’m coming** and then
   **Can’t make it** before the Hong Kong start. Confirm that member leaves the
   count/roster and receives no later change notification. Confirm RSVP and
   withdrawal controls close at start time and duplicate taps do not create
   duplicate rows.
4. Have the acting Admin RSVP too, then verify each dated card's
   expected-attendee count and avatar roster. As that Admin, cancel one
   occurrence with a trimmed required reason. Confirm Schedule and
   Activity Details show **Cancelled** plus that reason, its active RSVP is
   cancelled without a deferral/future booking, and the recurring template and
   adjacent future occurrence remain active.
5. Before start, choose **Reopen event**. Confirm the previous bookings remain
   cancelled and the count remains zero. Have the approved member and acting
   Admin each RSVP afresh and confirm each gets one new active booking. Confirm
   blank cancellation reasons and post-start reopening fail without losing the
   current route or form state.
6. With those active RSVPs, have the same acting Admin change venue and then
   start time. Confirm the effective values update on Schedule and Activity
   Details. Repeat each unchanged save and confirm no duplicate notification is
   created.
7. For each cancellation, reopening, venue change, and time change, inspect the
   notification bell and trusted notification rows. The applicable active or
   occurrence-cancelled RSVP member must receive exactly one linked in-app
   notification. The signed-out visitor, pending/declined profile, member who
   withdrew before the change, and unrelated approved member must receive none.
   Confirm existing Admin audit notifications still reach non-actor Admins
   where applicable and the acting Admin is not duplicated when also RSVP'd.
8. Verify one-occurrence isolation explicitly: cancellation, reopening, venue,
   time, count, and roster changes for the test date must not alter the next
   recurring date. Confirm a walk-in can still attend and Admin attendance does
   not treat RSVP as an admission requirement.
9. On mobile, verify tap targets, roster/avatar rows, cancellation reason form,
   reopen control, notifications, loading/disabled states, error copy, focus
   order, back navigation, narrow-layout wrapping, and portrait/landscape
   scrolling without clipping or horizontal overflow.

### Read-only notification acceptance evidence

Immediately before the Admin cancellation, record the acceptance start
timestamp; immediately after the final time-change notification commits, record
the acceptance finish timestamp. After the controlled acceptance, replace the
six UUIDs, exact session ID, and both timestamps below with those recorded
fixture values. Run all three queries through trusted read-only production SQL
before promotion. The UUID placeholders are valid but deliberately cannot pass
the positive checks; do not edit expected counts. Every `ok` value and every
boolean in the state query must be `true`, and the final anti-join must return
zero rows.

The first query proves exact recipient and non-recipient notification behavior,
including no duplicate notification for the acting Admin who also RSVP'd:

```sql
with params as (
  select 'REPLACE_WITH_SESSION_ID'::text as session_id,
         '2099-01-01 00:00:00+00'::timestamptz as acceptance_started_at,
         '2099-01-01 01:00:00+00'::timestamptz as acceptance_finished_at
), cohorts(profile_id, cohort, expected_count) as (
  values
    ('00000000-0000-0000-0000-000000000001'::uuid, 'active member', 1),
    ('00000000-0000-0000-0000-000000000002'::uuid, 'acting RSVP Admin', 1),
    ('00000000-0000-0000-0000-000000000003'::uuid, 'withdrawn member', 0),
    ('00000000-0000-0000-0000-000000000004'::uuid, 'unrelated member', 0),
    ('00000000-0000-0000-0000-000000000005'::uuid, 'pending profile', 0),
    ('00000000-0000-0000-0000-000000000006'::uuid, 'declined profile', 0)
), kinds(kind) as (
  values
    ('operational_session_cancelled'),
    ('operational_rsvp_reopened'),
    ('operational_session_venue_updated'),
    ('operational_session_time_updated')
), expected as (
  select c.profile_id, c.cohort, k.kind, c.expected_count
    from cohorts c cross join kinds k
), observed as (
  select n.profile_id, n.kind, count(*)::integer as actual_count
    from public.notifications n
    cross join params p
   where n.destination = '#/activity/' || p.session_id
     and n.created_at >= p.acceptance_started_at
     and n.created_at < p.acceptance_finished_at
     and n.kind in (select kind from kinds)
   group by n.profile_id, n.kind
)
select e.cohort, e.kind, e.expected_count,
       coalesce(o.actual_count, 0) as actual_count,
       coalesce(o.actual_count, 0) = e.expected_count as ok
  from expected e
  left join observed o using (profile_id, kind)
 order by e.cohort, e.kind;
```

The second query proves reopening preserved the occurrence-cancelled RSVP
history, produced one fresh active RSVP for each positive cohort, and never
entered paid deferral:

```sql
with params as (
  select 'REPLACE_WITH_SESSION_ID'::text as session_id,
         '00000000-0000-0000-0000-000000000001'::uuid as active_member_id,
         '00000000-0000-0000-0000-000000000002'::uuid as acting_admin_id
)
select count(*) filter (
         where b.profile_id = p.active_member_id
           and b.status = 'cancelled'
           and b.cancellation_source = 'session'
       ) >= 1 as active_member_cancelled_history,
       count(*) filter (
         where b.profile_id = p.acting_admin_id
           and b.status = 'cancelled'
           and b.cancellation_source = 'session'
       ) >= 1 as acting_admin_cancelled_history,
       count(*) filter (
         where b.profile_id = p.active_member_id and b.status = 'confirmed'
       ) = 1 as active_member_one_fresh_rsvp,
       count(*) filter (
         where b.profile_id = p.acting_admin_id and b.status = 'confirmed'
       ) = 1 as acting_admin_one_fresh_rsvp,
       count(*) filter (where b.status = 'deferred') = 0 as no_paid_deferral,
       bool_and(s.cancelled_at is null) as occurrence_is_reopened
  from params p
  join public.operational_sessions s on s.id = p.session_id
  left join public.operational_bookings b on b.session_id = s.id
 group by p.active_member_id, p.acting_admin_id;
```

The third query is the observed-led safety check that the cohort-led first query
cannot provide. Its expected set includes the two fresh RSVP confirmations that
occur inside the bounded window. Before running it, add one explicit
`operational_session_venue_updated` pair for every non-acting Admin or Super
Admin who is expected to receive the existing venue-audit fan-out. Do not add
any other profile merely to make the output empty.

**Unexpected notification recipients/kinds:** this query must return zero rows
before production promotion. Any row is an unexpected `(profile_id, kind)` or a
missing expected-set entry that must be investigated. Because it uses the exact
dated-session destination and the recorded half-open acceptance window, older
notifications for this session and notifications for other sessions cannot
create false positives.

```sql
with params as (
  select 'REPLACE_WITH_SESSION_ID'::text as session_id,
         '2099-01-01 00:00:00+00'::timestamptz as acceptance_started_at,
         '2099-01-01 01:00:00+00'::timestamptz as acceptance_finished_at
), expected_recipient_kinds(profile_id, kind) as (
  values
    ('00000000-0000-0000-0000-000000000001'::uuid, 'operational_session_cancelled'),
    ('00000000-0000-0000-0000-000000000002'::uuid, 'operational_session_cancelled'),
    ('00000000-0000-0000-0000-000000000001'::uuid, 'operational_rsvp_reopened'),
    ('00000000-0000-0000-0000-000000000002'::uuid, 'operational_rsvp_reopened'),
    ('00000000-0000-0000-0000-000000000001'::uuid, 'operational_rsvp_confirmed'),
    ('00000000-0000-0000-0000-000000000002'::uuid, 'operational_rsvp_confirmed'),
    ('00000000-0000-0000-0000-000000000001'::uuid, 'operational_session_venue_updated'),
    ('00000000-0000-0000-0000-000000000002'::uuid, 'operational_session_venue_updated'),
    -- Add each expected non-acting Admin venue-audit pair here.
    ('00000000-0000-0000-0000-000000000001'::uuid, 'operational_session_time_updated'),
    ('00000000-0000-0000-0000-000000000002'::uuid, 'operational_session_time_updated')
), observed as (
  select n.profile_id, n.kind, count(*)::integer as actual_count
    from public.notifications n
    cross join params p
   where n.destination = '#/activity/' || p.session_id
     and n.created_at >= p.acceptance_started_at
     and n.created_at < p.acceptance_finished_at
   group by n.profile_id, n.kind
)
select o.profile_id, o.kind, o.actual_count
  from observed o
  left join expected_recipient_kinds e using (profile_id, kind)
 where e.profile_id is null
 order by o.profile_id, o.kind;
```

Attach all query output and authenticated screenshots to the release record.
Only then is notification acceptance complete and production frontend promotion
permitted.

### Rollback

Rollback is access-first and preserves evidence:

1. Deploy a frontend revision that hides/disables member RSVP/withdraw/roster
   controls and Admin count/cancel/reopen/change controls. Verify browsers no
   longer invoke the new RPC paths.
2. Only after access is removed, create and review a forward rollback migration
   that restores/replaces database functions if required. Do not edit or delete
   the applied migration file, and do not blindly replay migration history.
3. Never delete `operational_bookings.cancelled_at`, `cancellation_source`, RSVP
   rows, notification rows, or other booking/audit history. Leave authoritative
   session and booking evidence in place while retention and recovery are
   decided.
4. Re-run the smoke and SQL safety suites, verify paid/HYROX behavior, and
   retain an operator record of the affected occurrence IDs and rollback
   revision.

## Profile photos: deployment, acceptance, and rollback

Profile photos are a live-Supabase feature. Local mode always renders initials:
it does not upload, persist, or place image bytes/base64 data in `localStorage`.
Approved members, Admins, and Super Admins may manage photos. Public, pending,
and declined viewers cannot resolve other members' photos.

### Pre-deployment checks and secrets

**New-installation reference only.** For `krxbvgyolxvmzgysfjkj`, the authoritative post-application promotion path above takes precedence: resolver v8/JWT and the exact two-origin allowlist are already verified. Do not repeat deployment, migration application/history repair or secret configuration for this promotion.

1. Select the intended Supabase project and confirm its backup/point-in-time
   recovery status. Do not use a production database for the destructive test
   harness. Set and visibly verify the public project reference, then inspect
   both local and remote migration history before any write:

   ```bash
   export SUPABASE_PROJECT_REF="<confirmed-project-ref>"
   supabase projects list
   supabase migration list --project-ref "$SUPABASE_PROJECT_REF"
   supabase db push --dry-run --project-ref "$SUPABASE_PROJECT_REF"
   ```

   `supabase/config.toml` is versioned so the CLI discovers local migrations
   and each function's shared `supabase/functions/deno.json` import map. If the
   dry run reports no migrations while local files exist, stop: the CLI is not
   reading the repository configuration.
2. In Supabase Dashboard → Edge Functions → Secrets, confirm the managed
   `SUPABASE_SERVICE_ROLE_KEY` is available to functions. Never copy its value
   into the browser, Vercel, logs, screenshots, this runbook, or any repository
   file.
3. For a separately authorized new installation, configure `ITC_APP_ORIGINS`
   from that installation's approved exact-origin inventory: no paths or wildcard.
   For this existing target, restoration/verification is already complete and the
   list is exactly `https://island-training-club.vercel.app` and
   `https://island-training-club-git-testing-island-training-club.vercel.app`.
   Do not replace that list with placeholders, add a localhost/preview origin,
   or issue a secret update during promotion. Public supported origins are not
   credentials; never publish API keys, tokens or other secret values.

4. Confirm the deployed frontend contains only the browser-safe Supabase URL
   and anon/publishable key. Search the deployment output for service-role and
   database credentials before continuing.

### Deploy in order — new installations only

These commands are not the next operation on the already-applied target. The September 18 application/history example below is historical precedent, not permission to repeat it.

The migration `20260917000001_profile_avatars.sql` creates the private
`profile-avatars` bucket, metadata and immutable audit tables, upload-attempt
rate enforcement, and service-only transition functions. When local and remote
migration histories align, deploy in this exact order:

```bash
supabase db push --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy process-profile-avatar --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy resolve-profile-avatars --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy moderate-profile-avatar --project-ref "$SUPABASE_PROJECT_REF"
```

The production project had a legacy migration-history gap before the avatar
rollout on 18 September 2026: its existing schema was present while older
migration-history rows were absent. An unqualified `db push` would therefore
try to replay old migrations. For that verified condition only, the avatar
migration was applied and recorded explicitly:

```bash
supabase db query --linked --project-ref "$SUPABASE_PROJECT_REF" \
  --file supabase/migrations/20260917000001_profile_avatars.sql
# Verify the bucket, tables, RLS, grants, and functions before recording it.
supabase migration repair 20260917000001 --status applied --linked \
  --project-ref "$SUPABASE_PROJECT_REF" --yes
```

Do not use `--include-all`, and do not mark older versions applied without a
separate schema audit. Reconcile that historical drift before the next normal
migration rollout.

Do not deploy the photo-enabled frontend until all four commands succeed. Edge
Functions accept CORS only from `ITC_APP_ORIGINS`; they must never return
`Access-Control-Allow-Origin: *`. Browser code has no direct Storage mutation
policy. Sanitized objects are delivered through signed URLs valid for 600 seconds
and cached only in page memory.

### Post-deployment verification

Verify the bucket in Dashboard → Storage and with trusted SQL:

```sql
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id = 'profile-avatars';
```

Expected: one row, `public = false`, `file_size_limit = 2097152`, and only
`image/jpeg`. Confirm anon/authenticated users have no direct insert, update,
or delete policy for this bucket. A direct browser Storage upload/delete must
fail; only the three Edge Functions may own object paths.

Before live acceptance, run all automated checks from the repository root:

```bash
node app/avatar-smoke.mjs
node app/smoke.mjs
node app/live-auth-smoke.mjs
deno test --config supabase/functions/deno.json --allow-net supabase/functions/_shared/*_test.ts \
  supabase/functions/process-profile-avatar/index_test.ts \
  supabase/functions/resolve-profile-avatars/index_test.ts \
  supabase/functions/moderate-profile-avatar/index_test.ts
bash supabase/tests/verify_profile_avatars_safety.sh
```

When an explicitly disposable, empty Supabase-compatible database is available,
run the destructive migration integration suite. The acknowledgement flag is a
safety boundary, not boilerplate:

```bash
ITC_AVATAR_TEST_DATABASE_URL="$DISPOSABLE_DATABASE_URL" \
ITC_ALLOW_DATABASE_RESET=1 \
bash supabase/tests/verify_profile_avatars.sh
```

If no acknowledged disposable database is available, record this check as
**unexecuted deployment acceptance**. Never report it as passing, and never
point it at production, staging, a shared database, or a database containing
users/application objects.

Use separate approved Google and email magic-link accounts, plus pending,
declined, Admin, and Super Admin accounts, for browser acceptance:

1. On current Safari/iOS and Chrome/Android, tap the approved Profile avatar.
   Confirm the standard picker offers camera and photo library where supported;
   it must not force camera-only capture.
2. Select JPEG, PNG, and WebP sources. Drag the square crop with pointer/touch,
   zoom from 1–4×, move it with arrow keys, and save. Confirm progress copy,
   duplicate-submit disabling, a 512×512 JPEG result, and Profile/top-navigation
   updates without a page reload.
3. Confirm a verified Google account photo appears automatically when no custom
   image exists. Remove a custom photo and verify Google fallback, or initials
   for a magic-link account without Google imagery.
4. Confirm approved Activity Details shows only confirmed attendee avatar/name
   rows. Signed-out, pending, and declined sessions must retain the member-only
   gate and receive no cross-member image URLs.
5. As Admin and Super Admin, hide an active photo with a required reason. Upload
   a replacement as that moderated member, verify it remains pending, then test
   approve and reject (with reason) independently. Ordinary members must never
   see moderation controls or pending previews.
6. Let a signed URL expire or deliberately break an image request. Confirm the
   initials sibling appears without exposing an object path or server error.
7. Test 375 px portrait and a narrow landscape viewport. Confirm attendee rows,
   review cards, dialogs, focus order, Escape close, focus restoration, and
   reduced-motion behavior remain usable.
8. Download one processed object through a temporary signed URL in trusted
   Admin context. Verify exact 512×512 JPEG dimensions and no EXIF/GPS/comment
   metadata. Do not retain the downloaded member image after the check.

### Storage and audit cleanup checks

After upload replacement, custom removal, Admin rejection, and a forced failed
transition, inspect metadata/audit rows and look for unreferenced objects:

```sql
select profile_id, state, moderated_by, moderation_reason, moderated_at
  from public.profile_avatars
 order by updated_at desc;

select profile_id, actor_id, action, reason, created_at
  from public.profile_avatar_audit
 order by created_at desc
 limit 100;

select o.name, o.created_at
  from storage.objects o
  left join public.profile_avatars p
    on o.name in (p.google_object_path, p.active_object_path, p.pending_object_path)
 where o.bucket_id = 'profile-avatars'
   and p.profile_id is null
 order by o.created_at;
```

The audit should show attempts and transitions without image bytes. Investigate
recent in-flight objects before removal. Delete only confirmed stale objects
through trusted operator tooling after the retention decision; never add a
browser cleanup policy.

### Rollback

Treat rollback as an access shutdown first and data cleanup second:

1. Deploy a frontend revision that removes/disables photo upload, attendee
   resolution, and Admin moderation entry points. Confirm clients no longer call
   any avatar function.
2. Disable or delete `process-profile-avatar`, `resolve-profile-avatars`, and
   `moderate-profile-avatar` in the target project. Removing
   `ITC_APP_ORIGINS` alone is not a substitute for disabling function access.
3. Confirm no browser/function requests remain. Preserve the private bucket,
   metadata, and immutable audit rows while leadership decides retention and
   member-notification obligations.
4. If deletion is approved, export the required audit evidence, delete bucket
   objects with trusted service-side tooling, and only then remove the empty
   `profile-avatars` bucket. Verify the object count is zero.
5. Database migrations are append-only. Do not edit or delete the applied
   `20260917000001_profile_avatars.sql` file. Create and review a new rollback
   migration to revoke/drop avatar RPCs and tables only after object cleanup and
   retention approval. Re-run the complete smoke and SQL safety suites.

For a code-only rollback, stop after steps 1–3 and leave private data in place;
this is safer and reversible. Never drop metadata first, because doing so loses
references needed to identify and clean stored objects safely.

## Giving schema and campaign

The member route treats PostgREST `PGRST205` as no active campaign so Giving
remains reachable. This does not make donations functional.

To enable Giving:

1. Apply the ordered migration chain, including
   `20260805000011_giving_campaigns.sql`, `20260806000001_donor_id.sql`, and
   `20260827000001_hyrox_indemnity_fields.sql`, to the intended Supabase
   project.
2. Sign in as an approved Admin or Super Admin and use **Admin Tools → Giving**
   to create and publish a real campaign.
3. Verify the published campaign as an approved member.

No fake campaign data is restored.

Before production deployment, verify the migration chain against a fresh,
disposable Supabase-compatible database:

```bash
export ITC_GIVING_TEST_DATABASE_URL='postgresql://...disposable database...'
export ITC_ALLOW_DATABASE_RESET=1
bash supabase/tests/verify_giving_campaigns.sh
```

This verifier applies every migration and runs SQL integration checks. It is
destructive and must never target production, staging, a shared database, or
any database containing users or application objects. Its safety gate requires
an explicitly acknowledged, empty target. Exercise the gate without applying
migrations with:

```bash
bash supabase/tests/verify_giving_campaigns.sh --safety-check-only
bash supabase/tests/verify_giving_campaigns_safety.sh
```

## Free-event venue overrides

Dated free/RSVP venues (`wnt`, `run`, `water`, `lunch`) live in
`operational_session_venue_overrides` and use
`set_session_venue(p_session_id text, p_location text, p_maps_query text,
p_was_tbc boolean, p_meeting_lat double precision, p_meeting_lng double
precision)`. The four-argument compatibility wrapper remains available. The
RPC is the only mutation path. Paid HYROX sessions are rejected with
`Activity venue is fixed.`. Members see the first confirmation per session;
Admins see an audit notification on every actual save/reset, excluding the
actor.

The Admin UI exposes these dated controls at **Admin Tools → Activities →
Weekly Event Controls → Free & RSVP Events**. Paid time, venue-status, notice,
and cancellation controls are in the adjacent **Paid Sessions** group.

Recurring Swimming and lunch may remain `TBC` in their activity templates.
Only dated overrides are shared through `set_session_venue`.

Mapping privacy: Nominatim receives the venue text submitted for geocoding and
the browser's IP address. The browser cache is device-local and stores only
venue coordinates; it does not contain member or attendance data.

Deploy the location updates after the operational backend chain in this order:

1. `20260813000001_free_event_venue_overrides.sql`
2. `20260813000002_midtown28_fitness.sql`

Then verify against a fresh disposable database:

```bash
export ITC_OPERATIONS_TEST_DATABASE_URL='postgresql://...disposable database...'
export ITC_ALLOW_DATABASE_RESET=1
bash supabase/tests/verify_operational_backend.sh
```

If `set_session_venue` returns `Could not find 'public.operational_session_venue_overrides' in the schema cache` even though the migration was applied, reload PostgREST's schema cache for the calling role:

```sql
notify pgrst, 'reload schema';
```

Run it once per Supabase role (`anon`, `authenticated`, `service_role`) the
client uses. After this the new table is visible to the PostgREST query path.
Run it via the Supabase SQL editor or `psql` against the live database URL.

Browser-level acceptance on the deployed environment:

1. As an Admin, sign in and open **Admin Tools → Activities → Weekly Event
   Controls → Free & RSVP Events**. Save a dated display location and geocode
   query.
2. Open the dated activity page with `localStorage.removeItem("itc.geocode.v1")`.
   Confirm the Leaflet marker, attribution, and external Get directions link.
3. Confirm an approved member receives **Venue confirmed** and another Admin
   receives **Session venue updated**. The actor must not receive a duplicate
   notification.
4. Edit and then reset the venue; members are not notified again.
5. Block `unpkg.com` and `nominatim.openstreetmap.org` separately. Both
   failure paths must settle on the fallback copy without breaking the
   external Get directions link.
6. Open the Island ECC HYROX activity page. Get directions must appear without
   a weekly venue form. Retired HYROX activity links must use the neutral state
   documented above.

Applying migrations to the real remote target remains a manual deployment
operation. Confirm the selected project and backups, then follow each feature's
reviewed source-tip procedure. Do not run an unqualified `supabase db push`.

## Initial Super Admin bootstrap

Every Supabase Auth-created profile starts `pending`, including the first profile in a
fresh project. There is no browser or first-user promotion path. After all
migrations have run and the intended owner has signed in once, an operator must
verify that person's identity out of band and promote the **known profile UUID**
from the Supabase SQL editor or another **trusted SQL** / service-role context.
Never run this with an UUID learned only from an unverified signup request.

Replace both placeholders below, then run the whole block as one transaction.
It requires the `role_changes` audit migration to be installed, requires an
exact pending UUID/email match, and labels the trigger-created audit row:

```sql
begin;

do $$
declare
  target_id uuid := '<known-profile-uuid>';
  target_email text := '<verified-owner-email>';
  changed_rows integer;
  audit_id uuid;
begin
  update public.profiles
     set role = 'super_admin'
   where id = target_id
     and email = target_email
     and role = 'pending';
  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then
    raise exception 'bootstrap target must be one verified pending profile';
  end if;

  select id into audit_id
    from public.role_changes
   where profile_id = target_id
     and old_role = 'pending'
     and new_role = 'super_admin'
   order by created_at desc
   limit 1;
  if audit_id is null then
    raise exception 'Initial Super Admin bootstrap audit row missing';
  end if;

  update public.role_changes
     set reason = 'Initial Super Admin bootstrap via trusted deployment SQL'
   where id = audit_id;
end $$;

commit;
```

Verify the result and audit evidence before enabling general sign-in:

```sql
select id, email, role from public.profiles where id = '<known-profile-uuid>';
select profile_id, old_role, new_role, reason, created_at
  from public.role_changes
 where profile_id = '<known-profile-uuid>'
 order by created_at desc;
```

Runtime authorization never hardcodes an owner email. Existing deployments
should verify their intended owner directly in `public.profiles`. If disaster
recovery requires a role correction, make it explicitly in trusted context and
verify the audit trail. Do not add email-based role logic to browser code.

## Promote a second admin

Two paths:

- Via the admin panel: a super_admin signs in → `/admin/members` → find the
  member → **Promote to admin**. The DB trigger logs the change in
  `role_changes` automatically.
- Via SQL (when no super_admin exists yet):

```sql
update public.profiles
   set role = 'admin'
 where email = '<email>';
```

## Backfill profiles

If the trigger is added after some users already exist, run once:

```sql
insert into public.profiles (id, email, full_name, avatar_url, role)
select u.id, u.email,
       u.raw_user_meta_data->>'full_name',
       u.raw_user_meta_data->>'avatar_url',
       'pending'
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);
```

## Inspect audit log

```sql
select p.email, rc.old_role, rc.new_role, rc.reason, rc.created_at
from public.role_changes rc
join public.profiles p on p.id = rc.profile_id
order by rc.created_at desc;
```

## Application drafts and approval states

- Google OAuth or email magic-link authentication creates `public.profiles(role = 'pending')`. Until an `applications` row exists, Admin shows the profile under **Awaiting application** and approval controls remain locked.
- The live membership form calls `saveMyApplication()` and upserts `public.applications`. Successful submission moves the profile to **Ready for review**.
- Unfinished forms auto-save every 500 ms to `itc.apply.draft.v1` on that browser only. Drafts are not uploaded to Supabase and do not appear to administrators.
- Home, Account, and Apply expose Continue / Discard controls while a local draft exists.
- A successful Supabase submission or explicit Discard removes the local draft. Sign-out does not remove it.
- To reset a tester's draft without deleting their Supabase identity, run `localStorage.removeItem('itc.apply.draft.v1')` in that browser's console.

## Inspect pending applications

```sql
select p.email, a.mobile, a.date_of_birth, a.is_minor, a.submitted_at
from public.applications a
join public.profiles p on p.id = a.profile_id
where p.role = 'pending'
order by a.submitted_at;
```

## Tear down and reseed the local project

```bash
supabase db reset                 # drops everything; replays migrations
supabase db push                  # pushes migrations to remote
```

## Edit placeholder copy

Until the ITC leadership workshop fills in the policy text, placeholder
copy lives in:

- `app/js/views.js` — `applyFormHtml()` (waiver / privacy / guidelines
  checkbox labels).
- `supabase/migrations/20260804000002_audit_notifications.sql` — the
  welcome notification title and body inside `record_role_change()`.

To update the welcome notification on already-deployed databases:

```sql
update public.notifications
   set body = '<new body text>'
 where kind = 'welcome' and read_at is null;
```

## Migrations

All schema lives in `supabase/migrations/` and is replayed in order by
`supabase db push`. Never edit a migration after it has been applied to
a shared environment — add a new one instead.

`20260827000001_hyrox_indemnity_fields.sql` is additive: it adds
`waiver_signature_text`, `waiver_signed_at`, `waiver_form_version`, and
`emergency_relationship` to `public.applications` without backfilling or
adding `not null` constraints. Apply it before deploying any UI revision
that writes the versioned indemnity fields so live application submits and
Profile > Indemnity updates do not fail on missing columns.

The latest operational corrections are forward migrations and must remain in
this order after `20260829000008_rsvp_integrity.sql`:

1. `20260830000001_rsvp_count_trigger_locking.sql` narrows RSVP count triggers
   to confirmed contribution changes and serializes exact RSVP recounts with
   per-session advisory transaction locks.
2. `20260830000002_release_operational_reservation.sql` adds the owner/Admin
   RPC for releasing only unmarked paid reservations. It does not perform a
   client-side or fake live waitlist promotion.
3. `20260830000003_notification_event_destinations.sql` corrects notification
   routes for zero-price/RSVP events and preserves the Schedule fallback for
   paid cancellation rows.

`verify_operational_backend.sh` replays the ordered chain and then runs a
bounded concurrency harness. It still requires a fresh, explicitly
acknowledged disposable Supabase-compatible database; a source-only safety
run does not verify PostgreSQL execution.

## ⏳ Awaiting ITC leadership workshop

The supplied Hyrox indemnity source is already implemented. The following copy is still placeholdered until the workshop lands:

- Privacy policy text.
- Community guidelines text.
- Welcome notification body.
- Approval criteria wording (plausible, non-abusive).
- Hong Kong phone regex in `app/js/store.js` `saveMyApplication`.

The data model supports the real text from day one. Updating the text is
a small SQL or HTML edit per the Edit-placeholder-copy section above.