-- Island Training Club — Island ECC Monday signup lock and Friday reminders
--
-- Locks both Saturday Island ECC slots until Monday 18:00 HKT, stamps unpaid
-- original holds to Thursday 18:00 HKT, leftover/promoted holds to Friday
-- 21:00 HKT, promotes Island ECC waitlist rows into reserved bookings, and
-- sends Friday 18:00 member/collector reminders plus a Friday 21:00
-- collector finalize nudge. Does not revive retired pool reminder RPCs.

-- =====================================================================
-- HKT clock helpers
-- =====================================================================

create or replace function private.island_ecc_now()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(current_setting('itc.clock', true), '')::timestamptz,
    now()
  );
$$;

create or replace function private.island_ecc_signup_opens_at(p_session_date date)
returns timestamptz
language sql
immutable
security definer
set search_path = public
as $$
  select ((p_session_date - 5) + time '18:00') at time zone 'Asia/Hong_Kong';
$$;

create or replace function private.island_ecc_payment_deadline_at(p_session_date date)
returns timestamptz
language sql
immutable
security definer
set search_path = public
as $$
  select ((p_session_date - 2) + time '18:00') at time zone 'Asia/Hong_Kong';
$$;

create or replace function private.island_ecc_leftover_pay_by_at(p_session_date date)
returns timestamptz
language sql
immutable
security definer
set search_path = public
as $$
  select ((p_session_date - 1) + time '21:00') at time zone 'Asia/Hong_Kong';
$$;

create or replace function private.island_ecc_member_reminder_at(p_session_date date)
returns timestamptz
language sql
immutable
security definer
set search_path = public
as $$
  select ((p_session_date - 1) + time '18:00') at time zone 'Asia/Hong_Kong';
$$;

create or replace function private.island_ecc_collector_finalize_nudge_at(p_session_date date)
returns timestamptz
language sql
immutable
security definer
set search_path = public
as $$
  select ((p_session_date - 1) + time '21:00') at time zone 'Asia/Hong_Kong';
$$;

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
    when p_now < private.island_ecc_payment_deadline_at(p_session_date)
      then private.island_ecc_payment_deadline_at(p_session_date)
    else private.island_ecc_leftover_pay_by_at(p_session_date)
  end;
$$;

revoke all on function private.island_ecc_now()
  from public, anon, authenticated;
revoke all on function private.island_ecc_signup_opens_at(date)
  from public, anon, authenticated;
revoke all on function private.island_ecc_payment_deadline_at(date)
  from public, anon, authenticated;
revoke all on function private.island_ecc_leftover_pay_by_at(date)
  from public, anon, authenticated;
revoke all on function private.island_ecc_member_reminder_at(date)
  from public, anon, authenticated;
revoke all on function private.island_ecc_collector_finalize_nudge_at(date)
  from public, anon, authenticated;
revoke all on function private.island_ecc_next_pay_deadline(date, timestamptz)
  from public, anon, authenticated;

-- =====================================================================
-- Week-ops table and reminder sent marker
-- =====================================================================

create table public.operational_island_ecc_week_ops (
  session_date date primary key,
  collector_finalize_reminder_sent_at timestamptz,
  collector_finalize_nudge_sent_at timestamptz
);

alter table public.operational_island_ecc_week_ops enable row level security;
revoke all on table public.operational_island_ecc_week_ops
  from public, anon, authenticated;

alter table public.operational_bookings
  add column if not exists island_ecc_payment_reminder_sent_at timestamptz;

-- =====================================================================
-- Reserve / join: Monday lock before exclusivity, Island ECC pay-by stamp
-- =====================================================================

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

revoke all on function public.reserve_operational_session(text)
  from public, anon, authenticated;
