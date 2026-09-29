# Operational Backend Deployment Runbook

This is the current runbook for the live Supabase operational backend. Island ECC is the sole active HYROX venue, with 9:15 AM and 10:30 AM Saturday sessions. Both keep the direct paid-session reservation, waitlist, payment, receipt, attendance, replacement, collector, and venue-confirmation paths.

The former BFT Causeway Bay/Midtown28 shared pool is retired. Retained BFT/Midtown pool test records are hidden from browser roles, not deleted. They remain available only to trusted database operators for audit. Retirement does not cancel bookings, move members to Island ECC, delete rows, or send notifications.

Known retired HYROX deep links render `This session is no longer available.`; unknown IDs keep the existing safe not-found behavior; neither redirects to Island ECC.

## Current ownership and safety boundary

Supabase is authoritative in configured live mode. Browser reads are constrained by RLS and browser mutations use scoped security-definer RPCs. The retirement migration:

- deactivates exactly `hyrox-bft` and `hyrox-midtown` while preserving both `hyrox-quarry-bay-early` and `hyrox-quarry-bay`;
- removes browser access to pool cycles and cycle queues;
- filters retired sessions, bookings, queues, receipts, replacements, and notifications;
- revokes pool-only RPCs and guards shared direct-session RPCs before side effects;
- disables cycle provisioning and pool reminders;
- leaves retained domain rows and their statuses unchanged.

The historical pool tables and migrations remain because they define the retained schema. Their presence does not make the pool an active product.

## Clean disposable migration order (not promotion)

For a **clean disposable database only**, replay every repository migration once in filename/version order. The operational sequence is:

1. `20260808000001_operational_schema.sql`
2. `20260808000002_operational_member_rpcs.sql`
3. `20260808000003_operational_admin_rpcs.sql`
4. `20260808000004_operational_realtime_seed.sql`
5. all later migrations in filename order, including the historical pool schema/RPC migrations `20260903000001`–`20260904000002`, attendance `20260909000001`, replacement migrations `20260910000001`–`20260910000006`, free-event migration `20260920000001`, prayer migration `20260921000001`, decision repair `20260921000002`, the immutable retirement boundary `20260922000001`–`20260922000003`, and all subsequent forward migrations;
6. `20260929000001_island_ecc_hyrox_slots.sql` last.

Do not skip or rewrite historical files in a clean replay: the retirement migrations depend on the schema they close, and later forward migrations depend on that closed browser boundary.

The shared target is already migrated through the accepted retirement boundary. Do **not** replay this clean-disposable chain, use unqualified `supabase db push`, use `--include-all`, or repair applied history on that target. Never edit, replay, reapply, or repair `00001`, `00002`, or `00003`. Apply the Island ECC dual-slot change only as the new forward migration described below.

## Island ECC dual-slot deployment

This change is backend-first. Do not promote a frontend that expects the 9:15 AM and 10:30 AM slots until `20260929000001_island_ecc_hyrox_slots.sql` is applied and verified on its target.

1. Confirm the three immutable `20260922000001`–`20260922000003` retirement migrations and all intervening forward migrations are present exactly once. A mismatch blocks application; do not repair or replay history.
2. Apply only `20260929000001_island_ecc_hyrox_slots.sql` through the reviewed migration process.
3. Verify read-only that both active Island ECC templates exist with start times 09:15 and 10:30, duration 60, capacity 30 and price HK$180; future generated sessions match; and no future exact-default 11:00 Island ECC session remains.
4. Verify the one-slot-per-Saturday guards for reservations, queues and confirmed replacements, then promote the matching frontend artifact.

## HYROX pool retirement: backend-first deployment

This rollout is strictly backend-first deployment. A frontend containing retirement behavior must not target an unmigrated project.

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

Never edit, replay, reapply, or repair `00001`, `00002`, or `00003`. Do not rerun completed recovery or acceptance fixtures, redeploy the resolver, or replace the verified origins for this promotion. A mismatch means STOP for separate review, not a repeated mutation.

Controller evidence: `promotion-review.md` and the final **FINAL Admin-only acceptance — controller CORS repair verified** section of `task-7-step5-browser-report.md`, retained in the private task evidence. Earlier failures are superseded. This documentation update did not re-query production; no secrets or private fixture identifiers belong in promotion evidence.

### Executable promotion sequence

