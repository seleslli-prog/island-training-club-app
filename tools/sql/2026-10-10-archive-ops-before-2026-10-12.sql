-- Backup copy of live operational rows for sessions dated before 2026-10-12
-- (HKT calendar date). Paste into the Supabase SQL Editor and run once.
-- Does NOT delete anything. The matching purge script lives on
-- chore/purge-ops-before-2026-10-12 and must run after this archive exists.
-- Do NOT add this to supabase/migrations.

begin;

create schema if not exists archive;

drop table if exists archive.operational_sessions_before_20261012;
create table archive.operational_sessions_before_20261012 as
select s.*
  from public.operational_sessions s
 where s.session_date < date '2026-10-12';

drop table if exists archive.operational_bookings_before_20261012;
create table archive.operational_bookings_before_20261012 as
select b.*
  from public.operational_bookings b
  left join public.operational_sessions s on s.id = b.session_id
 where s.session_date < date '2026-10-12'
    or (
      s.id is null
      and (
        (b.snapshot->>'session_date' ~ '^\d{4}-\d{2}-\d{2}$'
          and (b.snapshot->>'session_date')::date < date '2026-10-12')
        or (b.snapshot->>'dateISO' ~ '^\d{4}-\d{2}-\d{2}$'
          and (b.snapshot->>'dateISO')::date < date '2026-10-12')
      )
    );

drop table if exists archive.operational_receipts_before_20261012;
create table archive.operational_receipts_before_20261012 as
select r.*
  from public.operational_receipts r
 where r.booking_id in (select id from archive.operational_bookings_before_20261012)
    or r.session_id in (select id from archive.operational_sessions_before_20261012);

drop table if exists archive.operational_queue_entries_before_20261012;
create table archive.operational_queue_entries_before_20261012 as
select q.*
  from public.operational_queue_entries q
 where q.session_id in (select id from archive.operational_sessions_before_20261012);

drop table if exists archive.operational_hyrox_cycles_before_20261012;
create table archive.operational_hyrox_cycles_before_20261012 as
select c.*
  from public.operational_hyrox_cycles c
 where c.session_date < date '2026-10-12';

drop table if exists archive.operational_hyrox_queue_entries_before_20261012;
create table archive.operational_hyrox_queue_entries_before_20261012 as
select q.*
  from public.operational_hyrox_queue_entries q
 where q.cycle_id in (select id from archive.operational_hyrox_cycles_before_20261012)
    or q.target_session_id in (select id from archive.operational_sessions_before_20261012);

drop table if exists archive.operational_booking_replacement_requests_before_20261012;
create table archive.operational_booking_replacement_requests_before_20261012 as
select r.*
  from public.operational_booking_replacement_requests r
 where r.booking_id in (select id from archive.operational_bookings_before_20261012);

drop table if exists archive.operational_booking_replacement_audit_before_20261012;
create table archive.operational_booking_replacement_audit_before_20261012 as
select a.*
  from public.operational_booking_replacement_audit a
 where a.booking_id in (select id from archive.operational_bookings_before_20261012)
    or a.request_id in (
         select id from archive.operational_booking_replacement_requests_before_20261012
       );

drop table if exists archive.operational_rsvp_counts_before_20261012;
create table archive.operational_rsvp_counts_before_20261012 as
select c.*
  from public.operational_rsvp_counts c
 where c.session_id in (select id from archive.operational_sessions_before_20261012);

drop table if exists archive.notifications_before_20261012;
create table archive.notifications_before_20261012 as
select n.*
  from public.notifications n
 where exists (
         select 1 from archive.operational_bookings_before_20261012 b
          where n.destination like '%' || b.id::text || '%'
       )
    or exists (
         select 1 from archive.operational_sessions_before_20261012 s
          where n.destination like '%/activity/' || s.id || '%'
       );

select 'sessions' as kind, count(*) from archive.operational_sessions_before_20261012
union all
select 'bookings', count(*) from archive.operational_bookings_before_20261012
union all
select 'receipts', count(*) from archive.operational_receipts_before_20261012
union all
select 'queues', count(*) from archive.operational_queue_entries_before_20261012
union all
select 'hyrox_cycles', count(*) from archive.operational_hyrox_cycles_before_20261012
union all
select 'hyrox_queues', count(*) from archive.operational_hyrox_queue_entries_before_20261012
union all
select 'replacements', count(*) from archive.operational_booking_replacement_requests_before_20261012
union all
select 'replacement_audit', count(*) from archive.operational_booking_replacement_audit_before_20261012
union all
select 'rsvp_counts', count(*) from archive.operational_rsvp_counts_before_20261012
union all
select 'notifications', count(*) from archive.notifications_before_20261012
order by 1;

commit;
