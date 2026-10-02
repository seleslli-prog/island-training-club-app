-- Island Training Club — Island ECC signup-window integration tests
--
-- Plain SQL covering Monday lock, Thursday/Friday pay-by, waitlist promote,
-- member/collector reminders, opt-out, and collector finalize nudge.
-- Run after every ordered migration through
-- supabase/tests/verify_operational_backend.sh against a disposable
-- Supabase-compatible database.

\set ON_ERROR_STOP on

begin;

create function pg_temp.assert(ok boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'verification failed: %', message;
  end if;
end;
$$;

create function pg_temp.expect_rejected(
  statement text,
  expected_state text,
  expected_message text
)
returns void language plpgsql as $$
declare
  actual_state text;
  actual_message text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics
      actual_state = returned_sqlstate,
      actual_message = message_text;
  end;
  perform pg_temp.assert(
    actual_state = expected_state and actual_message = expected_message,
    format(
      'expected SQLSTATE %s / %L, got %s / %L for: %s',
      expected_state, expected_message, coalesce(actual_state, '<success>'),
      actual_message, statement
    )
  );
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('e2100000-0000-0000-0000-000000000001', 'ecc-collector@itc.invalid', '{}'::jsonb),
  ('e2100000-0000-0000-0000-000000000002', 'ecc-holder@itc.invalid', '{}'::jsonb),
  ('e2100000-0000-0000-0000-000000000003', 'ecc-waitlist@itc.invalid', '{}'::jsonb),
  ('e2100000-0000-0000-0000-000000000004', 'ecc-marked@itc.invalid', '{}'::jsonb),
  ('e2100000-0000-0000-0000-000000000005', 'ecc-optout@itc.invalid', '{}'::jsonb);

update public.profiles
   set role = 'admin', full_name = 'ECC Collector'
 where id = 'e2100000-0000-0000-0000-000000000001';
update public.profiles
   set role = 'member', full_name = 'ECC Holder'
 where id = 'e2100000-0000-0000-0000-000000000002';
update public.profiles
   set role = 'member', full_name = 'ECC Waitlist'
 where id = 'e2100000-0000-0000-0000-000000000003';
update public.profiles
   set role = 'member', full_name = 'ECC Marked'
 where id = 'e2100000-0000-0000-0000-000000000004';
update public.profiles
   set role = 'member', full_name = 'ECC Opt Out'
 where id = 'e2100000-0000-0000-0000-000000000005';

insert into public.applications (
  profile_id, mobile, is_minor, privacy_accepted_at, hyrox_payment_reminders
) values
  ('e2100000-0000-0000-0000-000000000001', '+852 6100 0001', false, now(), true),
  ('e2100000-0000-0000-0000-000000000002', '+852 6100 0002', false, now(), true),
  ('e2100000-0000-0000-0000-000000000003', '+852 6100 0003', false, now(), true),
  ('e2100000-0000-0000-0000-000000000004', '+852 6100 0004', false, now(), true),
  ('e2100000-0000-0000-0000-000000000005', '+852 6100 0005', false, now(), false);

insert into public.collector_assignments
  (week_start, collector_profile_id, assigned_by)
values
  (date '2026-10-05',
   'e2100000-0000-0000-0000-000000000001',
   'e2100000-0000-0000-0000-000000000001');

insert into public.operational_sessions (
  id, activity_id, session_date, start_time, duration_minutes,
  venue, capacity, price_hkd, is_open
) values
  ('hyrox-quarry-bay-early-2026-10-10', 'hyrox-quarry-bay-early',
   date '2026-10-10', '09:15', 60, '10/F, Island ECC, Quarry Bay', 1, 180, true),
  ('hyrox-quarry-bay-2026-10-10', 'hyrox-quarry-bay',
   date '2026-10-10', '10:30', 60, '10/F, Island ECC, Quarry Bay', 1, 180, true),
  ('hyrox-quarry-bay-early-2026-10-17', 'hyrox-quarry-bay-early',
   date '2026-10-17', '09:15', 60, '10/F, Island ECC, Quarry Bay', 1, 180, true),
  ('hyrox-quarry-bay-2026-10-17', 'hyrox-quarry-bay',
   date '2026-10-17', '10:30', 60, '10/F, Island ECC, Quarry Bay', 1, 180, true),
  ('hyrox-quarry-bay-early-2026-10-24', 'hyrox-quarry-bay-early',
   date '2026-10-24', '09:15', 60, '10/F, Island ECC, Quarry Bay', 1, 180, true),
  ('hyrox-quarry-bay-2026-10-24', 'hyrox-quarry-bay',
   date '2026-10-24', '10:30', 60, '10/F, Island ECC, Quarry Bay', 1, 180, true),
  ('hyrox-bft-2026-10-10', 'hyrox-bft',
   date '2026-10-10', '11:15', 60, 'BFT Causeway Bay', 20, 180, true)
on conflict (id) do update
  set capacity = excluded.capacity,
      is_open = true,
      cancelled_at = null,
      cancelled_by = null,
      cancelled_source = null,
      cancel_reason = null,
      gym_confirmed_at = null,
      gym_confirmed_by = null,
      gym_note = null;

do $$
declare
  v_collector constant uuid := 'e2100000-0000-0000-0000-000000000001';
  v_holder constant uuid := 'e2100000-0000-0000-0000-000000000002';
  v_waitlist constant uuid := 'e2100000-0000-0000-0000-000000000003';
  v_marked constant uuid := 'e2100000-0000-0000-0000-000000000004';
  v_optout constant uuid := 'e2100000-0000-0000-0000-000000000005';
  v_saturday date := date '2026-10-10';
  v_late text := 'hyrox-quarry-bay-2026-10-10';
  v_early text := 'hyrox-quarry-bay-early-2026-10-10';
  v_optout_session text := 'hyrox-quarry-bay-2026-10-17';
  v_confirmed_early text := 'hyrox-quarry-bay-early-2026-10-24';
  v_confirmed_late text := 'hyrox-quarry-bay-2026-10-24';
  v_bft text := 'hyrox-bft-2026-10-10';
  v_monday_open timestamptz :=
    ((date '2026-10-10' - 5) + time '18:00') at time zone 'Asia/Hong_Kong';
  v_thursday_deadline timestamptz :=
    ((date '2026-10-10' - 2) + time '18:00') at time zone 'Asia/Hong_Kong';
  v_friday_18 timestamptz :=
    ((date '2026-10-10' - 1) + time '18:00') at time zone 'Asia/Hong_Kong';
  v_friday_21 timestamptz :=
    ((date '2026-10-10' - 1) + time '21:00') at time zone 'Asia/Hong_Kong';
  v_optout_open timestamptz :=
    ((date '2026-10-17' - 5) + time '18:00') at time zone 'Asia/Hong_Kong';
  v_optout_friday_18 timestamptz :=
    ((date '2026-10-17' - 1) + time '18:00') at time zone 'Asia/Hong_Kong';
  v_confirmed_friday_21 timestamptz :=
    ((date '2026-10-24' - 1) + time '21:00') at time zone 'Asia/Hong_Kong';
  v_hold public.operational_bookings;
  v_promoted public.operational_bookings;
  v_marked_hold public.operational_bookings;
  v_optout_hold public.operational_bookings;
  v_member_reminders integer;
  v_collector_reminders integer;
  v_nudges integer;
  v_expired integer;
begin
  perform set_config(
    'itc.clock',
    (v_monday_open - interval '1 second')::text,
    true
  );
  perform set_config('request.jwt.claim.sub', v_holder::text, true);
  set local role authenticated;
  perform pg_temp.expect_rejected(
    format('select public.reserve_operational_session(%L)', v_late),
    '23514',
    'HYROX sign-up opens Monday at 6 PM HKT.'
  );
  perform pg_temp.expect_rejected(
    format('select public.join_operational_queue(%L, %L)', v_late, 'waitlist'),
    '23514',
    'HYROX sign-up opens Monday at 6 PM HKT.'
  );
  reset role;

  perform set_config('itc.clock', v_monday_open::text, true);
  perform set_config('request.jwt.claim.sub', v_holder::text, true);
  set local role authenticated;
  select * into v_hold
    from public.reserve_operational_session(v_late);
  reset role;

  perform pg_temp.assert(
    v_hold.status = 'reserved'
      and v_hold.pay_deadline_at = v_thursday_deadline,
    'Island ECC reserve after Monday 18:00 must stamp Thursday 18:00 HKT pay-by'
  );

  perform set_config('request.jwt.claim.sub', v_holder::text, true);
  set local role authenticated;
  perform pg_temp.expect_rejected(
    format('select public.reserve_operational_session(%L)', v_early),
    '23505',
    'Choose one Island ECC HYROX slot per Saturday.'
  );
  perform pg_temp.expect_rejected(
    format('select public.join_operational_queue(%L, %L)', v_early, 'waitlist'),
    '23505',
    'Choose one Island ECC HYROX slot per Saturday.'
  );
  reset role;

  perform set_config('request.jwt.claim.sub', v_waitlist::text, true);
  set local role authenticated;
  perform public.join_operational_queue(v_late, 'waitlist');
  reset role;

  perform set_config('request.jwt.claim.sub', v_marked::text, true);
  set local role authenticated;
  select * into v_marked_hold
    from public.reserve_operational_session(v_early);
  perform public.mark_operational_payment(v_marked_hold.id, 'fps', 'MARKED-HOLD');
  reset role;

  perform set_config('request.jwt.claim.sub', v_collector::text, true);
  set local role authenticated;
  v_expired := public.sweep_operational_deadlines(
    v_thursday_deadline + interval '1 second'
  );
  reset role;

  select * into v_hold
    from public.operational_bookings
   where id = v_hold.id;
  select * into v_promoted
    from public.operational_bookings
   where profile_id = v_waitlist
     and session_id = v_late
     and status = 'reserved';
  select * into v_marked_hold
    from public.operational_bookings
   where id = v_marked_hold.id;

  perform pg_temp.assert(
    v_expired >= 1 and v_hold.status = 'expired',
    'unpaid original Island ECC hold must expire at Thursday 18:00 HKT'
  );
  perform pg_temp.assert(
    v_promoted.id is not null
      and v_promoted.pay_deadline_at = v_friday_21,
    'waitlist promote must insert reserved leftover with Friday 21:00 HKT pay-by'
  );
  perform pg_temp.assert(
    exists (
      select 1 from public.operational_queue_entries
       where profile_id = v_waitlist
         and session_id = v_late
         and status = 'promoted'
    ),
    'promoted waitlist row must be marked promoted'
  );
  perform pg_temp.assert(
    v_marked_hold.status = 'reserved'
      and v_marked_hold.payment_marked_at is not null,
    'marked-unconfirmed Island ECC hold must not expire at Thursday 18:00'
  );

  perform set_config('request.jwt.claim.sub', v_collector::text, true);
  set local role authenticated;
  perform public.sweep_island_ecc_reminders(v_friday_18);
  reset role;

  select count(*) into v_member_reminders
    from public.notifications
   where profile_id = v_waitlist
     and kind = 'operational_island_ecc_payment_reminder';
  select count(*) into v_collector_reminders
    from public.notifications
   where profile_id = v_collector
     and kind = 'operational_island_ecc_collector_finalize_reminder';

  perform pg_temp.assert(
    v_member_reminders = 1
      and exists (
        select 1 from public.notifications
         where profile_id = v_waitlist
           and kind = 'operational_island_ecc_payment_reminder'
           and created_at = v_friday_18
           and destination = '#/pay/' || v_promoted.id::text
           and body like 'Pay for ITC HYROX on % by the deadline or the spot goes to the waitlist.'
      ),
    'Friday 18:00 must send one member payment reminder to #/pay/{id}'
  );
  perform pg_temp.assert(
    v_collector_reminders = 1
      and exists (
        select 1 from public.notifications
         where profile_id = v_collector
           and kind = 'operational_island_ecc_collector_finalize_reminder'
           and created_at = v_friday_18
           and destination = '#/admin/payments'
           and body = 'Finalize both Island ECC HYROX sessions with Island ECC and the coach.'
      ),
    'Friday 18:00 must send one collector finalize reminder'
  );

  perform set_config('request.jwt.claim.sub', v_collector::text, true);
  set local role authenticated;
  perform public.sweep_island_ecc_reminders(v_friday_18 + interval '1 minute');
  reset role;

  perform pg_temp.assert(
    (select count(*) from public.notifications
      where profile_id = v_waitlist
        and kind = 'operational_island_ecc_payment_reminder') = 1
    and (select count(*) from public.notifications
      where profile_id = v_collector
        and kind = 'operational_island_ecc_collector_finalize_reminder') = 1,
    'Friday 18:00 member and collector reminders must be idempotent'
  );

  perform set_config('itc.clock', v_optout_open::text, true);
  perform set_config('request.jwt.claim.sub', v_optout::text, true);
  set local role authenticated;
  select * into v_optout_hold
    from public.reserve_operational_session(v_optout_session);
  reset role;

  perform set_config('request.jwt.claim.sub', v_collector::text, true);
  set local role authenticated;
  perform public.sweep_island_ecc_reminders(v_optout_friday_18);
  reset role;

  perform pg_temp.assert(
    (select count(*) from public.notifications
      where profile_id = v_optout
        and kind = 'operational_island_ecc_payment_reminder') = 0
    and (select island_ecc_payment_reminder_sent_at is not null
           from public.operational_bookings
          where id = v_optout_hold.id),
    'hyrox_payment_reminders false must skip the member Friday reminder'
  );

  perform set_config('request.jwt.claim.sub', v_collector::text, true);
  set local role authenticated;
  perform public.sweep_island_ecc_reminders(v_friday_21);
  reset role;

  select count(*) into v_nudges
    from public.notifications
   where profile_id = v_collector
     and kind = 'operational_island_ecc_collector_finalize_nudge';
  perform pg_temp.assert(
    v_nudges = 1
      and exists (
        select 1 from public.notifications
         where profile_id = v_collector
           and kind = 'operational_island_ecc_collector_finalize_nudge'
           and created_at = v_friday_21
           and destination = '#/admin/payments'
           and body = 'Still not finalized — please confirm with Island ECC and the coach if possible.'
      ),
    'Friday 21:00 must nudge when either Island ECC session is unconfirmed'
  );

  perform set_config('request.jwt.claim.sub', v_collector::text, true);
  set local role authenticated;
  perform public.sweep_island_ecc_reminders(v_friday_21 + interval '1 second');
  reset role;
  perform pg_temp.assert(
    (select count(*) from public.notifications
      where profile_id = v_collector
        and kind = 'operational_island_ecc_collector_finalize_nudge') = 1,
    'Friday 21:00 collector nudge must be idempotent'
  );

  update public.operational_sessions
     set gym_confirmed_at = v_confirmed_friday_21,
         gym_confirmed_by = v_collector,
         gym_note = 'Island ECC confirmed'
   where id in (v_confirmed_early, v_confirmed_late);

  perform set_config('request.jwt.claim.sub', v_collector::text, true);
  set local role authenticated;
  perform public.sweep_island_ecc_reminders(v_confirmed_friday_21);
  reset role;

  perform pg_temp.assert(
    (select count(*) from public.notifications
      where profile_id = v_collector
        and kind = 'operational_island_ecc_collector_finalize_nudge') = 1,
    'Friday 21:00 must not nudge when both Island ECC sessions are gym-confirmed'
  );

  perform set_config('itc.clock', v_monday_open::text, true);
  perform set_config('request.jwt.claim.sub', v_holder::text, true);
  set local role authenticated;
  perform pg_temp.expect_rejected(
    format('select public.reserve_operational_session(%L)', v_bft),
    'P0002',
    'Session not found.'
  );
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

rollback;
\echo 'Island ECC signup-window database integration verification passed.'
