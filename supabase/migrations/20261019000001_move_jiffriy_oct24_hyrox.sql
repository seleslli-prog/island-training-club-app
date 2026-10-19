-- Move Jiffriy Chandra from Sat 24 Oct 9:00 to Sat 24 Oct 10:15.
-- Keeps the same booking, payment, and status. Other members stay put.
-- Safe to run again after the move.

do $$
declare
  v_profile_id uuid;
  v_profile_count integer;
  v_booking_id uuid;
  v_booking_count integer;
  v_late public.operational_sessions;
begin
  select count(distinct p.id) into v_profile_count
    from public.profiles p
    left join public.applications a on a.profile_id = p.id
   where lower(btrim(p.full_name)) = 'jiffriy chandra'
      or lower(btrim(coalesce(a.preferred_name, ''))) = 'jiffriy chandra';

  if v_profile_count <> 1 then
    raise exception 'Expected one Jiffriy Chandra profile, found %.', v_profile_count;
  end if;

  select p.id into v_profile_id
    from public.profiles p
    left join public.applications a on a.profile_id = p.id
   where lower(btrim(p.full_name)) = 'jiffriy chandra'
      or lower(btrim(coalesce(a.preferred_name, ''))) = 'jiffriy chandra';

  if exists (
    select 1
      from public.operational_bookings b
     where coalesce(b.replacement_profile_id, b.profile_id) = v_profile_id
       and b.session_id = 'hyrox-quarry-bay-2026-10-24'
       and b.status in ('reserved', 'confirmed', 'attended')
  ) and not exists (
    select 1
      from public.operational_bookings b
     where coalesce(b.replacement_profile_id, b.profile_id) = v_profile_id
       and b.session_id = 'hyrox-quarry-bay-early-2026-10-24'
       and b.status in ('reserved', 'confirmed', 'attended')
  ) then
    return;
  end if;

  select count(*) into v_booking_count
    from public.operational_bookings b
   where coalesce(b.replacement_profile_id, b.profile_id) = v_profile_id
     and b.session_id = 'hyrox-quarry-bay-early-2026-10-24'
     and b.status in ('reserved', 'confirmed', 'attended');

  if v_booking_count <> 1 then
    raise exception 'Expected one Sat 24 Oct 9:00 booking for Jiffriy Chandra, found %.', v_booking_count;
  end if;

  select b.id into v_booking_id
    from public.operational_bookings b
   where coalesce(b.replacement_profile_id, b.profile_id) = v_profile_id
     and b.session_id = 'hyrox-quarry-bay-early-2026-10-24'
     and b.status in ('reserved', 'confirmed', 'attended');

  select * into v_late
    from public.operational_sessions
   where id = 'hyrox-quarry-bay-2026-10-24'
   for update;

  if not found then
    raise exception 'Sat 24 Oct 10:15 session was not found.';
  end if;

  if v_late.capacity is not null and v_late.held_count >= v_late.capacity then
    raise exception 'Sat 24 Oct 10:15 is already full.';
  end if;

  update public.operational_bookings
     set session_id = v_late.id,
         snapshot = jsonb_set(
           snapshot,
           '{start_time}',
           to_jsonb(v_late.start_time),
           true
         )
   where id = v_booking_id;
end;
$$;