1. **Verify the applied backend boundary (read-only).** Verify applied versions/hashes against the table above and existing backend invariants: exact catalog pin, pool ACLs closed, template/helper/notification/shared-RPC contracts, retained counts/digests and notification baseline. Use count-only evidence. Retain the approved pool RPC denial and Island ECC active-RPC checks; do not invoke mutating RPCs or create fixtures. Any mismatch blocks promotion.
2. **Verify the deployed resolver and origins (read-only).** Verify resolver v8 with `verify_jwt = true`, its approved artifact revision and exactly the two supported origins. Retain direct authenticated endpoint evidence (retired 404, ECC success, classifier-failure fail-closed from the disposable replica). Do not redeploy or change secrets.
3. **Confirm completed Testing acceptance.** Verify the reviewed preview revision and the controller's Testing browser acceptance PASS, including credited browser UI and Island ECC lifecycle, final CORS and selector probes. Bind the accepted runtime artifact; a runtime change requires new review, not a silent substitution. Do not rerun completed recovery or acceptance fixtures.
4. **Promote the exact accepted snapshot.** Under separate promotion authorization, promote only that accepted frontend artifact. Confirm the served revision and repeat bounded read-only route/denial/configuration/count checks without creating fixtures or moving money.

The application/recovery and fixture-acceptance records below are historical precedent only. Local clean replay is separately scoped to disposable databases and does not authorize replay on this target.

### Complete pool-only reassertion scope (00003)

Derive the exact set from immutable 00001: its six retired-job revocations immediately before **Pool-only browser RPCs**, then every one of the twelve revocations in that section. Do not gather every REVOKE in the file: shared wrappers are intentionally re-granted authenticated access later. The safety verifier cross-checks the complete ordered set against 00001's immutable hash. Both exact pool policy drops and table SELECT revocations are included, with PUBLIC/anon/authenticated denial, followed by these exact EXECUTE revocations:

```text
ensure_hyrox_cycles(date, integer)
schedule_hyrox_cycle(text)
sweep_hyrox_cycle_deadlines(timestamptz)
send_hyrox_member_payment_reminders(timestamptz)
send_hyrox_collector_payment_reminder(timestamptz)
send_hyrox_venue_reminders(timestamptz)
reserve_hyrox_cycle(text, text, boolean)
join_hyrox_cycle_waitlist(text, text, boolean)
leave_hyrox_cycle_queue(uuid)
reject_hyrox_cycle_payment(uuid, text)
finalize_hyrox_venue_plan(text)
finalize_hyrox_venue_plan_locked(text, timestamptz, text, uuid)
select_hyrox_cycle_venue(uuid, text)
join_hyrox_venue_switch_queue(uuid, text)
leave_hyrox_venue_switch_queue(uuid)
close_hyrox_venue_allocation(text)
cancel_hyrox_cycle(text, text)
set_operational_midtown_open(text, boolean)
```

There is no separate `approve_hyrox_cycle_payment` function to revoke: that string is an assertion label inside shared `approve_operational_payment(uuid)`. Do not revoke the shared guarded functions `get_operational_attendee_names`, `reserve_operational_session`, `mark_operational_payment`, `join_operational_queue`, `release_operational_reservation`, `approve_operational_payment`, `defer_operational_booking`, `set_operational_attendance`, or `suppress_opted_out_hyrox_payment_reminder`, nor other shared wrappers/helpers/preserved implementations outside the exact pool-only set. Their existing ACLs and all bodies remain unchanged.

This is a one-shot, idempotent reassertion robust against any subset of historical re-grants within that boundary, not permission to accept broader drift. Revoking already-absent grants must be a catalog no-op. The final statement remains the PostgREST schema-cache notify; no dispatch, history edit or generator invocation belongs in the migration.

### HISTORICAL — certain-stop application/recovery (executed 2026-09-23)

**Reviewed precedent/rollback reference only; not the next operation on this target. Do not rerun completed recovery.** The controller verified application, exact fixture cleanup and restored baseline. The historical sequence was:

1. The original process was stopped and quiescence established; the mode-0600 v5 journal was preserved. The rule was to never clear uncertainty or use ordinary cleanup-only crash restoration.
2. Independent review pinned the complete 23 statements and 18 pool-only functions. At that pre-application checkpoint only 00001/00002 were recorded; the separately authorized one-time 00003 application and history recording then completed. All three are now applied exactly once. No migration replay or history repair is part of current promotion.
3. Post-application catalog/source/ACL/history checks established the fixed repaired pin, pool denial, shared guarded access, preserved bodies/service/operator grants and unchanged retained rows.
4. The separately reviewed one-off recovery required a fresh one-use journal/hash/count-bound acknowledgement, exact provenance/FK closure and unsupported-row checks, durable lock and mode-0600 receipt. Organic-session normalization was limited to canonical, open, uncancelled future additions matching active non-retired templates and generator defaults. Candidate subtraction had to reproduce saved baseline counts/digests exactly; all other domains and retained cohorts stayed exact. The rule was to never adopt or delete organic rows.
5. The unchanged SERIALIZABLE exact-ID/xmin/full-row-digest compiler ran with its reviewed locks and predelete/precommit/postcommit guards. Complete unnormalized organic rows were preserved; fixture IDs reached zero. The original journal was removed only after definitive success; durable evidence remained. Ambiguous commits were never authorization to retry.
6. Baseline restoration and later Testing fixture cleanup were verified: retained **46/18/14/1/45**, total notifications **131**, unchanged retained digests. The non-retired generator was not disabled by recovery. This record is not a new recovery authorization.

