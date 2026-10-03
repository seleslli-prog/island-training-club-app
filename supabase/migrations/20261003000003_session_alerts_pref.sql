-- Align the Session alerts preference column with the Notifications label.
-- Fresh applies of 20261003000001 already create session_alerts. Preview DBs
-- that ran the earlier session_reminders name are renamed here.

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'applications'
       and column_name = 'session_reminders'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'applications'
       and column_name = 'session_alerts'
  ) then
    alter table public.applications rename column session_reminders to session_alerts;
  elsif not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'applications'
       and column_name = 'session_alerts'
  ) then
    alter table public.applications
      add column session_alerts boolean not null default true;
  end if;
end $$;

create or replace function public.suppress_opted_out_session_reminder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.kind = 'operational_session_venue_updated'
     and coalesce(NEW.title, '') not in ('Venue confirmed', 'Venue updated') then
    return NEW;
  end if;
  if NEW.kind in (
       'operational_booking_reserved',
       'operational_rsvp_confirmed',
       'operational_session_cancelled',
       'operational_session_cancelled_no_defer',
       'operational_session_time_updated',
       'operational_session_venue_updated',
       'operational_session_reminder_tomorrow',
       'operational_session_reminder_morning'
     )
     and exists (
       select 1
         from public.applications a
        where a.profile_id = NEW.profile_id
          and a.session_alerts = false
     ) then
    return null;
  end if;
  return NEW;
end;
$$;

notify pgrst, 'reload schema';
