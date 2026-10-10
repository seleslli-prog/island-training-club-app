-- Island Training Club — shared HYROX operational backend integration tests
--
-- Plain SQL covering schema, RLS, RPCs, atomicity, and seed. Each scenario
-- is scoped inside an explicit transaction. Tests use raise notice to
-- surface failures; the verifier observes non-zero exit from psql.
--
-- Run after every ordered migration through
-- supabase/tests/verify_operational_backend.sh against a disposable
-- Supabase-compatible database.

\set ON_ERROR_STOP on

create function pg_temp.op_assert(ok boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'verification failed: %', message;
  end if;
end;
$$;

-- Helper: claim the current role/sub as a SQL session and run a snippet.
-- Used so each scenario can switch callers without losing state.
create function pg_temp.op_as(p_sub uuid, p_role text, p_body text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  set local role authenticated;
  execute replace(p_body, '{{SUB}}', p_sub::text);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

-- =====================================================================
-- Schema foundations
-- =====================================================================

do $$
declare failures integer := 0;
begin
  if to_regclass('public.operational_activity_templates') is null then
    raise notice 'FAIL: operational_activity_templates missing'; failures := failures + 1;
  end if;
  if to_regclass('public.operational_sessions') is null then
    raise notice 'FAIL: operational_sessions missing'; failures := failures + 1;
  end if;
  if to_regclass('public.operational_bookings') is null then
    raise notice 'FAIL: operational_bookings missing'; failures := failures + 1;
  end if;
  if to_regclass('public.operational_queue_entries') is null then
    raise notice 'FAIL: operational_queue_entries missing'; failures := failures + 1;
  end if;
  if to_regclass('public.operational_receipts') is null then
    raise notice 'FAIL: operational_receipts missing'; failures := failures + 1;
  end if;
  if to_regclass('public.collector_assignments') is null then
    raise notice 'FAIL: collector_assignments missing'; failures := failures + 1;
  end if;
  if to_regclass('public.collector_payout_profiles') is null then
    raise notice 'FAIL: collector_payout_profiles missing'; failures := failures + 1;
  end if;
  if to_regprocedure('public.get_assigned_collector_payout_profiles()') is null then
    raise notice 'FAIL: get_assigned_collector_payout_profiles missing'; failures := failures + 1;
  else
    if not has_function_privilege(
      'authenticated',
      'public.get_assigned_collector_payout_profiles()',
      'execute'
    ) then
      raise notice 'FAIL: authenticated cannot execute assigned collector payout RPC';
      failures := failures + 1;
    end if;
    if has_function_privilege(
      'anon',
      'public.get_assigned_collector_payout_profiles()',
      'execute'
    ) then
      raise notice 'FAIL: anon should not execute assigned collector payout RPC';
      failures := failures + 1;
    end if;
  end if;
  if to_regclass('public.operational_session_venue_overrides') is null then
    raise notice 'FAIL: operational_session_venue_overrides missing'; failures := failures + 1;
  end if;
  if to_regclass('public.operational_rsvp_counts') is null then
    raise notice 'FAIL: operational_rsvp_counts missing'; failures := failures + 1;
  elsif not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'operational_rsvp_counts'
       and c.relrowsecurity
  ) then
    raise notice 'FAIL: operational_rsvp_counts RLS not enabled'; failures := failures + 1;
  elsif (
    select array_agg(column_name::text order by ordinal_position)
      from information_schema.columns
     where table_schema = 'public' and table_name = 'operational_rsvp_counts'
  ) <> array['session_id', 'going_count', 'updated_at']::text[] then
    raise notice 'FAIL: operational_rsvp_counts exposes unexpected columns'; failures := failures + 1;
  end if;
  if not has_table_privilege('anon', 'public.operational_rsvp_counts', 'select')
      or not has_table_privilege('authenticated', 'public.operational_rsvp_counts', 'select') then
    raise notice 'FAIL: public browser roles cannot read RSVP counts'; failures := failures + 1;
  end if;
  if has_table_privilege('anon', 'public.operational_rsvp_counts', 'insert,update,delete')
      or has_table_privilege('authenticated', 'public.operational_rsvp_counts', 'insert,update,delete') then
    raise notice 'FAIL: browser roles can write RSVP counts'; failures := failures + 1;
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'operational_rsvp_counts'
       and cmd = 'SELECT'
       and roles = array['public']::name[]
       and qual = 'true'
  ) then
    raise notice 'FAIL: operational_rsvp_counts public SELECT policy missing'; failures := failures + 1;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'operational_rsvp_counts'
  ) then
    raise notice 'FAIL: operational_rsvp_counts missing from Realtime publication'; failures := failures + 1;
  end if;
  if has_function_privilege('anon', 'public.recalculate_operational_rsvp_count(text)', 'execute')
      or has_function_privilege('authenticated', 'public.recalculate_operational_rsvp_count(text)', 'execute')
      or has_function_privilege('anon', 'public.sync_operational_rsvp_count()', 'execute')
      or has_function_privilege('authenticated', 'public.sync_operational_rsvp_count()', 'execute') then
    raise notice 'FAIL: browser roles can execute RSVP count trigger helpers'; failures := failures + 1;
  end if;
  if has_function_privilege('anon', 'public.reserve_operational_session(text)', 'execute')
      or not has_function_privilege('authenticated', 'public.reserve_operational_session(text)', 'execute')
      or has_function_privilege('anon', 'public.withdraw_operational_rsvp(uuid)', 'execute')
      or not has_function_privilege('authenticated', 'public.withdraw_operational_rsvp(uuid)', 'execute') then
    raise notice 'FAIL: RSVP mutation RPC ACLs violate least privilege'; failures := failures + 1;
  end if;
  if to_regprocedure('public.release_operational_reservation(uuid)') is null
      or exists (
        select 1
          from pg_proc p
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
         where p.oid = 'public.release_operational_reservation(uuid)'::regprocedure
           and acl.grantee = 0
           and acl.privilege_type = 'EXECUTE'
      )
      or has_function_privilege('anon', 'public.release_operational_reservation(uuid)', 'execute')
      or not has_function_privilege('authenticated', 'public.release_operational_reservation(uuid)', 'execute') then
    raise notice 'FAIL: release reservation RPC ACLs violate least privilege'; failures := failures + 1;
  end if;
  if exists (
    select 1
      from pg_proc p
     where p.oid in (
       'public.resolve_notification_destination(uuid,text,timestamptz)'::regprocedure,
       'public.resolve_historical_booking_notification_destination(uuid,text,timestamptz)'::regprocedure,
       'public.resolve_historical_notification_event_destination(uuid,text,timestamptz)'::regprocedure,
       'public.route_notification_destination()'::regprocedure
     )
       and (not p.prosecdef or not coalesce(p.proconfig @> array['search_path=public']::text[], false))
  ) then
    raise notice 'FAIL: notification routing functions must be SECURITY DEFINER with search_path=public'; failures := failures + 1;
  end if;
  if has_function_privilege('anon', 'public.resolve_notification_destination(uuid,text,timestamptz)', 'execute')
      or has_function_privilege('authenticated', 'public.resolve_notification_destination(uuid,text,timestamptz)', 'execute')
      or has_function_privilege('anon', 'public.resolve_historical_booking_notification_destination(uuid,text,timestamptz)', 'execute')
      or has_function_privilege('authenticated', 'public.resolve_historical_booking_notification_destination(uuid,text,timestamptz)', 'execute')
      or has_function_privilege('anon', 'public.resolve_historical_notification_event_destination(uuid,text,timestamptz)', 'execute')
      or has_function_privilege('authenticated', 'public.resolve_historical_notification_event_destination(uuid,text,timestamptz)', 'execute')
      or has_function_privilege('anon', 'public.route_notification_destination()', 'execute')
      or has_function_privilege('authenticated', 'public.route_notification_destination()', 'execute') then
    raise notice 'FAIL: browser roles can execute notification routing functions'; failures := failures + 1;
  end if;
  if exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'operational_bookings'
       and t.tgname = 'sync_operational_rsvp_count'
       and not t.tgisinternal
  ) then
    raise notice 'FAIL: broad RSVP count trigger still exists'; failures := failures + 1;
  end if;
  if (
    select array_agg(t.tgname order by t.tgname)
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'operational_bookings'
       and t.tgname like 'sync_operational_rsvp_count_%'
       and not t.tgisinternal
  ) <> array[
    'sync_operational_rsvp_count_delete',
    'sync_operational_rsvp_count_insert',
    'sync_operational_rsvp_count_update'
  ]::name[] then
    raise notice 'FAIL: selective RSVP count triggers are incomplete'; failures := failures + 1;
  end if;
  if not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'operational_bookings'
       and t.tgname = 'sync_operational_rsvp_count_update'
       and pg_get_triggerdef(t.oid) like '%UPDATE OF status, session_id%'
  ) then
    raise notice 'FAIL: RSVP update trigger is not status/session scoped'; failures := failures + 1;
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'notifications'
       and column_name = 'destination'
  ) then
    raise notice 'FAIL: notifications.destination missing'; failures := failures + 1;
  end if;
  if to_regprocedure('public.resolve_notification_destination(uuid,text,timestamptz)') is null then
    raise notice 'FAIL: exact notification destination resolver missing'; failures := failures + 1;
  end if;
  if to_regprocedure('public.resolve_historical_booking_notification_destination(uuid,text,timestamptz)') is null then
    raise notice 'FAIL: historical booking notification destination resolver missing'; failures := failures + 1;
  end if;
  if to_regprocedure('public.route_notification_destination()') is null then
    raise notice 'FAIL: notification destination trigger function missing'; failures := failures + 1;
  end if;
  if not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'notifications'
       and t.tgname = 'notifications_route_destination'
       and not t.tgisinternal
  ) then
    raise notice 'FAIL: notification destination trigger missing'; failures := failures + 1;
  end if;
  if has_function_privilege(
    'anon',
    'public.resolve_notification_destination(uuid,text,timestamptz)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.resolve_notification_destination(uuid,text,timestamptz)',
    'execute'
  ) then
    raise notice 'FAIL: browser roles can execute notification destination resolver';
    failures := failures + 1;
  end if;
  if has_function_privilege(
    'anon',
    'public.resolve_historical_booking_notification_destination(uuid,text,timestamptz)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.resolve_historical_booking_notification_destination(uuid,text,timestamptz)',
    'execute'
  ) then
    raise notice 'FAIL: browser roles can execute historical booking notification resolver';
    failures := failures + 1;
  end if;
  if has_function_privilege(
    'anon',
    'public.route_notification_destination()',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.route_notification_destination()',
    'execute'
  ) then
    raise notice 'FAIL: browser roles can execute notification destination trigger function';
    failures := failures + 1;
  end if;
  if not exists (
    select 1 from public.operational_activity_templates
    where activity_id = 'hyrox-bft' and capacity = 20 and price_hkd = 180 and venue = 'BFT Causeway Bay'
  ) then
    raise notice 'FAIL: hyrox-bft activity template seed missing'; failures := failures + 1;
  end if;
  if exists (
    select 1 from public.operational_activity_templates where activity_id = 'hyrox'
  ) then
    raise notice 'FAIL: ambiguous legacy hyrox activity template remains'; failures := failures + 1;
  end if;
  if not exists (
    select 1 from public.operational_activity_templates
    where activity_id = 'hyrox-midtown'
      and capacity = 12
      and price_hkd = 180
      and venue = 'Midtown28 Fitness'
  ) then
    raise notice 'FAIL: corrected hyrox-midtown activity template seed missing';
    failures := failures + 1;
  end if;
  if not exists (
    select 1 from public.operational_activity_templates
    where activity_id = 'hyrox-quarry-bay'
      and weekday = 6
      and start_time = '10:30'::time
      and duration_minutes = 60
      and capacity = 30
      and price_hkd = 180
      and default_open
      and active
      and venue = '10/F, Island ECC, Quarry Bay'
      and maps_query = 'Island ECC, Quarry Bay, Hong Kong'
  ) then
    raise notice 'FAIL: later Island ECC HYROX activity template seed missing';
    failures := failures + 1;
  end if;
  if not exists (
    select 1 from public.operational_activity_templates
    where activity_id = 'hyrox-quarry-bay-early'
      and weekday = 6
      and start_time = '09:15'::time
      and duration_minutes = 60
      and capacity = 30
      and price_hkd = 180
      and default_open
      and active
      and venue = '10/F, Island ECC, Quarry Bay'
      and maps_query = 'Island ECC, Quarry Bay, Hong Kong'
  ) then
    raise notice 'FAIL: early Island ECC HYROX activity template seed missing';
    failures := failures + 1;
  end if;
  if exists (
    select 1 from public.operational_sessions
    where activity_id in ('hyrox-quarry-bay-early', 'hyrox-quarry-bay')
      and capacity <> 30
  ) then
    raise notice 'FAIL: every Island ECC HYROX session must have capacity 30';
    failures := failures + 1;
  end if;
  perform 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'operational_sessions' and c.relrowsecurity;
  if not found then
    raise notice 'FAIL: operational_sessions RLS not enabled'; failures := failures + 1;
  end if;
  perform 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'operational_session_venue_overrides' and c.relrowsecurity;
  if not found then
    raise notice 'FAIL: operational_session_venue_overrides RLS not enabled'; failures := failures + 1;
  end if;
  if not has_function_privilege('authenticated', 'public.set_session_venue(text, text, text, boolean)', 'execute') then
    raise notice 'FAIL: authenticated cannot execute set_session_venue'; failures := failures + 1;
  end if;
  if has_function_privilege('anon', 'public.set_session_venue(text, text, text, boolean)', 'execute') then
    raise notice 'FAIL: anon should not execute set_session_venue'; failures := failures + 1;
  end if;
  if to_regprocedure('public.set_session_venue(text,text,text,boolean,double precision,double precision)') is null then
    raise notice 'FAIL: six-argument meeting-point RPC missing'; failures := failures + 1;
  elsif not has_function_privilege(
    'authenticated',
    'public.set_session_venue(text,text,text,boolean,double precision,double precision)',
    'execute'
  ) then
    raise notice 'FAIL: authenticated cannot execute meeting-point RPC'; failures := failures + 1;
  elsif has_function_privilege(
    'anon',
    'public.set_session_venue(text,text,text,boolean,double precision,double precision)',
    'execute'
  ) then
    raise notice 'FAIL: anon should not execute meeting-point RPC'; failures := failures + 1;
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'operational_session_venue_overrides'
       and column_name = 'meeting_lat'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'operational_session_venue_overrides'
       and column_name = 'meeting_lng'
  ) then
    raise notice 'FAIL: venue meeting-point columns missing'; failures := failures + 1;
  end if;
  if to_regclass('public.operational_hyrox_cycles') is null then
    raise notice 'FAIL: operational_hyrox_cycles missing'; failures := failures + 1;
  else
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'operational_hyrox_cycles'
         and c.relrowsecurity
    ) then
      raise notice 'FAIL: operational_hyrox_cycles RLS not enabled'; failures := failures + 1;
    end if;
    if not has_table_privilege('anon', 'public.operational_hyrox_cycles', 'select')
        or not has_table_privilege('authenticated', 'public.operational_hyrox_cycles', 'select') then
      raise notice 'FAIL: browser roles cannot read HYROX cycles'; failures := failures + 1;
    end if;
    if has_table_privilege('anon', 'public.operational_hyrox_cycles', 'insert,update,delete')
        or has_table_privilege('authenticated', 'public.operational_hyrox_cycles', 'insert,update,delete') then
      raise notice 'FAIL: browser roles can write HYROX cycles'; failures := failures + 1;
    end if;
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'operational_hyrox_cycles'
         and column_name = 'registration_opens_at'
    ) or not exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'operational_hyrox_cycles'
         and column_name = 'holder_grace_deadline_at'
    ) or not exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'operational_hyrox_cycles'
         and column_name = 'promoted_payment_deadline_at'
    ) then
      raise notice 'FAIL: HYROX lifecycle checkpoint columns missing'; failures := failures + 1;
    end if;
  end if;
  if to_regclass('public.operational_hyrox_queue_entries') is null then
    raise notice 'FAIL: operational_hyrox_queue_entries missing'; failures := failures + 1;
  else
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'operational_hyrox_queue_entries'
         and c.relrowsecurity
    ) then
      raise notice 'FAIL: operational_hyrox_queue_entries RLS not enabled'; failures := failures + 1;
    end if;
    if has_table_privilege('anon', 'public.operational_hyrox_queue_entries', 'select')
        or not has_table_privilege('authenticated', 'public.operational_hyrox_queue_entries', 'select') then
      raise notice 'FAIL: HYROX cycle queue read privileges are incorrect'; failures := failures + 1;
    end if;
    if has_table_privilege('anon', 'public.operational_hyrox_queue_entries', 'insert,update,delete')
        or has_table_privilege('authenticated', 'public.operational_hyrox_queue_entries', 'insert,update,delete') then
      raise notice 'FAIL: browser roles can write HYROX cycle queues'; failures := failures + 1;
    end if;
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'operational_bookings'
       and column_name = 'hyrox_cycle_id'
  ) then
    raise notice 'FAIL: operational_bookings.hyrox_cycle_id missing'; failures := failures + 1;
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'operational_bookings'
       and column_name = 'promoted_from_waitlist_at'
  ) then
    raise notice 'FAIL: operational_bookings.promoted_from_waitlist_at missing'; failures := failures + 1;
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'operational_bookings'
       and column_name = 'session_id'
       and is_nullable = 'YES'
  ) then
    raise notice 'FAIL: pooled operational bookings cannot be unallocated'; failures := failures + 1;
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'operational_receipts'
       and column_name = 'hyrox_cycle_id'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'operational_receipts'
       and column_name = 'session_id'
       and is_nullable = 'YES'
  ) then
    raise notice 'FAIL: pooled operational receipt scope missing'; failures := failures + 1;
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'operational_bookings'
       and column_name = 'attended_at' and data_type = 'timestamp with time zone'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'operational_bookings'
       and column_name = 'attended_by' and data_type = 'uuid'
  ) then
    raise notice 'FAIL: operational attendance audit columns missing'; failures := failures + 1;
  end if;
  if to_regprocedure('public.set_operational_attendance(uuid,boolean)') is null
      or has_function_privilege('anon', 'public.set_operational_attendance(uuid,boolean)', 'execute')
      or not has_function_privilege('authenticated', 'public.set_operational_attendance(uuid,boolean)', 'execute') then
    raise notice 'FAIL: attendance RPC ACLs violate least privilege'; failures := failures + 1;
  end if;
  if failures > 0 then raise exception 'schema failures: %', failures; end if;
  raise notice 'OK: operational schema foundations';
end $$;

-- =====================================================================
-- Member RPCs (Tasks 2-4)
-- =====================================================================

begin;

-- Auth fixtures and profiles.
insert into auth.users (id, email, raw_user_meta_data) values
  ('aa000000-0000-0000-0000-00000000a001', 'admin-test@itc.invalid', '{}'::jsonb),
  ('bb000000-0000-0000-0000-00000000b001', 'member-test@itc.invalid', '{}'::jsonb),
  ('cc000000-0000-0000-0000-00000000c001', 'pending-test@itc.invalid', '{}'::jsonb),
  ('dd000000-0000-0000-0000-00000000d001', 'other-test@itc.invalid', '{}'::jsonb),
  ('ee000000-0000-0000-0000-00000000e001', 'extra-member@itc.invalid', '{}'::jsonb),
  ('ff000000-0000-0000-0000-00000000f001', 'super-test@itc.invalid', '{}'::jsonb),
  ('ab000000-0000-0000-0000-00000000d001', 'declined-test@itc.invalid', '{}'::jsonb);

update public.profiles set full_name = 'Admin Test', role = 'admin'
  where id = 'aa000000-0000-0000-0000-00000000a001';
update public.profiles set full_name = 'Member Test', role = 'member'
  where id = 'bb000000-0000-0000-0000-00000000b001';
update public.profiles set full_name = 'Pending Test', role = 'pending'
  where id = 'cc000000-0000-0000-0000-00000000c001';
update public.profiles set full_name = 'Other Test', role = 'member'
  where id = 'dd000000-0000-0000-0000-00000000d001';
update public.profiles set full_name = 'Extra Member', role = 'member'
  where id = 'ee000000-0000-0000-0000-00000000e001';
update public.profiles set full_name = 'Super Test', role = 'super_admin'
  where id = 'ff000000-0000-0000-0000-00000000f001';
update public.profiles set full_name = 'Declined Test', role = 'declined'
  where id = 'ab000000-0000-0000-0000-00000000d001';

-- Assigned payout reads add only the collector rows needed by approved members.
-- Membership Details is authoritative for FPS, including collectors who have
-- not created an optional PayMe payout profile.
insert into public.applications
  (profile_id, mobile, preferred_name, is_minor, photo_consent, privacy_accepted_at)
values
  ('aa000000-0000-0000-0000-00000000a001', '+852 6333 3003', 'Jerry', false, false, now()),
  ('dd000000-0000-0000-0000-00000000d001', '+852 6555 5005', 'Other', false, false, now()),
  ('ff000000-0000-0000-0000-00000000f001', '+852 6444 4004', 'Super', false, false, now());

insert into public.collector_assignments
  (week_start, collector_profile_id, assigned_by)
values
  (date '2026-08-03',
   'aa000000-0000-0000-0000-00000000a001',
   'ff000000-0000-0000-0000-00000000f001'),
  (date '2026-08-10',
   'dd000000-0000-0000-0000-00000000d001',
   'ff000000-0000-0000-0000-00000000f001');

insert into public.collector_payout_profiles
  (profile_id, payme_link, fps_phone)
values
  ('aa000000-0000-0000-0000-00000000a001',
   'https://payme.hsbc.com.hk/1/assigned-admin',
   '+852 6111 1001'),
  ('ff000000-0000-0000-0000-00000000f001',
   'https://payme.hsbc.com.hk/1/unassigned-super',
   '+852 6222 2002');

do $$
declare
  v_direct_count integer;
  v_assigned_count integer;
  v_no_payout_count integer;
  v_unassigned_count integer;
begin
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;

  select count(*) into v_direct_count
    from public.collector_payout_profiles
   where profile_id in (
     'aa000000-0000-0000-0000-00000000a001',
     'ff000000-0000-0000-0000-00000000f001'
   );
  perform pg_temp.op_assert(
    v_direct_count = 0,
    'member direct payout-table RLS remains self-only'
  );

  select count(*) into v_assigned_count
    from public.get_assigned_collector_payout_profiles()
   where profile_id = 'aa000000-0000-0000-0000-00000000a001'
     and payme_link = 'https://payme.hsbc.com.hk/1/assigned-admin'
     and fps_phone = '+852 6333 3003'
     and full_name = 'Admin Test'
     and preferred_name = 'Jerry';
  perform pg_temp.op_assert(
    v_assigned_count = 1,
    'approved member reads assigned PayMe with FPS from applications.mobile'
  );

  reset role;
  update public.applications
     set mobile = '+852 6333 3999'
   where profile_id = 'aa000000-0000-0000-0000-00000000a001';
  set local role authenticated;
  select count(*) into v_assigned_count
    from public.get_assigned_collector_payout_profiles()
   where profile_id = 'aa000000-0000-0000-0000-00000000a001'
     and fps_phone = '+852 6333 3999';
  perform pg_temp.op_assert(
    v_assigned_count = 1,
    'changing applications.mobile updates assigned FPS without a payout save'
  );

  select count(*) into v_no_payout_count
    from public.get_assigned_collector_payout_profiles()
   where profile_id = 'dd000000-0000-0000-0000-00000000d001'
     and payme_link is null
     and fps_phone = '+852 6555 5005'
     and full_name = 'Other Test'
     and preferred_name = 'Other';
  perform pg_temp.op_assert(
    v_no_payout_count = 1,
    'assigned FPS remains available without a collector payout profile'
  );

  select count(*) into v_unassigned_count
    from public.get_assigned_collector_payout_profiles()
   where profile_id = 'ff000000-0000-0000-0000-00000000f001';
  perform pg_temp.op_assert(
    v_unassigned_count = 0,
    'approved member cannot read an unassigned payout row through the RPC'
  );

  perform set_config('request.jwt.claim.sub', 'cc000000-0000-0000-0000-00000000c001', true);
  begin
    perform public.get_assigned_collector_payout_profiles();
    raise exception 'pending profile should not read assigned collector payouts';
  exception when others then
    if sqlerrm not like '%Approved membership required.%' then raise; end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.get_assigned_collector_payout_profiles();
    raise exception 'anonymous session should not read assigned collector payouts';
  exception when others then
    if sqlerrm not like '%Authentication required.%' then raise; end if;
  end;
