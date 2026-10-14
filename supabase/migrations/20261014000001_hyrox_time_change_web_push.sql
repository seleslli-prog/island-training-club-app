-- Island ECC HYROX time changes are session alerts. Inserting the inbox row
-- lets the existing web push trigger deliver it when web_push_ops is on.
-- session_alerts opt-out already suppresses operational_session_time_updated.

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
      insert into public.notifications (profile_id, kind, title, body, destination)
      select distinct b.profile_id,
             'operational_session_time_updated',
             'HYROX time updated',
             format('ITC HYROX on %s is now TBC.', to_char(v_session.session_date, 'FMDD Mon')),
             '#/activity/' || p_session_id
        from public.operational_bookings b
       where b.session_id = p_session_id
         and b.status in ('reserved', 'confirmed')
         and b.profile_id is not null;
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
    insert into public.notifications (profile_id, kind, title, body, destination)
    select distinct b.profile_id,
           'operational_session_time_updated',
           'HYROX time updated',
           v_body,
           '#/activity/' || p_session_id
      from public.operational_bookings b
     where b.session_id = p_session_id
       and b.status in ('reserved', 'confirmed')
       and b.profile_id is not null;
  end if;

  return v_session;
end;
$$;

notify pgrst, 'reload schema';
