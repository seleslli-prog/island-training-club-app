-- Island Training Club — monthly referral invites
--
-- Approved members create single-use invite hashes. Acceptance changes only
-- the applicant identity link; it never approves membership or moves money.

create table public.referral_invites (
  id                    uuid primary key default gen_random_uuid(),
  referrer_profile_id   uuid not null references public.profiles(id),
  token_hash            text not null unique,
  status                text not null default 'pending'
                          check (status in ('pending', 'accepted', 'expired', 'cancelled')),
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  invitee_profile_id    uuid references public.profiles(id),
  accepted_at           timestamptz,
  application_id        uuid references public.applications(profile_id),
  cancelled_at          timestamptz,
  expired_at            timestamptz,
  check (expires_at > created_at),
  check ((status = 'accepted' and invitee_profile_id is not null and accepted_at is not null)
      or status <> 'accepted')
);

create index referral_invites_referrer_idx
  on public.referral_invites(referrer_profile_id, created_at desc);
create unique index referral_invites_one_accepted_invitee
  on public.referral_invites(invitee_profile_id)
  where status = 'accepted';

alter table public.referral_invites enable row level security;
revoke all on table public.referral_invites from public, anon, authenticated;

create or replace function public.sweep_referral_invites(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  update public.referral_invites
     set status = 'expired', expired_at = expires_at
   where status = 'pending' and expires_at <= p_now;
  delete from public.referral_invites
   where (status = 'expired' and expires_at + interval '30 days' <= p_now)
      or (status = 'cancelled' and cancelled_at + interval '30 days' <= p_now);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.create_referral_invite(
  p_token_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_expires_at timestamptz;
  v_invite public.referral_invites;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if v_role not in ('member', 'admin', 'super_admin') then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_token_hash, ''))) < 32 then
    raise exception 'Referral invite token is invalid.' using errcode = '22023';
  end if;
  perform public.sweep_referral_invites(now());
  if (
    select count(*) from public.referral_invites
     where referrer_profile_id = v_uid
       and status = 'accepted'
       and (accepted_at at time zone 'Asia/Hong_Kong')
           >= date_trunc('month', now() at time zone 'Asia/Hong_Kong')
       and (accepted_at at time zone 'Asia/Hong_Kong')
           < date_trunc('month', now() at time zone 'Asia/Hong_Kong') + interval '1 month'
  ) >= 3 then
    raise exception 'You have used all 3 referrals this month.' using errcode = '23514';
  end if;
  if (
    select count(*) from public.referral_invites
     where referrer_profile_id = v_uid
       and status = 'pending'
       and expires_at > now()
  ) >= 3 then
    raise exception 'You already have 3 active invites.' using errcode = '23514';
  end if;
  v_expires_at := least(p_expires_at, now() + interval '7 days');
  if v_expires_at <= now() then
    raise exception 'Referral invite expiry is invalid.' using errcode = '22023';
  end if;
  insert into public.referral_invites (
    referrer_profile_id, token_hash, status, created_at, expires_at
  ) values (
    v_uid, trim(p_token_hash), 'pending', now(), v_expires_at
  ) returning * into v_invite;
  return jsonb_build_object(
    'id', v_invite.id,
    'status', v_invite.status,
    'createdAt', v_invite.created_at,
    'expiresAt', v_invite.expires_at
  );
end;
$$;

