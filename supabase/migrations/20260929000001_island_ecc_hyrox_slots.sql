-- Island Training Club — two chronological Island ECC HYROX slots
--
-- Keeps the existing Quarry Bay identity for the later slot, adds a stable
-- early-slot identity, retimes future materialized sessions, and enforces one
-- Island ECC booking or queue commitment per member per Saturday.

-- =====================================================================
-- Templates and future sessions
-- =====================================================================

alter table public.operational_activity_templates
  drop constraint if exists operational_activity_templates_activity_id_check;
alter table public.operational_activity_templates
  add constraint operational_activity_templates_activity_id_check
  check (
    activity_id in (
      'hyrox-bft',
      'hyrox-midtown',
      'hyrox-quarry-bay-early',
      'hyrox-quarry-bay',
      'lunch',
      'wnt',
      'run',
      'water'
    )
    or activity_id like 'event-%'
  );

update public.operational_activity_templates
   set start_time = '10:30',
       duration_minutes = 60,
       venue = '10/F, Island ECC, Quarry Bay',
       capacity = 30,
       price_hkd = 180,
       default_open = true,
       active = true,
       category = 'HYROX',
       maps_query = 'Island ECC, Quarry Bay, Hong Kong',
       requires_rsvp = false,
       updated_at = now()
 where activity_id = 'hyrox-quarry-bay';

insert into public.operational_activity_templates (
  activity_id, name, venue, weekday, start_time, duration_minutes,
  capacity, price_hkd, default_open, active, category, maps_query,
  requires_rsvp
)
values (
  'hyrox-quarry-bay-early',
  'ITC HYROX',
  '10/F, Island ECC, Quarry Bay',
  6,
  '09:15',
  60,
  30,
  180,
  true,
  true,
  'HYROX',
  'Island ECC, Quarry Bay, Hong Kong',
  false
)
on conflict (activity_id) do update
  set name = excluded.name,
      venue = excluded.venue,
      weekday = excluded.weekday,
      start_time = excluded.start_time,
      duration_minutes = excluded.duration_minutes,
      capacity = excluded.capacity,
      price_hkd = excluded.price_hkd,
      default_open = excluded.default_open,
      active = excluded.active,
      category = excluded.category,
      maps_query = excluded.maps_query,
      requires_rsvp = excluded.requires_rsvp,
      updated_at = now();

-- Tell holders before changing the authoritative row they already reference.
insert into public.notifications (profile_id, kind, title, body, destination)
select distinct
       recipient.profile_id,
       'operational_session_time_changed',
       'HYROX time updated',
       'Your upcoming Island ECC HYROX session now starts at 10:30 AM.',
       '#/booking/' || b.id::text
  from public.operational_bookings b
  join public.operational_sessions s on s.id = b.session_id
 cross join lateral (
   values (b.profile_id), (b.replacement_profile_id)
 ) as recipient(profile_id)
 where s.activity_id = 'hyrox-quarry-bay'
   and s.start_time = '11:00'
   and (s.session_date + s.start_time)
       > (now() at time zone 'Asia/Hong_Kong')
   and b.status in ('reserved', 'confirmed')
   and recipient.profile_id is not null;

update public.operational_bookings b
   set snapshot = b.snapshot
       || case
            when b.snapshot ->> 'start_time' in ('11:00', '11:00:00')
            then jsonb_build_object('start_time', '10:30:00')
            else '{}'::jsonb
          end
       || case
            when b.snapshot ->> 'time' = '11:00'
            then jsonb_build_object('time', '10:30')
            else '{}'::jsonb
          end,
       updated_at = now()
  from public.operational_sessions s
 where s.id = b.session_id
   and s.activity_id = 'hyrox-quarry-bay'
   and s.start_time = '11:00'
   and (s.session_date + s.start_time)
       > (now() at time zone 'Asia/Hong_Kong')
   and (
     b.snapshot ->> 'start_time' in ('11:00', '11:00:00')
     or b.snapshot ->> 'time' = '11:00'
   );

update public.operational_sessions
   set start_time = '10:30',
       updated_at = now()
 where activity_id = 'hyrox-quarry-bay'
   and start_time = '11:00'
   and (session_date + start_time) > (now() at time zone 'Asia/Hong_Kong');

do $$
begin
  perform public.ensure_operational_sessions(
    (now() at time zone 'Asia/Hong_Kong')::date,
    16
  );
end;
$$;

-- =====================================================================
-- One Island ECC slot per member per date
-- =====================================================================

create or replace function private.operational_is_island_ecc_hyrox_activity(
  p_activity_id text
)
returns boolean
language sql
immutable
security definer
set search_path = public
as $$
  select p_activity_id in ('hyrox-quarry-bay-early', 'hyrox-quarry-bay');
$$;

revoke all on function private.operational_is_island_ecc_hyrox_activity(text)
  from public, anon, authenticated;

create or replace function private.enforce_island_ecc_replacement_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.operational_sessions;
begin
  if new.replacement_profile_id is null
     or new.replacement_profile_id is not distinct from old.replacement_profile_id then
    return new;
  end if;

  select * into v_session
    from public.operational_sessions
   where id = new.session_id;
  if not private.operational_is_island_ecc_hyrox_activity(v_session.activity_id) then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      new.replacement_profile_id::text || ':' || v_session.session_date::text,
      0
    )
  );

  if exists (
    select 1
      from public.operational_bookings b
      join public.operational_sessions s on s.id = b.session_id
     where coalesce(b.replacement_profile_id, b.profile_id)
           = new.replacement_profile_id
       and b.id <> new.id
       and b.status in ('reserved', 'confirmed', 'attended')
       and s.session_date = v_session.session_date
       and private.operational_is_island_ecc_hyrox_activity(s.activity_id)
  ) or exists (
    select 1
      from public.operational_queue_entries q
      join public.operational_sessions s on s.id = q.session_id
     where q.profile_id = new.replacement_profile_id
       and q.status = 'active'
       and s.session_date = v_session.session_date
       and private.operational_is_island_ecc_hyrox_activity(s.activity_id)
  ) then
    raise exception 'The replacement member now has an Island ECC HYROX commitment for this Saturday.'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_island_ecc_replacement_slot()
  from public, anon, authenticated;

drop trigger if exists operational_bookings_island_ecc_replacement_slot
  on public.operational_bookings;
create trigger operational_bookings_island_ecc_replacement_slot
  before update of replacement_profile_id on public.operational_bookings
  for each row execute function private.enforce_island_ecc_replacement_slot();

create or replace function public.reserve_operational_session(p_session_id text)
returns public.operational_bookings
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

  return public.reserve_operational_session_legacy(p_session_id);
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

revoke all on function public.reserve_operational_session(text)
  from public, anon, authenticated;
revoke all on function public.join_operational_queue(text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_operational_session(text)
  to authenticated;
grant execute on function public.join_operational_queue(text, text)
  to authenticated;