end $$;

-- Prove the actual migration backfills bookings that predate its trigger. The
-- The disposable verifier applied 00008 and its forward locking correction
-- during setup. Remove every count trigger, create pre-migration rows, then
-- reapply 00008 followed by the forward correction in deployment order.
drop trigger if exists sync_operational_rsvp_count on public.operational_bookings;
drop trigger if exists sync_operational_rsvp_count_insert on public.operational_bookings;
drop trigger if exists sync_operational_rsvp_count_delete on public.operational_bookings;
drop trigger if exists sync_operational_rsvp_count_update on public.operational_bookings;

do $$
declare
  v_backfill_date date := (now() at time zone 'Asia/Hong_Kong')::date + 403;
  v_backfill_session text;
begin
  v_backfill_session := 'lunch-' || v_backfill_date::text;

  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open)
  values
    (v_backfill_session, 'lunch', v_backfill_date, time '12:45', 75,
     'TBC', null, 0, true)
  on conflict (id) do update
    set session_date = excluded.session_date,
        start_time = excluded.start_time,
        cancelled_at = null,
        cancelled_by = null,
        cancelled_source = null,
        cancel_reason = null,
        capacity = null,
        price_hkd = 0,
        is_open = true;

  delete from public.operational_bookings
   where session_id = v_backfill_session;
  delete from public.operational_rsvp_counts
   where session_id = v_backfill_session;

  insert into public.operational_bookings
    (profile_id, session_id, status, pay_deadline_at, paid_at, snapshot)
  values
    ('bb000000-0000-0000-0000-00000000b001', v_backfill_session,
     'confirmed', now(), now(),
     jsonb_build_object('name', 'Post-Training Lunch',
       'session_date', v_backfill_date, 'start_time', '12:45',
       'venue', 'TBC', 'price_hkd', 0)),
    ('dd000000-0000-0000-0000-00000000d001', v_backfill_session,
     'confirmed', now(), now(),
     jsonb_build_object('name', 'Post-Training Lunch',
       'session_date', v_backfill_date, 'start_time', '12:45',
       'venue', 'TBC', 'price_hkd', 0));

  perform pg_temp.op_assert(
    not exists (
      select 1 from public.operational_rsvp_counts
       where session_id = v_backfill_session
    ),
    'pre-migration RSVP fixture has no copied count row'
  );
end $$;

\ir ../migrations/20260829000008_rsvp_integrity.sql
\ir ../migrations/20260830000001_rsvp_count_trigger_locking.sql
\ir ../migrations/20260903000002_hyrox_cycle_member_rpcs.sql

do $$
declare
  v_backfill_date date := (now() at time zone 'Asia/Hong_Kong')::date + 403;
  v_backfill_session text;
begin
  v_backfill_session := 'lunch-' || v_backfill_date::text;

  perform pg_temp.op_assert(
    (select going_count = 2
       from public.operational_rsvp_counts
      where session_id = v_backfill_session),
    'actual 00008 migration backfills two preexisting confirmed RSVPs'
  );

  delete from public.operational_bookings
   where session_id = v_backfill_session
     and profile_id = 'bb000000-0000-0000-0000-00000000b001';
  perform pg_temp.op_assert(
    (select going_count = 1
       from public.operational_rsvp_counts
      where session_id = v_backfill_session),
    'booking DELETE decrements the exact RSVP total from two to one'
  );

  delete from public.operational_bookings
   where session_id = v_backfill_session
     and profile_id = 'dd000000-0000-0000-0000-00000000d001';
  perform pg_temp.op_assert(
    (select going_count = 0
       from public.operational_rsvp_counts
      where session_id = v_backfill_session),
    'final booking DELETE retains the exact zero RSVP total'
  );
end $$;

-- Future-guarded scenarios use Saturdays derived from the current Hong Kong
-- date. Two weeks of lead time keeps both paid and RSVP fixtures safely ahead
-- of their start guards even when the database session uses another timezone.
create temp table operational_time_fixtures (
  base_date date not null,
  paid_session text not null,
  midtown_session text not null,
  admin_paid_session text not null,
  defer_target_session text not null,
  cancel_session text not null,
  cancel_midtown_session text not null,
  receipt_session text not null,
  routing_date date not null,
  routing_paid_session text not null,
  routing_midtown_session text not null,
  routing_rsvp_session text not null,
  window_last_session text not null,
  unique_cancel_date date not null,
  unique_cancel_session text not null,
  historical_cancel_session text not null
) on commit drop;

with hkt_clock as (
  select (current_timestamp at time zone 'Asia/Hong_Kong')::date as today
), fixture_date as (
  select today + ((6 - extract(dow from today)::integer + 7) % 7) + 14 as base_date
    from hkt_clock
)
insert into operational_time_fixtures
select base_date,
       'hyrox-bft-' || base_date::text,
       'hyrox-midtown-' || base_date::text,
       'hyrox-bft-' || (base_date + 7)::text,
       'hyrox-bft-' || (base_date + 14)::text,
       'hyrox-bft-' || (base_date + 21)::text,
       'hyrox-midtown-' || (base_date + 21)::text,
       'hyrox-bft-' || (base_date + 28)::text,
       base_date + 42,
       'hyrox-bft-' || (base_date + 42)::text,
       'hyrox-midtown-' || (base_date + 42)::text,
       'lunch-' || (base_date + 42)::text,
       'hyrox-bft-' || (base_date + 105)::text,
       base_date + 126,
       'hyrox-bft-' || (base_date + 126)::text,
       'hyrox-midtown-' || (base_date + 49)::text
  from fixture_date;

select ensure_operational_sessions(base_date, 16)
  from operational_time_fixtures;

-- Keep the expired static cancellation fixture: cancellation must win before
-- the paid-session future guard.
select ensure_operational_sessions(date '2026-08-01', 5);
update public.operational_sessions
   set cancelled_at = now(),
       cancelled_by = null,
       cancelled_source = 'system',
       cancel_reason = 'HYROX race weekend'
 where id in ('hyrox-bft-2026-08-15', 'hyrox-midtown-2026-08-15');

-- RSVP integrity: exact public counts, requires_rsvp enforcement, Hong Kong
-- start boundaries, and preservation of paid/uncapped reservation behavior.
do $$
declare
  v_member_a        constant uuid := 'bb000000-0000-0000-0000-00000000b001';
  v_member_b        constant uuid := 'dd000000-0000-0000-0000-00000000d001';
  v_member_c        constant uuid := 'ee000000-0000-0000-0000-00000000e001';
  v_admin           constant uuid := 'aa000000-0000-0000-0000-00000000a001';
  v_super           constant uuid := 'ff000000-0000-0000-0000-00000000f001';
  v_future_hk       timestamp := (now() + interval '1 hour') at time zone 'Asia/Hong_Kong';
  v_at_start_hk     timestamp := now() at time zone 'Asia/Hong_Kong';
  v_hk_today        date := (now() at time zone 'Asia/Hong_Kong')::date;
  v_count_date      date := (now() at time zone 'Asia/Hong_Kong')::date + 400;
  v_paid_date       date := (now() at time zone 'Asia/Hong_Kong')::date + 401;
  v_free_date       date := (now() at time zone 'Asia/Hong_Kong')::date + 402;
  v_count_session   text;
  v_paid_session    text;
  v_paid_same_day_session text;
  v_paid_next_day_session text;
  v_free_session    text;
  v_boundary_before_session text;
  v_boundary_at_session text;
  v_free_booking    uuid;
  v_boundary_before_booking uuid;
  v_boundary_at_booking uuid;
  v_paid_booking    uuid;
  v_paid_next_day_booking uuid;
  v_lunch_booking   uuid;
  v_going_count     bigint;
  v_visible_count   integer;
begin
  v_count_session := 'lunch-' || v_count_date::text;
  v_paid_session := 'hyrox-bft-' || v_paid_date::text;
  v_paid_same_day_session := 'event-paid-integrity-' || v_hk_today::text;
  v_paid_next_day_session := 'event-paid-integrity-' || (v_hk_today + 1)::text;
  v_free_session := 'event-free-integrity-' || v_free_date::text;
  v_boundary_before_session := 'event-rsvp-boundary-before-' || v_future_hk::date::text;
  v_boundary_at_session := 'event-rsvp-boundary-at-' || v_at_start_hk::date::text;

  insert into public.operational_activity_templates
    (activity_id, name, venue, weekday, start_time, duration_minutes,
     capacity, price_hkd, default_open, active, category, maps_query, requires_rsvp)
  values
    ('event-free-integrity', 'Integrity Free Event', 'Tamar Park',
     extract(dow from v_free_date)::integer, time '19:00', 60,
     20, 0, true, false, 'Socials', 'Tamar Park', false),
    ('event-paid-integrity', 'Integrity Paid Event', 'BFT Causeway Bay',
     extract(dow from v_hk_today)::integer, time '23:59:59', 60,
     20, 180, true, false, 'HYROX', 'BFT Causeway Bay', false),
    ('event-rsvp-boundary-before', 'Boundary RSVP Before', 'TBC',
     extract(dow from v_future_hk::date)::integer, v_future_hk::time, 60,
     null, 0, true, false, 'Socials', null, true),
    ('event-rsvp-boundary-at', 'Boundary RSVP At', 'TBC',
     extract(dow from v_at_start_hk::date)::integer, v_at_start_hk::time, 60,
     null, 0, true, false, 'Socials', null, true)
  on conflict (activity_id) do update
    set start_time = excluded.start_time,
        capacity = excluded.capacity,
        price_hkd = excluded.price_hkd,
        requires_rsvp = excluded.requires_rsvp,
        active = excluded.active;

  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open)
  values
    (v_count_session, 'lunch', v_count_date, time '12:45', 75,
     'TBC', null, 0, true),
    (v_paid_session, 'hyrox-bft', v_paid_date, time '11:15', 60,
     'BFT Causeway Bay', 20, 180, true),
    (v_paid_same_day_session, 'event-paid-integrity', v_hk_today,
     time '23:59:59.999999', 60, 'BFT Causeway Bay', 20, 180, true),
    (v_paid_next_day_session, 'event-paid-integrity', v_hk_today + 1,
     time '00:00', 60, 'BFT Causeway Bay', 20, 180, true),
    (v_free_session, 'event-free-integrity', v_free_date, time '19:00', 60,
     'Tamar Park', 20, 0, true),
    (v_boundary_before_session, 'event-rsvp-boundary-before', v_future_hk::date,
     v_future_hk::time, 60, 'TBC', null, 0, true),
    (v_boundary_at_session, 'event-rsvp-boundary-at', v_at_start_hk::date,
     v_at_start_hk::time, 60, 'TBC', null, 0, true)
  on conflict (id) do update
    set session_date = excluded.session_date,
        start_time = excluded.start_time,
        cancelled_at = null,
        cancelled_by = null,
        cancelled_source = null,
        cancel_reason = null,
        capacity = excluded.capacity,
        price_hkd = excluded.price_hkd,
        is_open = excluded.is_open;

  -- Two confirmed lunch bookings plus statuses that must not count.
  insert into public.operational_bookings
    (profile_id, session_id, status, pay_deadline_at, paid_at, snapshot)
  values
    (v_member_a, v_count_session, 'confirmed', now(), now(),
     jsonb_build_object('name', 'Post-Training Lunch', 'session_date', v_count_date,
       'start_time', '12:45', 'venue', 'TBC', 'price_hkd', 0)),
    (v_member_b, v_count_session, 'confirmed', now(), now(),
     jsonb_build_object('name', 'Post-Training Lunch', 'session_date', v_count_date,
       'start_time', '12:45', 'venue', 'TBC', 'price_hkd', 0)),
    (v_member_c, v_count_session, 'reserved', now(), null,
     jsonb_build_object('name', 'Post-Training Lunch', 'session_date', v_count_date,
       'start_time', '12:45', 'venue', 'TBC', 'price_hkd', 0)),
    (v_admin, v_count_session, 'cancelled', now(), null,
     jsonb_build_object('name', 'Post-Training Lunch', 'session_date', v_count_date,
       'start_time', '12:45', 'venue', 'TBC', 'price_hkd', 0)),
    (v_super, v_count_session, 'deferred', now(), now(),
     jsonb_build_object('name', 'Post-Training Lunch', 'session_date', v_count_date,
       'start_time', '12:45', 'venue', 'TBC', 'price_hkd', 0));

  select going_count into v_going_count
    from public.get_operational_rsvp_counts()
   where session_id = v_count_session;
  perform pg_temp.op_assert(v_going_count = 2,
    'RSVP aggregate counts only two confirmed lunch bookings');
  perform pg_temp.op_assert(
    (select p.proargnames = array['session_id', 'going_count']::text[]
       from pg_proc p
      where p.oid = 'public.get_operational_rsvp_counts()'::regprocedure),
    'RSVP aggregate exposes no identity output columns'
  );
  perform pg_temp.op_assert(
    has_function_privilege('anon', 'public.get_operational_rsvp_counts()', 'execute')
    and has_function_privilege('authenticated', 'public.get_operational_rsvp_counts()', 'execute'),
    'anon and authenticated can execute only the identity-free count aggregate'
  );
  perform pg_temp.op_assert(
    (select relrowsecurity from pg_class
      where oid = 'public.operational_bookings'::regclass)
    and exists (
      select 1 from pg_policies
       where schemaname = 'public'
         and tablename = 'operational_bookings'
         and policyname = 'member read own operational bookings'
    ),
    'direct operational booking RLS remains enabled and unchanged'
  );

  set local role anon;
  select going_count into v_going_count
    from public.get_operational_rsvp_counts()
   where session_id = v_count_session;
  select count(*) into v_visible_count
    from public.operational_bookings
   where session_id = v_count_session;
  reset role;
  perform pg_temp.op_assert(v_going_count = 2,
    'anon receives the exact RSVP total through the aggregate');
  perform pg_temp.op_assert(v_visible_count = 0,
    'anon receives no direct booking rows');

  perform set_config('request.jwt.claim.sub', v_member_a::text, true);
  set local role authenticated;
  select going_count into v_going_count
    from public.get_operational_rsvp_counts()
   where session_id = v_count_session;
  select count(*) into v_visible_count
    from public.operational_bookings
   where session_id = v_count_session;
  reset role;
  perform pg_temp.op_assert(v_going_count = 2,
    'ordinary member receives the exact all-member RSVP total');
  perform pg_temp.op_assert(v_visible_count = 1,
    'ordinary member direct booking query sees only their own row');

  -- Zero-price ordinary free events cannot enter the RSVP reserve path.
  perform set_config('request.jwt.claim.sub', v_member_a::text, true);
  set local role authenticated;
  begin
    perform public.reserve_operational_session(v_free_session);
    raise exception 'ordinary free event reserve should fail';
  exception when others then
    if sqlerrm not like '%Session does not require RSVP.%' then raise; end if;
  end;
  reset role;
  perform pg_temp.op_assert(
    not exists (select 1 from public.operational_bookings
      where profile_id = v_member_a and session_id = v_free_session),
    'rejected ordinary free reserve creates no booking row'
  );

  -- Even a forged confirmed free-event row cannot be withdrawn through RSVP.
  insert into public.operational_bookings
    (profile_id, session_id, status, pay_deadline_at, paid_at, snapshot)
  values
    (v_member_b, v_free_session, 'confirmed', now(), now(),
     jsonb_build_object('name', 'Integrity Free Event', 'session_date', v_free_date,
       'start_time', '19:00', 'venue', 'Tamar Park', 'price_hkd', 0))
  returning id into v_free_booking;
  perform set_config('request.jwt.claim.sub', v_member_b::text, true);
  set local role authenticated;
  begin
    perform public.withdraw_operational_rsvp(v_free_booking);
    raise exception 'ordinary free event withdraw should fail';
  exception when others then
    if sqlerrm not like '%Only your own confirmed RSVP can be withdrawn.%' then raise; end if;
  end;
  reset role;
  perform pg_temp.op_assert(
    (select status = 'confirmed' from public.operational_bookings where id = v_free_booking),
    'rejected ordinary free withdraw does not mutate its booking row'
  );

  -- now() is transaction-stable. Each boundary session derives its ID, date,
  -- and wall time from one HKT timestamp, including across 23:xx rollover.
  perform set_config('request.jwt.claim.sub', v_member_a::text, true);
  set local role authenticated;
  select id into v_boundary_before_booking
    from public.reserve_operational_session(v_boundary_before_session);
  reset role;
  perform pg_temp.op_assert(v_boundary_before_booking is not null,
    'RSVP succeeds before its exact Hong Kong start instant');

  insert into public.operational_bookings
    (profile_id, session_id, status, pay_deadline_at, paid_at, snapshot)
  values
    (v_member_a, v_boundary_at_session, 'confirmed', now(), now(),
     jsonb_build_object('name', 'Boundary RSVP At',
       'session_date', v_at_start_hk::date,
       'start_time', v_at_start_hk::time,
       'venue', 'TBC', 'price_hkd', 0))
  returning id into v_boundary_at_booking;

  perform set_config('request.jwt.claim.sub', v_member_b::text, true);
  set local role authenticated;
  begin
    perform public.reserve_operational_session(v_boundary_at_session);
    raise exception 'RSVP at Hong Kong start should fail';
  exception when others then
    if sqlerrm not like '%Session has already started.%' then raise; end if;
  end;
  reset role;
  perform pg_temp.op_assert(
    not exists (select 1 from public.operational_bookings
      where profile_id = v_member_b and session_id = v_boundary_at_session),
    'at-start Hong Kong reserve creates no booking row'
  );

  perform set_config('request.jwt.claim.sub', v_member_a::text, true);
  set local role authenticated;
  begin
    perform public.withdraw_operational_rsvp(v_boundary_at_booking);
    raise exception 'RSVP withdraw at Hong Kong start should fail';
  exception when others then
    if sqlerrm not like '%Session has already started.%' then raise; end if;
  end;
  reset role;
  perform pg_temp.op_assert(
    (select status = 'confirmed' from public.operational_bookings
      where id = v_boundary_at_booking),
    'at-start Hong Kong withdraw leaves RSVP confirmed'
  );

  -- Paid reservations reject the entire current HKT session date, even when
  -- its wall-clock start is later; the next HKT date remains reservable.
  perform set_config('request.jwt.claim.sub', v_member_c::text, true);
  set local role authenticated;
  begin
    perform public.reserve_operational_session(v_paid_same_day_session);
    raise exception 'same-day paid reservation should fail';
  exception when others then
    if sqlerrm not like '%Session has already started.%' then raise; end if;
  end;
  reset role;
  perform pg_temp.op_assert(
    not exists (select 1 from public.operational_bookings
      where profile_id = v_member_c and session_id = v_paid_same_day_session),
    'same-HKT-date paid rejection creates no expired reservation'
  );

  perform set_config('request.jwt.claim.sub', v_member_c::text, true);
  set local role authenticated;
  select id into v_paid_next_day_booking
    from public.reserve_operational_session(v_paid_next_day_session);
  reset role;
  perform pg_temp.op_assert(
    (select status = 'reserved'
       from public.operational_bookings where id = v_paid_next_day_booking),
    'paid reservation accepts the next HKT session date'
  );

  -- A later paid HYROX still retains its capacity/payment semantics.
  perform set_config('request.jwt.claim.sub', v_member_c::text, true);
  set local role authenticated;
  select id into v_paid_booking
    from public.reserve_operational_session(v_paid_session);
  reset role;
  perform pg_temp.op_assert(
    (select status = 'reserved' and payment_marked_at is null
       from public.operational_bookings where id = v_paid_booking),
    'paid HYROX reservation behavior is preserved'
  );

  -- The pre-seeded noise does not cap lunch; another member confirms instantly.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  select id into v_lunch_booking
    from public.reserve_operational_session(v_count_session);
  reset role;
  perform pg_temp.op_assert(
    (select status = 'confirmed' from public.operational_bookings
      where id = v_lunch_booking)
    and (select capacity is null from public.operational_sessions
      where id = v_count_session),
    'uncapped lunch RSVP still confirms instantly'
  );

  -- Drive the aggregate to zero through a real withdrawal. The trigger must
  -- retain an identity-free row with an exact zero rather than deleting it.
  update public.operational_bookings
     set status = 'cancelled'
   where session_id = v_count_session
     and profile_id in (v_member_a, v_member_b)
     and status = 'confirmed';
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  perform public.withdraw_operational_rsvp(v_lunch_booking);
  reset role;
  perform pg_temp.op_assert(
    (select going_count = 0 from public.operational_rsvp_counts
      where session_id = v_count_session),
    'booking trigger updates the public RSVP count row to exact zero after withdrawal'
  );
  select going_count into v_going_count
    from public.get_operational_rsvp_counts()
   where session_id = v_count_session;
  perform pg_temp.op_assert(v_going_count = 0,
    'identity-free aggregate returns the stored exact zero');

  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- Selective RSVP trigger behavior: paid/payment noise must not create or touch
-- aggregate rows; only confirmed contribution changes recalculate exact totals.
do $$
declare
  v_rsvp_date_a date := (now() at time zone 'Asia/Hong_Kong')::date + 410;
  v_rsvp_date_b date := (now() at time zone 'Asia/Hong_Kong')::date + 411;
  v_paid_date date := (now() at time zone 'Asia/Hong_Kong')::date + 412;
  v_rsvp_a text;
  v_rsvp_b text;
  v_paid text;
  v_confirmed uuid;
  v_transition uuid;
  v_paid_booking uuid;
  v_a_updated_at timestamptz;
