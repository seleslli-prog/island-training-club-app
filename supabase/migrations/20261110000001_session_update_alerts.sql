-- Island ECC HYROX time changes, sign-up pauses, and sign-up reopens are
-- session alerts. They go to every approved member and admin. Session
-- alerts opt-out still suppresses the inbox row, and web push follows only
-- when that member has it on.

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
       'operational_session_signup_paused',
       'operational_session_signup_reopened',
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

create or replace function private.notify_session_update_alert(
  p_session_id text,
  p_kind text,
  p_title text,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (profile_id, kind, title, body, destination)
  select p.id,
         p_kind,
         p_title,
         p_body,
         '#/activity/' || p_session_id
    from public.profiles p
   where p.role in ('member', 'admin', 'super_admin');
end;
$$;

revoke all on function private.notify_session_update_alert(text, text, text, text)
  from public, anon, authenticated;

create or replace function public.set_operational_session_time(
  p_session_id text,
  p_time time
)
returns public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.operational_sessions;
  v_template_time time;
  v_was_tbc boolean;
  v_previous_time time;
  v_body text;
begin
  if public.operational_is_retired_hyrox_session(p_session_id) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;

  if p_time is null then
    perform public.operational_assert_admin('set_session_time');
    select s.* into v_session
      from public.operational_sessions s
     where s.id = p_session_id
     for update;
    if not found then
      raise exception 'Session not found.' using errcode = 'P0002';
    end if;
    if v_session.activity_id not in ('hyrox-quarry-bay-early', 'hyrox-quarry-bay')
       or v_session.session_date < date '2026-10-24' then
      raise exception 'Only Island ECC weeks from 24 Oct can return to TBC.'
        using errcode = '23514';
    end if;
    v_was_tbc := coalesce(v_session.time_tbc, false);
    select t.start_time into v_template_time
      from public.operational_activity_templates t
     where t.activity_id = v_session.activity_id;
    update public.operational_sessions
       set time_tbc = true,
           start_time = coalesce(v_template_time, start_time)
     where id = p_session_id
    returning * into v_session;
    if not v_was_tbc then
      perform private.notify_session_update_alert(
        p_session_id,
        'operational_session_time_updated',
        'HYROX time updated',
        format('ITC HYROX on %s is now TBC.', to_char(v_session.session_date, 'FMDD Mon'))
      );
    end if;
    return v_session;
  end if;

  select s.time_tbc, s.start_time into v_was_tbc, v_previous_time
    from public.operational_sessions s
   where s.id = p_session_id;

  v_session := public.set_operational_session_time_pre_pool_retirement_20260922(p_session_id, p_time);
  update public.operational_sessions
     set time_tbc = false
   where id = p_session_id
  returning * into v_session;

  if v_session.activity_id in ('hyrox-quarry-bay-early', 'hyrox-quarry-bay')
     and (coalesce(v_was_tbc, false) or v_previous_time is distinct from v_session.start_time) then
    v_body := format(
      'ITC HYROX on %s now starts at %s.',
      to_char(v_session.session_date, 'FMDD Mon'),
      to_char(v_session.start_time, 'HH12:MI AM')
    );
    perform private.notify_session_update_alert(
      p_session_id,
      'operational_session_time_updated',
      'HYROX time updated',
      v_body
    );
  end if;

  return v_session;
end;
$$;

create or replace function public.set_operational_island_ecc_signup_open(
  p_session_id text,
  p_open boolean
)
returns public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.operational_sessions;
  v_was_open boolean;
  v_notice text := 'Sign-up is paused while the times are updated.';
  v_reopened text := 'signup-reopened';
  v_when text;
  v_clock text;
  v_body text;
begin
  perform public.operational_assert_admin('set_island_ecc_signup_open');

  if public.operational_is_retired_hyrox_session(p_session_id) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if p_open is null then
    raise exception 'Choose whether sign-up is open.' using errcode = '23514';
  end if;

  select * into v_session
    from public.operational_sessions
   where id = p_session_id
   for update;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if v_session.activity_id not in ('hyrox-quarry-bay-early', 'hyrox-quarry-bay') then
    raise exception 'Only Island ECC HYROX weeks can pause sign-up.'
      using errcode = '23514';
  end if;
  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;

  v_was_open := v_session.is_open;
  update public.operational_sessions
     set is_open = p_open,
         notice = case
           when p_open and id in (
             'hyrox-quarry-bay-early-2026-11-14',
             'hyrox-quarry-bay-2026-11-14'
           ) then v_reopened
           when p_open and notice = v_notice then null
           when not p_open and (
             notice is null or btrim(notice) = '' or notice = v_reopened
           ) then v_notice
           else notice
         end
   where id = p_session_id
  returning * into v_session;

  if v_was_open is distinct from v_session.is_open then
    v_when := to_char(v_session.session_date, 'FMDD Mon');
    v_clock := case
      when coalesce(v_session.time_tbc, false) then null
      else to_char(v_session.start_time, 'HH12:MI AM')
    end;
    if p_open then
      v_body := case
        when v_clock is null then format('Sign-up for ITC HYROX on %s is open again.', v_when)
        else format('Sign-up for ITC HYROX on %s at %s is open again.', v_when, v_clock)
      end;
      perform private.notify_session_update_alert(
        p_session_id,
        'operational_session_signup_reopened',
        'HYROX sign-up reopened',
        v_body
      );
    else
      v_body := case
        when v_clock is null then format('Sign-up for ITC HYROX on %s is paused.', v_when)
        else format('Sign-up for ITC HYROX on %s at %s is paused.', v_when, v_clock)
      end;
      perform private.notify_session_update_alert(
        p_session_id,
        'operational_session_signup_paused',
        'HYROX sign-up paused',
        v_body
      );
    end if;
  end if;

  return v_session;
end;
$$;

notify pgrst, 'reload schema';