The invariant queries below remain useful for read-only promotion verification, not for reapplying any migration.

### 1. Local gates — clean disposable replay only

From the reviewed checkout, prove migration-version uniqueness and run the complete local safety suite:

```bash
test -z "$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' \
  -exec basename {} \; | cut -d_ -f1 | sort | uniq -d)"
test "$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' \
  -exec basename {} \; | sort | tail -1)" = \
  "20260929000001_island_ecc_hyrox_slots.sql"
shasum -a 256 supabase/migrations/20260922000003_reassert_retired_hyrox_pool_acls.sql
shasum -a 256 supabase/migrations/20260929000001_island_ecc_hyrox_slots.sql
bash supabase/tests/retire_hyrox_pool_safety.sh
python3 supabase/tests/verify_retired_hyrox_correction.py
python3 supabase/tests/verify_retired_hyrox_drift.py
```

Reset a disposable local Supabase stack, replay the unmodified chain, and run the rollback-scoped integration:

```bash
supabase stop --no-backup || true
supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor
supabase db reset --local --no-seed
docker exec -i supabase_db_island-training-club-app \
  psql -U postgres -d postgres -X -P pager=off -v ON_ERROR_STOP=1 \
  < supabase/tests/retire_hyrox_pool_integration.sql
python3 supabase/tests/verify_retired_hyrox_correction.py --integration
python3 supabase/tests/verify_retired_hyrox_drift.py --sql | docker exec -i supabase_db_island-training-club-app \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1
```

The drift integration reproduces the observed two policies, browser grants and authenticated EXECUTE on all three reminders plus the sweeper. It also restores the FULL historical boundary: both policies, both tables and all 18 function grants to PUBLIC/anon/authenticated. One application must close everything. It proves nonempty cycle exposure, exact row/catalog/body/ACL preservation, actual browser SQL denial on every overload, repeated-application idempotence and shared authenticated RPC/Island ECC reservation preservation, then rolls back. `--sql --red` omits repair and must fail with rollback. The ignored local disposable runner also rehashes retained catalog evidence and verifies the complete counterfactual equals `5a0ecdeb48872f4ec2aacebc1d037c14`; this is local projection evidence, not a fresh target observation.

The correction integration recreates production function defaults, service grants, broad notification table/column grants and the older preserved roster in one transaction. It verifies exact ACLs, unchanged RLS/defaults/notification rows, ECC paid/replacement rosters, free RSVP rosters and member mark-read, then rolls back. `--integration --red` deliberately omits `00002` and must fail (connection close rolls back). Forbidden mutations including TRUNCATE are checked with catalog privilege predicates, never executed.

Expected: the integration emits `OK: retired HYROX pool boundary`, ends with `ROLLBACK`, and exits zero. Never run this reset or integration against production, Testing, staging, a shared database, or a database containing real user data.

### 2. Read-only production inventory

For read-only promotion verification, confirm the controller-verified target, backup/PITR status, reviewed commit, all three applied SHA-256 values, and recorded history. No shared mutation is part of this inventory:

```bash
export SUPABASE_PROJECT_REF="krxbvgyolxvmzgysfjkj"
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase migration list --linked
```

Stop unless `20260922000001`, `20260922000002` and `20260922000003` are each present exactly once with the verified hashes above, BFT/Midtown are inactive, and Island ECC is active. Known older history gaps are not permission to replay or repair anything. Stop on missing/duplicate/unexpected versions or artifact mismatch; do not fix the discrepancy by repeating an applied operation.

The SHA-256 identifies the complete reviewed SQL; the version alone is not artifact identity. Keep the applied `00001` digest `81f66371c360d9e6aed31f4130f38df891aad4100abdbddf2aa1c0d92e7aadb8` unchanged. Keep `00002` digest `1bb968bdbe435d4cad66a1fec993946c5b67692e8f1b25e53b1bde85e2edb6eb` unchanged. Keep applied `00003` digest `48a8f4b5d9dc22f8002e69b2c19b4a736ee83584527d269d7bdd1793150a0857` unchanged. The following 00002-era invariants must still pass; they do not authorize another correction. Retain reviewed commit/hash, target, backup/PITR evidence and count-only baseline. Verify the already-corrected helper, notification table/column ACL and preserved attendee-body boundaries. Confirm the wrapper/policies still match reviewed `00001`; unexpected divergence blocks promotion.

Run the following in trusted read-only SQL. It deliberately emits canonical activity/status labels and counts only—never member names, emails, profile IDs, payment references, replacement tokens, notification bodies, or screenshots of row content.

