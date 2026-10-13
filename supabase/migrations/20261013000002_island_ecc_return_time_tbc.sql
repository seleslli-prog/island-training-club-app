-- Let an admin return one Island ECC week to TBC after a time was saved.

create or replace function public.set_operational_session_time_tbc(
  p_session_id text
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
end;
$$;

revoke all on function public.set_operational_session_time_tbc(text)
  from public, anon, authenticated;
grant execute on function public.set_operational_session_time_tbc(text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