begin
  v_rsvp_a := 'event-rsvp-trigger-a-' || v_rsvp_date_a::text;
  v_rsvp_b := 'event-rsvp-trigger-b-' || v_rsvp_date_b::text;
  v_paid := 'event-paid-trigger-noise-' || v_paid_date::text;

  insert into public.operational_activity_templates
    (activity_id, name, venue, weekday, start_time, duration_minutes,
     capacity, price_hkd, default_open, active, category, maps_query, requires_rsvp)
  values
    ('event-rsvp-trigger-a', 'Trigger RSVP A', 'TBC',
     extract(dow from v_rsvp_date_a)::integer, time '12:00', 60,
     null, 0, true, false, 'Socials', null, true),
    ('event-rsvp-trigger-b', 'Trigger RSVP B', 'TBC',
     extract(dow from v_rsvp_date_b)::integer, time '12:00', 60,
     null, 0, true, false, 'Socials', null, true),
    ('event-paid-trigger-noise', 'Trigger Paid Noise', 'BFT Causeway Bay',
     extract(dow from v_paid_date)::integer, time '12:00', 60,
     20, 180, true, false, 'HYROX', 'BFT Causeway Bay', false)
  on conflict (activity_id) do update
    set requires_rsvp = excluded.requires_rsvp,
        price_hkd = excluded.price_hkd,
        capacity = excluded.capacity;

  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open)
  values
    (v_rsvp_a, 'event-rsvp-trigger-a', v_rsvp_date_a, time '12:00', 60,
     'TBC', null, 0, true),
    (v_rsvp_b, 'event-rsvp-trigger-b', v_rsvp_date_b, time '12:00', 60,
     'TBC', null, 0, true),
    (v_paid, 'event-paid-trigger-noise', v_paid_date, time '12:00', 60,
     'BFT Causeway Bay', 20, 180, true);

  insert into public.operational_bookings
    (profile_id, session_id, status, pay_deadline_at, paid_at, snapshot)
  values
    ('bb000000-0000-0000-0000-00000000b001', v_rsvp_a,
     'confirmed', now(), now(),
     jsonb_build_object('name', 'Trigger RSVP A', 'session_date', v_rsvp_date_a,
       'start_time', '12:00', 'venue', 'TBC', 'price_hkd', 0))
  returning id into v_confirmed;
  perform pg_temp.op_assert(
    (select going_count = 1 from public.operational_rsvp_counts where session_id = v_rsvp_a),
    'confirmed RSVP insert creates exact count one'
  );

  select updated_at into v_a_updated_at
    from public.operational_rsvp_counts where session_id = v_rsvp_a;

  insert into public.operational_bookings
    (profile_id, session_id, status, pay_deadline_at, snapshot)
  values
    ('dd000000-0000-0000-0000-00000000d001', v_rsvp_a,
     'reserved', now(),
     jsonb_build_object('name', 'Trigger RSVP A', 'session_date', v_rsvp_date_a,
       'start_time', '12:00', 'venue', 'TBC', 'price_hkd', 0))
  returning id into v_transition;
  update public.operational_bookings
     set payment_reference = 'RSVP-NOISE',
         payment_marked_at = now()
   where id = v_transition;
  perform pg_temp.op_assert(
    (select going_count = 1 and updated_at = v_a_updated_at
       from public.operational_rsvp_counts where session_id = v_rsvp_a),
    'reserved RSVP insert and payment-field noise do not recalculate'
  );

  insert into public.operational_bookings
    (profile_id, session_id, status, pay_deadline_at, snapshot)
  values
    ('ee000000-0000-0000-0000-00000000e001', v_paid,
     'reserved', now(),
     jsonb_build_object('name', 'Trigger Paid Noise', 'session_date', v_paid_date,
       'start_time', '12:00', 'venue', 'BFT Causeway Bay', 'price_hkd', 180))
  returning id into v_paid_booking;
  update public.operational_bookings
     set payment_marked_at = now(),
         payment_method = 'payme',
         payment_reference = 'PAID-NOISE'
   where id = v_paid_booking;
  update public.operational_bookings set status = 'confirmed' where id = v_paid_booking;
  update public.operational_bookings set payment_reference = 'PAID-NOISE-2' where id = v_paid_booking;
  delete from public.operational_bookings where id = v_paid_booking;
  perform pg_temp.op_assert(
    not exists (select 1 from public.operational_rsvp_counts where session_id = v_paid)
    and (select updated_at = v_a_updated_at
           from public.operational_rsvp_counts where session_id = v_rsvp_a),
    'paid inserts, status transitions, payment updates and deletes never mutate RSVP counts'
  );

  update public.operational_bookings set status = 'confirmed' where id = v_transition;
  perform pg_temp.op_assert(
    (select going_count = 2 from public.operational_rsvp_counts where session_id = v_rsvp_a),
    'reserved to confirmed RSVP increments exact total'
  );
  update public.operational_bookings set status = 'cancelled' where id = v_confirmed;
  perform pg_temp.op_assert(
    (select going_count = 1 from public.operational_rsvp_counts where session_id = v_rsvp_a),
    'confirmed to cancelled RSVP decrements exact total'
  );

  update public.operational_bookings set session_id = v_rsvp_b where id = v_transition;
  perform pg_temp.op_assert(
    (select going_count = 0 from public.operational_rsvp_counts where session_id = v_rsvp_a)
    and (select going_count = 1 from public.operational_rsvp_counts where session_id = v_rsvp_b),
    'RSVP to RSVP move recounts old and new sessions exactly'
  );
  update public.operational_bookings set session_id = v_paid where id = v_transition;
  perform pg_temp.op_assert(
    (select going_count = 0 from public.operational_rsvp_counts where session_id = v_rsvp_b)
    and not exists (select 1 from public.operational_rsvp_counts where session_id = v_paid),
    'RSVP to non-RSVP move decrements only the RSVP side'
  );
  update public.operational_bookings set session_id = v_rsvp_b where id = v_transition;
  perform pg_temp.op_assert(
    (select going_count = 1 from public.operational_rsvp_counts where session_id = v_rsvp_b)
    and not exists (select 1 from public.operational_rsvp_counts where session_id = v_paid),
    'non-RSVP to RSVP move increments only the RSVP side'
  );
  delete from public.operational_bookings where id = v_transition;
  perform pg_temp.op_assert(
    (select going_count = 0 from public.operational_rsvp_counts where session_id = v_rsvp_b),
    'final confirmed RSVP delete retains exact zero'
  );

  perform pg_temp.op_assert(
    not exists (
      select 1
        from public.operational_rsvp_counts c
       where c.session_id in (v_rsvp_a, v_rsvp_b)
         and c.going_count <> (
           select count(*) from public.operational_bookings b
            where b.session_id = c.session_id and b.status = 'confirmed'
         )
    ),
    'stored RSVP totals equal a full confirmed-booking recount after every transition'
  );
end $$;

-- run tests as a SQL function that can switch auth.uid() per case.
do $$
declare
  v_session_count integer;
  v_status text;
  v_dummy text;
  v_other_id uuid;
  v_other_id2 uuid;
  v_pending_book uuid;
  v_paid_session text;
  v_midtown_session text;
  v_defer_target_session text;
begin
  select paid_session, midtown_session, defer_target_session
    into v_paid_session, v_midtown_session, v_defer_target_session
    from operational_time_fixtures;

  perform pg_temp.op_assert(
    exists (
      select 1 from public.operational_sessions
       where id = v_midtown_session
         and activity_id = 'hyrox-midtown'
         and session_date > (now() at time zone 'Asia/Hong_Kong')::date
         and not is_open
         and cancelled_at is null
    ),
    'member queue fixture is an existing future closed active Midtown session'
  );

  -- Pending cannot reserve.
  perform set_config('request.jwt.claim.sub', 'cc000000-0000-0000-0000-00000000c001', true);
  set local role authenticated;
  begin
    perform reserve_operational_session(v_paid_session);
    raise exception 'pending should not reserve';
  exception when others then
    if sqlerrm not like '%Approved membership required%' then
      raise;
    end if;
  end;

  -- Member can reserve an open session.
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  select id into v_pending_book
    from reserve_operational_session(v_paid_session);
  select status into v_status from public.operational_bookings where id = v_pending_book;
  perform pg_temp.op_assert(v_status = 'reserved', 'reserved booking created');

  -- Duplicate reservation is rejected.
  begin
    perform reserve_operational_session(v_paid_session);
    raise exception 'duplicate should not reserve';
  exception when others then
    if sqlerrm not like '%Already booked%' then raise; end if;
  end;

  -- This historical seed is deliberately static: cancellation is checked
  -- before the paid HKT date guard, and this scenario verifies that priority.
  begin
    perform reserve_operational_session('hyrox-bft-2026-08-15');
    raise exception 'cancelled should not reserve';
  exception when others then
    if sqlerrm not like '%Session is cancelled%' then raise; end if;
  end;

  -- Closed session also refuses reservation.
  begin
    perform reserve_operational_session(v_midtown_session);
    raise exception 'closed session should not reserve';
  exception when others then
    if sqlerrm not like '%Session is not open%' then raise; end if;
  end;

  -- Interest can join on a proven future closed Midtown session.
  perform join_operational_queue(v_midtown_session, 'interest');

  -- Waitlist cannot join on that closed session.
  begin
    perform join_operational_queue(v_midtown_session, 'waitlist');
    raise exception 'waitlist should not join on closed session';
  exception when others then
    if sqlerrm not like '%Session is not open%' then raise; end if;
  end;

  -- Member cannot mark another's payment.
  perform set_config('request.jwt.claim.sub', 'dd000000-0000-0000-0000-00000000d001', true);
  begin
    perform mark_operational_payment(v_pending_book, 'payme', 'WRONG-OWNER');
    raise exception 'non-owner should not mark payment';
  exception when others then
    if sqlerrm not like '%Not authorized for this booking%' then raise; end if;
  end;

  -- Member marks payment correctly.
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  perform mark_operational_payment(v_pending_book, 'payme', 'REF-001');

  -- Member cannot mark again.
  begin
    perform mark_operational_payment(v_pending_book, 'payme', 'REF-002');
    raise exception 'already-marked should reject';
  exception when others then
    if sqlerrm not like '%Payment has already been marked%' then raise; end if;
  end;

  -- Member cannot defer because booking is still reserved (not confirmed).
  begin
    perform defer_operational_booking(v_pending_book, v_defer_target_session);
    raise exception 'reserved should not defer';
  exception when others then
    if sqlerrm not like '%Only confirmed bookings can be deferred%' then raise; end if;
  end;

  reset role;
end $$;

-- Authoritative unpaid-reservation release: owner/Admin only, unmarked
-- reserved state only, idempotent failure, rollback-safe, and no direct writes.
do $$
declare
  v_base_date date := (now() at time zone 'Asia/Hong_Kong')::date + 430;
  v_owner_session text;
  v_admin_session text;
  v_other_session text;
  v_membership_session text;
  v_marked_session text;
  v_status_session text;
  v_rollback_session text;
  v_owner_booking uuid;
  v_fresh_booking uuid;
  v_admin_booking uuid;
  v_other_booking uuid;
  v_membership_booking uuid;
  v_marked_booking uuid;
  v_confirmed_booking uuid;
  v_cancelled_booking uuid;
  v_expired_booking uuid;
  v_deferred_booking uuid;
  v_rollback_booking uuid;
  v_status text;
begin
  v_owner_session := 'event-release-owner-' || v_base_date::text;
  v_admin_session := 'event-release-admin-' || (v_base_date + 1)::text;
  v_other_session := 'event-release-other-' || (v_base_date + 2)::text;
  v_membership_session := 'event-release-membership-' || (v_base_date + 3)::text;
  v_marked_session := 'event-release-marked-' || (v_base_date + 4)::text;
  v_status_session := 'event-release-status-' || (v_base_date + 5)::text;
  v_rollback_session := 'event-release-rollback-' || (v_base_date + 6)::text;

  insert into public.operational_activity_templates
    (activity_id, name, venue, weekday, start_time, duration_minutes,
     capacity, price_hkd, default_open, active, category, maps_query, requires_rsvp)
  values
    ('event-release-owner', 'Release Owner', 'BFT Causeway Bay', 1, time '12:00', 60, 20, 180, true, false, 'HYROX', 'BFT Causeway Bay', false),
    ('event-release-admin', 'Release Admin', 'BFT Causeway Bay', 2, time '12:00', 60, 20, 180, true, false, 'HYROX', 'BFT Causeway Bay', false),
    ('event-release-other', 'Release Other', 'BFT Causeway Bay', 3, time '12:00', 60, 20, 180, true, false, 'HYROX', 'BFT Causeway Bay', false),
    ('event-release-membership', 'Release Membership', 'BFT Causeway Bay', 4, time '12:00', 60, 20, 180, true, false, 'HYROX', 'BFT Causeway Bay', false),
    ('event-release-marked', 'Release Marked', 'BFT Causeway Bay', 5, time '12:00', 60, 20, 180, true, false, 'HYROX', 'BFT Causeway Bay', false),
    ('event-release-status', 'Release Status', 'BFT Causeway Bay', 6, time '12:00', 60, 20, 180, true, false, 'HYROX', 'BFT Causeway Bay', false),
    ('event-release-rollback', 'Release Rollback', 'BFT Causeway Bay', 0, time '12:00', 60, 20, 180, true, false, 'HYROX', 'BFT Causeway Bay', false);

  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open)
  values
    (v_owner_session, 'event-release-owner', v_base_date, time '12:00', 60, 'BFT Causeway Bay', 20, 180, true),
    (v_admin_session, 'event-release-admin', v_base_date + 1, time '12:00', 60, 'BFT Causeway Bay', 20, 180, true),
    (v_other_session, 'event-release-other', v_base_date + 2, time '12:00', 60, 'BFT Causeway Bay', 20, 180, true),
    (v_membership_session, 'event-release-membership', v_base_date + 3, time '12:00', 60, 'BFT Causeway Bay', 20, 180, true),
    (v_marked_session, 'event-release-marked', v_base_date + 4, time '12:00', 60, 'BFT Causeway Bay', 20, 180, true),
    (v_status_session, 'event-release-status', v_base_date + 5, time '12:00', 60, 'BFT Causeway Bay', 20, 180, true),
    (v_rollback_session, 'event-release-rollback', v_base_date + 6, time '12:00', 60, 'BFT Causeway Bay', 20, 180, true);

  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select id into v_owner_booking from public.reserve_operational_session(v_owner_session);
  select status into v_status from public.release_operational_reservation(v_owner_booking);
  reset role;
  perform pg_temp.op_assert(v_status = 'cancelled'
    and (select status = 'cancelled' from public.operational_bookings where id = v_owner_booking),
    'owner releases an unmarked reservation authoritatively');
  perform pg_temp.op_assert(
    (select count(*) = 0 from public.operational_bookings
      where session_id = v_owner_session and status in ('reserved', 'confirmed')),
    'release drops the authoritative active booking count');

  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  begin
    perform public.release_operational_reservation(v_owner_booking);
    raise exception 'repeated release should fail';
  exception when others then
    if sqlerrm not like '%Reservation is no longer releasable.%' then raise; end if;
  end;
  select id into v_fresh_booking from public.reserve_operational_session(v_owner_session);
  reset role;
  perform pg_temp.op_assert(
    (select status = 'reserved' from public.operational_bookings where id = v_fresh_booking),
    'release permits a fresh later reservation for the same owner/session');

  perform set_config('request.jwt.claim.sub', 'dd000000-0000-0000-0000-00000000d001', true);
  set local role authenticated;
  select id into v_admin_booking from public.reserve_operational_session(v_admin_session);
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  perform public.release_operational_reservation(v_admin_booking);
  reset role;
  perform pg_temp.op_assert(
    (select status = 'cancelled' from public.operational_bookings where id = v_admin_booking),
    'Admin releases an owner reservation on their behalf');

  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select id into v_other_booking from public.reserve_operational_session(v_other_session);
  perform set_config('request.jwt.claim.sub', 'dd000000-0000-0000-0000-00000000d001', true);
  begin
    perform public.release_operational_reservation(v_other_booking);
    raise exception 'another member release should fail';
  exception when others then
    if sqlerrm not like '%Not authorized for this booking.%' then raise; end if;
  end;
  reset role;
  perform pg_temp.op_assert(
    (select status = 'reserved' from public.operational_bookings where id = v_other_booking),
    'another member cannot mutate the reservation');

  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select id into v_membership_booking from public.reserve_operational_session(v_membership_session);
  for v_status in select unnest(array[
    'cc000000-0000-0000-0000-00000000c001',
    'ab000000-0000-0000-0000-00000000d001'
  ]) loop
    perform set_config('request.jwt.claim.sub', v_status, true);
    begin
      perform public.release_operational_reservation(v_membership_booking);
      raise exception 'unapproved release should fail';
    exception when others then
      if sqlerrm not like '%Approved membership required.%' then raise; end if;
    end;
  end loop;
  reset role;
  perform pg_temp.op_assert(
    (select status = 'reserved' from public.operational_bookings where id = v_membership_booking),
    'pending and declined callers cannot mutate a reservation');

  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select id into v_marked_booking from public.reserve_operational_session(v_marked_session);
  perform public.mark_operational_payment(v_marked_booking, 'payme', 'RELEASE-MARKED');
  begin
    perform public.release_operational_reservation(v_marked_booking);
    raise exception 'payment-marked release should fail';
  exception when others then
    if sqlerrm not like '%Payment has already been marked.%' then raise; end if;
  end;
  reset role;
  perform pg_temp.op_assert(
    (select status = 'reserved' and payment_marked_at is not null
       from public.operational_bookings where id = v_marked_booking),
    'payment-marked reservation remains untouched');

  insert into public.operational_bookings
    (profile_id, session_id, status, pay_deadline_at, paid_at, snapshot)
  values
    ('bb000000-0000-0000-0000-00000000b001', v_status_session, 'confirmed', now(), now(), '{}'::jsonb),
    ('dd000000-0000-0000-0000-00000000d001', v_status_session, 'cancelled', now(), null, '{}'::jsonb),
    ('ee000000-0000-0000-0000-00000000e001', v_status_session, 'expired', now(), null, '{}'::jsonb),
    ('aa000000-0000-0000-0000-00000000a001', v_status_session, 'deferred', now(), now(), '{}'::jsonb);
  select id into v_confirmed_booking from public.operational_bookings
   where profile_id = 'bb000000-0000-0000-0000-00000000b001' and session_id = v_status_session;
  select id into v_cancelled_booking from public.operational_bookings
   where profile_id = 'dd000000-0000-0000-0000-00000000d001' and session_id = v_status_session;
  select id into v_expired_booking from public.operational_bookings
   where profile_id = 'ee000000-0000-0000-0000-00000000e001' and session_id = v_status_session;
  select id into v_deferred_booking from public.operational_bookings
   where profile_id = 'aa000000-0000-0000-0000-00000000a001' and session_id = v_status_session;
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  foreach v_owner_booking in array array[
    v_confirmed_booking, v_cancelled_booking, v_expired_booking, v_deferred_booking
  ] loop
    begin
      perform public.release_operational_reservation(v_owner_booking);
      raise exception 'non-reserved release should fail';
    exception when others then
      if sqlerrm not like '%Reservation is no longer releasable.%' then raise; end if;
    end;
  end loop;
  begin
    perform public.release_operational_reservation('00000000-0000-0000-0000-000000000000');
    raise exception 'unknown release should fail';
  exception when others then
    if sqlerrm not like '%Booking not found.%' then raise; end if;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select id into v_rollback_booking from public.reserve_operational_session(v_rollback_session);
  begin
    perform public.release_operational_reservation(v_rollback_booking);
    raise exception 'forced release rollback';
  exception when others then
    if sqlerrm <> 'forced release rollback' then raise; end if;
  end;
  begin
    update public.operational_bookings set status = 'cancelled' where id = v_rollback_booking;
    raise exception 'direct authenticated update should fail';
  exception when insufficient_privilege then
    null;
  end;
  reset role;
  perform pg_temp.op_assert(
    (select status = 'reserved' from public.operational_bookings where id = v_rollback_booking),
    'forced rollback and denied direct UPDATE preserve the reservation');
end $$;

-- Admin scenario: approve payment, finalize, defer, queue join promotion.
do $$
declare
  v_pending_book uuid;
  v_new_booking uuid;
  v_role text;
  v_status text;
  v_admin_paid_session text;
  v_defer_target_session text;
begin
  select admin_paid_session, defer_target_session
    into v_admin_paid_session, v_defer_target_session
    from operational_time_fixtures;

  -- Member reserves and marks payment.
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select id into v_pending_book
    from reserve_operational_session(v_admin_paid_session);
  perform mark_operational_payment(v_pending_book, 'payme', 'REF-100');

  -- Admin approves payment.
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  perform approve_operational_payment(v_pending_book);
  select status into v_status from public.operational_bookings where id = v_pending_book;
  perform pg_temp.op_assert(v_status = 'confirmed', 'approved booking is confirmed');

  -- Member defers to a later session.
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  begin
    select id into v_new_booking
      from defer_operational_booking(v_pending_book, v_defer_target_session);
  exception when no_data_found then
    v_new_booking := null;
  end;
  perform pg_temp.op_assert(v_new_booking is not null, 'deferral created new booking');

  -- Source booking is marked deferred.
  select status into v_status from public.operational_bookings where id = v_pending_book;
  perform pg_temp.op_assert(v_status = 'deferred', 'source booking is deferred');

  -- Receipt created for the original booking.
  perform pg_temp.op_assert(
    (select count(*) from public.operational_receipts where booking_id = v_pending_book) = 1,
    'one receipt issued for confirmed booking'
  );

  reset role;
end $$;

-- Admin cancellation atomicity.
do $$
declare
  v_pending uuid;
  v_confirmed uuid;
  v_waitlist_id uuid;
  v_interest_id uuid;
  v_session_id text;
  v_midtown_session_id text;
  v_deferred_count integer;
  v_cancelled_count integer;
  v_dissolved_count integer;
begin
  select cancel_session, cancel_midtown_session
    into v_session_id, v_midtown_session_id
    from operational_time_fixtures;

  perform pg_temp.op_assert(
    exists (
      select 1
        from public.operational_sessions
       where id = v_midtown_session_id
         and activity_id = 'hyrox-midtown'
         and session_date > (now() at time zone 'Asia/Hong_Kong')::date
         and not is_open
         and cancelled_at is null
    ),
    'closed Midtown interest fixture exists with required properties'
  );

  -- Tighten capacity so two reservations fill the session.
  update public.operational_sessions set capacity = 2 where id = v_session_id;

  -- Two members fill the single slot.
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select id into v_pending from reserve_operational_session(v_session_id);

  perform set_config('request.jwt.claim.sub', 'dd000000-0000-0000-0000-00000000d001', true);
  select id into v_confirmed from reserve_operational_session(v_session_id);
  perform mark_operational_payment(v_confirmed, 'fps', 'REF-CON');
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  perform approve_operational_payment(v_confirmed);

  -- Waitlist and interest preconditions.
  perform set_config('request.jwt.claim.sub', 'ee000000-0000-0000-0000-00000000e001', true);
  select id into v_waitlist_id from join_operational_queue(v_session_id, 'waitlist');
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  select id into v_interest_id from join_operational_queue(v_midtown_session_id, 'interest');

  -- Admin cancels the session — the unpaid reservation will be cancelled
  -- by the RPC itself, so no direct update is needed here.
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  perform cancel_operational_session(v_session_id, 'Storm warning');

  -- Verify outcome.
  select count(*) into v_deferred_count
    from public.operational_bookings
   where session_id = v_session_id and status = 'deferred';
  perform pg_temp.op_assert(v_deferred_count = 1, 'confirmed booking was deferred');

  select count(*) into v_cancelled_count
    from public.operational_bookings
   where session_id = v_session_id and status = 'cancelled';
  perform pg_temp.op_assert(v_cancelled_count >= 1, 'unpaid/reservation was cancelled');

  select count(*) into v_dissolved_count
    from public.operational_queue_entries
   where session_id = v_session_id and status = 'dissolved';
  perform pg_temp.op_assert(v_dissolved_count = 1, 'waitlist is dissolved');

  declare
    v_cancel_reason text;
  begin
    select cancel_reason into v_cancel_reason from public.operational_sessions where id = v_session_id;
    perform pg_temp.op_assert(v_cancel_reason = 'Storm warning', 'cancel reason stored');
  end;

  reset role;
end $$;

-- Cancellation rollback test: a failed deferral leaves everything consistent.
do $$
declare
  v_pending uuid;
  v_status text;
  v_date date := (now() at time zone 'Asia/Hong_Kong')::date + 500;
  v_activity_id constant text := 'event-cancel-no-target';
  v_session_id text := v_activity_id || '-' || v_date::text;
begin
  insert into public.operational_activity_templates
    (activity_id, name, venue, weekday, start_time, duration_minutes,
     capacity, price_hkd, default_open, active, category, maps_query, requires_rsvp)
  values
    (v_activity_id, 'Cancellation Isolation', 'Test Venue',
     extract(dow from v_date)::integer, time '11:00', 60,
     1, 180, true, false, 'HYROX', null, false);
  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open)
  values
    (v_session_id, v_activity_id, v_date, time '11:00', 60,
     'Test Venue', 1, 180, true);

  -- Member reserves; Admin cancels; this activity has no later target.
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select id into v_pending from reserve_operational_session(v_session_id);
  perform mark_operational_payment(v_pending, 'payme', 'REF-200');
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  perform approve_operational_payment(v_pending);
  perform cancel_operational_session(v_session_id, 'Venue flooded');
  select status into v_status from public.operational_bookings where id = v_pending;
  perform pg_temp.op_assert(v_status = 'cancelled',
    'confirmed booking cancelled when no deferral target');
  reset role;
end $$;