```sql
-- Canonical templates: these IDs are product identifiers, not member data.
select activity_id, active, count(*) as row_count
  from public.operational_activity_templates
 where activity_id in ('hyrox-bft', 'hyrox-midtown', 'hyrox-quarry-bay-early', 'hyrox-quarry-bay')
 group by activity_id, active
 order by activity_id;

-- Retained-domain count-only evidence. Compare with the restored baseline.
with retired_sessions as (
  select id
    from public.operational_sessions
   where activity_id in ('hyrox-bft', 'hyrox-midtown')
), retired_bookings as (
  select b.id
    from public.operational_bookings b
   where b.hyrox_cycle_id is not null
      or b.session_id in (select id from retired_sessions)
), retired_replacements as (
  select r.id
    from public.operational_booking_replacement_requests r
   where r.booking_id in (select id from retired_bookings)
), metrics(metric, bucket, row_count) as (
  select 'sessions',
         case when s.session_date >= (now() at time zone 'Asia/Hong_Kong')::date
              then 'future_or_today' else 'past' end,
         count(*)
    from public.operational_sessions s
   where s.id in (select id from retired_sessions)
   group by 2
  union all
  select 'cycles', coalesce(c.registration_state, 'unknown'), count(*)
    from public.operational_hyrox_cycles c group by 2
  union all
  select 'bookings', coalesce(b.status, 'unknown'), count(*)
    from public.operational_bookings b
   where b.id in (select id from retired_bookings) group by 2
  union all
  select 'receipts', coalesce(r.status, 'unknown'), count(*)
    from public.operational_receipts r
   where r.booking_id in (select id from retired_bookings) group by 2
  union all
  select 'direct_queues', coalesce(q.kind, 'unknown') || ':' || coalesce(q.status, 'unknown'), count(*)
    from public.operational_queue_entries q
   where q.session_id in (select id from retired_sessions) group by 2
  union all
  select 'cycle_queues', coalesce(q.kind, 'unknown') || ':' || coalesce(q.status, 'unknown'), count(*)
    from public.operational_hyrox_queue_entries q group by 2
  union all
  select 'replacements', coalesce(r.status, 'unknown'), count(*)
    from public.operational_booking_replacement_requests r
   where r.id in (select id from retired_replacements) group by 2
  union all
  select 'replacement_audit', coalesce(a.action, 'unknown'), count(*)
    from public.operational_booking_replacement_audit a
   where a.request_id in (select id from retired_replacements) group by 2
  union all
  select 'notifications', 'retired_pool_related', count(*)
    from public.notifications n
   where n.kind like 'operational_hyrox\_%' escape '\'
      or n.destination in (
           select '#/activity/' || id from retired_sessions
           union all select '#/booking/' || id::text from retired_bookings
           union all select '#/pay/' || id::text from retired_bookings
         )
      or (
        n.kind = 'operational_payment_marked'
        and (
          exists (
            select 1 from public.operational_bookings b
             where b.payment_marked_at = n.created_at
               and b.id in (select id from retired_bookings)
          )
          or exists (
            select 1 from public.operational_hyrox_cycles c
             where n.title = 'HYROX payment claim submitted'
               and n.destination = '#/admin/payments'
               and n.body = 'Review the payment claim for ' || c.session_date::text || '.'
          )
        )
      )
      or (
        n.kind = 'operational_gym_finalized'
        and exists (
          select 1 from public.operational_sessions s
           where s.gym_confirmed_at = n.created_at
             and s.id in (select id from retired_sessions)
        )
      )
      or (
        n.kind = 'hyrox_replacement_review'
        and (
          exists (
            select 1
              from public.operational_booking_replacement_requests r
             where r.accepted_at = n.created_at
               and r.booking_id in (select id from retired_bookings)
          )
          or not exists (
            select 1
              from public.operational_booking_replacement_requests r
             where r.accepted_at = n.created_at
          )
        )
      )
)
select metric, bucket, row_count
  from metrics
 order by metric, bucket;
```

The `hyrox_replacement_review` branch mirrors the pre-migration relationship rule: a notice matching any retired booking is counted; an ambiguous notice with no replacement at the same acceptance/creation timestamp is conservatively counted; and a notice is excluded only when that timestamp resolves exclusively to a proven active replacement such as Island ECC. If active and retired replacements share a timestamp, the retired match wins. The query emits only the aggregate bucket—never notification IDs or content. The rollback-scoped integration includes retired, unmatched, and proven-active Island ECC review-notice controls and asserts the expected aggregate classification.

Generic `operational_payment_marked` and `operational_gym_finalized` producers initially use the same transaction timestamp as `payment_marked_at` and `gym_confirmed_at`. Any retired timestamp match hides (even with an active match). Payment timestamps are mutable: mark → reject clears the mark, and mark → reject → re-mark replaces it. Therefore the inventory and RLS classifier also recognize the durable exact pooled producer fingerprint: kind `operational_payment_marked`, title exactly `HYROX payment claim submitted`, destination exactly `#/admin/payments`, and body exactly `Review the payment claim for <cycle-date>.` where `<cycle-date>` is a retained `operational_hyrox_cycles.session_date::text`. Every prior claim stays hidden regardless of the current booking timestamp or status. A fingerprint match wins even if another active payment shares its timestamp.