revoke all on function public.join_operational_queue(text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_operational_session(text)
  to authenticated;
grant execute on function public.join_operational_queue(text, text)
  to authenticated;

-- =====================================================================
-- Friday reminders
-- =====================================================================

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
       and p_now >= private.island_ecc_member_reminder_at(s.session_date)
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

    v_body := 'Pay for ITC HYROX on '
      || to_char(v_booking.session_date, 'Dy · FMDD FMMonth')
      || ' by the deadline or the spot goes to the waitlist.';

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

-- =====================================================================
-- Deadline sweep: expire, Island ECC promote-into-booking, then reminders
-- =====================================================================

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

revoke all on function public.sweep_operational_deadlines(timestamptz)
  from public, anon, authenticated;
revoke all on function public.sweep_island_ecc_reminders(timestamptz)
  from public, anon, authenticated;
grant execute on function public.sweep_operational_deadlines(timestamptz)
  to authenticated;
grant execute on function public.sweep_island_ecc_reminders(timestamptz)
  to authenticated;

-- =====================================================================
-- Backfill future unpaid Island ECC reserved pay-by instants
-- =====================================================================

update public.operational_bookings b
   set pay_deadline_at = private.island_ecc_next_pay_deadline(
         s.session_date,
         private.island_ecc_now()
       )
  from public.operational_sessions s
 where s.id = b.session_id
   and private.operational_is_island_ecc_hyrox_activity(s.activity_id)
   and b.status = 'reserved'
   and b.payment_marked_at is null
   and s.session_date >= (now() at time zone 'Asia/Hong_Kong')::date;

-- =====================================================================
-- Destination resolver and web-push allowlist
-- =====================================================================

create or replace function public.resolve_notification_destination(
  p_profile_id uuid,
  p_kind text,
  p_created_at timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_candidate_count bigint;
  v_booking_id uuid;
  v_session_id text;
  v_price_hkd integer;
  v_requires_rsvp boolean;
begin
  if p_kind = 'operational_booking_reserved' then
    select count(*)
      into v_candidate_count
      from public.operational_bookings b
      join public.operational_sessions s on s.id = b.session_id
      left join public.operational_activity_templates t on t.activity_id = s.activity_id
     where b.profile_id = p_profile_id
       and b.reserved_at = p_created_at;

    if v_candidate_count = 1 then
      select b.id, b.session_id, s.price_hkd, coalesce(t.requires_rsvp, false)
        into v_booking_id, v_session_id, v_price_hkd, v_requires_rsvp
        from public.operational_bookings b
        join public.operational_sessions s on s.id = b.session_id
        left join public.operational_activity_templates t on t.activity_id = s.activity_id
       where b.profile_id = p_profile_id
         and b.reserved_at = p_created_at;
      if v_price_hkd > 0 then
        return '#/pay/' || v_booking_id::text;
      end if;
      if v_price_hkd = 0 or v_requires_rsvp then
        return '#/activity/' || v_session_id;
      end if;
    end if;
    return null;
  end if;

  if p_kind = 'operational_rsvp_confirmed' then
    select count(*)
      into v_candidate_count
      from public.operational_bookings b
      join public.operational_sessions s on s.id = b.session_id
      join public.operational_activity_templates t on t.activity_id = s.activity_id
     where b.profile_id = p_profile_id
       and b.reserved_at = p_created_at
       and s.price_hkd = 0
       and t.requires_rsvp;

    if v_candidate_count = 1 then
      select b.session_id
        into v_session_id
        from public.operational_bookings b
        join public.operational_sessions s on s.id = b.session_id
        join public.operational_activity_templates t on t.activity_id = s.activity_id
       where b.profile_id = p_profile_id
         and b.reserved_at = p_created_at
         and s.price_hkd = 0
         and t.requires_rsvp;
      return '#/activity/' || v_session_id;
    end if;
    return null;
  end if;

  if p_kind = 'operational_payment_approved' then
    select count(*)
      into v_candidate_count
      from public.operational_bookings b
     where b.profile_id = p_profile_id
       and b.paid_at = p_created_at;

    if v_candidate_count = 1 then
      select b.id
        into v_booking_id
        from public.operational_bookings b
       where b.profile_id = p_profile_id
         and b.paid_at = p_created_at;
      return '#/booking/' || v_booking_id::text;
    end if;
    return null;
  end if;

  if p_kind = 'operational_session_deferred' then
    select count(*)
      into v_candidate_count
      from public.operational_bookings b
     where b.profile_id = p_profile_id
       and b.deferred_from_booking_id is not null
       and b.reserved_at = p_created_at;

    if v_candidate_count = 1 then
      select b.id
        into v_booking_id
        from public.operational_bookings b
       where b.profile_id = p_profile_id
         and b.deferred_from_booking_id is not null
         and b.reserved_at = p_created_at;
      return '#/booking/' || v_booking_id::text;
    end if;
    return null;
  end if;

  if p_kind = 'operational_session_cancelled_no_defer' then
    select count(*)
      into v_candidate_count
      from (
        select distinct s.id
          from public.operational_sessions s
          join public.operational_bookings b on b.session_id = s.id
         where b.profile_id = p_profile_id
           and s.cancelled_at = p_created_at
      ) candidates;

    if v_candidate_count = 1 then
      select distinct s.id
        into v_session_id
        from public.operational_sessions s
        join public.operational_bookings b on b.session_id = s.id
       where b.profile_id = p_profile_id
         and s.cancelled_at = p_created_at;
      return '#/activity/' || v_session_id;
    end if;
    return null;
  end if;

  if p_kind = 'operational_session_cancelled' then
    select count(*)
      into v_candidate_count
      from public.operational_sessions s
     where s.cancelled_at = p_created_at;

    if v_candidate_count = 1 then
      select s.id
        into v_session_id
        from public.operational_sessions s
       where s.cancelled_at = p_created_at;
      return '#/activity/' || v_session_id;
    end if;
    return null;
  end if;

  if p_kind = 'operational_island_ecc_payment_reminder' then
    select count(*)
      into v_candidate_count
      from public.operational_bookings b
     where b.profile_id = p_profile_id
       and b.island_ecc_payment_reminder_sent_at = p_created_at;

    if v_candidate_count = 1 then
      select b.id
        into v_booking_id
        from public.operational_bookings b
       where b.profile_id = p_profile_id
         and b.island_ecc_payment_reminder_sent_at = p_created_at;
      return '#/pay/' || v_booking_id::text;
    end if;
    return null;
  end if;

  return case p_kind
    when 'operational_payment_marked' then '#/admin/payments'
    when 'operational_gym_finalized' then '#/admin/payments'
    when 'operational_session_venue_updated' then '#/schedule'
    when 'admin_application_submitted' then '#/admin/approvals'
    when 'admin_application_approved' then '#/admin/members'
    when 'admin_application_declined' then '#/admin/members'
    when 'admin_role_promoted' then '#/admin/members'
    when 'admin_role_demoted' then '#/admin/members'
    when 'admin_membership_revoked' then '#/admin/members'
    when 'admin_role_changed' then '#/admin/members'
    when 'giving_campaign_published' then '#/giving'
    when 'community_announcement_published' then '#/community/announcements'
    when 'community_announcement_audit' then '#/community/announcements'
    when 'operational_island_ecc_collector_finalize_reminder' then '#/admin/payments'
    when 'operational_island_ecc_collector_finalize_nudge' then '#/admin/payments'
    when 'welcome' then '#/account'
    else null
  end;
end;
$$;

revoke all on function public.resolve_notification_destination(uuid, text, timestamptz)
  from public, anon, authenticated;

create or replace function public.web_push_ops_kind_eligible(p_kind text, p_title text)
returns boolean
language sql
immutable
as $$
  select case
    when p_kind in (
      'operational_booking_reserved',
      'operational_rsvp_confirmed',
      'operational_payment_approved',
      'operational_session_deferred',
      'operational_session_cancelled',
      'operational_session_cancelled_no_defer',
      'community_announcement_published',
      'operational_island_ecc_payment_reminder',
      'operational_island_ecc_collector_finalize_reminder',
      'operational_island_ecc_collector_finalize_nudge'
    ) then true
    when p_kind = 'operational_session_venue_updated'
      and p_title in ('Venue confirmed', 'Venue updated') then true
    else false
  end;
$$;

comment on function public.web_push_ops_kind_eligible(text, text) is
  'Web push allowlist: booking/payment/venue shared rows, community_announcement_published, and Island ECC window reminders. Excludes venue audit and community_announcement_audit.';

notify pgrst, 'reload schema';