-- Stake: gym finalization must reject a cancelled session.
do $$
begin
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  begin
    perform finalize_operational_gym('hyrox-bft-2026-08-15', 'Reader note');
    raise exception 'cancelled session must reject gym finalization';
  exception when others then
    if sqlerrm not like '%Session is cancelled%' then raise; end if;
  end;
  reset role;
end $$;

-- Stake: non-admin cannot finalize.
do $$
begin
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  begin
    perform finalize_operational_gym('hyrox-bft-2026-08-29', 'unauthorized');
    raise exception 'members must not finalize';
  exception when others then
    if sqlerrm not like '%Administrator access required%' then raise; end if;
  end;
  reset role;
end $$;

-- Stake: gym finalization succeeds on an active session.
do $$
begin
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  perform finalize_operational_gym('hyrox-bft-2026-08-29', 'All clear');
  perform pg_temp.op_assert(
    (select gym_confirmed_at from public.operational_sessions where id = 'hyrox-bft-2026-08-29') is not null,
    'gym confirmation timestamp recorded'
  );
  reset role;
end $$;

-- Stake: receipt approval is required for paid bookings.
do $$
declare
  v_booking uuid;
  v_receipt_session text;
begin
  select receipt_session into v_receipt_session
    from operational_time_fixtures;
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select id into v_booking from reserve_operational_session(v_receipt_session);
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  begin
    perform approve_operational_payment(v_booking);
    raise exception 'approval must require marked payment';
  exception when others then
    if sqlerrm not like '%Payment has not been marked%' then
      raise;
    end if;
  end;
  reset role;
end $$;

-- =====================================================================
-- Pooled HYROX member registration and weekly waitlist
-- =====================================================================

do $$
declare
  v_member_bft constant uuid := 'bb000000-0000-0000-0000-00000000b001';
  v_member_midtown constant uuid := 'dd000000-0000-0000-0000-00000000d001';
  v_member_either constant uuid := 'ee000000-0000-0000-0000-00000000e001';
  v_direct_member constant uuid := '70000000-0000-0000-0000-000000000031';
  v_quarry_member constant uuid := '70000000-0000-0000-0000-000000000032';
  v_waitlist_member constant uuid := '70000000-0000-0000-0000-000000000030';
  v_date date := (now() at time zone 'Asia/Hong_Kong')::date
    + ((6 - extract(dow from (now() at time zone 'Asia/Hong_Kong')::date)::integer + 7) % 7)
    + 210;
  v_cycle_id text;
  v_bft_session text;
  v_midtown_session text;
  v_quarry_early_session text;
  v_quarry_session text;
  v_booking public.operational_bookings;
  v_queue public.operational_hyrox_queue_entries;
  v_error text;
begin
  v_cycle_id := 'hyrox-pool-' || v_date::text;
  v_bft_session := 'hyrox-bft-' || v_date::text;
  v_midtown_session := 'hyrox-midtown-' || v_date::text;
  v_quarry_early_session := 'hyrox-quarry-bay-early-' || v_date::text;
  v_quarry_session := 'hyrox-quarry-bay-' || v_date::text;

  insert into auth.users (id, email, raw_user_meta_data)
  select ('70000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
         'hyrox-pool-' || i::text || '@itc.invalid',
         '{}'::jsonb
    from generate_series(1, 32) i;
  update public.profiles
     set full_name = 'HYROX Pool Member ' || right(id::text, 2),
         role = 'member'
   where id::text like '70000000-0000-0000-0000-%';

  perform public.ensure_operational_sessions(v_date, 1);
  insert into public.operational_hyrox_cycles (
    id, session_date, bft_session_id, midtown_session_id,
    registration_state, venue_plan, registration_opens_at,
    payment_deadline_at, holder_grace_deadline_at,
    promoted_payment_deadline_at, venue_choice_deadline_at
  ) values (
    v_cycle_id, v_date, v_bft_session, v_midtown_session,
    'draft', 'pending', now() + interval '1 hour',
    now() + interval '3 days', now() + interval '3 days 1 hour',
    now() + interval '3 days 2 hours', now() + interval '4 days'
  );

  -- Scheduled cycles are visible but locked until their opening instant.
  perform pg_temp.op_assert(
    (select registration_state = 'draft' and opened_at is null
       from public.operational_hyrox_cycles where id = v_cycle_id),
    'scheduled pooled cycle is visible and locked before Monday opening'
  );
  perform set_config('request.jwt.claim.sub', v_member_bft::text, true);
  set local role authenticated;
  begin
    perform public.reserve_hyrox_cycle(v_cycle_id, 'bft', true);
    raise exception 'early pooled registration should fail';
  exception when others then
    v_error := sqlerrm;
    if v_error not like '%HYROX registration opens Monday at 6 PM HKT.%' then raise; end if;
  end;
  reset role;

  -- Moving the stored opening checkpoint into the past simulates Monday 18:00
  -- HKT without depending on the verifier host clock.
  update public.operational_hyrox_cycles
     set registration_opens_at = now() - interval '1 minute'
   where id = v_cycle_id;

  perform set_config('request.jwt.claim.sub', v_member_bft::text, true);
  set local role authenticated;
  begin
    perform public.reserve_hyrox_cycle(v_cycle_id, 'bft', false);
    raise exception 'missing fallback acknowledgement should fail';
  exception when others then
    v_error := sqlerrm;
    if v_error not like '%Fallback acknowledgement is required.%' then raise; end if;
  end;
  select * into v_booking
    from public.reserve_hyrox_cycle(v_cycle_id, 'bft', true);
  reset role;
  perform pg_temp.op_assert(
    v_booking.venue_preference = 'bft'
      and v_booking.fallback_acknowledged_at is not null
      and v_booking.session_id is null
      and v_booking.pay_deadline_at = (
        select holder_grace_deadline_at
          from public.operational_hyrox_cycles where id = v_cycle_id
      ),
    'BFT preference creates an acknowledged pooled reservation'
  );
  perform pg_temp.op_assert(
    (select registration_state = 'open' and opened_at is not null
       from public.operational_hyrox_cycles where id = v_cycle_id),
    'first due reservation opens the scheduled cycle under lock'
  );
  perform pg_temp.op_assert(
    exists (
      select 1 from public.notifications
       where profile_id = v_member_bft
         and kind = 'operational_hyrox_reserved'
         and destination = '#/pay/' || v_booking.id::text
    ),
    'pooled reservation sends its exact payment notification'
  );

  perform set_config('request.jwt.claim.sub', v_member_midtown::text, true);
  set local role authenticated;
  select * into v_booking
    from public.reserve_hyrox_cycle(v_cycle_id, 'midtown', true);
  reset role;
  perform pg_temp.op_assert(v_booking.venue_preference = 'midtown',
    'Midtown preference is recorded');

  perform set_config('request.jwt.claim.sub', v_member_either::text, true);
  set local role authenticated;
  select * into v_booking
    from public.reserve_hyrox_cycle(v_cycle_id, 'either', true);
  reset role;
  perform pg_temp.op_assert(v_booking.venue_preference = 'either',
    'Either preference is recorded');

  -- Once a cycle is scheduled, its child sessions cannot use legacy booking
  -- or Midtown interest/waitlist entry points.
  perform pg_temp.op_assert(
    exists (
      select 1 from public.operational_hyrox_cycles c
       where c.id = v_cycle_id
         and c.bft_session_id = v_bft_session
         and c.midtown_session_id = v_midtown_session
         and c.cancelled_at is null
    ),
    'pooled cycle retains its authoritative child-session links'
  );
  perform set_config('request.jwt.claim.sub', v_direct_member::text, true);
  set local role authenticated;
  begin
    perform public.reserve_operational_session(v_bft_session);
    raise exception 'direct pooled child reservation should fail';
  exception when others then
    v_error := sqlerrm;
    if v_error not like '%Use the weekly HYROX registration.%' then raise; end if;
  end;
  begin
    perform public.join_operational_queue(v_midtown_session, 'interest');
    raise exception 'legacy pooled child queue should fail';
  exception when others then
    v_error := sqlerrm;
    if v_error not like '%Use the weekly HYROX registration.%' then raise; end if;
  end;
  reset role;

  -- Quarry Bay remains separately bookable but cannot overlap the pool.
  perform set_config(
    'itc.clock',
    (((v_date - 5) + time '18:00') at time zone 'Asia/Hong_Kong')::text,
    true
  );
  perform set_config('request.jwt.claim.sub', v_quarry_member::text, true);
  set local role authenticated;
  perform public.reserve_operational_session(v_quarry_session);
  begin
    perform public.reserve_operational_session(v_quarry_early_session);
    raise exception 'same-date Island ECC slot bookings should conflict';
  exception when others then
    v_error := sqlerrm;
    if v_error not like '%Choose one Island ECC HYROX slot per Saturday.%' then raise; end if;
  end;
  begin
    perform public.join_operational_queue(v_quarry_early_session, 'waitlist');
    raise exception 'same-date Island ECC booking and queue should conflict';
  exception when others then
    v_error := sqlerrm;
    if v_error not like '%Choose one Island ECC HYROX slot per Saturday.%' then raise; end if;
  end;
  begin
    perform public.reserve_hyrox_cycle(v_cycle_id, 'either', true);
    raise exception 'same-date Quarry and pooled bookings should conflict';
  exception when others then
    v_error := sqlerrm;
    if v_error not like '%You already have a HYROX booking for this Saturday.%' then raise; end if;
  end;
  reset role;

  -- Fill the remaining 29 places directly; the RPC behaviors under test are
  -- capacity rejection and non-payable waitlist placement for member #33.
  insert into public.operational_bookings (
    profile_id, session_id, hyrox_cycle_id, status, reserved_at,
    pay_deadline_at, venue_preference, fallback_acknowledged_at, snapshot
  )
  select ('70000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
         null, v_cycle_id, 'reserved', now(),
         (select holder_grace_deadline_at
            from public.operational_hyrox_cycles where id = v_cycle_id),
         'either', now(),
         jsonb_build_object('name', 'ITC HYROX', 'booking_mode', 'weekly_pool',
           'session_date', v_date, 'price_hkd', 180)
    from generate_series(1, 29) i;
  perform pg_temp.op_assert(
    (select count(*) from public.operational_bookings
      where hyrox_cycle_id = v_cycle_id
        and status in ('reserved', 'confirmed')) = 32,
    'pooled registration capacity is 32 active bookings'
  );

  perform set_config('request.jwt.claim.sub', v_waitlist_member::text, true);
  set local role authenticated;
  begin
    perform public.reserve_hyrox_cycle(v_cycle_id, 'either', true);
    raise exception '33rd pooled reservation should fail';
  exception when others then
    v_error := sqlerrm;
    if v_error not like '%HYROX registration is full. Join the weekly waitlist.%' then raise; end if;
  end;
  begin
    perform public.join_hyrox_cycle_waitlist(v_cycle_id, 'midtown', false);
    raise exception 'unacknowledged weekly waitlist should fail';
  exception when others then
    v_error := sqlerrm;
    if v_error not like '%Fallback acknowledgement is required.%' then raise; end if;
  end;
  select * into v_queue
    from public.join_hyrox_cycle_waitlist(v_cycle_id, 'midtown', true);
  reset role;
  perform pg_temp.op_assert(
    v_queue.kind = 'weekly_waitlist'
      and v_queue.status = 'active'
      and v_queue.venue_preference = 'midtown'
      and v_queue.fallback_acknowledged_at is not null
      and not exists (
        select 1 from public.operational_bookings
         where profile_id = v_waitlist_member
           and hyrox_cycle_id = v_cycle_id
      ),
    '33rd member joins the non-payable weekly waitlist without a booking'
  );

  perform set_config('request.jwt.claim.sub', v_waitlist_member::text, true);
  set local role authenticated;
  select * into v_queue from public.leave_hyrox_cycle_queue(v_queue.id);
  reset role;
  perform pg_temp.op_assert(v_queue.status = 'left' and v_queue.resolved_at is not null,
    'member can leave their active weekly waitlist entry');
end $$;

-- =====================================================================
-- Pooled HYROX scheduling and lifecycle reconciliation
-- =====================================================================

do $$
declare
  v_admin constant uuid := 'aa000000-0000-0000-0000-00000000a001';
  v_date date := (now() at time zone 'Asia/Hong_Kong')::date
    + ((6 - extract(dow from (now() at time zone 'Asia/Hong_Kong')::date)::integer + 7) % 7)
    + 238;
  v_cycle_id text;
  v_cycle public.operational_hyrox_cycles;
  v_opened_at timestamptz;
  v_open_notification_count integer;
begin
  v_cycle_id := 'hyrox-pool-' || v_date::text;
  perform public.ensure_operational_sessions(v_date, 1);

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  select * into v_cycle from public.schedule_hyrox_cycle(v_cycle_id);
  reset role;

  perform pg_temp.op_assert(
    v_cycle.registration_state = 'draft'
      and v_cycle.venue_plan = 'pending'
      and v_cycle.bft_session_id = 'hyrox-bft-' || v_date::text
      and v_cycle.midtown_session_id = 'hyrox-midtown-' || v_date::text,
    'scheduling creates one draft shared cycle for matching BFT and Midtown sessions'
  );
  perform pg_temp.op_assert(
    v_cycle.registration_opens_at
      = ((v_date - 5) + time '18:00') at time zone 'Asia/Hong_Kong'
      and v_cycle.payment_deadline_at
        = ((v_date - 2) + time '18:00') at time zone 'Asia/Hong_Kong'
      and v_cycle.holder_grace_deadline_at
        = ((v_date - 2) + time '19:00') at time zone 'Asia/Hong_Kong'
      and v_cycle.promoted_payment_deadline_at
        = ((v_date - 2) + time '20:00') at time zone 'Asia/Hong_Kong'
      and v_cycle.venue_choice_deadline_at
        = ((v_date - 1) + time '21:00') at time zone 'Asia/Hong_Kong',
    'scheduled cycle stores exact Monday Thursday and Friday HKT checkpoints'
  );

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  perform public.sweep_hyrox_cycle_deadlines(v_cycle.registration_opens_at);
  reset role;
  select opened_at into v_opened_at
    from public.operational_hyrox_cycles where id = v_cycle_id;
  select count(*) into v_open_notification_count
    from public.notifications
   where kind = 'operational_hyrox_registration_opened'
     and body = 'Registration is open for Saturday ' || v_date::text || '.';
  perform pg_temp.op_assert(
    v_opened_at = v_cycle.registration_opens_at
      and (select registration_state from public.operational_hyrox_cycles
            where id = v_cycle_id) = 'open',
    'Monday 18:00 HKT sweep opens the scheduled cycle once'
  );
  perform pg_temp.op_assert(
    v_open_notification_count
      = (select count(*) from public.profiles
          where role in ('member', 'admin', 'super_admin')),
    'Monday opening notifies every approved profile'
  );

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  perform public.sweep_hyrox_cycle_deadlines(v_cycle.registration_opens_at + interval '1 minute');
  reset role;
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
      where kind = 'operational_hyrox_registration_opened'
        and body = 'Registration is open for Saturday ' || v_date::text || '.')
      = v_open_notification_count
      and (select opened_at from public.operational_hyrox_cycles
            where id = v_cycle_id) = v_opened_at,
    'repeated Monday sweep creates no duplicate opening notifications'
  );
end $$;

do $$
declare
  v_date date := (now() at time zone 'Asia/Hong_Kong')::date
    + ((6 - extract(dow from (now() at time zone 'Asia/Hong_Kong')::date)::integer + 7) % 7)
    + 252;
  v_cycle_id text;
  v_cycle public.operational_hyrox_cycles;
  v_thu_16 timestamptz;
  v_thu_18 timestamptz;
  v_thu_19 timestamptz;
  v_thu_20 timestamptz;
  v_promoted_booking uuid;
begin
  v_cycle_id := 'hyrox-pool-' || v_date::text;
  perform public.ensure_operational_sessions(v_date, 1);
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  select * into v_cycle from public.schedule_hyrox_cycle(v_cycle_id);
  reset role;

  v_thu_16 := v_cycle.payment_deadline_at - interval '2 hours';
  v_thu_18 := v_cycle.payment_deadline_at;
  v_thu_19 := v_cycle.holder_grace_deadline_at;
  v_thu_20 := v_cycle.promoted_payment_deadline_at;
  perform public.sweep_hyrox_cycle_deadlines(v_cycle.registration_opens_at);

  insert into public.operational_bookings (
    profile_id, session_id, hyrox_cycle_id, status, reserved_at,
    pay_deadline_at, venue_preference, fallback_acknowledged_at,
    payment_marked_at, payment_method, payment_reference, snapshot
  ) values
    ('70000000-0000-0000-0000-000000000001', null, v_cycle_id, 'reserved',
     v_cycle.registration_opens_at, v_thu_19, 'bft', v_cycle.registration_opens_at,
     null, null, null, '{"name":"ITC HYROX","booking_mode":"weekly_pool"}'::jsonb),
    ('70000000-0000-0000-0000-000000000002', null, v_cycle_id, 'reserved',
     v_cycle.registration_opens_at + interval '1 second', v_thu_19, 'midtown',
     v_cycle.registration_opens_at, null, null, null,
     '{"name":"ITC HYROX","booking_mode":"weekly_pool"}'::jsonb),
    ('70000000-0000-0000-0000-000000000003', null, v_cycle_id, 'reserved',
     v_cycle.registration_opens_at + interval '2 seconds', v_thu_19, 'either',
     v_cycle.registration_opens_at, now(), 'fps', 'PENDING-ORIGINAL',
     '{"name":"ITC HYROX","booking_mode":"weekly_pool"}'::jsonb);

  insert into public.operational_hyrox_queue_entries (
    cycle_id, profile_id, kind, venue_preference,
    fallback_acknowledged_at, joined_at
  ) values
    (v_cycle_id, '70000000-0000-0000-0000-000000000004', 'weekly_waitlist',
     'bft', v_cycle.registration_opens_at, v_cycle.registration_opens_at + interval '3 seconds'),
    (v_cycle_id, '70000000-0000-0000-0000-000000000005', 'weekly_waitlist',
     'midtown', v_cycle.registration_opens_at, v_cycle.registration_opens_at + interval '4 seconds'),
    (v_cycle_id, '70000000-0000-0000-0000-000000000006', 'weekly_waitlist',
     'either', v_cycle.registration_opens_at, v_cycle.registration_opens_at + interval '5 seconds');

  perform public.send_hyrox_member_payment_reminders(v_thu_16);
  perform public.sweep_hyrox_cycle_deadlines(v_thu_16);
  perform pg_temp.op_assert(
    (select payment_reminder_sent_at = v_thu_16
       from public.operational_hyrox_cycles where id = v_cycle_id)
      and (select count(*) from public.notifications
            where kind = 'operational_hyrox_payment_reminder'
              and body like '%' || v_date::text || '%') = 2,
    'Thursday 16:00 reminds each unmarked original holder once'
  );
  perform public.send_hyrox_member_payment_reminders(v_thu_16 + interval '1 minute');
  perform public.send_hyrox_collector_payment_reminder(v_thu_16);
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
      where kind = 'operational_hyrox_payment_reminder'
        and body like '%' || v_date::text || '%') = 2,
    'repeated Thursday 16:00 sweep does not duplicate member reminders'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
      where kind = 'operational_hyrox_collector_payment_reminder'
        and body like '%' || v_date::text || '%') = 1,
    'Thursday 16:00 collector reminder is aggregate and idempotent'
  );

  perform public.sweep_hyrox_cycle_deadlines(v_thu_18);
  perform pg_temp.op_assert(
    (select holder_grace_started_at = v_thu_18
       from public.operational_hyrox_cycles where id = v_cycle_id)
      and (select count(*) from public.operational_bookings
            where hyrox_cycle_id = v_cycle_id and status = 'reserved') = 3,
    'Thursday 18:00 starts grace without releasing original holders'
  );
  perform pg_temp.op_assert(
    exists (
      select 1 from public.notifications
       where kind = 'operational_hyrox_grace_summary'
         and body like '%1 payment claims%'
         and body like '%2 unmarked holders%'
         and body like '%3 weekly waitlist%'
    ),
    'Thursday 18:00 collector summary includes claims holders and waitlist totals'
  );

  perform public.sweep_hyrox_cycle_deadlines(v_thu_19);
  perform pg_temp.op_assert(
    (select waitlist_promoted_at = v_thu_19
       from public.operational_hyrox_cycles where id = v_cycle_id)
      and (select count(*) from public.operational_bookings
            where hyrox_cycle_id = v_cycle_id
              and status = 'expired'
              and promoted_from_waitlist_at is null) = 2,
    'Thursday 19:00 expires both unmarked originals once'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.operational_bookings
      where hyrox_cycle_id = v_cycle_id
        and status = 'reserved'
        and promoted_from_waitlist_at = v_thu_19
        and pay_deadline_at = v_thu_20) = 2
      and (select count(*) from public.operational_hyrox_queue_entries
            where cycle_id = v_cycle_id and status = 'promoted') = 2,
    'Thursday 19:00 promotes only the two oldest pre-existing waitlist entries'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.operational_hyrox_queue_entries
      where cycle_id = v_cycle_id
        and status = 'active'
        and profile_id in (
          '70000000-0000-0000-0000-000000000001',
          '70000000-0000-0000-0000-000000000002',
          '70000000-0000-0000-0000-000000000006'
        )) = 3,
    'demoted originals join behind the remaining pre-existing waitlist member'
  );

  select id into v_promoted_booking
    from public.operational_bookings
   where hyrox_cycle_id = v_cycle_id
     and profile_id = '70000000-0000-0000-0000-000000000004'
     and status = 'reserved';
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000004', true);
  set local role authenticated;
  perform public.mark_operational_payment(v_promoted_booking, 'fps', 'PROMOTED-CLAIM');
  reset role;

  perform public.sweep_hyrox_cycle_deadlines(v_thu_20);
  perform pg_temp.op_assert(
    (select reconciliation_started_at = v_thu_20
       from public.operational_hyrox_cycles where id = v_cycle_id)
      and (select registration_state from public.operational_hyrox_cycles
            where id = v_cycle_id) = 'reconciling',
    'Thursday 20:00 closes payment and starts reconciliation'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.operational_bookings
      where hyrox_cycle_id = v_cycle_id
        and status = 'expired'
        and promoted_from_waitlist_at is not null
        and payment_marked_at is null) = 1
      and (select count(*) from public.operational_bookings
            where hyrox_cycle_id = v_cycle_id
              and status = 'reserved'
              and payment_marked_at is not null) = 2,
    'Thursday 20:00 expires unmarked promotions but preserves timely claims'
  );
  perform pg_temp.op_assert(
    not exists (
      select 1 from public.operational_hyrox_queue_entries
       where cycle_id = v_cycle_id and status = 'active'
    ) and (select venue_plan from public.operational_hyrox_cycles
            where id = v_cycle_id) = 'pending',
    'Thursday 20:00 dissolves the weekly queue and pending claims block the venue plan'
  );
  perform pg_temp.op_assert(
    exists (
      select 1 from public.notifications
       where kind = 'operational_hyrox_reconciliation_started'
         and body like '%2 pending claims%'
         and body like '%0 confirmed payments%'
    ),
    'Thursday 20:00 collector summary includes pending and confirmed totals'
  );
end $$;

do $$
declare
  v_date date := (now() at time zone 'Asia/Hong_Kong')::date
    + ((6 - extract(dow from (now() at time zone 'Asia/Hong_Kong')::date)::integer + 7) % 7)
    + 266;
  v_cycle_id text;
  v_future_booking uuid;
  v_expired_booking uuid;