Direct Island ECC uses title `Payment marked for hyrox-quarry-bay` or `Payment marked for hyrox-quarry-bay-early` and body `A member marked payment on <session-date>.`; sharing a date with a retained cycle does not match the fingerprint. ECC-only timestamps and unrelated generic notices remain active. Near matches, missing retained dates, and arbitrary HYROX wording do not establish fingerprint provenance. This uses full-string equality to a known historical producer, never substring inference, free-text date parsing, or notification rewriting. Inventory output remains counts only—never title/body content.

The policy adapter and revoked public classifier now take `(text, text, timestamptz, text, text)` in kind/destination/created_at/title/body order; SELECT and both UPDATE predicates pass the original row fields. The private adapter is executable only by authenticated policy evaluation, not anon/PUBLIC; the public classifier remains revoked from all browser roles. The applied `00001` defines only this signature, with no three-argument overload. The production review verified these policies and signatures; `00002` intentionally leaves them unchanged. Any different policy/signature state requires separate review, never reapplication of `00001`.

Record the UTC query time and count-only evidence. Confirm with the data owner that future BFT/Midtown/pool rows are the acknowledged test records. A mismatch or evidence of genuine future member activity blocks deployment; do not infer consent, cancel it, migrate it, or inspect personal fields.

### 3. Verify completed application and recovery (read-only)

All three applied versions/hashes and the restored baseline must match the authoritative state above. Verify catalog `5a0ecdeb48872f4ec2aacebc1d037c14`, retained **46/18/14/1/45** and total notifications **131** against the approved controller evidence. The certain-stop application/recovery is historical and complete; do not rerun it. Do not run cancellation RPCs, cleanup statements or migration application/repair commands. Any discrepancy requires separate review.

### 4. Verify existing backend invariants (read-only)

The template query must return BFT and Midtown inactive and both Island ECC slots active:

```sql
select activity_id, active
  from public.operational_activity_templates
 where activity_id in ('hyrox-bft', 'hyrox-midtown', 'hyrox-quarry-bay-early', 'hyrox-quarry-bay')
 order by activity_id;
```

Expected:

```text
hyrox-bft         false
hyrox-midtown     false
hyrox-quarry-bay-early  true
hyrox-quarry-bay  true
```

Verify the canonical helpers and pool RPC privilege boundary. All three helpers must deny `anon` and `authenticated`; every listed pool RPC must deny both browser roles:

```sql
with expected(signature) as (
  values
    ('public.operational_is_retired_hyrox_activity(text)'),
    ('public.operational_is_retired_hyrox_session(text)'),
    ('public.operational_is_retired_hyrox_booking(uuid)'),
    ('public.ensure_hyrox_cycles(date,integer)'),
    ('public.schedule_hyrox_cycle(text)'),
    ('public.sweep_hyrox_cycle_deadlines(timestamptz)'),
    ('public.leave_hyrox_cycle_queue(uuid)'),
    ('public.reject_hyrox_cycle_payment(uuid,text)'),
    ('public.finalize_hyrox_venue_plan(text)'),
    ('public.finalize_hyrox_venue_plan_locked(text,timestamptz,text,uuid)'),
    ('public.leave_hyrox_venue_switch_queue(uuid)'),
    ('public.close_hyrox_venue_allocation(text)'),
    ('public.set_operational_midtown_open(text,boolean)'),
    ('public.reserve_hyrox_cycle(text,text,boolean)'),
    ('public.join_hyrox_cycle_waitlist(text,text,boolean)'),
    ('public.select_hyrox_cycle_venue(uuid,text)'),
    ('public.join_hyrox_venue_switch_queue(uuid,text)'),
    ('public.cancel_hyrox_cycle(text,text)'),
    ('public.send_hyrox_member_payment_reminders(timestamp with time zone)'),
    ('public.send_hyrox_collector_payment_reminder(timestamp with time zone)'),
    ('public.send_hyrox_venue_reminders(timestamp with time zone)')
)
select signature,
       to_regprocedure(signature) is not null as exists,
       coalesce(has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE'), false)
         as anon_execute,
       coalesce(has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE'), false)
         as authenticated_execute
  from expected
 order by signature;
```

Verify pool tables enforce RLS, expose no browser-readable policy, and grant no browser SELECT or mutation privilege, including inherited PUBLIC access. A re-granted SELECT is drift, even if RLS currently hides rows. For the two pool tables also verify no column-level SELECT grant; do not treat an empty query result as ACL proof:

