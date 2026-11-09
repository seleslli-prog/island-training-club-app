-- Island ECC HYROX capacity is 24 from Sat 14 Nov 2026, for both slots.
-- Weeks from 24 Oct through 7 Nov stay at 20. New weeks copy the template.

update public.operational_activity_templates
   set capacity = 24
 where activity_id in ('hyrox-quarry-bay-early', 'hyrox-quarry-bay');

update public.operational_sessions
   set capacity = 24
 where activity_id in ('hyrox-quarry-bay-early', 'hyrox-quarry-bay')
   and session_date >= date '2026-11-14';

create or replace function public.set_operational_session_capacity(
  p_session_id text,
  p_capacity integer
)
returns public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.operational_sessions;
  v_held integer;
begin
  perform public.operational_assert_admin('set_session_capacity');

  if public.operational_is_retired_hyrox_session(p_session_id) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if p_capacity is null or p_capacity < 1 then
    raise exception 'Enter a capacity of at least 1.' using errcode = '23514';
  end if;

  select s.* into v_session
    from public.operational_sessions s
   where s.id = p_session_id
   for update;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;

  select count(*) into v_held
    from public.operational_bookings b
   where b.session_id = p_session_id
     and b.status in ('reserved', 'confirmed', 'attended');
  if v_held > p_capacity then
    raise exception 'Capacity cannot be lower than the % places already held.', v_held
      using errcode = '23514';
  end if;

  update public.operational_sessions
     set capacity = p_capacity
   where id = p_session_id
  returning * into v_session;

  return v_session;
end;
$$;

revoke all on function public.set_operational_session_capacity(text, integer)
  from public, anon, authenticated;
grant execute on function public.set_operational_session_capacity(text, integer)
  to authenticated;

notify pgrst, 'reload schema';