begin
  v_cycle_id := 'hyrox-pool-' || v_date::text;
  perform public.ensure_operational_sessions(v_date, 1);
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  perform public.schedule_hyrox_cycle(v_cycle_id);
  reset role;

  insert into public.operational_bookings (
    profile_id, session_id, hyrox_cycle_id, status, reserved_at,
    pay_deadline_at, venue_preference, fallback_acknowledged_at,
    payment_marked_at, payment_method, payment_reference, snapshot
  ) values (
    '70000000-0000-0000-0000-000000000007', null, v_cycle_id, 'reserved', now(),
    now() + interval '1 hour', 'either', now(), now(), 'fps', 'REJECT-REOPEN',
    '{"name":"ITC HYROX","booking_mode":"weekly_pool"}'::jsonb
  ) returning id into v_future_booking;
  insert into public.operational_bookings (
    profile_id, session_id, hyrox_cycle_id, status, reserved_at,
    pay_deadline_at, venue_preference, fallback_acknowledged_at,
    payment_marked_at, payment_method, payment_reference, snapshot
  ) values (
    '70000000-0000-0000-0000-000000000008', null, v_cycle_id, 'reserved',
    now() - interval '2 hours', now() - interval '1 hour', 'bft',
    now() - interval '2 hours', now() - interval '90 minutes', 'payme',
    'REJECT-EXPIRE', '{"name":"ITC HYROX","booking_mode":"weekly_pool"}'::jsonb
  ) returning id into v_expired_booking;

  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  perform public.reject_hyrox_cycle_payment(v_future_booking, 'Reference not found');
  perform public.reject_hyrox_cycle_payment(v_expired_booking, 'Received after cutoff');
  reset role;

  perform pg_temp.op_assert(
    (select status = 'reserved'
        and payment_marked_at is null
        and payment_method is null
        and payment_reference is null
        and payment_rejected_at is not null
        and payment_rejected_by = 'aa000000-0000-0000-0000-00000000a001'
       from public.operational_bookings where id = v_future_booking),
    'rejected claim reopens payment before the booking hard deadline'
  );
  perform pg_temp.op_assert(
    (select status = 'expired'
        and payment_rejected_at is not null
        and payment_rejection_reason = 'Received after cutoff'
       from public.operational_bookings where id = v_expired_booking),
    'rejected claim expires at or after the booking hard deadline'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
      where kind = 'operational_hyrox_payment_rejected'
        and profile_id in (
          '70000000-0000-0000-0000-000000000007',
          '70000000-0000-0000-0000-000000000008'
        )) = 2,
    'payment rejection notifies each affected member with the reason'
  );

  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000007', true);
  set local role authenticated;
  perform public.mark_operational_payment(v_future_booking, 'fps', 'RESUBMITTED-CLAIM');
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  perform public.approve_operational_payment(v_future_booking);
  reset role;
  perform pg_temp.op_assert(
    (select status = 'confirmed' and paid_at is not null
       from public.operational_bookings where id = v_future_booking),
    'collector approval confirms a timely pooled payment claim'
  );
  perform pg_temp.op_assert(
    exists (
      select 1 from public.operational_receipts
       where booking_id = v_future_booking
         and hyrox_cycle_id = v_cycle_id
         and session_id is null
    ),
    'pooled receipt is issued before a child venue is allocated'
  );
end $$;

-- Resolving the final pending claims after Thursday 20:00 automatically
-- finalizes the capacity-derived plan; the collector supplies no venue input.
do $$
declare
  v_date date := (now() at time zone 'Asia/Hong_Kong')::date
    + ((6 - extract(dow from (now() at time zone 'Asia/Hong_Kong')::date)::integer + 7) % 7)
    + 252;
  v_cycle_id text;
  v_first uuid;
  v_last uuid;
begin
  v_cycle_id := 'hyrox-pool-' || v_date::text;
  select id into v_first from public.operational_bookings
   where hyrox_cycle_id = v_cycle_id
     and profile_id = '70000000-0000-0000-0000-000000000003'
     and status = 'reserved';
  select id into v_last from public.operational_bookings
   where hyrox_cycle_id = v_cycle_id
     and profile_id = '70000000-0000-0000-0000-000000000004'
     and status = 'reserved';

  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  perform public.approve_operational_payment(v_first);
  reset role;
  perform pg_temp.op_assert(
    (select venue_plan = 'pending' and registration_state = 'reconciling'
       from public.operational_hyrox_cycles where id = v_cycle_id),
    'remaining pending claims block automatic venue-plan finalization'
  );

  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  perform public.approve_operational_payment(v_last);
  reset role;
  perform pg_temp.op_assert(
    (select venue_plan = 'bft_only'
        and registration_state = 'closed'
        and plan_confirmed_source = 'payment_reconciliation'
       from public.operational_hyrox_cycles where id = v_cycle_id),
    'resolving the last pending claim automatically derives the BFT-only plan'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.operational_bookings
      where hyrox_cycle_id = v_cycle_id
        and status = 'confirmed'
        and session_id = 'hyrox-bft-' || v_date::text
        and allocation_state = 'final') = 2,
    'BFT-only finalization allocates every confirmed booking to BFT'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.operational_receipts r
      join public.operational_bookings b on b.id = r.booking_id
     where b.hyrox_cycle_id = v_cycle_id
       and r.hyrox_cycle_id = v_cycle_id
       and r.session_id = b.session_id) = 2,
    'final allocation links pooled receipts to their child session'
  );
end $$;

-- Exact threshold fixtures: 20 confirmed is BFT-only; 21 confirmed opens both
-- and deterministically overflows the twenty-first BFT preference to Midtown.
do $$
declare
  v_base date := (now() at time zone 'Asia/Hong_Kong')::date
    + ((6 - extract(dow from (now() at time zone 'Asia/Hong_Kong')::date)::integer + 7) % 7);
  v_date_20 date := v_base + 280;
  v_date_21 date := v_base + 294;
  v_cycle_20 text;
  v_cycle_21 text;
  v_cycle public.operational_hyrox_cycles;
  v_receipt_booking uuid;
begin
  v_cycle_20 := 'hyrox-pool-' || v_date_20::text;
  v_cycle_21 := 'hyrox-pool-' || v_date_21::text;
  perform public.ensure_operational_sessions(v_date_20, 1);
  perform public.ensure_operational_sessions(v_date_21, 1);
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  select * into v_cycle from public.schedule_hyrox_cycle(v_cycle_20);
  perform public.schedule_hyrox_cycle(v_cycle_21);
  reset role;

  insert into public.operational_bookings (
    profile_id, session_id, hyrox_cycle_id, status, reserved_at,
    pay_deadline_at, venue_preference, fallback_acknowledged_at,
    payment_marked_at, payment_method, payment_reference, paid_at,
    confirmed_by, snapshot
  )
  select ('70000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
         null, v_cycle_20, 'confirmed', v_cycle.registration_opens_at + i * interval '1 second',
         v_cycle.holder_grace_deadline_at, 'bft', v_cycle.registration_opens_at,
         v_cycle.payment_deadline_at - interval '1 hour', 'fps', 'PAID-20-' || i,
         v_cycle.payment_deadline_at - interval '30 minutes' + i * interval '1 second',
         'aa000000-0000-0000-0000-00000000a001',
         '{"name":"ITC HYROX","booking_mode":"weekly_pool"}'::jsonb
    from generate_series(1, 19) i;
  insert into public.operational_bookings (
    profile_id, session_id, hyrox_cycle_id, status, reserved_at,
    pay_deadline_at, venue_preference, fallback_acknowledged_at,
    payment_marked_at, payment_method, payment_reference, snapshot
  ) values (
    '70000000-0000-0000-0000-000000000020', null, v_cycle_20, 'reserved',
    v_cycle.registration_opens_at, v_cycle.holder_grace_deadline_at, 'bft',
    v_cycle.registration_opens_at, now(), 'fps', 'RECEIPT-BEFORE-ALLOCATION',
    '{"name":"ITC HYROX","booking_mode":"weekly_pool"}'::jsonb
  ) returning id into v_receipt_booking;
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  perform public.approve_operational_payment(v_receipt_booking);
  reset role;
  perform pg_temp.op_assert(
    exists (select 1 from public.operational_receipts
      where booking_id = v_receipt_booking and session_id is null),
    'receipt issuance succeeds before venue allocation'
  );
  perform public.sweep_hyrox_cycle_deadlines(v_cycle.promoted_payment_deadline_at);
  perform pg_temp.op_assert(
    (select venue_plan = 'bft_only' and registration_state = 'closed'
       from public.operational_hyrox_cycles where id = v_cycle_20)
      and (select count(*) from public.operational_bookings
            where hyrox_cycle_id = v_cycle_20
              and session_id = 'hyrox-bft-' || v_date_20::text
              and allocation_state = 'final') = 20,
    'twenty confirmed payments derive BFT-only with twenty final allocations'
  );
  perform pg_temp.op_assert(
    (select session_id = 'hyrox-bft-' || v_date_20::text
       from public.operational_receipts where booking_id = v_receipt_booking),
    'allocation links the previously venue-null receipt to BFT'
  );

  select * into v_cycle from public.operational_hyrox_cycles where id = v_cycle_21;
  insert into public.operational_bookings (
    profile_id, session_id, hyrox_cycle_id, status, reserved_at,
    pay_deadline_at, venue_preference, fallback_acknowledged_at,
    payment_marked_at, payment_method, payment_reference, paid_at,
    confirmed_by, snapshot
  )
  select ('70000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
         null, v_cycle_21, 'confirmed', v_cycle.registration_opens_at + i * interval '1 second',
         v_cycle.holder_grace_deadline_at, 'bft', v_cycle.registration_opens_at,
         v_cycle.payment_deadline_at - interval '1 hour', 'fps', 'PAID-21-' || i,
         v_cycle.payment_deadline_at - interval '30 minutes' + i * interval '1 second',
         'aa000000-0000-0000-0000-00000000a001',
         '{"name":"ITC HYROX","booking_mode":"weekly_pool"}'::jsonb
    from generate_series(1, 21) i;
  perform public.sweep_hyrox_cycle_deadlines(v_cycle.promoted_payment_deadline_at);
  perform pg_temp.op_assert(
    (select venue_plan = 'both' and registration_state = 'closed'
       from public.operational_hyrox_cycles where id = v_cycle_21)
      and (select count(*) from public.operational_bookings
            where hyrox_cycle_id = v_cycle_21
              and session_id = 'hyrox-bft-' || v_date_21::text) = 20
      and (select count(*) from public.operational_bookings
            where hyrox_cycle_id = v_cycle_21
              and session_id = 'hyrox-midtown-' || v_date_21::text) = 1,
    'twenty-one BFT preferences derive both venues with deterministic 20/1 allocation'
  );

  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  perform public.finalize_hyrox_venue_plan(v_cycle_21);
  reset role;
  perform pg_temp.op_assert(
    (select venue_plan = 'both' from public.operational_hyrox_cycles where id = v_cycle_21),
    'Admin recovery finalization is idempotent and accepts no venue override'
  );
end $$;

-- =====================================================================
-- Pooled HYROX venue selection and switch queues
-- =====================================================================

do $$
declare
  v_date date := (now() at time zone 'Asia/Hong_Kong')::date
    + ((6 - extract(dow from (now() at time zone 'Asia/Hong_Kong')::date)::integer + 7) % 7)
    + 294;
  v_cycle_id text;
  v_booking_id uuid;
  v_target text;
begin
  v_cycle_id := 'hyrox-pool-' || v_date::text;
  v_target := 'hyrox-midtown-' || v_date::text;
  select id into v_booking_id
    from public.operational_bookings
   where hyrox_cycle_id = v_cycle_id
     and profile_id = '70000000-0000-0000-0000-000000000001';

  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  perform public.select_hyrox_cycle_venue(v_booking_id, v_target);
  reset role;

  perform pg_temp.op_assert(
    (select session_id = v_target
        and allocation_state = 'provisional'
        and allocation_source = 'member'
       from public.operational_bookings where id = v_booking_id),
    'two-venue member moves immediately while the target has capacity'
  );
  perform pg_temp.op_assert(
    (select allocation_snapshot -> -1 ->> 'source' = 'member'
       from public.operational_bookings where id = v_booking_id),
    'immediate member move appends allocation history'
  );
end $$;

do $$
declare
  v_date date := (now() at time zone 'Asia/Hong_Kong')::date
    + ((6 - extract(dow from (now() at time zone 'Asia/Hong_Kong')::date)::integer + 7) % 7)
    + 294;
  v_cycle_id text;
  v_bft text;
  v_midtown text;
  v_bft_booking uuid;
  v_midtown_booking uuid;
  v_entry public.operational_hyrox_queue_entries;
begin
  v_cycle_id := 'hyrox-pool-' || v_date::text;
  v_bft := 'hyrox-bft-' || v_date::text;
  v_midtown := 'hyrox-midtown-' || v_date::text;

  -- The preceding immediate move leaves 19 BFT / 2 Midtown. Add eleven
  -- confirmed allocations to create an exact full 20 / 12 cycle.
  insert into public.operational_bookings (
    profile_id, session_id, hyrox_cycle_id, status, reserved_at,
    pay_deadline_at, venue_preference, fallback_acknowledged_at,
    payment_marked_at, payment_method, payment_reference, paid_at,
    confirmed_by, allocation_state, allocation_source, allocated_at,
    allocation_snapshot, snapshot
  )
  select ('70000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
         case when i = 22 then v_bft else v_midtown end,
         v_cycle_id, 'confirmed', now(), now() + interval '1 day',
         case when i = 22 then 'bft' else 'midtown' end, now(),
         now(), 'fps', 'SWITCH-FILL-' || i, now(),
         'aa000000-0000-0000-0000-00000000a001', 'provisional',
         'automatic', now(),
         jsonb_build_array(jsonb_build_object(
           'session_id', case when i = 22 then v_bft else v_midtown end,
           'source', 'switch-test-fill', 'assigned_at', now()
         )),
         '{"name":"ITC HYROX","booking_mode":"weekly_pool"}'::jsonb
    from generate_series(22, 32) i;

  perform pg_temp.op_assert(
    (select count(*) from public.operational_bookings
      where hyrox_cycle_id = v_cycle_id and status = 'confirmed'
        and session_id = v_bft) = 20
      and (select count(*) from public.operational_bookings
            where hyrox_cycle_id = v_cycle_id and status = 'confirmed'
              and session_id = v_midtown) = 12,
    'switch fixture starts at exact 20/12 venue capacity'
  );

  select id into v_bft_booking from public.operational_bookings
   where hyrox_cycle_id = v_cycle_id
     and profile_id = '70000000-0000-0000-0000-000000000002';
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000002', true);
  set local role authenticated;
  select * into v_entry
    from public.join_hyrox_venue_switch_queue(v_bft_booking, v_midtown);
  reset role;
  perform pg_temp.op_assert(
    v_entry.status = 'active'
      and v_entry.target_session_id = v_midtown
      and (select session_id = v_bft
             from public.operational_bookings where id = v_bft_booking),
    'full target creates an ordered switch entry without releasing the current venue'
  );

  select id into v_midtown_booking from public.operational_bookings
   where hyrox_cycle_id = v_cycle_id
     and profile_id = '70000000-0000-0000-0000-000000000021';
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000021', true);
  set local role authenticated;
  perform public.join_hyrox_venue_switch_queue(v_midtown_booking, v_bft);
  reset role;
  perform pg_temp.op_assert(
    (select session_id = v_midtown from public.operational_bookings where id = v_bft_booking)
      and (select session_id = v_bft from public.operational_bookings where id = v_midtown_booking)
      and (select count(*) from public.operational_hyrox_queue_entries
            where cycle_id = v_cycle_id and kind = 'venue_switch'
              and status = 'matched') = 2,
    'opposite full-venue requests atomically swap and match both entries'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.operational_bookings
      where hyrox_cycle_id = v_cycle_id and status = 'confirmed'
        and session_id = v_bft) = 20
      and (select count(*) from public.operational_bookings
            where hyrox_cycle_id = v_cycle_id and status = 'confirmed'
              and session_id = v_midtown) = 12,
    'atomic switch matching preserves exact 20/12 capacity'
  );
end $$;

do $$
declare
  v_date date := (now() at time zone 'Asia/Hong_Kong')::date
    + ((6 - extract(dow from (now() at time zone 'Asia/Hong_Kong')::date)::integer + 7) % 7)
    + 294;
  v_cycle_id text;
  v_midtown text;
  v_booking uuid;
  v_entry public.operational_hyrox_queue_entries;
  v_closed public.operational_hyrox_cycles;
begin
  v_cycle_id := 'hyrox-pool-' || v_date::text;
  v_midtown := 'hyrox-midtown-' || v_date::text;

  select id into v_booking from public.operational_bookings
   where hyrox_cycle_id = v_cycle_id
     and profile_id = '70000000-0000-0000-0000-000000000003';
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000003', true);
  set local role authenticated;
  select * into v_entry from public.join_hyrox_venue_switch_queue(v_booking, v_midtown);
  select * into v_entry from public.leave_hyrox_venue_switch_queue(v_entry.id);
  reset role;
  perform pg_temp.op_assert(v_entry.status = 'left' and v_entry.resolved_at is not null,
    'member can leave an active venue-switch request');

  select id into v_booking from public.operational_bookings
   where hyrox_cycle_id = v_cycle_id
     and profile_id = '70000000-0000-0000-0000-000000000004';
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000004', true);
  set local role authenticated;
  perform public.join_hyrox_venue_switch_queue(v_booking, v_midtown);
  reset role;

  update public.operational_hyrox_cycles
     set registration_opens_at = now() - interval '5 hours',
         payment_deadline_at = now() - interval '4 hours',
         holder_grace_deadline_at = now() - interval '3 hours',
         promoted_payment_deadline_at = now() - interval '2 hours',
         venue_choice_deadline_at = now() - interval '1 hour'
   where id = v_cycle_id;
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  select * into v_closed from public.close_hyrox_venue_allocation(v_cycle_id);
  reset role;

  perform pg_temp.op_assert(
    v_closed.allocation_closed_at is not null
      and not exists (select 1 from public.operational_bookings
        where hyrox_cycle_id = v_cycle_id and allocation_state <> 'final')
      and not exists (select 1 from public.operational_hyrox_queue_entries
        where cycle_id = v_cycle_id and status = 'active'),
    'Friday 21:00 closes allocations and dissolves unmatched switch requests'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
      where kind = 'operational_hyrox_allocation_final'
        and body like '%' || v_date::text || '%') = 32,
    'Friday closure sends every confirmed member their final allocation'
  );
end $$;

-- Cancelling a pooled week owns both child sessions and carries confirmed
-- payment into the next eligible open pool when capacity exists.
do $$
declare
  v_base date := (now() at time zone 'Asia/Hong_Kong')::date
    + ((6 - extract(dow from (now() at time zone 'Asia/Hong_Kong')::date)::integer + 7) % 7);
  v_source_date date := v_base + 308;
  v_target_date date := v_base + 315;
  v_source text;
  v_target text;
  v_confirmed uuid;
  v_cancelled public.operational_hyrox_cycles;
begin
  v_source := 'hyrox-pool-' || v_source_date::text;
  v_target := 'hyrox-pool-' || v_target_date::text;
  perform public.ensure_operational_sessions(v_source_date, 2);
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  perform public.schedule_hyrox_cycle(v_source);
  perform public.schedule_hyrox_cycle(v_target);
  reset role;
  update public.operational_hyrox_cycles
     set registration_state = 'closed', venue_plan = 'bft_only',
         opened_at = now(), reconciliation_started_at = now(),
         plan_confirmed_at = now(), plan_confirmed_source = 'automatic_sweep',
         allocation_closed_at = now()
   where id = v_source;
  update public.operational_hyrox_cycles
     set registration_state = 'open', opened_at = now()
   where id = v_target;

  insert into public.operational_bookings (
    profile_id, session_id, hyrox_cycle_id, status, reserved_at,
    pay_deadline_at, venue_preference, fallback_acknowledged_at,
    payment_marked_at, payment_method, payment_reference, paid_at,
    confirmed_by, allocation_state, allocation_source, allocated_at,
    allocation_snapshot, snapshot
  ) values (
    '70000000-0000-0000-0000-000000000009',
    'hyrox-bft-' || v_source_date::text, v_source, 'confirmed', now(),
    now() + interval '1 day', 'either', now(), now(), 'fps', 'CARRY-PAID', now(),
    'aa000000-0000-0000-0000-00000000a001', 'final', 'automatic', now(),
    jsonb_build_array(jsonb_build_object('session_id', 'hyrox-bft-' || v_source_date::text)),
    '{"name":"ITC HYROX","booking_mode":"weekly_pool"}'::jsonb
  ) returning id into v_confirmed;
  insert into public.operational_bookings (
    profile_id, session_id, hyrox_cycle_id, status, reserved_at,
    pay_deadline_at, venue_preference, fallback_acknowledged_at, snapshot
  ) values (
    '70000000-0000-0000-0000-000000000010', null, v_source, 'reserved', now(),
    now() + interval '1 day', 'bft', now(),
    '{"name":"ITC HYROX","booking_mode":"weekly_pool"}'::jsonb
  );
  insert into public.operational_hyrox_queue_entries
    (cycle_id, profile_id, kind, venue_preference, fallback_acknowledged_at)
  values (v_source, '70000000-0000-0000-0000-000000000011',
          'weekly_waitlist', 'midtown', now());

  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  select * into v_cancelled from public.cancel_hyrox_cycle(v_source, 'Race weekend');
  reset role;
  perform pg_temp.op_assert(
    v_cancelled.registration_state = 'cancelled'
      and v_cancelled.cancel_reason = 'Race weekend'
      and (select count(*) from public.operational_sessions
            where id in ('hyrox-bft-' || v_source_date::text,
                         'hyrox-midtown-' || v_source_date::text)
              and cancelled_at is not null
              and cancel_reason = 'Race weekend') = 2,
    'cycle cancellation atomically cancels the cycle and both child sessions'
  );
  perform pg_temp.op_assert(
    (select status = 'deferred' and deferred_to_booking_id is not null
       from public.operational_bookings where id = v_confirmed)
      and exists (select 1 from public.operational_bookings
        where hyrox_cycle_id = v_target
          and profile_id = '70000000-0000-0000-0000-000000000009'
          and status = 'confirmed'
          and venue_preference = 'either')
      and not exists (select 1 from public.operational_hyrox_queue_entries
        where cycle_id = v_source and status = 'active'),
    'cancellation carries confirmed payment forward and dissolves active queues'
  );
  perform pg_temp.op_assert(
    (select status in ('cancelled', 'expired') from public.operational_bookings
      where hyrox_cycle_id = v_source
        and profile_id = '70000000-0000-0000-0000-000000000010'),
    'cycle cancellation removes unpaid source reservations'
  );
end $$;

-- Pooled child controls must route through the parent cycle and its plan.
do $$
declare
  v_base date := (now() at time zone 'Asia/Hong_Kong')::date
    + ((6 - extract(dow from (now() at time zone 'Asia/Hong_Kong')::date)::integer + 7) % 7);
  v_date date := v_base + 322;
  v_cycle text := 'hyrox-pool-' || v_date::text;
  v_midtown text := 'hyrox-midtown-' || v_date::text;
  v_bft text := 'hyrox-bft-' || v_date::text;
begin
  perform public.ensure_operational_sessions(v_date, 2);
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  perform public.schedule_hyrox_cycle(v_cycle);
  reset role;
  update public.operational_hyrox_cycles
     set registration_state = 'open', opened_at = now()
   where id = v_cycle;
  set local role authenticated;

  begin
    perform public.cancel_operational_session(v_bft, 'Child-only cancellation');
    raise exception 'pooled child cancellation must be rejected';
  exception when others then
    if sqlerrm not like '%Cancel the weekly HYROX cycle instead.%' then raise; end if;
  end;
  begin
    perform public.set_operational_midtown_open(v_midtown, true);
    raise exception 'pooled Midtown toggle must be rejected';
  exception when others then
    if sqlerrm not like '%Midtown availability is derived from the weekly HYROX plan.%' then raise; end if;
  end;
  begin
    perform public.finalize_operational_gym(v_bft, 'Before allocation closure');
    raise exception 'pooled gym finalization must wait for allocation closure';
  exception when others then
    if sqlerrm not like '%HYROX venue allocation must be closed first.%' then raise; end if;
  end;
  reset role;

  perform pg_temp.op_assert(
    (select count(*) from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'operational_hyrox_cycles') = 1,
    'HYROX cycles are published to Realtime exactly once'
  );
  perform pg_temp.op_assert(
    (select count(*) from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'operational_hyrox_queue_entries') = 1,
    'HYROX queues are published to Realtime exactly once'
  );
end $$;

-- =====================================================================
-- Semantic notification destinations
-- =====================================================================

-- Stable kinds resolve to their approved section routes without entity data.
do $$
declare
  v_case record;
begin
  for v_case in
    select *
      from (values
        ('operational_payment_marked', '#/admin/payments'),
        ('operational_gym_finalized', '#/admin/payments'),
        ('operational_session_venue_updated', '#/schedule'),
        ('admin_application_submitted', '#/admin/approvals'),
        ('admin_application_approved', '#/admin/members'),
        ('admin_application_declined', '#/admin/members'),
        ('admin_role_promoted', '#/admin/members'),
        ('admin_role_demoted', '#/admin/members'),
        ('admin_membership_revoked', '#/admin/members'),
        ('admin_role_changed', '#/admin/members'),
        ('giving_campaign_published', '#/giving'),
        ('welcome', '#/account')
      ) expected(kind, destination)
  loop
    perform pg_temp.op_assert(
      public.resolve_notification_destination(
        'aa000000-0000-0000-0000-00000000a001',
        v_case.kind,
        '2000-01-01 00:00:00+00'
      ) = v_case.destination,
      v_case.kind || ' has stable destination ' || v_case.destination
    );
  end loop;
end $$;

do $$
declare
  v_paid_booking uuid;
  v_rsvp_booking uuid;
  v_free_booking constant uuid := '99000000-0000-0000-0000-000000000001';
  v_paid_session text;
  v_rsvp_session text;
  v_free_session text;
  v_routing_date date;
  v_free_reserved_at constant timestamptz := '2000-02-01 00:00:00+00';
  v_rsvp_cancelled_at constant timestamptz := '2000-02-01 00:01:00+00';
  v_free_cancelled_at constant timestamptz := '2000-02-01 00:02:00+00';
  v_routing_midtown_session text;
  v_deferred_booking uuid;
  v_explicit_notification uuid;
  v_unique_cancel_booking uuid;
  v_unique_cancel_date date;
  v_unique_cancel_session text;
  v_unique_cancel_activity constant text := 'event-notification-cancel';
  v_rsvp_body text;
  v_payment_marked_body text;
  v_gym_finalized_body text;
  v_cancelled_member_body text;
  v_cancelled_admin_body text;
  v_expected_admin_recipients constant uuid[] := array[
    'aa000000-0000-0000-0000-00000000a001'::uuid,
    'ff000000-0000-0000-0000-00000000f001'::uuid
  ];
  v_payment_marked_before integer;
  v_payment_marked_after integer;
  v_payment_marked_existing_ids uuid[];
  v_gym_finalized_before integer;
  v_gym_finalized_after integer;
  v_gym_finalized_existing_ids uuid[];
  v_cancelled_member_before integer;
  v_cancelled_member_after integer;
  v_cancelled_admin_before integer;
  v_cancelled_admin_after integer;
begin
  select routing_date, routing_paid_session, routing_midtown_session,
         routing_rsvp_session, unique_cancel_date, unique_cancel_session
    into v_routing_date, v_paid_session, v_routing_midtown_session,
         v_rsvp_session, v_unique_cancel_date, v_unique_cancel_session
    from operational_time_fixtures;

  -- Use a one-session activity so cancellation cannot find a generated HYROX
  -- deferral target that the same member already holds.
  v_unique_cancel_session := v_unique_cancel_activity || '-' || v_unique_cancel_date::text;
  insert into public.operational_activity_templates
    (activity_id, name, venue, weekday, start_time, duration_minutes,
     capacity, price_hkd, default_open, active, category, maps_query, requires_rsvp)
  values
    (v_unique_cancel_activity, 'Notification Cancellation Isolation', 'Test Venue',
     extract(dow from v_unique_cancel_date)::integer, time '11:00', 60,
     1, 180, true, false, 'HYROX', null, false);
  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open)
  values
    (v_unique_cancel_session, v_unique_cancel_activity, v_unique_cancel_date,
     time '11:00', 60, 'Test Venue', 1, 180, true);

  v_rsvp_body := 'You''re on the list for Post-Training Lunch on ' || v_routing_date::text
    || '. See you there.';
  v_payment_marked_body := 'A member marked payment on ' || v_routing_date::text || '.';
  v_gym_finalized_body := 'Gym confirmation recorded for ' || v_routing_midtown_session || '.';
  v_cancelled_member_body := 'Your booking for ' || v_unique_cancel_session
    || ' was cancelled with no deferral target available.';
  v_cancelled_admin_body := 'Session ' || v_unique_cancel_session || ' was cancelled by ITC.';

  -- A newly reserved paid booking points to its exact payment page. The test
  -- suite runs in one transaction, so move prior fixtures off transaction-
  -- stable now() before exercising the timestamp-linked route resolver.
  update public.operational_bookings
     set reserved_at = reserved_at - interval '1 minute'
   where reserved_at = now();
  perform set_config('request.jwt.claim.sub', 'ee000000-0000-0000-0000-00000000e001', true);
  set local role authenticated;
  select id into v_paid_booking
    from reserve_operational_session(v_paid_session);
  reset role;
  perform pg_temp.op_assert(
    exists (
      select 1
        from public.notifications
       where profile_id = 'ee000000-0000-0000-0000-00000000e001'
         and kind = 'operational_booking_reserved'
         and title = 'Booking reserved'
         and destination = '#/pay/' || v_paid_booking::text
    ),
    'paid reservation notification has exact payment destination'
  );

  -- A new RSVP points to the exact dated Activity Details page.
  perform set_config('request.jwt.claim.sub', 'ff000000-0000-0000-0000-00000000f001', true);
  set local role authenticated;
  select id into v_rsvp_booking
    from reserve_operational_session(v_rsvp_session);
  reset role;
  perform pg_temp.op_assert(
    v_rsvp_booking is not null and exists (
      select 1
        from public.notifications
       where profile_id = 'ff000000-0000-0000-0000-00000000f001'
         and kind = 'operational_rsvp_confirmed'
         and title = 'You''re in'
         and body = v_rsvp_body
         and destination = '#/activity/' || v_rsvp_session
    ),
    'RSVP notification has exact Activity Details destination'
  );

  -- A legacy/new operational_booking_reserved row attached to a price-zero,
  -- non-RSVP event still opens Activity Details rather than a payment screen.
  v_free_session := 'event-routing-free-' || v_routing_date::text;
  insert into public.operational_activity_templates
    (activity_id, name, venue, weekday, start_time, duration_minutes,
     capacity, price_hkd, default_open, active, category, maps_query, requires_rsvp)
  values
    ('event-routing-free', 'Routing Free Social', 'Tamar Park',
     extract(dow from v_routing_date)::smallint, '15:00', 60,
     20, 0, true, false, 'Socials', 'Tamar Park', false);
  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes, venue,
     capacity, price_hkd, is_open)
  values
    (v_free_session, 'event-routing-free', v_routing_date, '15:00', 60,
     'Tamar Park', 20, 0, true);
  insert into public.operational_bookings
    (id, profile_id, session_id, status, reserved_at, pay_deadline_at, snapshot)
  values
    (v_free_booking, 'dd000000-0000-0000-0000-00000000d001',
     v_free_session, 'reserved', v_free_reserved_at, v_free_reserved_at,
     jsonb_build_object('name', 'Routing Free Social', 'price_hkd', 0));
  insert into public.notifications
    (profile_id, kind, title, body, created_at)
  values
    ('dd000000-0000-0000-0000-00000000d001',
     'operational_booking_reserved', 'Free event reminder',
     'Open this free event.', v_free_reserved_at);
  perform pg_temp.op_assert(
    exists (
      select 1 from public.notifications
       where profile_id = 'dd000000-0000-0000-0000-00000000d001'
         and title = 'Free event reminder'
         and destination = '#/activity/' || v_free_session
    ),
    'price-zero Booking reserved notification has exact Activity Details destination'
  );

  -- Exact RSVP/free cancellations open their dated event, and the same
  -- authoritative session linkage also applies to paid cancellations.
  update public.operational_sessions
     set cancelled_at = v_rsvp_cancelled_at,
         cancelled_by = 'aa000000-0000-0000-0000-00000000a001',
         cancelled_source = 'admin',
         cancel_reason = 'RSVP routing cancellation'
   where id = v_rsvp_session;
  insert into public.notifications
    (profile_id, kind, title, body, created_at)
  values
    ('ff000000-0000-0000-0000-00000000f001',
     'operational_session_cancelled_no_defer', 'RSVP cancelled',
     'Open the cancelled RSVP event.', v_rsvp_cancelled_at);
  perform pg_temp.op_assert(
    exists (
      select 1 from public.notifications
       where profile_id = 'ff000000-0000-0000-0000-00000000f001'
         and title = 'RSVP cancelled'
         and destination = '#/activity/' || v_rsvp_session
    ),
    'cancelled RSVP member notification has exact Activity Details destination'
  );

  update public.operational_sessions
     set cancelled_at = v_free_cancelled_at,
         cancelled_by = 'aa000000-0000-0000-0000-00000000a001',
         cancelled_source = 'admin',
         cancel_reason = 'Free routing cancellation'
   where id = v_free_session;
  insert into public.notifications
    (profile_id, kind, title, body, created_at)
  values
    ('aa000000-0000-0000-0000-00000000a001',
     'operational_session_cancelled', 'Free event cancelled',
     'Open the cancelled free event.', v_free_cancelled_at);
  perform pg_temp.op_assert(
    exists (
      select 1 from public.notifications
       where profile_id = 'aa000000-0000-0000-0000-00000000a001'
         and title = 'Free event cancelled'
         and destination = '#/activity/' || v_free_session
    ),
    'cancelled free Admin notification has exact Activity Details destination'
  );

  -- Payment-marked Admin fallback rows use the stable payments section;
  -- approval points back to the member's exact booking. Isolate this fallback
  -- from the suite's standing collector assignments, then restore them below.
  delete from public.collector_assignments;
  select count(*), coalesce(array_agg(id), array[]::uuid[])
    into v_payment_marked_before, v_payment_marked_existing_ids
    from public.notifications
   where kind = 'operational_payment_marked'
     and body = v_payment_marked_body;
  perform set_config('request.jwt.claim.sub', 'ee000000-0000-0000-0000-00000000e001', true);
  set local role authenticated;
  perform mark_operational_payment(v_paid_booking, 'payme', 'ROUTE-REF');
  reset role;
  select count(*) into v_payment_marked_after
    from public.notifications
   where kind = 'operational_payment_marked'
     and body = v_payment_marked_body;
  perform pg_temp.op_assert(
    v_payment_marked_after - v_payment_marked_before = 2,
    'payment marking produces exactly two Admin notifications for this action'
  );
  perform pg_temp.op_assert(
    (select array_agg(profile_id order by profile_id)
       from public.notifications
      where kind = 'operational_payment_marked'
        and body = v_payment_marked_body
        and not (id = any(v_payment_marked_existing_ids)))
      = v_expected_admin_recipients,
    'payment marking reaches exactly the Admin and Super Admin recipients'
  );
  perform pg_temp.op_assert(
    not exists (
      select 1
        from public.notifications
       where kind = 'operational_payment_marked'
         and body = v_payment_marked_body
         and not (id = any(v_payment_marked_existing_ids))
         and destination is distinct from '#/admin/payments'
    ),
    'payment-marked Admin notifications use the payments destination'
  );
  insert into public.collector_assignments
    (week_start, collector_profile_id, assigned_by)
  values
    (date '2026-08-03',
     'aa000000-0000-0000-0000-00000000a001',
     'ff000000-0000-0000-0000-00000000f001'),
    (date '2026-08-10',
     'dd000000-0000-0000-0000-00000000d001',
     'ff000000-0000-0000-0000-00000000f001');

  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  perform approve_operational_payment(v_paid_booking);
  reset role;
  perform pg_temp.op_assert(
    exists (
      select 1
        from public.notifications
       where profile_id = 'ee000000-0000-0000-0000-00000000e001'
         and kind = 'operational_payment_approved'
         and destination = '#/booking/' || v_paid_booking::text
    ),
    'payment approval notification has exact Booking Details destination'
  );

  -- Admin cancellation creates a replacement booking and the deferral
  -- notification points to that resulting entity.
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  perform cancel_operational_session(v_paid_session, 'Routing test');
  reset role;
  select deferred_to_booking_id into v_deferred_booking
    from public.operational_bookings
   where id = v_paid_booking;
  perform pg_temp.op_assert(
    v_deferred_booking is not null and exists (
      select 1
        from public.notifications
       where profile_id = 'ee000000-0000-0000-0000-00000000e001'
         and kind = 'operational_session_deferred'
         and destination = '#/booking/' || v_deferred_booking::text
    ),
    'deferral notification has exact resulting Booking Details destination'
  );

  -- Gym-finalized Admin rows use the same stable payments section. Scope
  -- both production and route checks to this session's exact action body.
  select count(*), coalesce(array_agg(id), array[]::uuid[])
    into v_gym_finalized_before, v_gym_finalized_existing_ids
    from public.notifications
   where kind = 'operational_gym_finalized'
     and body = v_gym_finalized_body;
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  perform finalize_operational_gym(v_routing_midtown_session, 'Routing test');
  reset role;
  select count(*) into v_gym_finalized_after
    from public.notifications
   where kind = 'operational_gym_finalized'
     and body = v_gym_finalized_body;
  perform pg_temp.op_assert(
    v_gym_finalized_after - v_gym_finalized_before = 2,
    'gym finalization produces exactly two Admin notifications for this action'
  );
  perform pg_temp.op_assert(
    (select array_agg(profile_id order by profile_id)
       from public.notifications
      where kind = 'operational_gym_finalized'
        and body = v_gym_finalized_body
        and not (id = any(v_gym_finalized_existing_ids)))
      = v_expected_admin_recipients,
    'gym finalization reaches exactly the Admin and Super Admin recipients'
  );
  perform pg_temp.op_assert(
    not exists (
      select 1
        from public.notifications
       where kind = 'operational_gym_finalized'
         and body = v_gym_finalized_body
         and not (id = any(v_gym_finalized_existing_ids))
         and destination is distinct from '#/admin/payments'
    ),
    'gym-finalized Admin notifications use the payments destination'
  );

  -- Exercise cancellation through the real producer with exactly one session
  -- at the resolver timestamp. The isolated activity has no deferral target,
  -- so the same call produces one member and two Admin cancellation
  -- rows. Older cancellation fixtures are shifted off the exact timestamp
  -- rather than serving as synthetic route evidence.
  perform set_config('request.jwt.claim.sub', 'ee000000-0000-0000-0000-00000000e001', true);
  set local role authenticated;
  select id into v_unique_cancel_booking
    from reserve_operational_session(v_unique_cancel_session);
  perform mark_operational_payment(v_unique_cancel_booking, 'payme', 'ROUTE-CANCEL');
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  perform approve_operational_payment(v_unique_cancel_booking);
  reset role;

  update public.operational_sessions
     set cancelled_at = cancelled_at - interval '1 minute'
   where cancelled_at is not null;

  select count(*) into v_cancelled_member_before
    from public.notifications
   where profile_id = 'ee000000-0000-0000-0000-00000000e001'
     and kind = 'operational_session_cancelled_no_defer'
     and body = v_cancelled_member_body;
  select count(*) into v_cancelled_admin_before
    from public.notifications
   where kind = 'operational_session_cancelled'
     and body = v_cancelled_admin_body;

  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  perform cancel_operational_session(v_unique_cancel_session, 'Unique routing test');
  reset role;

  select count(*) into v_cancelled_member_after
    from public.notifications
   where profile_id = 'ee000000-0000-0000-0000-00000000e001'
     and kind = 'operational_session_cancelled_no_defer'
     and body = v_cancelled_member_body;
  select count(*) into v_cancelled_admin_after
    from public.notifications
   where kind = 'operational_session_cancelled'
     and body = v_cancelled_admin_body;
  perform pg_temp.op_assert(
    v_cancelled_member_after - v_cancelled_member_before = 1,
    'real cancellation produces exactly one no-defer member notification'
  );
  perform pg_temp.op_assert(
    v_cancelled_admin_after - v_cancelled_admin_before = 2,
    'real cancellation produces exactly two Admin notifications'
  );
  perform pg_temp.op_assert(
    (select destination
       from public.notifications
      where profile_id = 'ee000000-0000-0000-0000-00000000e001'
        and kind = 'operational_session_cancelled_no_defer'
        and body = v_cancelled_member_body)
      = '#/activity/' || v_unique_cancel_session,
    'paid no-defer cancellation routes to its exact Activity Details page'
  );
  perform pg_temp.op_assert(
    not exists (
      select 1
        from public.notifications
       where kind = 'operational_session_cancelled'
         and body = v_cancelled_admin_body
         and destination is distinct from '#/activity/' || v_unique_cancel_session
    ),
    'paid Admin cancellation routes to its exact Activity Details page'
  );

  -- Explicit valid destinations are authoritative even for entity kinds.
  insert into public.notifications (profile_id, kind, title, body, destination)
  values (
    'ee000000-0000-0000-0000-00000000e001',
    'operational_booking_reserved',
    'Explicit route',
    'This route must be preserved.',
    '#/giving'
  )
  returning id into v_explicit_notification;
  perform pg_temp.op_assert(
    (select destination from public.notifications where id = v_explicit_notification) = '#/giving',
    'explicit Giving destination remains unchanged'
  );