```sql
with checked(table_name) as (
  values
    ('operational_hyrox_cycles'),
    ('operational_hyrox_queue_entries'),
    ('operational_booking_replacement_requests'),
    ('operational_booking_replacement_audit')
)
select x.table_name,
       c.relrowsecurity as rls_enabled,
       has_any_column_privilege('anon', format('public.%I', x.table_name), 'SELECT') as anon_can_select,
       has_any_column_privilege('authenticated', format('public.%I', x.table_name), 'SELECT') as authenticated_can_select,
       count(p.policyname) as browser_read_policies,
       has_table_privilege('anon', format('public.%I', x.table_name), 'INSERT,UPDATE,DELETE')
         as anon_can_mutate,
       has_table_privilege('authenticated', format('public.%I', x.table_name), 'INSERT,UPDATE,DELETE')
         as authenticated_can_mutate
  from checked x
  join pg_class c on c.oid = format('public.%I', x.table_name)::regclass
  left join pg_policies p
    on p.schemaname = 'public'
   and p.tablename = x.table_name
   and p.cmd = 'SELECT'
 group by x.table_name, c.relrowsecurity
 order by x.table_name;
```

Every row must have `rls_enabled = true`, `browser_read_policies = 0`, and both SELECT and mutation values false. Then rerun the read-only inventory query from step 2. Every retained-domain count, status bucket and digest must equal the restored baseline: retained sessions/cycles/bookings/receipts/notifications **46/18/14/1/45**, total notifications **131**. Unexpected organic activity requires review, not fixture cleanup or baseline rewriting.

Finally verify Island ECC remains present and future direct sessions remain available:

```sql
select t.activity_id, t.active, t.venue, t.capacity, t.price_hkd,
       count(s.id) filter (
         where s.session_date >= (now() at time zone 'Asia/Hong_Kong')::date
       ) as current_and_future_sessions
  from public.operational_activity_templates t
  left join public.operational_sessions s using (activity_id)
 where t.activity_id in ('hyrox-quarry-bay-early', 'hyrox-quarry-bay')
 group by t.activity_id, t.active, t.venue, t.capacity, t.price_hkd;
```

Expected: active `hyrox-quarry-bay-early` (9:15 AM) and `hyrox-quarry-bay` (10:30 AM) templates at Island ECC, each capacity 30 and HK$180, with the expected current/future session window. Any failed check blocks frontend promotion; it does not authorize resolver redeployment.

Verify effective ACLs, not merely explicit migration statements: `service_role` may execute the session classifier only among retirement classifiers/adapters; activity, booking, notification classifiers and all three private policy adapters must deny it. All public classifiers deny PUBLIC/anon/authenticated. The preserved attendee implementation denies PUBLIC/anon/authenticated/service_role, is owned by postgres, stable SECURITY DEFINER with `search_path=public`, and its body must exactly match `20260910000002_operational_attendee_names_rsvp.sql` (body MD5 `64c519f7652df631b654191575a51680`, compare full reviewed source too). The public guarded wrapper and its authenticated grant remain unchanged. Prove BFT/Midtown empty rosters, ECC paid/replacement names without payer transfer, and free RSVP names in disposable local acceptance; use no fixture creation or mutating RPCs for read-only production verification.

For notifications, verify RLS and both complete reviewed policy predicates unchanged; anon has no table or column privileges, authenticated has only table SELECT and column UPDATE(read_at). Inspect every column for SELECT/INSERT/UPDATE/REFERENCES and every table privilege including TRUNCATE/TRIGGER/REFERENCES. No other UPDATE, INSERT, DELETE or TRUNCATE may be effective. Inspect PUBLIC/inherited grants too. Do not execute forbidden mutations to test denial. Read-only production metadata checks plus local member read/read_at and cross-recipient/retired denial tests are required; RLS alone is not evidence of correct grants.

Production defaults remain unchanged: object-specific revokes close this boundary, not all service/legacy/job privileges. Other preserved implementations and generic sweep grants observed in Step 2 remain a separate review item, not claimed owner-only here. No reviewed runtime requires direct service access to the restored attendee helper or notification classifier; the definer wrapper/policy adapters call internally as postgres. The resolver calls only the public session classifier.

After all checks pass, confirm `00001`, `00002` and `00003` remain recorded exactly once with approved hashes and no older history changed. Recovery and Testing acceptance are complete; verify their evidence rather than repeating them. Any STOP blocks promotion. Never repair historical versions.

#### Read-only correction ACL/source gate

Run as the trusted operator in a read-only transaction. Every returned `ok` must be true. These queries do not invoke application RPCs or execute forbidden mutations; preserve the Step 2 full policy/wrapper comparison and count-only inventory gates as well.

