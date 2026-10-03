-- Session reminders (in-app + web push) and open web-push eligibility.
-- WhatsApp is not a delivery channel. session_reminders defaults on so existing
-- booking / RSVP / venue / cancel inbox rows stay visible.

alter table public.applications
  add column if not exists session_reminders boolean not null default true;

alter table public.operational_bookings
  add column if not exists session_reminder_tomorrow_sent_at timestamptz,
  add column if not exists session_reminder_morning_sent_at timestamptz;

create or replace function public.web_push_ops_kind_eligible(p_kind text, p_title text)
returns boolean
language sql
immutable
as $$
  select true;
$$;

comment on function public.web_push_ops_kind_eligible(text, text) is
  'Web push: every inbox notification for that profile when applications.web_push_ops is on.';

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
          and a.session_reminders = false
     ) then
    return null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists notifications_respect_session_reminder_preference
  on public.notifications;
create trigger notifications_respect_session_reminder_preference
  before insert on public.notifications
  for each row execute function public.suppress_opted_out_session_reminder();

revoke all on function public.suppress_opted_out_session_reminder()
  from public;

create or replace function public.sweep_session_reminders(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (p_now at time zone 'Asia/Hong_Kong')::date;
  v_morning timestamptz := ((v_today::text || ' 07:00:00')::timestamp at time zone 'Asia/Hong_Kong');
  v_sent integer := 0;
begin
  with tomorrow as (
    update public.operational_bookings b
       set session_reminder_tomorrow_sent_at = p_now
      from public.operational_sessions s
     where s.id = b.session_id
       and b.status in ('reserved', 'confirmed')
       and s.cancelled_at is null
       and s.session_date = v_today + 1
       and b.session_reminder_tomorrow_sent_at is null
     returning b.id, b.profile_id, b.session_id, s.activity_id, s.session_date
  )
  insert into public.notifications (profile_id, kind, title, body, destination)
  select t.profile_id,
         'operational_session_reminder_tomorrow',
         'Session tomorrow',
         'Your session is tomorrow: ' || t.activity_id || ' on ' || t.session_date::text || '.',
         '#/activity/' || t.session_id
    from tomorrow t;
  get diagnostics v_sent = row_count;

  if p_now >= v_morning then
    with morning as (
      update public.operational_bookings b
         set session_reminder_morning_sent_at = p_now
        from public.operational_sessions s
       where s.id = b.session_id
         and b.status in ('reserved', 'confirmed')
         and s.cancelled_at is null
         and s.session_date = v_today
         and b.session_reminder_morning_sent_at is null
       returning b.id, b.profile_id, b.session_id, s.activity_id, s.session_date
    )
    insert into public.notifications (profile_id, kind, title, body, destination)
    select m.profile_id,
           'operational_session_reminder_morning',
           'Session this morning',
           'Your session is this morning: ' || m.activity_id || ' on ' || m.session_date::text || '.',
           '#/activity/' || m.session_id
      from morning m;
  end if;

  return v_sent;
end;
$$;

revoke all on function public.sweep_session_reminders(timestamptz) from public, anon;
grant execute on function public.sweep_session_reminders(timestamptz) to authenticated;

notify pgrst, 'reload schema';