end $$;

-- Historical backfill fixtures cover nine independent classes. The nearby
-- booking exists before its notification to prove INSERT routing is exact;
-- migration reapplication may fuzzily repair that booking row only. The
-- historical cancellation gains an exact timestamp match after notification
-- insertion and must remain unresolved.
create temp table notification_routing_backfill_fixtures (
  fixture_class text primary key,
  notification_id uuid not null unique
) on commit drop;

do $$
declare
  v_nearby_at constant timestamptz := '2001-01-01 00:00:00+00';
  v_malformed_at constant timestamptz := '2001-01-01 00:01:00+00';
  v_ambiguous_at constant timestamptz := '2001-01-01 00:02:00+00';
  v_foreign_at constant timestamptz := '2001-01-01 00:03:00+00';
  v_explicit_at constant timestamptz := '2001-01-01 00:04:00+00';
  v_read_state_at constant timestamptz := '2001-01-01 00:05:00+00';
  v_historical_cancellation_at constant timestamptz := '2001-01-01 00:06:00+00';
  v_rsvp_unique_at constant timestamptz := '2001-01-01 00:07:00+00';
  v_rsvp_ambiguous_at constant timestamptz := '2001-01-01 00:08:00+00';
  v_read_at constant timestamptz := '2001-01-02 00:00:00+00';
  v_nearby_notification uuid;
  v_malformed_notification uuid;
  v_ambiguous_notification uuid;
  v_foreign_notification uuid;
  v_explicit_notification uuid;
  v_read_state_notification uuid;
  v_historical_cancellation_notification uuid;
  v_rsvp_unique_notification uuid;
  v_rsvp_ambiguous_notification uuid;
  v_historical_cancel_session text;
begin
  select historical_cancel_session into v_historical_cancel_session
    from operational_time_fixtures;

  insert into public.notifications
    (profile_id, kind, title, body, destination, created_at)
  values
    ('bb000000-0000-0000-0000-00000000b001',
     'operational_booking_reserved', 'Historical malformed', 'No body parsing.',
     'https://example.invalid/foreign', v_malformed_at)
  returning id into v_malformed_notification;

  insert into public.notifications
    (profile_id, kind, title, body, created_at)
  values
    ('bb000000-0000-0000-0000-00000000b001',
     'operational_booking_reserved', 'Historical ambiguous', 'No body parsing.',
     v_ambiguous_at)
  returning id into v_ambiguous_notification;

  insert into public.notifications
    (profile_id, kind, title, body, created_at)
  values
    ('bb000000-0000-0000-0000-00000000b001',
     'operational_booking_reserved', 'Historical foreign only', 'No body parsing.',
     v_foreign_at)
  returning id into v_foreign_notification;

  insert into public.notifications
    (profile_id, kind, title, body, destination, created_at)
  values
    ('bb000000-0000-0000-0000-00000000b001',
     'operational_booking_reserved', 'Historical explicit', 'No body parsing.',
     '#/giving', v_explicit_at)
  returning id into v_explicit_notification;

  insert into public.notifications
    (profile_id, kind, title, body, read_at, created_at)
  values
    ('bb000000-0000-0000-0000-00000000b001',
     'operational_booking_reserved', 'Historical read state', 'No body parsing.',
     v_read_at, v_read_state_at)
  returning id into v_read_state_notification;

  insert into public.notifications
    (profile_id, kind, title, body, created_at)
  values
    ('aa000000-0000-0000-0000-00000000a001',
     'operational_session_cancelled', 'Historical cancellation', 'No body parsing.',
     v_historical_cancellation_at)
  returning id into v_historical_cancellation_notification;

  insert into public.notifications
    (profile_id, kind, title, body, created_at)
  values
    ('bb000000-0000-0000-0000-00000000b001',
     'operational_rsvp_confirmed', 'Historical RSVP unique', 'No body parsing.',
     v_rsvp_unique_at)
  returning id into v_rsvp_unique_notification;

  insert into public.notifications
    (profile_id, kind, title, body, created_at)
  values
    ('bb000000-0000-0000-0000-00000000b001',
     'operational_rsvp_confirmed', 'Historical RSVP ambiguous', 'No body parsing.',
     v_rsvp_ambiguous_at)
  returning id into v_rsvp_ambiguous_notification;

  insert into public.operational_bookings
    (id, profile_id, session_id, status, reserved_at, pay_deadline_at, snapshot)
  values
    ('11000000-0000-0000-0000-000000000001',
     'bb000000-0000-0000-0000-00000000b001',
     'hyrox-bft-2026-08-22', 'expired', v_nearby_at + interval '4 seconds',
     v_nearby_at + interval '1 day', '{}'::jsonb),
    ('11000000-0000-0000-0000-000000000002',
     'bb000000-0000-0000-0000-00000000b001',
     'hyrox-midtown-2026-08-22', 'expired', v_malformed_at,
     v_malformed_at + interval '1 day', '{}'::jsonb),
    ('22000000-0000-0000-0000-000000000001',
     'bb000000-0000-0000-0000-00000000b001',
     'hyrox-bft-2026-08-22', 'expired', v_ambiguous_at,
     v_ambiguous_at + interval '1 day', '{}'::jsonb),
    ('22000000-0000-0000-0000-000000000002',
     'bb000000-0000-0000-0000-00000000b001',
     'hyrox-midtown-2026-08-22', 'expired', v_ambiguous_at,
     v_ambiguous_at + interval '1 day', '{}'::jsonb),
    ('33000000-0000-0000-0000-000000000001',
     'dd000000-0000-0000-0000-00000000d001',
     'hyrox-bft-2026-08-22', 'expired', v_foreign_at,
     v_foreign_at + interval '1 day', '{}'::jsonb),
    ('55000000-0000-0000-0000-000000000001',
     'bb000000-0000-0000-0000-00000000b001',
     'hyrox-bft-2026-08-22', 'expired', v_explicit_at,
     v_explicit_at + interval '1 day', '{}'::jsonb),
    ('66000000-0000-0000-0000-000000000001',
     'bb000000-0000-0000-0000-00000000b001',
     'hyrox-bft-2026-08-22', 'expired', v_read_state_at,
     v_read_state_at + interval '1 day', '{}'::jsonb),
    ('77000000-0000-0000-0000-000000000001',
     'bb000000-0000-0000-0000-00000000b001',
     'lunch-2026-08-22', 'expired', v_rsvp_unique_at,
     v_rsvp_unique_at + interval '1 day', '{}'::jsonb),
    ('88000000-0000-0000-0000-000000000001',
     'bb000000-0000-0000-0000-00000000b001',
     'lunch-2026-08-22', 'expired', v_rsvp_ambiguous_at,
     v_rsvp_ambiguous_at + interval '1 day', '{}'::jsonb),
    ('88000000-0000-0000-0000-000000000002',
     'bb000000-0000-0000-0000-00000000b001',
     'lunch-2026-08-29', 'expired', v_rsvp_ambiguous_at,
     v_rsvp_ambiguous_at + interval '1 day', '{}'::jsonb);

  -- A booking four seconds away is eligible only for historical repair. It
  -- already exists when this row is inserted, so a fuzzy INSERT resolver
  -- would incorrectly assign it immediately.
  insert into public.notifications
    (profile_id, kind, title, body, created_at)
  values
    ('bb000000-0000-0000-0000-00000000b001',
     'operational_booking_reserved', 'Historical nearby booking', 'No body parsing.',
     v_nearby_at)
  returning id into v_nearby_notification;

  update public.operational_sessions
     set cancelled_at = v_historical_cancellation_at,
         cancelled_by = 'aa000000-0000-0000-0000-00000000a001',
         cancelled_source = 'admin',
         cancel_reason = 'Historical routing evidence'
   where id = v_historical_cancel_session;

  perform pg_temp.op_assert(
    exists (
      select 1
        from public.operational_sessions
       where id = v_historical_cancel_session
         and activity_id = 'hyrox-midtown'
         and id = activity_id || '-' || session_date::text
    ),
    'historical cancellation fixture is a generated Midtown row with matching ID and date'
  );

  -- The insert trigger correctly discarded the malformed route while no
  -- candidate existed; restore it to model a genuinely historical bad value.
  update public.notifications
     set destination = 'https://example.invalid/foreign'
   where id = v_malformed_notification;

  insert into pg_temp.notification_routing_backfill_fixtures
    (fixture_class, notification_id)
  values
    ('nearby-booking', v_nearby_notification),
    ('unique-malformed', v_malformed_notification),
    ('ambiguous-same-profile', v_ambiguous_notification),
    ('foreign-only', v_foreign_notification),
    ('valid-explicit', v_explicit_notification),
    ('read-state', v_read_state_notification),
    ('historical-rsvp-unique', v_rsvp_unique_notification),
    ('historical-rsvp-ambiguous', v_rsvp_ambiguous_notification),
    ('historical-cancellation', v_historical_cancellation_notification);

  perform pg_temp.op_assert(
    (select count(*) from pg_temp.notification_routing_backfill_fixtures) = 9,
    'nine historical notification fixture classes are present'
  );
  perform pg_temp.op_assert(
    (select destination from public.notifications where id = v_nearby_notification) is null,
    'exact INSERT routing does not infer a booking four seconds away'
  );
  perform pg_temp.op_assert(
    (select destination from public.notifications where id = v_malformed_notification)
      = 'https://example.invalid/foreign',
    'unique-malformed fixture starts malformed'
  );
  perform pg_temp.op_assert(
    (select cancelled_at
       from public.operational_sessions
      where id = v_historical_cancel_session) = v_historical_cancellation_at,
    'historical cancellation fixture has one exact session candidate'
  );
  perform pg_temp.op_assert(
    (select destination from public.notifications where id = v_historical_cancellation_notification) is null,
    'historical cancellation fixture starts unresolved before backfill'
  );
  perform pg_temp.op_assert(
    (select destination from public.notifications where id = v_rsvp_unique_notification) is null,
    'unique historical RSVP fixture starts unresolved before backfill'
  );
  perform pg_temp.op_assert(
    (select destination from public.notifications where id = v_rsvp_ambiguous_notification) is null,
    'ambiguous historical RSVP fixture starts unresolved before backfill'
  );