```sql
begin transaction isolation level repeatable read read only;
with helpers(signature, service_execute) as (values
  ('public.operational_is_retired_hyrox_activity(text)', false),
  ('public.operational_is_retired_hyrox_booking(uuid)', false),
  ('public.operational_is_retired_hyrox_session(text)', true),
  ('public.operational_notification_is_retired_hyrox(text,text,timestamptz,text,text)', false),
  ('public.get_operational_attendee_names_pre_pool_retirement_20260922(text)', false)
)
select signature,
       not has_function_privilege('anon', signature, 'EXECUTE')
       and not has_function_privilege('authenticated', signature, 'EXECUTE')
       and has_function_privilege('service_role', signature, 'EXECUTE') = service_execute as ok
  from helpers;

with roles(role_name) as (values ('anon'), ('authenticated')),
privileges(privilege) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
  ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'))
select role_name, bool_and(has_table_privilege(role_name, 'public.notifications', privilege)
  = (role_name = 'authenticated' and privilege = 'SELECT')) as ok
from roles cross join privileges group by role_name;

with roles(role_name) as (values ('anon'), ('authenticated')),
privileges(privilege) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES'))
select role_name, bool_and(has_column_privilege(role_name, 'public.notifications', a.attname, privilege)
  = (role_name = 'authenticated' and (privilege = 'SELECT'
       or (privilege = 'UPDATE' and a.attname = 'read_at')))) as ok
from roles cross join privileges cross join pg_attribute a
where a.attrelid = 'public.notifications'::regclass and a.attnum > 0 and not a.attisdropped
 group by role_name;

select p.proname, not has_function_privilege('service_role', p.oid, 'EXECUTE')
  and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  and has_function_privilege('anon', p.oid, 'EXECUTE')
    = (p.proname <> 'operational_notification_is_active') as ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private' and p.proname in
 ('operational_booking_is_active', 'operational_session_is_active', 'operational_notification_is_active');

select md5(prosrc) = '64c519f7652df631b654191575a51680'
  and prosecdef and provolatile = 's' and proconfig = array['search_path=public']
  and pg_get_userbyid(proowner) = 'postgres'
  and not exists (select 1 from aclexplode(proacl) where grantee = 0) as ok
from pg_proc where oid = 'public.get_operational_attendee_names_pre_pool_retirement_20260922(text)'::regprocedure;
rollback;
```

### 5. Verify the already-deployed avatar service-role boundary

Resolver v8 is already deployed with `verify_jwt = true`; no redeployment or secret update is needed for this promotion. After step 4, verify read-only as a trusted operator that `operational_is_retired_hyrox_session(text)` exists, is security-definer with `search_path=public`, denies `PUBLIC`/`anon`/`authenticated`, and grants `service_role` EXECUTE:

```sql
select p.prosecdef, p.proconfig,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
  from pg_proc p
 where p.oid = 'public.operational_is_retired_hyrox_session(text)'::regprocedure;
```

Compare the reviewed checkout with the approved deployed artifact revision; these local commands do not deploy anything:

```bash
git rev-parse HEAD
shasum -a 256 supabase/functions/resolve-profile-avatars/index.ts \
  supabase/functions/_shared/avatar-service.ts
```

Verify the recorded deployed artifact revision (commit plus function/shared-adapter digests and deployment version), target project, JWT enforcement and exact two-origin allowlist above. Do not replace it with placeholders or wildcard origins. An old resolver bypasses RLS through service-role reads: SQL success alone never closes this boundary.

### HISTORICAL — direct endpoint acceptance (completed)

The following reviewed acceptance gates are retained as precedent, not instructions to create fixtures or redeploy on this target. Current promotion verifies the completed evidence and uses only separately authorized bounded read-only probes.

**Direct authenticated endpoint gates**, independent of frontend routing: use disposable approved-member and Admin access tokens (never log tokens or avatar response payloads). Send GET requests directly to `/functions/v1/resolve-profile-avatars?scope=session&sessionId=<URL-encoded-canonical-session-id>` with `Authorization: Bearer <access-token>` and the project's public API key.

- BFT and Midtown retained sessions: HTTP 404 with only `{"error":"Session not found"}`; no attendee identities, avatar payload, or signed URLs. Verify no attendee read/signing occurs using privacy-safe instrumentation in the disposable replica.
- Active Island ECC with disposable attendee/avatar fixtures: HTTP 200 and the expected authorized attendee presentations; confirm signing still works without retaining the URLs or identities in evidence.
- **classifier-failure fail-closed**: on a disposable local replica of the exact artifact, inject a classifier lookup error (or temporarily revoke its service grant there only), then call the authenticated HTTP endpoint. Require HTTP 500 with only `{"error":"Profile photos could not be loaded"}` and zero attendee reads/signing. Restore the local grant and repeat ECC success. Never break the classifier in a shared project to test failure.

Record status, count-only assertions, revision and target, not private payloads. Every gate must pass before endpoint/browser acceptance is declared complete or a preview is accepted. Unit mocks do not substitute for direct HTTP acceptance of the deployed artifact. Recheck BFT/Midtown denial and ECC success on the authorized target after deployment; failure-injection evidence comes from the disposable replica.

### HISTORICAL — pre-preview backend and RPC acceptance

Archived reviewed acceptance requirements, not another fixture run for promotion. This RPC/data-boundary matrix used separately authorized disposable member/Admin sessions; completed evidence and cleanup are now verified read-only.

