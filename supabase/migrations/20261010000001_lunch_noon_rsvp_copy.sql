-- Island Training Club — Saturday lunch at 12:00 and RSVP copy without
-- "pays their own bill". RSVP events are headcount only; paid sessions
-- remain the payment path.
--
-- Depends on 20260829000008_rsvp_integrity.sql (legacy reserve body) and
-- 20260903000002_hyrox_cycle_member_rpcs.sql (legacy function rename).

update public.operational_activity_templates
   set start_time = time '12:00'
 where activity_id = 'lunch'
   and start_time = time '12:45';

update public.operational_sessions
   set start_time = time '12:00'
 where activity_id = 'lunch'
   and start_time = time '12:45'
   and session_date >= (timezone('Asia/Hong_Kong', now()))::date;

update public.notifications
   set body = replace(
     body,
     ' Everyone pays their own bill — see you there.',
     ' See you there.'
   )
 where body like '%Everyone pays their own bill%';

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

  return v_booking;
end;
$$;

revoke all on function public.reserve_operational_session_legacy(text)
  from public, anon, authenticated;
