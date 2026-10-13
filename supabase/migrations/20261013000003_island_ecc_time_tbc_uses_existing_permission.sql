-- Mark time TBC through the already-permitted Save time function.
-- A null time means return that one Island ECC week to TBC.
-- CREATE OR REPLACE keeps the existing execute grant.

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
begin
  if public.operational_is_retired_hyrox_session(p_session_id) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  perform public.operational_assert_admin('set_session_time');

  select s.* into v_session
    from public.operational_sessions s
   where s.id = p_session_id
   for update;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;

  if p_time is null then
    if v_session.activity_id not in ('hyrox-quarry-bay-early', 'hyrox-quarry-bay')
       or v_session.session_date < date '2026-10-24' then
      raise exception 'Only Island ECC weeks from 24 Oct can return to TBC.'
        using errcode = '23514';
    end if;
    select t.start_time into v_template_time
      from public.operational_activity_templates t
     where t.activity_id = v_session.activity_id;
    update public.operational_sessions
       set time_tbc = true,
           start_time = coalesce(v_template_time, start_time)
     where id = p_session_id
    returning * into v_session;
    return v_session;
  end if;

  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;
  if v_session.start_time is distinct from p_time then
    update public.operational_sessions
       set start_time = p_time
     where id = p_session_id;
  end if;
  update public.operational_sessions
     set time_tbc = false
   where id = p_session_id
  returning * into v_session;
  return v_session;
end;
$$;

notify pgrst, 'reload schema';
