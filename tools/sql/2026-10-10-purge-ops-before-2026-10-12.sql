-- One-shot live cleanup. Paste into the Supabase SQL Editor and run once
-- AFTER tools/sql/2026-10-10-archive-ops-before-2026-10-12.sql on
-- backup/ops-before-2026-10-12 has been applied.
-- Removes bookings, awaiting-payment holds, receipts, queues, replacements,
-- RSVP counts, and related inbox rows for sessions dated before 2026-10-12.
-- Does NOT delete operational_sessions themselves.
-- Do NOT add this to supabase/migrations.

begin;

do $$
begin
  if to_regclass('archive.operational_bookings_before_20261012') is null
     or to_regclass('archive.operational_sessions_before_20261012') is null then
    raise exception
      'Archive tables missing. Run 2026-10-10-archive-ops-before-2026-10-12.sql first.';
  end if;
end;
$$;

-- Preview
select 'bookings' as kind, count(*) from archive.operational_bookings_before_20261012
union all
select 'receipts', count(*) from archive.operational_receipts_before_20261012
union all
select 'queues', count(*) from archive.operational_queue_entries_before_20261012
order by 1;

update public.operational_bookings
   set deferred_from_booking_id = null
 where deferred_from_booking_id in (
   select id from archive.operational_bookings_before_20261012
 );
update public.operational_bookings
   set deferred_to_booking_id = null
 where deferred_to_booking_id in (
   select id from archive.operational_bookings_before_20261012
 );

delete from public.operational_booking_replacement_audit
 where booking_id in (select id from archive.operational_bookings_before_20261012)
    or request_id in (
         select id from archive.operational_booking_replacement_requests_before_20261012
       );

delete from public.operational_booking_replacement_requests
 where booking_id in (select id from archive.operational_bookings_before_20261012);

delete from public.operational_receipts
 where booking_id in (select id from archive.operational_bookings_before_20261012)
    or session_id in (select id from archive.operational_sessions_before_20261012);

delete from public.operational_queue_entries
 where session_id in (select id from archive.operational_sessions_before_20261012);

delete from public.operational_hyrox_queue_entries
 where cycle_id in (select id from archive.operational_hyrox_cycles_before_20261012)
    or target_session_id in (select id from archive.operational_sessions_before_20261012);

delete from public.operational_rsvp_counts
 where session_id in (select id from archive.operational_sessions_before_20261012);

delete from public.notifications n
 where exists (
         select 1 from archive.operational_bookings_before_20261012 b
          where n.destination like '%' || b.id::text || '%'
       )
    or exists (
         select 1 from archive.operational_sessions_before_20261012 s
          where n.destination like '%/activity/' || s.id || '%'
       );

delete from public.operational_bookings
 where id in (select id from archive.operational_bookings_before_20261012);

select
  (select count(*) from public.operational_bookings b
     join public.operational_sessions s on s.id = b.session_id
    where s.session_date < date '2026-10-12') as leftover_bookings,
  (select count(*) from public.operational_receipts r
     join public.operational_sessions s on s.id = r.session_id
    where s.session_date < date '2026-10-12') as leftover_receipts,
  (select count(*) from archive.operational_bookings_before_20261012) as archived_bookings;

commit;
