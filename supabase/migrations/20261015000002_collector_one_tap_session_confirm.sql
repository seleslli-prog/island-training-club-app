-- Island Training Club — one-tap collector self-booking
--
-- On-duty collectors confirm their own paid spot in one step (reserve +
-- confirm). Other members still use Reserve → PayMe/FPS → I've paid →
-- collector confirm.

create or replace function public.confirm_own_collector_session(
  p_session_id text
)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.operational_sessions;
  v_collector uuid;
  v_booking public.operational_bookings;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if not public.operational_is_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  select * into v_session
    from public.operational_sessions
   where id = p_session_id
     for share;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;
  if coalesce(v_session.price_hkd, 0) <= 0 then
    raise exception 'Only paid sessions use collector confirmation.' using errcode = '23514';
  end if;

  select ca.collector_profile_id into v_collector
    from public.collector_assignments ca
   where ca.week_start <= v_session.session_date
   order by ca.week_start desc
   limit 1;
  if v_collector is null or v_collector is distinct from v_uid then
    raise exception 'Only the assigned collector can confirm their own booking.'
      using errcode = '42501';
  end if;

  select * into v_booking
    from public.operational_bookings
   where profile_id = v_uid
     and session_id = p_session_id
     and status in ('reserved', 'confirmed')
   order by case when status = 'reserved' then 0 else 1 end, created_at
   limit 1
   for update;

  if found and v_booking.status = 'confirmed' then
    return v_booking;
  end if;

  if not found then
    v_booking := public.reserve_operational_session(p_session_id);
  end if;

  return public.confirm_own_collector_booking(v_booking.id);
end;
$$;

revoke all on function public.confirm_own_collector_session(text)
  from public, anon, authenticated;
grant execute on function public.confirm_own_collector_session(text)
  to authenticated;

notify pgrst, 'reload schema';
