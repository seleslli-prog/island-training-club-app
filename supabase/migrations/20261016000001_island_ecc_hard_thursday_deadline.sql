-- Island Training Club — hard Thursday deadline from 24 Oct 2026
--
-- 17 Oct 2026 keeps the soft-launch Friday 21:00 HKT leftover pay-by.
-- From 24 Oct, Thursday 18:00 HKT is the last moment to reserve and mark
-- payment. Unpaid holds move to that slot's waitlist and are not promoted
-- into a new booking after the deadline.

create or replace function private.island_ecc_next_pay_deadline(
  p_session_date date,
  p_now timestamptz
)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_session_date >= date '2026-10-24'
      then private.island_ecc_payment_deadline_at(p_session_date)
    when p_now < private.island_ecc_payment_deadline_at(p_session_date)
      then private.island_ecc_payment_deadline_at(p_session_date)
    else private.island_ecc_leftover_pay_by_at(p_session_date)
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

create or replace function public.sweep_operational_deadlines(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired integer := 0;
  v_session public.operational_sessions;
  v_candidate public.operational_queue_entries;
  v_entry public.operational_queue_entries;
  v_held integer;
  v_template_name text;
begin
  with expired as (
    update public.operational_bookings b
       set status = 'expired'
     where b.status = 'reserved'
       and b.pay_deadline_at < p_now
       and b.payment_marked_at is null
       and not public.operational_is_retired_hyrox_booking(b.id)
     returning b.id, b.profile_id, b.replacement_profile_id, b.session_id
  ),
  moved as (
    insert into public.operational_queue_entries (
      session_id, profile_id, kind, status, joined_at
    )
    select e.session_id,
           coalesce(e.replacement_profile_id, e.profile_id),
           'waitlist',
           'active',
           p_now
      from expired e
      join public.operational_sessions s on s.id = e.session_id
     where s.session_date >= date '2026-10-24'
       and private.operational_is_island_ecc_hyrox_activity(s.activity_id)
       and not exists (
         select 1
           from public.operational_queue_entries q
          where q.session_id = e.session_id
            and q.profile_id = coalesce(e.replacement_profile_id, e.profile_id)
            and q.status = 'active'
       )
       and not exists (
         select 1
           from public.operational_queue_entries q
           join public.operational_sessions other on other.id = q.session_id
          where q.profile_id = coalesce(e.replacement_profile_id, e.profile_id)
            and q.status = 'active'
            and other.session_date = s.session_date
            and other.id <> s.id
            and private.operational_is_island_ecc_hyrox_activity(other.activity_id)
       )
    returning 1
  )
  select count(*) into v_expired from expired;

  for v_session in
    select s.*
      from public.operational_sessions s
     where private.operational_is_island_ecc_hyrox_activity(s.activity_id)
       and s.cancelled_at is null
       and s.is_open
       and not public.operational_is_retired_hyrox_session(s.id)
     order by s.session_date, s.id
     for update
  loop
    if v_session.session_date >= date '2026-10-24'
       and p_now >= private.island_ecc_payment_deadline_at(v_session.session_date) then
      continue;
    end if;
    loop
      select count(*) into v_held
        from public.operational_bookings b
       where b.session_id = v_session.id
         and b.status in ('reserved', 'confirmed');
      exit when v_held >= v_session.capacity;

      v_entry := null;
      for v_candidate in
        select qe.*
          from public.operational_queue_entries qe
         where qe.session_id = v_session.id
           and qe.status = 'active'
           and qe.kind = 'waitlist'
         order by qe.joined_at, qe.id
         for update
      loop
        if exists (
          select 1
            from public.operational_bookings b
            join public.operational_sessions s on s.id = b.session_id
           where coalesce(b.replacement_profile_id, b.profile_id)
                 = v_candidate.profile_id
             and b.status in ('reserved', 'confirmed', 'attended')
             and s.session_date = v_session.session_date
             and private.operational_is_island_ecc_hyrox_activity(s.activity_id)
        ) or exists (
          select 1
            from public.operational_queue_entries q
            join public.operational_sessions s on s.id = q.session_id
           where q.profile_id = v_candidate.profile_id
             and q.status = 'active'
             and s.session_date = v_session.session_date
             and private.operational_is_island_ecc_hyrox_activity(s.activity_id)
             and s.id <> v_session.id
        ) then
          continue;
        end if;
        v_entry := v_candidate;
        exit;
      end loop;

      exit when v_entry.id is null;

      perform pg_advisory_xact_lock(
        hashtextextended(
          v_entry.profile_id::text || ':' || v_session.session_date::text,
          0
        )
      );

      if exists (
        select 1
          from public.operational_bookings b
          join public.operational_sessions s on s.id = b.session_id
         where coalesce(b.replacement_profile_id, b.profile_id)
               = v_entry.profile_id
           and b.status in ('reserved', 'confirmed', 'attended')
           and s.session_date = v_session.session_date
           and private.operational_is_island_ecc_hyrox_activity(s.activity_id)
      ) or exists (
        select 1
          from public.operational_queue_entries q
          join public.operational_sessions s on s.id = q.session_id
         where q.profile_id = v_entry.profile_id
           and q.status = 'active'
           and s.session_date = v_session.session_date
           and private.operational_is_island_ecc_hyrox_activity(s.activity_id)
           and s.id <> v_session.id
      ) then
        continue;
      end if;

      select t.name into v_template_name
        from public.operational_activity_templates t
       where t.activity_id = v_session.activity_id;

      insert into public.operational_bookings (
        profile_id, session_id, status, reserved_at, pay_deadline_at, snapshot
      ) values (
        v_entry.profile_id,
        v_session.id,
        'reserved',
        p_now,
        private.island_ecc_next_pay_deadline(v_session.session_date, p_now),
        jsonb_build_object(
          'name', coalesce(v_template_name, v_session.activity_id),
          'session_date', v_session.session_date,
          'start_time', v_session.start_time,
          'venue', v_session.venue,
          'price_hkd', v_session.price_hkd
        )
      );

      update public.operational_queue_entries
         set status = 'promoted',
             resolved_at = p_now
       where id = v_entry.id;
    end loop;
  end loop;

  with ranked as (
    select qe.id,
           qe.session_id,
           row_number() over (
             partition by qe.session_id order by qe.joined_at, qe.id
           ) as rn
      from public.operational_queue_entries qe
     where qe.status = 'active'
       and qe.kind = 'waitlist'
       and not public.operational_is_retired_hyrox_session(qe.session_id)
  ),
  promotable as (
    select r.id
      from ranked r
      join public.operational_sessions s on s.id = r.session_id
     where r.rn = 1
       and s.cancelled_at is null
       and s.is_open
       and not private.operational_is_island_ecc_hyrox_activity(s.activity_id)
       and (select count(*) from public.operational_bookings b
             where b.session_id = r.session_id
               and b.status in ('reserved', 'confirmed')) < s.capacity
  )
  update public.operational_queue_entries qe
     set status = 'promoted', resolved_at = now()
    from promotable p
   where qe.id = p.id;

  perform public.sweep_island_ecc_reminders(p_now);

  return v_expired;
end;
$$;


create or replace function public.mark_operational_payment(p_booking_id uuid, p_method text, p_reference text)
returns public.operational_bookings language plpgsql security definer set search_path = public as $$
declare
  v_session_date date;
  v_deadline timestamptz;
  v_marked timestamptz;
begin
  if public.operational_is_retired_hyrox_booking(p_booking_id) then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  select s.session_date, b.pay_deadline_at, b.payment_marked_at
    into v_session_date, v_deadline, v_marked
    from public.operational_bookings b
    join public.operational_sessions s on s.id = b.session_id
   where b.id = p_booking_id
     and private.operational_is_island_ecc_hyrox_activity(s.activity_id);
  if v_session_date >= date '2026-10-24'
     and v_marked is null
     and v_deadline is not null
     and private.island_ecc_now() >= v_deadline then
    raise exception 'Payment marking is closed for this booking.' using errcode = '23514';
  end if;
  return public.mark_operational_payment_pre_pool_retirement_20260922(p_booking_id, p_method, p_reference);
end; $$;

create or replace function public.confirm_own_collector_booking(
  p_booking_id uuid
)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_booking public.operational_bookings;
  v_session public.operational_sessions;
  v_collector uuid;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if not public.operational_is_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  select * into v_booking
    from public.operational_bookings
   where id = p_booking_id
     for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  if v_booking.profile_id is distinct from v_uid then
    raise exception 'Only the booking owner can confirm their own collector payment.'
      using errcode = '42501';
  end if;
  if v_booking.status <> 'reserved' then
    raise exception 'Booking is not awaiting payment.' using errcode = '23514';
  end if;

  select * into v_session
    from public.operational_sessions
   where id = v_booking.session_id
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

  if v_session.session_date >= date '2026-10-24'
     and v_booking.payment_marked_at is null
     and v_booking.pay_deadline_at is not null
     and private.island_ecc_now() >= v_booking.pay_deadline_at then
    raise exception 'Payment marking is closed for this booking.' using errcode = '23514';
  end if;

  if v_booking.payment_marked_at is null then
    update public.operational_bookings
       set payment_marked_at = now(),
           payment_method = 'fps',
           payment_reference = 'COLLECTOR-SELF'
     where id = p_booking_id;
  end if;

  return public.approve_operational_payment(p_booking_id);
end;
$$;

notify pgrst, 'reload schema';
