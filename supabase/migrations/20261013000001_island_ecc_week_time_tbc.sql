-- Island ECC HYROX times from 24 Oct 2026 are TBC until an admin sets that week.

alter table public.operational_sessions
  add column if not exists time_tbc boolean not null default false;

update public.operational_sessions
   set time_tbc = true
 where activity_id in ('hyrox-quarry-bay-early', 'hyrox-quarry-bay')
   and session_date >= date '2026-10-24';

create or replace function public.ensure_operational_sessions(
  p_start_date date,
  p_weeks integer default 16
)
returns setof public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template record;
  v_first_occurrence date;
  v_series date;
  v_id text;
begin
  if p_weeks is null or p_weeks < 1 or p_weeks > 16 then
    raise exception 'ensure_operational_sessions: weeks must be between 1 and 16.'
      using errcode = '22023';
  end if;

  for v_template in
    select *
      from public.operational_activity_templates
     where active
       and not public.operational_is_retired_hyrox_activity(activity_id)
     order by activity_id
  loop
    v_first_occurrence := p_start_date
      + ((v_template.weekday - extract(dow from p_start_date)::integer + 7) % 7);
    for v_series in
      select v_first_occurrence + (7 * gs)::integer
        from generate_series(0, p_weeks - 1) gs
    loop
      v_id := v_template.activity_id || '-' || v_series::text;
      insert into public.operational_sessions
        (id, activity_id, session_date, start_time, duration_minutes,
         venue, capacity, price_hkd, is_open, time_tbc)
      values
        (v_id, v_template.activity_id, v_series, v_template.start_time,
         v_template.duration_minutes, v_template.venue, v_template.capacity,
         v_template.price_hkd, v_template.default_open,
         v_template.activity_id in ('hyrox-quarry-bay-early', 'hyrox-quarry-bay')
           and v_series >= date '2026-10-24')
      on conflict (id) do nothing;
    end loop;
  end loop;

  return query
    select s.*
      from public.operational_sessions s
     where s.session_date between p_start_date
       and p_start_date + (7 * p_weeks - 1)
       and not public.operational_is_retired_hyrox_activity(s.activity_id)
     order by s.session_date, s.activity_id;
end;
$$;

create or replace function public.set_operational_session_time(
  p_session_id text,
  p_time time
)
returns public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.operational_sessions;
begin
  if public.operational_is_retired_hyrox_session(p_session_id) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  v_session := public.set_operational_session_time_pre_pool_retirement_20260922(p_session_id, p_time);
  update public.operational_sessions
     set time_tbc = false
   where id = p_session_id
  returning * into v_session;
  return v_session;
end;
$$;