create or replace function public.get_referral_invite(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.referral_invites;
  v_name text;
begin
  select * into v_invite from public.referral_invites
   where token_hash = trim(coalesce(p_token_hash, ''));
  if not found then
    raise exception 'This referral invite is no longer available.' using errcode = 'P0002';
  end if;
  select coalesce(nullif(trim(a.preferred_name), ''), nullif(trim(p.full_name), ''), 'ITC member')
    into v_name
    from public.profiles p
    left join public.applications a on a.profile_id = p.id
   where p.id = v_invite.referrer_profile_id;
  return jsonb_build_object(
    'status', v_invite.status,
    'expiresAt', v_invite.expires_at,
    'referrerPreferredName', v_name
  );
end;
$$;

create or replace function public.accept_referral_invite(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invite public.referral_invites;
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if public.current_user_role() <> 'pending' then
    raise exception 'You already have an ITC account or application.' using errcode = '42501';
  end if;
  if exists (select 1 from public.applications where profile_id = v_uid) then
    raise exception 'You already have an ITC account or application.' using errcode = '23514';
  end if;
  perform public.sweep_referral_invites(now());
  select * into v_invite from public.referral_invites
   where token_hash = trim(coalesce(p_token_hash, ''))
   for update;
  if not found or v_invite.status <> 'pending' or v_invite.invitee_profile_id is not null then
    raise exception 'This referral invite is no longer available.' using errcode = 'P0002';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'This referral invite has expired.' using errcode = '23514';
  end if;
  if v_invite.referrer_profile_id = v_uid then
    raise exception 'You cannot accept your own referral invite.' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.created_at < v_invite.created_at then
    raise exception 'You already have an ITC account or application.' using errcode = '23514';
  end if;
  update public.referral_invites
     set status = 'accepted', invitee_profile_id = v_uid, accepted_at = now()
   where id = v_invite.id
   returning * into v_invite;
  return jsonb_build_object(
    'id', v_invite.id,
    'status', v_invite.status,
    'inviteeId', v_invite.invitee_profile_id,
    'acceptedAt', v_invite.accepted_at
  );
end;
$$;

create or replace function public.cancel_referral_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invite public.referral_invites;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  select * into v_invite from public.referral_invites
   where id = p_invite_id
   for update;
  if not found or v_invite.referrer_profile_id <> v_uid then
    raise exception 'Not authorized for this referral invite.' using errcode = '42501';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Only a pending referral invite can be cancelled.' using errcode = '23514';
  end if;
  update public.referral_invites
     set status = 'cancelled', cancelled_at = now()
   where id = v_invite.id
   returning * into v_invite;
  return jsonb_build_object('id', v_invite.id, 'status', v_invite.status);
end;
$$;

create or replace function public.list_my_referral_invites()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  perform public.sweep_referral_invites(now());
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'status', status, 'createdAt', created_at, 'expiresAt', expires_at,
      'acceptedAt', accepted_at, 'inviteeId', invitee_profile_id
    ) order by created_at desc)
    from public.referral_invites
    where referrer_profile_id = v_uid
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_referral_context_for_admin()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('admin', 'super_admin') then
    raise exception 'Approved actor access required.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'inviteeId', r.invitee_profile_id,
      'referrerPreferredName', coalesce(nullif(trim(a.preferred_name), ''), nullif(trim(p.full_name), ''), 'ITC member'),
      'acceptedAt', r.accepted_at,
      'status', r.status
    ))
    from public.referral_invites r
    join public.profiles p on p.id = r.referrer_profile_id
    left join public.applications a on a.profile_id = p.id
    where r.status = 'accepted'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.sweep_referral_invites(timestamptz) from public, anon, authenticated;
revoke all on function public.create_referral_invite(text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_referral_invite(text) from public, anon, authenticated;
revoke all on function public.accept_referral_invite(text) from public, anon, authenticated;
revoke all on function public.cancel_referral_invite(uuid) from public, anon, authenticated;
revoke all on function public.list_my_referral_invites() from public, anon, authenticated;
revoke all on function public.list_referral_context_for_admin() from public, anon, authenticated;

grant execute on function public.sweep_referral_invites(timestamptz) to authenticated;
grant execute on function public.create_referral_invite(text, timestamptz) to authenticated;
grant execute on function public.get_referral_invite(text) to authenticated;
grant execute on function public.accept_referral_invite(text) to authenticated;
grant execute on function public.cancel_referral_invite(uuid) to authenticated;
grant execute on function public.list_my_referral_invites() to authenticated;
grant execute on function public.list_referral_context_for_admin() to authenticated;
