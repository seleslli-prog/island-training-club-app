-- One-shot live cleanup. Paste into the Supabase SQL Editor and run once.
-- Do NOT add this to supabase/migrations — it is not a schema change.
-- Removes auth + profile rows for the listed emails after clearing
-- non-cascading operational FKs.

begin;

create temporary table remove_members on commit drop as
select p.id, p.email, p.role, p.full_name
  from public.profiles p
 where lower(p.email) in (
   'guitarforhymn17@gmail.com',
   'jeffli32@msn.com',
   'hf1395@aol.com',
   'chandrangptl@gmail.com',
   'johndoechang88@gmail.com'
 );

do $$
declare
  remaining_super int;
begin
  if not exists (select 1 from remove_members) then
    raise notice 'No matching profiles — nothing to delete.';
    return;
  end if;

  select count(*) into remaining_super
    from public.profiles
   where role = 'super_admin'
     and id not in (select id from remove_members);

  if remaining_super < 1
     and exists (
       select 1 from remove_members
        where role = 'super_admin'
     ) then
    raise exception 'Refusing to delete the last Super Admin.';
  end if;
end;
$$;

-- Preview (visible in the SQL Editor results)
select id, email, role, full_name from remove_members order by email;

update public.role_changes
   set changed_by = null
 where changed_by in (select id from remove_members);

update public.operational_sessions
   set cancelled_by = null
 where cancelled_by in (select id from remove_members);
update public.operational_sessions
   set gym_confirmed_by = null
 where gym_confirmed_by in (select id from remove_members);

update public.operational_session_venue_overrides
   set set_by = null
 where set_by in (select id from remove_members);

update public.operational_bookings
   set confirmed_by = null
 where confirmed_by in (select id from remove_members);
update public.operational_bookings
   set attended_by = null
 where attended_by in (select id from remove_members);
update public.operational_bookings
   set payment_rejected_by = null
 where payment_rejected_by in (select id from remove_members);
update public.operational_bookings
   set replacement_confirmed_by = null
 where replacement_confirmed_by in (select id from remove_members);
update public.operational_bookings
   set replacement_profile_id = null
 where replacement_profile_id in (select id from remove_members);

update public.operational_receipts
   set issued_by = null
 where issued_by in (select id from remove_members);

update public.operational_hyrox_cycles
   set plan_confirmed_by = null
 where plan_confirmed_by in (select id from remove_members);
update public.operational_hyrox_cycles
   set cancelled_by = null
 where cancelled_by in (select id from remove_members);

update public.operational_booking_replacement_requests
   set replacement_profile_id = null,
       accepted_by = null,
       declined_by = null,
       cancelled_by = null,
       rejected_by = null,
       confirmed_by = null
 where replacement_profile_id in (select id from remove_members)
    or accepted_by in (select id from remove_members)
    or declined_by in (select id from remove_members)
    or cancelled_by in (select id from remove_members)
    or rejected_by in (select id from remove_members)
    or confirmed_by in (select id from remove_members);

update public.operational_booking_replacement_audit
   set replacement_profile_id = null,
       actor_profile_id = null
 where replacement_profile_id in (select id from remove_members)
    or actor_profile_id in (select id from remove_members);

update public.collector_assignments
   set assigned_by = (
     select p.id from public.profiles p
      where p.role in ('super_admin', 'admin')
        and p.id not in (select id from remove_members)
      order by p.role desc
      limit 1
   )
 where assigned_by in (select id from remove_members);

delete from public.collector_assignments
 where collector_profile_id in (select id from remove_members);

delete from public.operational_booking_replacement_requests
 where original_profile_id in (select id from remove_members);

delete from public.operational_booking_replacement_audit
 where original_profile_id in (select id from remove_members);

delete from public.operational_receipts
 where profile_id in (select id from remove_members);

delete from public.operational_queue_entries
 where profile_id in (select id from remove_members);

delete from public.operational_hyrox_queue_entries
 where profile_id in (select id from remove_members);

delete from public.collector_payout_profiles
 where profile_id in (select id from remove_members);

delete from public.operational_bookings
 where profile_id in (select id from remove_members);

update public.community_announcements
   set creator_profile_id = (
     select p.id from public.profiles p
      where p.role in ('super_admin', 'admin')
        and p.id not in (select id from remove_members)
      order by p.role desc
      limit 1
   )
 where creator_profile_id in (select id from remove_members);

update public.giving_campaigns
   set creator_profile_id = (
     select p.id from public.profiles p
      where p.role in ('super_admin', 'admin')
        and p.id not in (select id from remove_members)
      order by p.role desc
      limit 1
   )
 where creator_profile_id in (select id from remove_members)
   and status <> 'closed';

-- Avatar audit is immutable (update and delete both raise 42501), including
-- ON DELETE CASCADE from profiles and ON DELETE SET NULL on actor_id.
alter table public.profile_avatar_audit
  disable trigger profile_avatar_audit_immutable;
delete from public.profile_avatar_audit
 where profile_id in (select id from remove_members);
update public.profile_avatar_audit
   set actor_id = null
 where actor_id in (select id from remove_members);
alter table public.profile_avatar_audit
  enable trigger profile_avatar_audit_immutable;

-- Profiles / applications / notifications / avatars / prayers / push
-- cascade from auth.users.
delete from auth.users
 where id in (select id from remove_members);

select
  email,
  (select count(*) = 0 from public.profiles p where p.id = t.id) as profile_gone,
  (select count(*) = 0 from auth.users u where u.id = t.id) as auth_gone
from remove_members t
order by email;

commit;