end $$;

\ir ../migrations/20260829000007_notification_destinations.sql
\ir ../migrations/20260830000003_notification_event_destinations.sql

do $$
begin
  perform pg_temp.op_assert(
    (select n.destination
       from public.notifications n
       join pg_temp.notification_routing_backfill_fixtures f
         on f.notification_id = n.id
      where f.fixture_class = 'nearby-booking')
      = '#/pay/11000000-0000-0000-0000-000000000001',
    'actual migration fuzzily backfills a unique nearby same-profile reservation'
  );
  perform pg_temp.op_assert(
    (select n.destination
       from public.notifications n
       join pg_temp.notification_routing_backfill_fixtures f
         on f.notification_id = n.id
      where f.fixture_class = 'unique-malformed')
      = '#/pay/11000000-0000-0000-0000-000000000002',
    'actual migration repairs a malformed unique same-profile reservation'
  );
  perform pg_temp.op_assert(
    (select count(*)
       from public.notifications n
       join pg_temp.notification_routing_backfill_fixtures f
         on f.notification_id = n.id
      where f.fixture_class = 'ambiguous-same-profile'
        and n.destination is null) = 1,
    'actual migration leaves exactly one same-profile ambiguity unresolved'
  );
  perform pg_temp.op_assert(
    (select count(*)
       from public.notifications n
       join pg_temp.notification_routing_backfill_fixtures f
         on f.notification_id = n.id
      where f.fixture_class = 'foreign-only'
        and n.destination is null) = 1,
    'actual migration leaves exactly one foreign-only fixture unresolved'
  );
  perform pg_temp.op_assert(
    (select n.destination
       from public.notifications n
       join pg_temp.notification_routing_backfill_fixtures f
         on f.notification_id = n.id
      where f.fixture_class = 'historical-rsvp-unique')
      = '#/activity/lunch-2026-08-22',
    'actual migration backfills a uniquely resolvable RSVP to Activity Details'
  );
  perform pg_temp.op_assert(
    (select count(*)
       from public.notifications n
       join pg_temp.notification_routing_backfill_fixtures f
         on f.notification_id = n.id
      where f.fixture_class = 'historical-rsvp-ambiguous'
        and n.destination is null) = 1,
    'actual migration leaves an ambiguous historical RSVP unresolved'
  );
  perform pg_temp.op_assert(
    (select count(*)
       from public.notifications n
       join pg_temp.notification_routing_backfill_fixtures f
         on f.notification_id = n.id
      where f.fixture_class = 'historical-cancellation'
        and n.destination is null) = 1,
    'actual migration never infers a historical cancellation destination'
  );
  perform pg_temp.op_assert(
    (select n.destination
       from public.notifications n
       join pg_temp.notification_routing_backfill_fixtures f
         on f.notification_id = n.id
      where f.fixture_class = 'valid-explicit') = '#/giving',
    'actual migration preserves a valid explicit destination'
  );
  perform pg_temp.op_assert(
    (select n.destination
       from public.notifications n
       join pg_temp.notification_routing_backfill_fixtures f
         on f.notification_id = n.id
      where f.fixture_class = 'read-state')
      = '#/pay/66000000-0000-0000-0000-000000000001',
    'actual migration backfills a read notification destination'
  );
  perform pg_temp.op_assert(
    (select n.read_at
       from public.notifications n
       join pg_temp.notification_routing_backfill_fixtures f
         on f.notification_id = n.id
      where f.fixture_class = 'read-state')
      = '2001-01-02 00:00:00+00'::timestamptz,
    'actual migration preserves existing read_at'
  );
end $$;

create temp table notification_routing_backfill_snapshot on commit drop as
select id, profile_id, kind, title, body, destination, read_at, created_at
  from public.notifications;

\ir ../migrations/20260829000007_notification_destinations.sql
\ir ../migrations/20260830000003_notification_event_destinations.sql

select pg_temp.op_assert(
  not exists (
    select 1
      from pg_temp.notification_routing_backfill_snapshot s
      full join public.notifications n on n.id = s.id
     where s.id is null
        or n.id is null
        or s.profile_id is distinct from n.profile_id
        or s.kind is distinct from n.kind
        or s.title is distinct from n.title
        or s.body is distinct from n.body
        or s.destination is distinct from n.destination
        or s.read_at is distinct from n.read_at
        or s.created_at is distinct from n.created_at
  ),
  'notification routing migration second reapplication is idempotent'
);

-- =====================================================================
-- Free-event venue overrides (Task 1)
-- =====================================================================

do $$
declare
  v_admin     constant uuid := 'aa000000-0000-0000-0000-00000000a001';
  v_super     constant uuid := 'ff000000-0000-0000-0000-00000000f001';
  v_member_a  constant uuid := 'bb000000-0000-0000-0000-00000000b001';
  v_member_b  constant uuid := 'dd000000-0000-0000-0000-00000000d001';
  v_member_c  constant uuid := 'ee000000-0000-0000-0000-00000000e001';
  v_pending   constant uuid := 'cc000000-0000-0000-0000-00000000c001';
  v_session   constant text := 'wnt-2026-08-19';
  v_other_session constant text := 'wnt-2026-08-26';
  v_non_tamar_session constant text := 'wnt-2026-09-02';
  v_reset_only_session constant text := 'water-2026-08-18';
  v_partial_session constant text := 'water-2026-08-25';
  v_initial_count integer;
  v_after_edit_count integer;
  v_after_reset_count integer;
  v_after_reconfirm_count integer;
  v_member_notified_at timestamptz;
  v_partial_member_count integer;
  v_member_before_point integer;
  v_admin_before_point integer;
  v_retained_notified_at timestamptz;
begin
  perform ensure_operational_sessions(date '2026-08-01', 5);

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;

  -- Reset with no retained override is a true no-op: no blank row and no
  -- audit notification are created.
  select count(*) into v_initial_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform public.set_session_venue(v_reset_only_session, null, null, false);
  perform pg_temp.op_assert(
    not exists (
      select 1 from public.operational_session_venue_overrides
       where session_id = v_reset_only_session
    ),
    'first blank reset does not create an override row'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
      where kind = 'operational_session_venue_updated') = v_initial_count,
    'first blank reset does not create audit notifications'
  );

  -- First confirmation: TBC -> real venue. Shared to members + acting admin;
  -- audit to other admins; pending excluded.
  perform public.set_session_venue(
    v_session,
    'Central Harbourfront — 7pm sharp',
    'Central Harbourfront, Hong Kong',
    true
  );
  -- Cross-recipient assertions must run as the test owner because notification
  -- RLS intentionally exposes only the authenticated user's own rows.
  reset role;

  perform pg_temp.op_assert(
    (select location from public.operational_session_venue_overrides where session_id = v_session)
      = 'Central Harbourfront — 7pm sharp',
    'dated free-event venue stored'
  );
  perform pg_temp.op_assert(
    (select activity_id from public.operational_session_venue_overrides where session_id = v_session) = 'wnt',
    'venue override records the derived activity'
  );
  perform pg_temp.op_assert(
    (select member_notified_at from public.operational_session_venue_overrides where session_id = v_session)
      is not null,
    'member notification timestamp recorded on first transition'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
       where kind = 'operational_session_venue_updated'
         and destination = '#/activity/' || v_session
         and profile_id in (v_member_a, v_member_b, v_member_c)) = 3,
    'first confirmation notifies approved members once'
  );
  perform pg_temp.op_assert(
    exists (
      select 1 from public.notifications
       where kind = 'operational_session_venue_updated'
         and destination = '#/activity/' || v_session
         and profile_id = v_admin
         and title = 'Venue confirmed'
         and body = 'Wednesday Night Training on 2026-08-19 is at Central Harbourfront — 7pm sharp. Check the activity page for details.'
    ),
    'acting admin receives shared Venue confirmed'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
       where kind = 'operational_session_venue_updated'
         and destination = '#/activity/' || v_session
         and profile_id = v_super
         and title = 'Session venue updated') = 1,
    'other admins receive audit notification'
  );
  perform pg_temp.op_assert(
    not exists (select 1 from public.notifications
       where kind = 'operational_session_venue_updated'
         and destination = '#/activity/' || v_session
         and profile_id = v_pending),
    'pending profiles are excluded'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
       where kind = 'operational_session_venue_updated'
         and destination = '#/activity/' || v_session
         and profile_id = v_admin
         and title = 'Session venue updated') = 0,
    'acting admin does not also receive audit'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
       where kind = 'operational_session_venue_updated'
         and destination = '#/activity/' || v_session)
      = (select count(*) from public.profiles where role = 'member')
        + 1  -- acting admin shared
        + (select count(*) from public.profiles
            where role in ('admin', 'super_admin') and id <> v_admin),
    'members + acting admin shared + other admins audit'
  );
  perform pg_temp.op_assert(
    exists (
      select 1 from public.notifications
       where kind = 'operational_session_venue_updated'
         and profile_id = v_member_a
         and body = 'Wednesday Night Training on 2026-08-19 is at Central Harbourfront — 7pm sharp. Check the activity page for details.'
    ),
    'member copy uses the activity display name and dated venue'
  );
  perform pg_temp.op_assert(
    exists (
      select 1 from public.notifications
       where kind = 'operational_session_venue_updated'
         and profile_id = v_super
         and body = 'Admin Test set the venue for wnt-2026-08-19 to Central Harbourfront — 7pm sharp.'
    ),
    'admin audit copy identifies the acting profile'
  );

  -- Subsequent edit: shared to all members + actor, audit to other admins.
  select count(*) into v_initial_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform public.set_session_venue(
    v_session,
    'Wan Chai Promenade — 7pm sharp',
    'Wan Chai Promenade, Hong Kong',
    false
  );
  select count(*) into v_after_edit_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform pg_temp.op_assert(
    v_after_edit_count - v_initial_count
      = (select count(*) from public.profiles where role = 'member')
        + 1
        + (select count(*) from public.profiles
            where role in ('admin', 'super_admin') and id <> v_admin),
    'second save shared-notifies members+actor and audits other admins'
  );
  perform pg_temp.op_assert(
    exists (
      select 1 from public.notifications
       where kind = 'operational_session_venue_updated'
         and profile_id = v_member_a
         and title = 'Venue updated'
         and body like 'Wednesday Night Training on 2026-08-19 is at Wan Chai Promenade%'
    ),
    'later edit uses Venue updated shared title'
  );

  -- No-op save: no new notification rows.
  select count(*) into v_initial_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform public.set_session_venue(
    v_session,
    'Wan Chai Promenade — 7pm sharp',
    'Wan Chai Promenade, Hong Kong',
    false
  );
  select count(*) into v_after_edit_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform pg_temp.op_assert(
    v_after_edit_count = v_initial_count,
    'no-op save does not notify anyone'
  );

  -- Reset: audit only; preserve member_notified_at for title choice.
  select member_notified_at into v_member_notified_at
    from public.operational_session_venue_overrides where session_id = v_session;
  select count(*) into v_initial_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform public.set_session_venue(v_session, null, null, false);
  select count(*) into v_after_reset_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform pg_temp.op_assert(
    v_after_reset_count - v_initial_count
      = (select count(*) from public.profiles
          where role in ('admin', 'super_admin') and id <> v_admin),
    'reset fans out only to other admins'
  );
  perform pg_temp.op_assert(
    (select location from public.operational_session_venue_overrides where session_id = v_session) is null,
    'reset clears the override location'
  );
  perform pg_temp.op_assert(
    (select member_notified_at from public.operational_session_venue_overrides where session_id = v_session)
      = v_member_notified_at,
    'reset preserves member_notified_at for confirmed vs updated titles'
  );

  -- Reconfirmation after reset: shared again as Venue updated.
  perform public.set_session_venue(
    v_session,
    'Causeway Bay Promenade — 7pm sharp',
    'Causeway Bay Promenade, Hong Kong',
    false
  );
  select count(*) into v_after_reconfirm_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform pg_temp.op_assert(
    v_after_reconfirm_count - v_after_reset_count
      = (select count(*) from public.profiles where role = 'member')
        + 1
        + (select count(*) from public.profiles
            where role in ('admin', 'super_admin') and id <> v_admin),
    'reconfirmation after reset shared-notifies members+actor and audits other admins'
  );

  -- A partial row does not consume member dedupe or create blank copy. Once
  -- both usable values are present, that same session confirms exactly once.
  perform public.set_session_venue(
    v_partial_session,
    null,
    'Victoria Park Swimming Pool, Hong Kong',
    true
  );
  perform pg_temp.op_assert(
    (select member_notified_at from public.operational_session_venue_overrides
      where session_id = v_partial_session) is null,
    'partial override does not consume member_notified_at'
  );
  perform pg_temp.op_assert(
    not exists (
      select 1 from public.notifications
       where kind = 'operational_session_venue_updated'
         and destination = '#/activity/' || v_partial_session
         and profile_id in (v_member_a, v_member_b, v_member_c)
    ),
    'partial override creates no member notification copy'
  );
  perform public.set_session_venue(
    v_partial_session,
    'Victoria Park Swimming Pool',
    'Victoria Park Swimming Pool, Hong Kong',
    true
  );
  select count(*) into v_partial_member_count
    from public.notifications
   where kind = 'operational_session_venue_updated'
     and destination = '#/activity/' || v_partial_session
     and profile_id in (v_member_a, v_member_b, v_member_c);
  perform pg_temp.op_assert(
    v_partial_member_count = 3,
    'completing a partial override notifies approved members exactly once'
  );
  perform pg_temp.op_assert(
    exists (
      select 1 from public.notifications
       where kind = 'operational_session_venue_updated'
         and profile_id = v_member_a
         and destination = '#/activity/' || v_partial_session
         and body = 'ITC Swimming on 2026-08-25 is at Victoria Park Swimming Pool. Check the activity page for details.'
    ),
    'completed partial override uses Swimming display copy'
  );

  -- A six-argument WNT Tamar save stores the dated point.
  perform public.set_session_venue(
    v_other_session, 'Tamar Park', 'Tamar Park', true,
    22.2825, 114.1659
  );
  perform pg_temp.op_assert(
    (select meeting_lat = 22.2825 and meeting_lng = 114.1659
       from public.operational_session_venue_overrides
      where session_id = v_other_session),
    'dated WNT meeting point is stored'
  );

  -- Moving only the point audits Admins once without repeating members.
  select count(*) into v_member_before_point
    from public.notifications
   where kind = 'operational_session_venue_updated'
     and destination = '#/activity/' || v_other_session
     and profile_id in (v_member_a, v_member_b, v_member_c);
  select count(*) into v_admin_before_point
    from public.notifications
   where kind = 'operational_session_venue_updated'
     and destination = '#/activity/' || v_other_session
     and profile_id = v_super;
  perform public.set_session_venue(
    v_other_session, 'Tamar Park', 'Tamar Park', false,
    22.2827, 114.1661
  );
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
      where kind = 'operational_session_venue_updated'
        and destination = '#/activity/' || v_other_session
        and profile_id in (v_member_a, v_member_b, v_member_c)) = v_member_before_point,
    'coordinate-only edit does not repeat member fan-out'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
      where kind = 'operational_session_venue_updated'
        and destination = '#/activity/' || v_other_session
        and profile_id = v_super) = v_admin_before_point + 1,
    'coordinate-only edit creates one Admin audit notification'
  );

  -- Partial and out-of-range Tamar points are rejected before persistence.
  begin
    perform public.set_session_venue(
      'wnt-2026-09-09', 'Tamar Park', 'Tamar Park', true,
      22.28, null
    );
    raise exception 'partial point should fail';
  exception when others then
    if sqlerrm not like '%Meeting point must include valid latitude and longitude.%' then raise; end if;
  end;
  begin
    perform public.set_session_venue(
      'wnt-2026-09-09', 'Tamar Park', 'Tamar Park', true,
      91, 114.16
    );
    raise exception 'latitude should fail';
  exception when others then
    if sqlerrm not like '%Meeting point must include valid latitude and longitude.%' then raise; end if;
  end;
  begin
    perform public.set_session_venue(
      'wnt-2026-09-09', 'Tamar Park', 'Tamar Park', true,
      22.28, -181
    );
    raise exception 'longitude should fail';
  exception when others then
    if sqlerrm not like '%Meeting point must include valid latitude and longitude.%' then raise; end if;
  end;

  -- Stale arguments never attach specialized points to another activity or venue.
  perform public.set_session_venue(
    'run-2026-09-14', 'Tamar Park', 'Tamar Park', true,
    22.2825, 114.1659
  );
  perform pg_temp.op_assert(
    (select meeting_lat is null and meeting_lng is null
       from public.operational_session_venue_overrides
      where session_id = 'run-2026-09-14'),
    'non-WNT save clears stale coordinates'
  );
  perform public.set_session_venue(
    v_non_tamar_session, 'Island ECC 9/F', 'Island ECC', true,
    22.2825, 114.1659
  );
  perform pg_temp.op_assert(
    (select meeting_lat is null and meeting_lng is null
       from public.operational_session_venue_overrides
      where session_id = v_non_tamar_session),
    'non-Tamar save clears stale coordinates'
  );

  -- The old signature remains usable and reset clears the point while retaining dedupe.
  select member_notified_at into v_retained_notified_at
    from public.operational_session_venue_overrides
   where session_id = v_other_session;
  perform public.set_session_venue(v_other_session, null, null, false);
  perform pg_temp.op_assert(
    (select meeting_lat is null and meeting_lng is null
        and member_notified_at = v_retained_notified_at
       from public.operational_session_venue_overrides
      where session_id = v_other_session),
    'four-argument reset clears point and retains member dedupe'
  );

  -- The browser's six named arguments admit lunch without retaining stale
  -- meeting coordinates, and the compatibility overload can reset it.
  perform public.set_session_venue(
    'lunch-2026-08-22', 'Cafe Deco, Central', 'Cafe Deco, Central', true,
    null, null
  );
  perform pg_temp.op_assert(
    exists (
      select 1 from public.operational_session_venue_overrides
       where session_id = 'lunch-2026-08-22'
         and activity_id = 'lunch'
         and location = 'Cafe Deco, Central'
         and maps_query = 'Cafe Deco, Central'
         and meeting_lat is null
         and meeting_lng is null
    ),
    'six-argument lunch venue save persists without meeting coordinates'
  );
  perform public.set_session_venue('lunch-2026-08-22', null, null, false);
  perform pg_temp.op_assert(
    exists (
      select 1 from public.operational_session_venue_overrides
       where session_id = 'lunch-2026-08-22'
         and activity_id = 'lunch'
         and location is null
         and maps_query is null
         and meeting_lat is null
         and meeting_lng is null
    ),
    'four-argument lunch venue reset clears the retained override'
  );

  reset role;
end $$;

-- Public venue details are selectable through the actual anon and
-- authenticated roles, while every direct mutation privilege is denied.
do $$
declare
  v_anon_count integer;
  v_authenticated_count integer;
begin
  set local role anon;
  select count(*) into v_anon_count
    from public.operational_session_venue_overrides;
  reset role;
  perform pg_temp.op_assert(v_anon_count > 0, 'anon can select venue overrides');

  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select count(*) into v_authenticated_count
    from public.operational_session_venue_overrides;
  reset role;
  perform pg_temp.op_assert(
    v_authenticated_count = v_anon_count,
    'authenticated clients can select the same public venue overrides'
  );
end $$;

do $$
declare
  v_denials integer := 0;
begin
  perform set_config('request.jwt.claim.sub', 'ff000000-0000-0000-0000-00000000f001', true);
  set local role authenticated;
  begin
    insert into public.operational_session_venue_overrides
      (session_id, activity_id, location, maps_query)
    values ('run-2026-09-07', 'run', 'Direct insert', 'Direct insert');
  exception when insufficient_privilege then
    v_denials := v_denials + 1;
  end;
  begin
    update public.operational_session_venue_overrides
       set location = 'Direct update'
     where session_id = 'wnt-2026-08-19';
  exception when insufficient_privilege then
    v_denials := v_denials + 1;
  end;
  begin
    delete from public.operational_session_venue_overrides
     where session_id = 'wnt-2026-08-19';
  exception when insufficient_privilege then
    v_denials := v_denials + 1;
  end;
  reset role;
  perform pg_temp.op_assert(
    v_denials = 3,
    'authenticated direct insert/update/delete are all denied'
  );
end $$;

