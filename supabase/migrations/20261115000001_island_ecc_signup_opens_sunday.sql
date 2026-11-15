-- Saturday Island ECC HYROX sign-up opens Sunday 18:00 HKT of that week.
-- Thursday 18:00 HKT stays the sign-up deadline. Reserve and join keep the
-- same checks; only the open clock and its sentence change.

create or replace function private.island_ecc_signup_opens_at(p_session_date date)
returns timestamptz
language sql
immutable
security definer
set search_path = public
as $$
  select ((p_session_date - 6) + time '18:00') at time zone 'Asia/Hong_Kong';
$$;

create or replace function public.reserve_operational_session(p_session_id text)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.operational_sessions;
  v_booking public.operational_bookings;
begin
  if public.operational_is_retired_hyrox_session(p_session_id) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;

  select * into v_session
    from public.operational_sessions
   where id = p_session_id;

  if private.operational_is_island_ecc_hyrox_activity(v_session.activity_id)
     and not v_session.is_open then
    raise exception 'HYROX sign-up is paused while the times are updated.'
      using errcode = '23514';
  end if;

  if private.operational_is_island_ecc_hyrox_activity(v_session.activity_id)
     and private.island_ecc_now()
         < private.island_ecc_signup_opens_at(v_session.session_date) then
    raise exception 'HYROX sign-up opens Sunday at 6 PM HKT.'
      using errcode = '23514';
  end if;

  if private.operational_is_island_ecc_hyrox_activity(v_session.activity_id)
     and v_session.session_date >= date '2026-10-24'
     and private.island_ecc_now()
         >= private.island_ecc_payment_deadline_at(v_session.session_date) then
    raise exception 'HYROX sign-up closes Thursday at 6 PM HKT.'
      using errcode = '23514';
  end if;

  if v_uid is not null
     and private.operational_is_island_ecc_hyrox_activity(v_session.activity_id) then
    perform pg_advisory_xact_lock(
      hashtextextended(v_uid::text || ':' || v_session.session_date::text, 0)
    );

    if exists (
      select 1
        from public.operational_bookings b
        join public.operational_sessions s on s.id = b.session_id
       where coalesce(b.replacement_profile_id, b.profile_id) = v_uid
         and b.status in ('reserved', 'confirmed', 'attended')
         and s.session_date = v_session.session_date
         and private.operational_is_island_ecc_hyrox_activity(s.activity_id)
    ) or exists (
      select 1
        from public.operational_queue_entries q
        join public.operational_sessions s on s.id = q.session_id
       where q.profile_id = v_uid
         and q.status = 'active'
         and s.session_date = v_session.session_date
         and private.operational_is_island_ecc_hyrox_activity(s.activity_id)
         and s.id <> v_session.id
    ) then
      raise exception 'Choose one Island ECC HYROX slot per Saturday.'
        using errcode = '23505';
    end if;
  end if;

  v_booking := public.reserve_operational_session_legacy(p_session_id);

  if private.operational_is_island_ecc_hyrox_activity(v_session.activity_id) then
    update public.operational_bookings
       set pay_deadline_at = private.island_ecc_next_pay_deadline(
             v_session.session_date,
             private.island_ecc_now()
           )
     where id = v_booking.id
    returning * into v_booking;
  end if;

  return v_booking;
end;
$$;

create or replace function public.join_operational_queue(
  p_session_id text,
  p_kind text
)
returns public.operational_queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.operational_sessions;
begin
  if public.operational_is_retired_hyrox_session(p_session_id) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;

  select * into v_session
    from public.operational_sessions
   where id = p_session_id;

  if private.operational_is_island_ecc_hyrox_activity(v_session.activity_id)
     and not v_session.is_open then
    raise exception 'HYROX sign-up is paused while the times are updated.'
      using errcode = '23514';
  end if;

  if private.operational_is_island_ecc_hyrox_activity(v_session.activity_id)
     and private.island_ecc_now()
         < private.island_ecc_signup_opens_at(v_session.session_date) then
    raise exception 'HYROX sign-up opens Sunday at 6 PM HKT.'
      using errcode = '23514';
  end if;

  if v_uid is not null
     and private.operational_is_island_ecc_hyrox_activity(v_session.activity_id) then
    perform pg_advisory_xact_lock(
      hashtextextended(v_uid::text || ':' || v_session.session_date::text, 0)
    );

    if exists (
      select 1
        from public.operational_bookings b
        join public.operational_sessions s on s.id = b.session_id
       where coalesce(b.replacement_profile_id, b.profile_id) = v_uid
         and b.status in ('reserved', 'confirmed', 'attended')
         and s.session_date = v_session.session_date
         and private.operational_is_island_ecc_hyrox_activity(s.activity_id)
    ) or exists (
      select 1
        from public.operational_queue_entries q
        join public.operational_sessions s on s.id = q.session_id
       where q.profile_id = v_uid
         and q.status = 'active'
         and s.session_date = v_session.session_date
         and private.operational_is_island_ecc_hyrox_activity(s.activity_id)
         and s.id <> v_session.id
    ) then
      raise exception 'Choose one Island ECC HYROX slot per Saturday.'
        using errcode = '23505';
    end if;
  end if;

  return public.join_operational_queue_pre_pool_retirement_20260922(
    p_session_id,
    p_kind
  );
end;
$$;

notify pgrst, 'reload schema';
