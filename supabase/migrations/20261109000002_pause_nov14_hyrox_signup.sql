-- Pause both Sat 14 Nov 2026 Island ECC HYROX slots and clear current sign-ups.
-- The sessions stay on the schedule so the times can be updated first.
-- Reopen later with set_operational_island_ecc_signup_open; this does not
-- restore the released bookings. Receipts stay so a collector can apply a
-- payment that already landed.

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

insert into public.operational_sessions (
  id, activity_id, session_date, start_time, duration_minutes,
  venue, capacity, price_hkd, is_open, time_tbc, notice
)
select t.activity_id || '-2026-11-14',
       t.activity_id,
       date '2026-11-14',
       t.start_time,
       t.duration_minutes,
       t.venue,
       t.capacity,
       t.price_hkd,
       false,
       false,
       'Sign-up is paused while the times are updated.'
  from public.operational_activity_templates t
 where t.activity_id in ('hyrox-quarry-bay-early', 'hyrox-quarry-bay')
on conflict (id) do update
  set is_open = false,
      notice = case
        when operational_sessions.notice is null
          or btrim(operational_sessions.notice) = ''
          then excluded.notice
        else operational_sessions.notice
      end;

do $$
declare
  v_ids text[] := array[
    'hyrox-quarry-bay-early-2026-11-14',
    'hyrox-quarry-bay-2026-11-14'
  ];
  v_found integer;
begin
  select count(*) into v_found
    from public.operational_sessions
   where id = any (v_ids);
  if v_found <> 2 then
    raise exception 'Expected both Sat 14 Nov Island ECC HYROX sessions, found %.', v_found;
  end if;

  create temp table nov14_released (
    session_id text not null,
    profile_id uuid not null
  ) on commit drop;

  with closed_requests as (
    update public.operational_booking_replacement_requests r
       set status = 'cancelled',
           cancelled_at = now()
     where r.status in ('pending', 'accepted')
       and r.booking_id in (
         select b.id
           from public.operational_bookings b
          where b.session_id = any (v_ids)
            and b.status in ('reserved', 'confirmed', 'attended')
       )
    returning r.id, r.booking_id, r.original_profile_id, r.replacement_profile_id
  ),
  audited as (
    insert into public.operational_booking_replacement_audit (
      request_id, booking_id, action, original_profile_id,
      replacement_profile_id, reason
    )
    select c.id, c.booking_id, 'cancelled', c.original_profile_id,
           c.replacement_profile_id,
           'Sign-up paused while the times are updated.'
      from closed_requests c
    returning request_id
  )
  insert into nov14_released (session_id, profile_id)
  select b.session_id, person.profile_id
    from closed_requests c
    join public.operational_bookings b on b.id = c.booking_id
    cross join lateral (
      select c.original_profile_id as profile_id
      union
      select c.replacement_profile_id
    ) person
   where person.profile_id is not null
     and exists (select 1 from audited);

  insert into nov14_released (session_id, profile_id)
  select released.session_id, person.profile_id
    from (
      update public.operational_bookings b
         set status = 'cancelled',
             attended_at = null,
             attended_by = null
       where b.session_id = any (v_ids)
         and b.status in ('reserved', 'confirmed', 'attended')
      returning b.session_id, b.profile_id, b.replacement_profile_id
    ) released
    cross join lateral (
      select released.profile_id
      union
      select released.replacement_profile_id
    ) person
   where person.profile_id is not null;

  insert into nov14_released (session_id, profile_id)
  select q.session_id, q.profile_id
    from (
      update public.operational_queue_entries q
         set status = 'dissolved',
             resolved_at = now()
       where q.session_id = any (v_ids)
         and q.status = 'active'
      returning q.session_id, q.profile_id
    ) q
   where q.profile_id is not null;

  insert into public.notifications (profile_id, kind, title, body, destination)
  select distinct r.profile_id,
         'operational_session_signup_paused',
         'HYROX sign-up paused',
         'Sign-up for ITC HYROX on Sat 14 Nov is paused while the times are updated. Your place has been cleared. If you already paid, contact the collector so it can be applied when sign-up opens again.',
         '#/activity/' || r.session_id
    from nov14_released r;
end;
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
    raise exception 'HYROX sign-up opens Monday at 6 PM HKT.'
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
    raise exception 'HYROX sign-up opens Monday at 6 PM HKT.'
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
  v_notice text := 'Sign-up is paused while the times are updated.';
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

  update public.operational_sessions
     set is_open = p_open,
         notice = case
           when p_open and notice = v_notice then null
           when not p_open and (notice is null or btrim(notice) = '') then v_notice
           else notice
         end
   where id = p_session_id
  returning * into v_session;

  return v_session;
end;
$$;

revoke all on function public.set_operational_island_ecc_signup_open(text, boolean)
  from public, anon, authenticated;
grant execute on function public.set_operational_island_ecc_signup_open(text, boolean)
  to authenticated;

notify pgrst, 'reload schema';