1. As member and Admin API clients, attempts to select pool cycles/queues must fail or return no rows; retired templates, sessions, bookings, receipts, replacements, and notifications must not hydrate.
2. Pool reservation, waitlist, venue choice/switch, allocation, cancellation, reminder, payment, attendance, and replacement RPCs must be denied before any row, audit, queue, or notification side effect.
3. Exercise Island ECC active RPCs with disposable fixtures: reserve, mark paid, Admin confirm, issue/read receipt, attendance, waitlist where applicable, and replacement acceptance/confirmation. Verify replacement preserves original payer, payment, receipt owner, amount, and direct session.
4. Re-run count-only evidence. Retained rows/statuses and the complete pool-related notification count—including retired/unmatched replacement-review notices—must equal baseline.
5. Remove API fixtures and prove cleanup with count-only queries.

Any failure blocks preview deployment.

### HISTORICAL — reviewed Testing preview deployment

The reviewed preview revision was deployed against the verified backend. The controller confirmed its served selector fix and target project before the final accepted browser run. Promotion uses that accepted artifact, not a new unreviewed preview deployment.

### HISTORICAL — Testing browser acceptance

The archived acceptance matrix below defined the reviewed surfaces and lifecycle requirements. Testing browser acceptance is now PASS; consult credited checks in the final controller-CORS-repaired report, not superseded failures or an assumed rerun. This matrix is retained as precedent, not an instruction to create more fixtures during promotion.

1. Verify Home, Schedule, Profile/history/notifications, Admin Activities, and Admin Payments show both Island ECC slots chronologically, expose no active pool controls or indirect pool counts, and do not clip horizontally.
2. Verify known retired Activity, pool, booking, payment, checkout, and receipt deep links show `This session is no longer available.` and keep the original URL without RPC/avatar calls. Unknown identifiers keep the safe not-found state. Neither redirects to Island ECC.
3. Through the browser UI, complete the full Island ECC lifecycle: reserve → mark paid → Admin confirmation → receipt → attendance, plus waitlist behavior where applicable.
4. Create and accept an Island ECC replacement invite, then confirm it as Admin. Verify only effective attendee ownership changes; payer/payment/receipt ownership remains unchanged.
5. Compare retained count-only evidence again, confirm no retirement notification was created, remove all preview fixtures, and prove cleanup.

Record fixture UUIDs and bounded UTC timestamps only. Never retain names, emails, tokens, payment references, notification bodies, or screenshots containing personal data. Any failure blocks production promotion.

### 6. Promote the exact accepted snapshot

Follow the authoritative executable promotion sequence above: verify the accepted artifact, obtain promotion authorization, confirm its served revision, and perform bounded read-only canonical-route/browser-denial/configuration/count checks. Recovery and fixture cleanup are complete; do not repeat lifecycle mutations or create new fixtures.

A failed or unexecuted backend or preview gate blocks promotion. Frontend rollback alone does not restore pool access and must never point old pool UI at the migrated backend.

## Forward-only rollback

Rollback is a forward-only rollback: preserve all retained rows and write a new, separately reviewed forward migration that explicitly restores any intended template activation, policies, grants, functions, and provisioning. Pair it with a compatible frontend deployment and compatible avatar Edge Function artifact in backend-first order. Keep the fail-closed resolver while retirement is intended; never roll back to the old service-role resolver that bypasses classification. Any intentional reopening must review the database, Edge Function and frontend together, deploy SQL prerequisites first, then the compatible resolver, rerun direct endpoint gates, and only then accept the frontend.

Never edit or replay applied migration history. Never delete or mark down `20260922000001_retire_bft_midtown_hyrox_pool.sql`, alter historical pool migrations, drop/truncate retained tables, or reconstruct state from browser caches. If only the retirement frontend is defective, redeploy a reviewed compatible frontend that keeps pool entry points unavailable while the backend boundary remains in force.

## Post-application promotion checklist

- [ ] Accepted frontend artifact revision and all three applied migration hashes verified.
- [ ] `00001`, `00002`, `00003` each recorded exactly once on `krxbvgyolxvmzgysfjkj`; older history unchanged; no replay/reapply/repair.
- [ ] Catalog pin, pool ACL denial, template/helper/notification/shared-RPC invariants and Island ECC availability verified read-only.
- [ ] Completed recovery/cleanup evidence verified: baseline restored, retained **46/18/14/1/45** and notifications **131**; no recovery rerun.
- [ ] Resolver v8/JWT, approved artifact revision, exact two-origin allowlist and completed direct endpoint evidence verified; no redeployment or secret rewrite.
- [ ] Final Testing Chrome/Safari acceptance PASS and selector/CORS completion evidence bound to the accepted runtime artifact.
- [ ] Historical application/recovery precedent and clean disposable replay kept distinct from current operations.
- [ ] Separate promotion authorization obtained; exact accepted snapshot served; bounded read-only production checks recorded without personal data or new fixtures.
