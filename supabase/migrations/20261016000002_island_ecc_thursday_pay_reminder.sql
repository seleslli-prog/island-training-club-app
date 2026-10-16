-- Island Training Club — Thursday reminder without waitlist move
--
-- From 24 Oct, a reserved Island ECC spot that has not tapped I've paid by
-- Thursday 18:00 HKT stays reserved. The member gets one reminder to tap
-- I've paid. New reserves still close at that deadline. 17 Oct is unchanged.

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
       and not exists (
         select 1
           from public.operational_sessions s
          where s.id = b.session_id
            and s.session_date >= date '2026-10-24'
            and private.operational_is_island_ecc_hyrox_activity(s.activity_id)
       )
     returning b.id
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



create or replace function public.sweep_island_ecc_reminders(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sent integer := 0;
  v_booking record;
  v_date date;
  v_ops public.operational_island_ecc_week_ops;
  v_collector uuid;
  v_body text;
begin
  for v_booking in
    select b.id, b.profile_id, s.session_date
      from public.operational_bookings b
      join public.operational_sessions s on s.id = b.session_id
     where b.status = 'reserved'
       and b.payment_marked_at is null
       and b.island_ecc_payment_reminder_sent_at is null
       and private.operational_is_island_ecc_hyrox_activity(s.activity_id)
       and p_now >= case
             when s.session_date >= date '2026-10-24'
               then private.island_ecc_payment_deadline_at(s.session_date)
             else private.island_ecc_member_reminder_at(s.session_date)
           end
     order by b.reserved_at, b.id
     for update of b
  loop
    update public.operational_bookings
       set island_ecc_payment_reminder_sent_at = p_now
     where id = v_booking.id;

    if exists (
      select 1
        from public.applications a
       where a.profile_id = v_booking.profile_id
         and a.hyrox_payment_reminders = false
    ) then
      continue;
    end if;

    v_body := case
      when v_booking.session_date >= date '2026-10-24' then
        'Tap I''ve paid for ITC HYROX on '
        || to_char(v_booking.session_date, 'Dy · FMDD FMMonth')
        || '. Reserve and payment were due Thursday at 6 PM.'
      else
        'Pay for ITC HYROX on '
        || to_char(v_booking.session_date, 'Dy · FMDD FMMonth')
        || ' by the deadline or the spot goes to the waitlist.'
    end;

    insert into public.notifications
      (profile_id, kind, title, body, created_at)
    values (
      v_booking.profile_id,
      'operational_island_ecc_payment_reminder',
      'HYROX payment reminder',
      v_body,
      p_now
    );
    v_sent := v_sent + 1;
  end loop;

  for v_date in
    select distinct s.session_date
      from public.operational_sessions s
     where private.operational_is_island_ecc_hyrox_activity(s.activity_id)
       and p_now >= private.island_ecc_member_reminder_at(s.session_date)
       and s.session_date >= (p_now at time zone 'Asia/Hong_Kong')::date
     order by 1
  loop
    insert into public.operational_island_ecc_week_ops (session_date)
    values (v_date)
    on conflict (session_date) do nothing;

    select * into v_ops
      from public.operational_island_ecc_week_ops
     where session_date = v_date
     for update;

    select ca.collector_profile_id
      into v_collector
      from public.collector_assignments ca
     where ca.week_start <= v_date
     order by ca.week_start desc
     limit 1;

    if v_collector is not null
       and v_ops.collector_finalize_reminder_sent_at is null then
      insert into public.notifications
        (profile_id, kind, title, body, created_at)
      values (
        v_collector,
        'operational_island_ecc_collector_finalize_reminder',
        'Finalize Island ECC HYROX',
        'Finalize both Island ECC HYROX sessions with Island ECC and the coach.',
        p_now
      );
      update public.operational_island_ecc_week_ops
         set collector_finalize_reminder_sent_at = p_now
       where session_date = v_date;
      v_ops.collector_finalize_reminder_sent_at := p_now;
      v_sent := v_sent + 1;
    end if;

    if v_collector is not null
       and v_ops.collector_finalize_nudge_sent_at is null
       and p_now >= private.island_ecc_collector_finalize_nudge_at(v_date)
       and exists (
         select 1
           from public.operational_sessions s
          where s.session_date = v_date
            and private.operational_is_island_ecc_hyrox_activity(s.activity_id)
            and s.gym_confirmed_at is null
            and s.cancelled_at is null
       ) then
      insert into public.notifications
        (profile_id, kind, title, body, created_at)
      values (
        v_collector,
        'operational_island_ecc_collector_finalize_nudge',
        'Island ECC still not finalized',
        'Still not finalized — please confirm with Island ECC and the coach if possible.',
        p_now
      );
      update public.operational_island_ecc_week_ops
         set collector_finalize_nudge_sent_at = p_now
       where session_date = v_date;
      v_sent := v_sent + 1;
    end if;
  end loop;

  return v_sent;
end;
$$;


create or replace function public.mark_operational_payment(p_booking_id uuid, p_method text, p_reference text)
returns public.operational_bookings language plpgsql security definer set search_path = public as $$
begin
  if public.operational_is_retired_hyrox_booking(p_booking_id) then
    raise exception 'Booking not found.' using errcode = 'P0002';
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
