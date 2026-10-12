-- Island Training Club — external-payment one-off events
-- Paid events whose signup/payment happens outside ITC need a distinct mode:
-- paid in presentation, but no in-app booking, checkout, roster, or capacity.

alter table public.operational_activity_templates
  add column if not exists external_payment boolean not null default false;

alter table public.operational_sessions
  add column if not exists external_payment boolean not null default false;

alter table public.operational_activity_templates
  drop constraint if exists operational_activity_templates_free_one_off_rsvp_check;
alter table public.operational_activity_templates
  add constraint operational_activity_templates_one_off_mode_check
  check (
    activity_id not like 'event-%'
    or price_hkd <> 0
    or external_payment
    or (requires_rsvp and capacity is null)
  );

alter table public.operational_sessions
  drop constraint if exists operational_sessions_free_one_off_uncapped_check;
alter table public.operational_sessions
  add constraint operational_sessions_one_off_mode_check
  check (
    activity_id not like 'event-%'
    or price_hkd <> 0
    or external_payment
    or capacity is null
  );

create or replace function public.create_operational_event(
  p_name             text,
  p_session_date     date,
  p_start_time       time,
  p_duration_minutes integer,
  p_venue            text,
  p_maps_query       text default null,
  p_category         text default 'Other',
  p_price_hkd        integer default 0,
  p_capacity         integer default 20,
  p_requires_rsvp    boolean default false,
  p_external_payment boolean default false
)
returns public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity_id text;
  v_session public.operational_sessions;
  v_external boolean := coalesce(p_external_payment, false);
begin
  perform public.operational_assert_admin('create_event');

  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Event name is required.' using errcode = '22023';
  end if;
  if p_session_date is null or p_session_date < current_date then
    raise exception 'Event date must be today or in the future.' using errcode = '22023';
  end if;
  if p_start_time is null then
    raise exception 'Start time is required.' using errcode = '22023';
  end if;
  if p_duration_minutes is null or p_duration_minutes <= 0 then
    raise exception 'Duration must be positive.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_venue, '')), '') is null then
    raise exception 'Venue is required.' using errcode = '22023';
  end if;
  if p_price_hkd is null or p_price_hkd < 0 then
    raise exception 'Price must be zero (free) or positive.' using errcode = '22023';
  end if;
  if v_external and p_price_hkd <> 0 then
    raise exception 'External-payment events must use an unspecified in-app price.' using errcode = '22023';
  end if;
  if v_external and coalesce(p_requires_rsvp, false) then
    raise exception 'External-payment events do not use RSVP tracking.' using errcode = '22023';
  end if;
  if not v_external and p_price_hkd = 0 and not coalesce(p_requires_rsvp, false) then
    raise exception 'Free one-off events must enable RSVP or use external payment.' using errcode = '22023';
  end if;
  if not v_external and p_price_hkd > 0 and (p_capacity is null or p_capacity <= 0) then
    raise exception 'Capacity must be positive.' using errcode = '22023';
  end if;

  v_activity_id := 'event-' || gen_random_uuid()::text;

  insert into public.operational_activity_templates
    (activity_id, name, venue, weekday, start_time, duration_minutes,
     capacity, price_hkd, default_open, active, category, maps_query,
     requires_rsvp, external_payment)
  values
    (v_activity_id, btrim(p_name), btrim(p_venue),
     extract(dow from p_session_date)::smallint, p_start_time, p_duration_minutes,
     case when v_external or p_price_hkd = 0 then null else p_capacity end,
     p_price_hkd, true, false,
     coalesce(nullif(btrim(p_category), ''), 'Other'),
     nullif(btrim(coalesce(p_maps_query, '')), ''),
     case when v_external then false else p_requires_rsvp end,
     v_external);

  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open, external_payment)
  values
    (v_activity_id || '-' || p_session_date::text, v_activity_id, p_session_date,
     p_start_time, p_duration_minutes, btrim(p_venue),
     case when v_external or p_price_hkd = 0 then null else p_capacity end,
     p_price_hkd, true, v_external)
  returning * into v_session;

  return v_session;
end;
$$;

revoke all on function public.create_operational_event(
  text, date, time, integer, text, text, text, integer, integer, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.create_operational_event(
  text, date, time, integer, text, text, text, integer, integer, boolean, boolean
) to authenticated;

notify pgrst, 'reload schema';