-- Super Admins mutate successfully through the trusted RPC.
do $$
begin
  perform set_config('request.jwt.claim.sub', 'ff000000-0000-0000-0000-00000000f001', true);
  set local role authenticated;
  perform public.set_session_venue(
    'run-2026-09-07',
    'Tamar Park',
    'Tamar Park, Hong Kong',
    true
  );
  reset role;
  perform pg_temp.op_assert(
    exists (
      select 1 from public.operational_session_venue_overrides
       where session_id = 'run-2026-09-07'
         and set_by = 'ff000000-0000-0000-0000-00000000f001'
         and member_notified_at is not null
    ),
    'Super Admin RPC saves and records first member fan-out'
  );
end $$;

-- Denial: ordinary members cannot call the RPC.
do $$
begin
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  begin
    perform public.set_session_venue('wnt-2026-08-19', 'x', 'y', true);
    raise exception 'member should not set_session_venue';
  exception when others then
    if sqlerrm not like '%Administrator access required%' then
      raise;
    end if;
  end;
  reset role;
end $$;

-- Denial: pending cannot call the RPC.
do $$
begin
  perform set_config('request.jwt.claim.sub', 'cc000000-0000-0000-0000-00000000c001', true);
  set local role authenticated;
  begin
    perform public.set_session_venue('wnt-2026-08-19', 'x', 'y', true);
    raise exception 'pending should not set_session_venue';
  exception when others then
    if sqlerrm not like '%Administrator access required%' then
      raise;
    end if;
  end;
  reset role;
end $$;

-- Denial: HYROX session id is rejected with the exact spec message.
do $$
begin
  perform ensure_operational_sessions(date '2026-08-01', 5);
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  begin
    perform public.set_session_venue('hyrox-bft-2026-08-22', 'x', 'y', true);
    raise exception 'hyrox should be rejected';
  exception when others then
    if sqlerrm not like '%Activity venue is fixed.%' then
      raise;
    end if;
  end;
  reset role;
end $$;

-- Anon must not execute the RPC at all.
do $$
begin
  set local role anon;
  begin
    perform public.set_session_venue('wnt-2026-08-19', 'x', 'y', true);
    raise exception 'anon should not set_session_venue';
  exception when others then
    if sqlerrm not like '%permission denied%' and sqlerrm not like '%42501%' then
      raise;
    end if;
  end;
  reset role;
end $$;

-- =====================================================================
-- Admin attendance: paid-only, time-bound, reversible and idempotent
-- =====================================================================

do $$
declare
  v_today date := (now() at time zone 'Asia/Hong_Kong')::date;
  v_open_time time := ((now() at time zone 'Asia/Hong_Kong') + interval '10 minutes')::time;
  v_future_time time := ((now() at time zone 'Asia/Hong_Kong') + interval '16 minutes')::time;
  v_old_time time := ((now() at time zone 'Asia/Hong_Kong') - interval '25 hours 1 second')::time;
  v_open_boundary_time time := ((now() at time zone 'Asia/Hong_Kong') + interval '15 minutes')::time;
  v_close_boundary_time time := ((now() at time zone 'Asia/Hong_Kong') - interval '25 hours')::time;
  v_open_date date := ((now() at time zone 'Asia/Hong_Kong') + interval '10 minutes')::date;
  v_future_date date := ((now() at time zone 'Asia/Hong_Kong') + interval '16 minutes')::date;
  v_old_date date := ((now() at time zone 'Asia/Hong_Kong') - interval '25 hours 1 second')::date;
  v_open_boundary_date date := ((now() at time zone 'Asia/Hong_Kong') + interval '15 minutes')::date;
  v_close_boundary_date date := ((now() at time zone 'Asia/Hong_Kong') - interval '25 hours')::date;
  v_open_session text;
  v_future_session text;
  v_old_session text;
  v_free_session text;
  v_cancelled_session text;
  v_open_boundary_session text;
  v_close_boundary_session text;
  v_first_attended_at timestamptz;
  v_attendee_name_count integer;
  v_receipt_status text;
  v_booking public.operational_bookings;
begin
  v_open_session := 'event-attendance-open-' || v_open_date::text;
  v_future_session := 'event-attendance-future-' || v_future_date::text;
  v_old_session := 'event-attendance-old-' || v_old_date::text;
  v_free_session := 'event-attendance-free-' || v_open_date::text;
  v_cancelled_session := 'event-attendance-cancelled-' || v_open_date::text;
  v_open_boundary_session := 'event-attendance-open-boundary-' || v_open_boundary_date::text;
  v_close_boundary_session := 'event-attendance-close-boundary-' || v_close_boundary_date::text;

  insert into public.operational_activity_templates
    (activity_id, name, venue, weekday, start_time, duration_minutes,
     capacity, price_hkd, default_open, active, category, requires_rsvp)
  values
    ('event-attendance-open', 'Attendance Open', 'Test Venue', extract(dow from v_open_date)::smallint, v_open_time, 60, 10, 180, true, false, 'HYROX', false),
    ('event-attendance-future', 'Attendance Future', 'Test Venue', extract(dow from v_future_date)::smallint, v_future_time, 60, 10, 180, true, false, 'HYROX', false),
    ('event-attendance-old', 'Attendance Old', 'Test Venue', extract(dow from v_old_date)::smallint, v_old_time, 60, 10, 180, true, false, 'HYROX', false),
    ('event-attendance-free', 'Attendance Free', 'Test Venue', extract(dow from v_open_date)::smallint, v_open_time, 60, 10, 0, true, false, 'Socials', true),
    ('event-attendance-cancelled', 'Attendance Cancelled', 'Test Venue', extract(dow from v_open_date)::smallint, v_open_time, 60, 10, 180, true, false, 'HYROX', false),
    ('event-attendance-open-boundary', 'Attendance Opening Boundary', 'Test Venue', extract(dow from v_open_boundary_date)::smallint, v_open_boundary_time, 60, 10, 180, true, false, 'HYROX', false),
    ('event-attendance-close-boundary', 'Attendance Closing Boundary', 'Test Venue', extract(dow from v_close_boundary_date)::smallint, v_close_boundary_time, 60, 10, 180, true, false, 'HYROX', false);

  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes, venue, capacity, price_hkd, is_open)
  values
    (v_open_session, 'event-attendance-open', v_open_date, v_open_time, 60, 'Test Venue', 10, 180, true),
    (v_future_session, 'event-attendance-future', v_future_date, v_future_time, 60, 'Test Venue', 10, 180, true),
    (v_old_session, 'event-attendance-old', v_old_date, v_old_time, 60, 'Test Venue', 10, 180, true),
    (v_free_session, 'event-attendance-free', v_open_date, v_open_time, 60, 'Test Venue', 10, 0, true),
    (v_cancelled_session, 'event-attendance-cancelled', v_open_date, v_open_time, 60, 'Test Venue', 10, 180, true),
    (v_open_boundary_session, 'event-attendance-open-boundary', v_open_boundary_date, v_open_boundary_time, 60, 'Test Venue', 10, 180, true),
    (v_close_boundary_session, 'event-attendance-close-boundary', v_close_boundary_date, v_close_boundary_time, 60, 'Test Venue', 10, 180, true);

  update public.operational_sessions
     set cancelled_at = now(), cancelled_by = 'aa000000-0000-0000-0000-00000000a001',
         cancelled_source = 'admin', cancel_reason = 'Attendance cancellation test'
   where id = v_cancelled_session;

  insert into public.operational_bookings
    (id, profile_id, session_id, status, reserved_at, pay_deadline_at,
     payment_marked_at, payment_method, payment_reference, paid_at, confirmed_by, snapshot)
  values
    ('13000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-00000000b001', v_open_session, 'confirmed', now() - interval '2 days', now() - interval '1 day', now() - interval '1 day', 'payme', 'ATTEND-PAID', now() - interval '1 day', 'aa000000-0000-0000-0000-00000000a001', '{"name":"Attendance Open","price_hkd":180}'::jsonb),
    ('13000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-00000000d001', v_open_session, 'reserved', now(), now() + interval '1 day', null, null, null, null, null, '{"name":"Attendance Open","price_hkd":180}'::jsonb),
    ('13000000-0000-0000-0000-000000000003', 'bb000000-0000-0000-0000-00000000b001', v_future_session, 'confirmed', now(), now(), now(), 'fps', 'FUTURE', now(), 'aa000000-0000-0000-0000-00000000a001', '{"name":"Attendance Future","price_hkd":180}'::jsonb),
    ('13000000-0000-0000-0000-000000000004', 'bb000000-0000-0000-0000-00000000b001', v_old_session, 'confirmed', now(), now(), now(), 'fps', 'OLD', now(), 'aa000000-0000-0000-0000-00000000a001', '{"name":"Attendance Old","price_hkd":180}'::jsonb),
    ('13000000-0000-0000-0000-000000000005', 'bb000000-0000-0000-0000-00000000b001', v_free_session, 'confirmed', now(), now(), null, null, null, now(), null, '{"name":"Attendance Free","price_hkd":0}'::jsonb),
    ('13000000-0000-0000-0000-000000000006', 'bb000000-0000-0000-0000-00000000b001', v_cancelled_session, 'confirmed', now(), now(), now(), 'payme', 'CANCELLED', now(), 'aa000000-0000-0000-0000-00000000a001', '{"name":"Attendance Cancelled","price_hkd":180}'::jsonb),
    ('13000000-0000-0000-0000-000000000007', 'bb000000-0000-0000-0000-00000000b001', v_open_boundary_session, 'confirmed', now(), now(), now(), 'payme', 'OPEN-BOUNDARY', now(), 'aa000000-0000-0000-0000-00000000a001', '{"name":"Attendance Opening Boundary","price_hkd":180}'::jsonb),
    ('13000000-0000-0000-0000-000000000008', 'bb000000-0000-0000-0000-00000000b001', v_close_boundary_session, 'confirmed', now(), now(), now(), 'payme', 'CLOSE-BOUNDARY', now(), 'aa000000-0000-0000-0000-00000000a001', '{"name":"Attendance Closing Boundary","price_hkd":180}'::jsonb);

  insert into public.operational_receipts
    (receipt_number, booking_id, profile_id, session_id, amount_hkd, payment_method, issued_by)
  values
    ('ITC-ATTEND-0001', '13000000-0000-0000-0000-000000000001',
     'bb000000-0000-0000-0000-00000000b001', v_open_session, 180, 'payme',
     'aa000000-0000-0000-0000-00000000a001');

  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  begin
    perform public.set_operational_attendance('13000000-0000-0000-0000-000000000001', true);
    raise exception 'member should not set attendance';
  exception when others then
    if sqlerrm not like '%Administrator access required%' then raise; end if;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  select * into v_booking from public.set_operational_attendance('13000000-0000-0000-0000-000000000001', true);
  perform pg_temp.op_assert(v_booking.status = 'attended'
    and v_booking.attended_by = 'aa000000-0000-0000-0000-00000000a001',
    'Admin marks a confirmed-paid booking Arrived');
  v_first_attended_at := v_booking.attended_at;
  reset role;

  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select count(*) into v_attendee_name_count
    from public.get_operational_attendee_names(v_open_session);
  perform pg_temp.op_assert(v_attendee_name_count = 1,
    'Arrived paid members remain in the protected attendee-name roster');
  reset role;

  select status into v_receipt_status from public.operational_receipts
   where booking_id = '13000000-0000-0000-0000-000000000001';
  perform pg_temp.op_assert(v_receipt_status = 'issued', 'attendance preserves the issued receipt');
  select * into v_booking from public.operational_bookings
   where id = '13000000-0000-0000-0000-000000000001';
  perform pg_temp.op_assert(v_booking.profile_id = 'bb000000-0000-0000-0000-00000000b001'
    and v_booking.session_id = v_open_session
    and v_booking.payment_marked_at = now() - interval '1 day'
    and v_booking.payment_method = 'payme'
    and v_booking.payment_reference = 'ATTEND-PAID'
    and v_booking.paid_at = now() - interval '1 day'
    and v_booking.confirmed_by = 'aa000000-0000-0000-0000-00000000a001',
    'attendance changes only status and attendance audit fields');

  perform set_config('request.jwt.claim.sub', 'ff000000-0000-0000-0000-00000000f001', true);
  set local role authenticated;
  select * into v_booking from public.set_operational_attendance('13000000-0000-0000-0000-000000000001', true);
  perform pg_temp.op_assert(v_booking.attended_at = v_first_attended_at
    and v_booking.attended_by = 'aa000000-0000-0000-0000-00000000a001',
    'idempotent mark preserves first attendance audit');
  select * into v_booking from public.set_operational_attendance('13000000-0000-0000-0000-000000000001', false);
  perform pg_temp.op_assert(v_booking.status = 'confirmed'
    and v_booking.attended_at is null and v_booking.attended_by is null,
    'Super Admin reverses Arrived to Expected');

  begin
    perform public.set_operational_attendance('13000000-0000-0000-0000-000000000001', null);
    raise exception 'null attendance state should reject';
  exception when others then if sqlerrm not like '%Attendance state is required%' then raise; end if; end;
  begin
    perform public.set_operational_attendance('13000000-0000-0000-0000-000000000002', true);
    raise exception 'unpaid booking should reject';
  exception when others then if sqlerrm not like '%confirmed-paid%' then raise; end if; end;
  begin
    perform public.set_operational_attendance('13000000-0000-0000-0000-000000000005', true);
    raise exception 'free RSVP should reject';
  exception when others then if sqlerrm not like '%paid sessions only%' then raise; end if; end;
  begin
    perform public.set_operational_attendance('13000000-0000-0000-0000-000000000006', true);
    raise exception 'cancelled session should reject';
  exception when others then if sqlerrm not like '%Session is cancelled%' then raise; end if; end;
  begin
    perform public.set_operational_attendance('13000000-0000-0000-0000-000000000003', true);
    raise exception 'early attendance should reject';
  exception when others then if sqlerrm not like '%outside the check-in window%' then raise; end if; end;
  begin
    perform public.set_operational_attendance('13000000-0000-0000-0000-000000000004', true);
    raise exception 'late attendance should reject';
  exception when others then if sqlerrm not like '%outside the check-in window%' then raise; end if; end;

  perform public.set_operational_attendance('13000000-0000-0000-0000-000000000007', true);
  perform public.set_operational_attendance('13000000-0000-0000-0000-000000000008', true);
  perform pg_temp.op_assert(
    (select count(*) = 2 from public.operational_bookings
      where id in ('13000000-0000-0000-0000-000000000007', '13000000-0000-0000-0000-000000000008')
        and status = 'attended'),
    'exact attendance opening and closing boundaries are inclusive');
  reset role;
end $$;

update public.operational_activity_templates
   set venue = 'Midtown 28'
 where activity_id = 'hyrox-midtown';

update public.operational_sessions
   set venue = case id
     when 'hyrox-midtown-2026-08-22' then 'Midtown 28'
     when 'hyrox-midtown-2026-08-29' then 'Custom Midtown Venue'
   end
 where id in ('hyrox-midtown-2026-08-22', 'hyrox-midtown-2026-08-29');

insert into public.operational_bookings
  (id, profile_id, session_id, status, pay_deadline_at, snapshot)
values
  ('12000000-0000-0000-0000-000000000001',
   'bb000000-0000-0000-0000-00000000b001',
   'hyrox-midtown-2026-08-22', 'reserved', now() + interval '1 day',
   '{"name":"hyrox-midtown","venue":"Midtown 28","price_hkd":180}'::jsonb),
  ('12000000-0000-0000-0000-000000000002',
   'dd000000-0000-0000-0000-00000000d001',
   'hyrox-midtown-2026-08-29', 'reserved', now() + interval '1 day',
   '{"name":"hyrox-midtown","venue":"Custom Midtown Venue","price_hkd":180}'::jsonb);

\ir ../migrations/20260813000002_midtown28_fitness.sql

select pg_temp.op_assert(
  (select venue = 'Midtown28 Fitness'
     from public.operational_activity_templates where activity_id = 'hyrox-midtown'),
  'migration must correct the exact old Midtown template venue'
);
select pg_temp.op_assert(
  (select venue = 'Midtown28 Fitness'
     from public.operational_sessions where id = 'hyrox-midtown-2026-08-22'),
  'migration must correct an exact old Midtown session venue'
);
select pg_temp.op_assert(
  (select venue = 'Custom Midtown Venue'
     from public.operational_sessions where id = 'hyrox-midtown-2026-08-29'),
  'migration must preserve a custom Midtown session venue'
);
select pg_temp.op_assert(
  (select snapshot ->> 'venue' = 'Midtown28 Fitness'
     from public.operational_bookings
    where id = '12000000-0000-0000-0000-000000000001'),
  'migration must correct an exact old Midtown booking snapshot'
);
select pg_temp.op_assert(
  (select snapshot ->> 'venue' = 'Custom Midtown Venue'
     from public.operational_bookings
    where id = '12000000-0000-0000-0000-000000000002'),
  'migration must preserve a custom Midtown booking snapshot'
);

-- =====================================================================
-- Manual HYROX replacement requests
-- =====================================================================

do $$
declare
  v_booking_id constant uuid := '13000000-0000-0000-0000-000000000001';
  v_receipt_id constant uuid := '14000000-0000-0000-0000-000000000001';
  v_session_id constant text := concat('hyrox', '-bft-', '2099-01-03');
  v_token constant text := repeat('a', 64);
  v_created jsonb;
  v_invite jsonb;
  v_accepted jsonb;
  v_confirmed jsonb;
  v_request_id uuid;
begin
  perform ensure_operational_sessions(date '2099-01-03', 1);
  -- A same-day non-HYROX RSVP must not prevent this member from accepting
  -- the HYROX replacement.
  insert into public.operational_bookings (
    profile_id, session_id, status, pay_deadline_at, paid_at, snapshot
  ) values (
    'dd000000-0000-0000-0000-00000000d001',
    'lunch-2099-01-03',
    'confirmed', now(), now(),
    '{"name":"Post-Training Lunch","kind":"free","price_hkd":0}'::jsonb
  );
  insert into public.operational_bookings (
    id, profile_id, session_id, status, pay_deadline_at, payment_method,
    payment_reference, paid_at, snapshot
  ) values (
    v_booking_id,
    'bb000000-0000-0000-0000-00000000b001',
    v_session_id,
    'confirmed', now() + interval '1 day', 'payme', 'REPLACEMENT-TEST', now(),
    jsonb_build_object(
      'name', 'hyrox-bft',
      'session_date', date '2099-01-03',
      'start_time', time '11:15',
      'venue', 'BFT Causeway Bay',
      'price_hkd', 180
    )
  );
  insert into public.operational_receipts (
    id, receipt_number, booking_id, profile_id, session_id,
    amount_hkd, payment_method, issued_by
  ) values (
    v_receipt_id, 'ITC-2099-9901', v_booking_id,
    'bb000000-0000-0000-0000-00000000b001', v_session_id,
    180, 'payme', 'aa000000-0000-0000-0000-00000000a001'
  );
  perform pg_temp.op_assert(
    not (select snapshot ? 'kind' from public.operational_bookings where id = v_booking_id),
    'replacement fixture must preserve the legacy operational snapshot shape'
  );

  perform set_config('request.jwt.claim.sub', 'dd000000-0000-0000-0000-00000000d001', true);
  set local role authenticated;
  begin
    select public.create_operational_replacement_request(
      v_booking_id, v_token, now() + interval '12 hours'
    ) into v_created;
    raise exception 'non-owner should not create a replacement';
  exception when others then
    if sqlerrm not like '%Booking not found%' then raise; end if;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select public.create_operational_replacement_request(
    v_booking_id, v_token, now() + interval '12 hours'
  ) into v_created;
  perform pg_temp.op_assert(v_created ->> 'status' = 'pending', 'replacement create should be pending');
  v_request_id := (v_created ->> 'requestId')::uuid;
  begin
    select public.create_operational_replacement_request(
      v_booking_id, repeat('b', 64), now() + interval '12 hours'
    ) into v_created;
    raise exception 'second active replacement should fail';
  exception when others then
    if sqlerrm not like '%already active%' then raise; end if;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', 'dd000000-0000-0000-0000-00000000d001', true);
  set local role authenticated;
  select public.get_operational_replacement_invite(v_token) into v_invite;
  perform pg_temp.op_assert(not (v_invite ? 'tokenHash'), 'invite payload must not expose token hash');
  select public.accept_operational_replacement_request(v_token) into v_accepted;
  perform pg_temp.op_assert(v_accepted ->> 'status' = 'accepted', 'first approved claimant should win');
  perform pg_temp.op_assert(
    exists (
      select 1
        from public.notifications n
        join public.profiles p on p.id = n.profile_id
       where n.kind = 'hyrox_replacement_review'
         and p.role in ('admin', 'super_admin')
    ),
    'accepted replacement should notify an operational Admin role'
  );
  begin
    select public.accept_operational_replacement_request(v_token) into v_accepted;
    raise exception 'second claim should fail';
  exception when others then
    if sqlerrm not like '%no longer available%' then raise; end if;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  perform public.list_operational_replacement_requests();
  select public.admin_decide_operational_replacement(v_request_id, true, null) into v_confirmed;
  perform pg_temp.op_assert(
    v_confirmed ->> 'status' = 'confirmed',
    'Admin should confirm an accepted replacement despite a same-day non-HYROX booking'
  );
  perform pg_temp.op_assert(
    (select profile_id = 'bb000000-0000-0000-0000-00000000b001'::uuid
            and replacement_profile_id = 'dd000000-0000-0000-0000-00000000d001'::uuid
            and payment_reference = 'REPLACEMENT-TEST'
       from public.operational_bookings where id = v_booking_id),
    'confirmation must preserve payer and payment fields'
  );
  perform pg_temp.op_assert(
    (select profile_id = 'bb000000-0000-0000-0000-00000000b001'::uuid
       from public.operational_receipts where id = v_receipt_id),
    'confirmation must preserve receipt owner'
  );
  perform pg_temp.op_assert(
    (select count(*) = 3
       from public.operational_booking_replacement_audit where request_id = v_request_id),
    'replacement audit must preserve each lifecycle action'
  );
  perform pg_temp.op_assert(
    (select count(*) = 1
       from public.get_operational_attendee_names(v_session_id)
      where display_name = 'Other T.'),
    'confirmed replacement should appear as the effective attendee'
  );
  perform pg_temp.op_assert(
    not exists (
      select 1 from public.get_operational_attendee_names(v_session_id)
       where display_name = 'Member T.'
    ),
    'original payer should leave the effective attendee roster'
  );
  reset role;
end $$;

rollback;

-- =====================================================================
-- Seed: 15 August 2026 cancelled sessions (post-migration assertions)
-- =====================================================================

do $$
declare
  v_hyrox_reason text;
  v_midtown_reason text;
  v_hyrox_source text;
  v_midtown_source text;
  v_published_count integer;
begin
  select cancel_reason, cancelled_source
    into v_hyrox_reason, v_hyrox_source
    from public.operational_sessions where id = 'hyrox-bft-2026-08-15';
  perform pg_temp.op_assert(v_hyrox_reason = 'HYROX race weekend', 'hyrox 15 August cancel reason');
  perform pg_temp.op_assert(v_hyrox_source = 'system', 'hyrox 15 August source label');

  select cancel_reason, cancelled_source
    into v_midtown_reason, v_midtown_source
    from public.operational_sessions where id = 'hyrox-midtown-2026-08-15';
  perform pg_temp.op_assert(v_midtown_reason = 'HYROX race weekend', 'midtown 15 August cancel reason');
  perform pg_temp.op_assert(v_midtown_source = 'system', 'midtown 15 August source label');

  select count(*) into v_published_count
    from pg_publication_tables
   where pubname = 'supabase_realtime'
     and schemaname = 'public'
     and tablename in (
       'operational_sessions',
       'operational_bookings',
       'operational_queue_entries',
       'operational_receipts',
       'collector_assignments',
       'collector_payout_profiles'
     );
  perform pg_temp.op_assert(v_published_count = 6, 'all operational tables published to realtime');
end $$;
