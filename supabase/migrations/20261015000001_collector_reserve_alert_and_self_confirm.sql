-- Island Training Club — collector reserve alert + own-booking confirm
--
-- 1) Paid-session reserves notify the assigned weekly collector (not the
--    reserving member when they are that collector).
-- 2) On-duty collectors can confirm their own reserved booking in one step
--    without PayMe/FPS to themselves.

create or replace function public.reserve_operational_session_legacy(
  p_session_id text
)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_session public.operational_sessions;
  v_template_name text;
  v_requires_rsvp boolean;
  v_is_rsvp boolean;
  v_active_count integer;
  v_existing uuid;
  v_deadline timestamptz;
  v_booking public.operational_bookings;
  v_collector uuid;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if v_role not in ('member', 'admin', 'super_admin') then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;

  select * into v_session
    from public.operational_sessions
   where id = p_session_id
     for update;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;

  select t.name, t.requires_rsvp
    into v_template_name, v_requires_rsvp
    from public.operational_activity_templates t
   where t.activity_id = v_session.activity_id;

  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;
  if not v_session.is_open then
    raise exception 'Session is not open.' using errcode = '23514';
  end if;

  v_is_rsvp := v_session.price_hkd = 0 and coalesce(v_requires_rsvp, false);
  if v_session.price_hkd = 0 and not v_is_rsvp then
    raise exception 'Session does not require RSVP.' using errcode = '23514';
  end if;

  if v_is_rsvp then
    if (v_session.session_date + v_session.start_time)
         at time zone 'Asia/Hong_Kong' <= now() then
      raise exception 'Session has already started.' using errcode = '23514';
    end if;
  elsif v_session.session_date <= (now() at time zone 'Asia/Hong_Kong')::date then
    raise exception 'Session has already started.' using errcode = '23514';
  end if;

  select id into v_existing
    from public.operational_bookings
   where profile_id = v_uid
     and session_id = p_session_id
     and status in ('reserved', 'confirmed');
  if v_existing is not null then
    raise exception 'Already booked.' using errcode = '23514';
  end if;

  select count(*) into v_active_count
    from public.operational_bookings
   where session_id = p_session_id
     and status in ('reserved', 'confirmed');
  if v_session.capacity is not null and v_active_count >= v_session.capacity then
    raise exception 'Session is full.' using errcode = '23514';
  end if;

  v_deadline := case when v_is_rsvp
    then now()
    else (v_session.session_date - interval '2 days')::date + time '15:59'
  end;

  insert into public.operational_bookings
    (profile_id, session_id, status, reserved_at, pay_deadline_at, paid_at, snapshot)
  values
    (v_uid, p_session_id,
     case when v_is_rsvp then 'confirmed' else 'reserved' end,
     now(), v_deadline,
     case when v_is_rsvp then now() else null end,
     jsonb_build_object(
       'name', coalesce(v_template_name, v_session.activity_id),
       'session_date', v_session.session_date,
       'start_time', v_session.start_time,
       'venue', v_session.venue,
       'price_hkd', v_session.price_hkd
     ))
  returning * into v_booking;

  insert into public.notifications (profile_id, kind, title, body)
  values (v_uid,
          case when v_is_rsvp then 'operational_rsvp_confirmed' else 'operational_booking_reserved' end,
          case when v_is_rsvp then 'You''re in' else 'Booking reserved' end,
          case when v_is_rsvp
            then 'You''re on the list for ' || coalesce(v_template_name, v_session.activity_id)
              || ' on ' || v_session.session_date::text
              || '. See you there.'
            else 'You have a reserved spot for ' || coalesce(v_template_name, v_session.activity_id)
              || ' on ' || v_session.session_date::text
              || '. Pay by ' || v_deadline::text || '.'
          end);

  -- Paid holds only: alert the on-duty collector so they can watch for payment.
  if not v_is_rsvp and v_session.price_hkd > 0 then
    select ca.collector_profile_id into v_collector
      from public.collector_assignments ca
     where ca.week_start <= v_session.session_date
     order by ca.week_start desc
     limit 1;
    if v_collector is not null and v_collector is distinct from v_uid then
      insert into public.notifications
        (profile_id, kind, title, body, destination)
      values (
        v_collector,
        'operational_collector_spot_reserved',
        'Spot reserved — awaiting payment',
        coalesce(v_template_name, v_session.activity_id)
          || ' on ' || v_session.session_date::text
          || ' has a new reserved spot.',
        '#/admin/payments'
      );
    end if;
  end if;

  return v_booking;
end;
$$;

revoke all on function public.reserve_operational_session_legacy(text)
  from public, anon, authenticated;

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

revoke all on function public.confirm_own_collector_booking(uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_own_collector_booking(uuid)
  to authenticated;

notify pgrst, 'reload schema';
