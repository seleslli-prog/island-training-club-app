-- Remove Charmine Lau from the Sat 24 Oct and Sat 31 Oct 10:15 HYROX sessions.
-- Cancels those active bookings only. Payment rows stay. Other members stay put.
-- Safe to run again after the spots are released.

do $$
declare
  v_profile_id uuid;
  v_profile_count integer;
  v_session_id text;
  v_booking_count integer;
begin
  select count(distinct p.id) into v_profile_count
    from public.profiles p
    left join public.applications a on a.profile_id = p.id
   where lower(btrim(p.full_name)) = 'charmine lau'
      or lower(btrim(coalesce(a.preferred_name, ''))) = 'charmine lau';

  if v_profile_count <> 1 then
    raise exception 'Expected one Charmine Lau profile, found %.', v_profile_count;
  end if;

  select p.id into v_profile_id
    from public.profiles p
    left join public.applications a on a.profile_id = p.id
   where lower(btrim(p.full_name)) = 'charmine lau'
      or lower(btrim(coalesce(a.preferred_name, ''))) = 'charmine lau';

  foreach v_session_id in array array[
    'hyrox-quarry-bay-2026-10-24',
    'hyrox-quarry-bay-2026-10-31'
  ]
  loop
    select count(*) into v_booking_count
      from public.operational_bookings b
     where coalesce(b.replacement_profile_id, b.profile_id) = v_profile_id
       and b.session_id = v_session_id
       and b.status in ('reserved', 'confirmed', 'attended');

    if v_booking_count > 1 then
      raise exception 'Expected at most one active booking on % for Charmine Lau, found %.',
        v_session_id, v_booking_count;
    end if;

    if v_booking_count = 0 then
      continue;
    end if;

    update public.operational_bookings
       set status = 'cancelled'
     where coalesce(replacement_profile_id, profile_id) = v_profile_id
       and session_id = v_session_id
       and status in ('reserved', 'confirmed', 'attended');
  end loop;
end;
$$;
