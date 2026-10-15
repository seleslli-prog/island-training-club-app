-- Island Training Club — collector Mark paid & confirm
--
-- Members who transferred money but never tapped I've paid stay in Payment
-- due. Admins/collectors can mark and confirm those reserved bookings in one
-- Admin Payments roster action.

create or replace function public.admin_mark_and_confirm_operational_payment(
  p_booking_id uuid
)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.operational_bookings;
begin
  perform public.operational_assert_admin('admin_mark_and_confirm_payment');

  select * into v_booking
    from public.operational_bookings
   where id = p_booking_id
     for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  if v_booking.status <> 'reserved' then
    raise exception 'Booking is not awaiting payment.' using errcode = '23514';
  end if;

  if v_booking.payment_marked_at is null then
    update public.operational_bookings
       set payment_marked_at = now(),
           payment_method = 'fps',
           payment_reference = 'COLLECTOR-MARKED'
     where id = p_booking_id;
  end if;

  return public.approve_operational_payment(p_booking_id);
end;
$$;

revoke all on function public.admin_mark_and_confirm_operational_payment(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_mark_and_confirm_operational_payment(uuid)
  to authenticated;

notify pgrst, 'reload schema';
