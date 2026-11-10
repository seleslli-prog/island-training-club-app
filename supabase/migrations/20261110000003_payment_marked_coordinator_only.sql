-- I've paid is the coordinator's queue. Send one Payment marked alert to
-- the collector on duty for that week, and remove copies already stored
-- for anyone else or more than once for the same mark.

create or replace function public.mark_operational_payment_legacy(
  p_booking_id uuid,
  p_method     text,
  p_reference  text
)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_booking public.operational_bookings;
  v_session public.operational_sessions;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if v_role not in ('member', 'admin', 'super_admin') then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;
  if p_method not in ('payme', 'fps') then
    raise exception 'Invalid payment method.' using errcode = '22023';
  end if;

  select * into v_booking
    from public.operational_bookings
   where id = p_booking_id
     for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  if v_booking.profile_id <> v_uid and not public.operational_is_admin() then
    raise exception 'Not authorized for this booking.' using errcode = '42501';
  end if;
  if v_booking.status <> 'reserved' then
    raise exception 'Payment has already been processed.' using errcode = '23514';
  end if;
  if v_booking.payment_marked_at is not null then
    raise exception 'Payment has already been marked.' using errcode = '23514';
  end if;

  select * into v_session
    from public.operational_sessions
   where id = v_booking.session_id
     for share;
  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;

  update public.operational_bookings
     set payment_marked_at = now(),
         payment_method = p_method,
         payment_reference = nullif(trim(p_reference), '')
   where id = p_booking_id
   returning * into v_booking;

  insert into public.notifications (profile_id, kind, title, body)
  select ca.collector_profile_id,
         'operational_payment_marked',
         'Payment marked for ' || v_session.activity_id,
         'A member marked payment on ' || v_session.session_date::text || '.'
    from public.collector_assignments ca
   where ca.week_start <= v_session.session_date
     and ca.collector_profile_id is not null
   order by ca.week_start desc
   limit 1;

  return v_booking;
end;
$$;

revoke all on function public.mark_operational_payment_legacy(uuid, text, text)
  from public, anon, authenticated;

delete from public.notifications n
 where n.kind = 'operational_payment_marked'
   and n.title like 'Payment marked for %'
   and n.body ~ '^A member marked payment on [0-9]{4}-[0-9]{2}-[0-9]{2}\.$'
   and exists (
     select 1
       from public.collector_assignments ca
      where ca.week_start <= substring(n.body from '([0-9]{4}-[0-9]{2}-[0-9]{2})')::date
        and ca.collector_profile_id is not null
   )
   and n.profile_id is distinct from (
     select ca.collector_profile_id
       from public.collector_assignments ca
      where ca.week_start <= substring(n.body from '([0-9]{4}-[0-9]{2}-[0-9]{2})')::date
        and ca.collector_profile_id is not null
      order by ca.week_start desc
      limit 1
   );

delete from public.notifications extra
 using public.notifications kept
 where extra.kind = 'operational_payment_marked'
   and extra.title like 'Payment marked for %'
   and kept.kind = extra.kind
   and kept.profile_id = extra.profile_id
   and kept.title = extra.title
   and kept.body = extra.body
   and kept.created_at = extra.created_at
   and kept.id < extra.id;

notify pgrst, 'reload schema';
