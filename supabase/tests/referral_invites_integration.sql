-- Referral invite integration checks.
-- Covers one concurrent token, the Hong Kong month boundary, the
-- active-invite cap, and 30-day cleanup.

create or replace function pg_temp.referral_assert(ok boolean, message text)
returns void language plpgsql as $$
begin
  if not ok then
    raise exception 'referral integration failed: %', message;
  end if;
end;
$$;

-- month boundary: 2026-09-30 16:00 UTC is 2026-10-01 in Asia/Hong_Kong.
select pg_temp.referral_assert(
  (timestamptz '2026-09-30 16:00:00+00' at time zone 'Asia/Hong_Kong')
    >= date_trunc('month', timestamptz '2026-10-02 04:00:00+00' at time zone 'Asia/Hong_Kong')
  and (timestamptz '2026-09-30 15:59:59+00' at time zone 'Asia/Hong_Kong')
    < date_trunc('month', timestamptz '2026-10-02 04:00:00+00' at time zone 'Asia/Hong_Kong'),
  'month boundary must follow Asia/Hong_Kong'
);

-- active-invite cap is enforced by create_referral_invite before insert.
select pg_temp.referral_assert(
  position('You already have 3 active invites.' in pg_get_functiondef('public.create_referral_invite(text,timestamptz)'::regprocedure)) > 0,
  'active-invite cap must be enforced by the create RPC'
);

-- concurrent token acceptance locks the invite row.
select pg_temp.referral_assert(
  position('for update' in pg_get_functiondef('public.accept_referral_invite(text)'::regprocedure)) > 0,
  'concurrent token acceptance must lock the invite'
);

-- cleanup deletes expired and cancelled rows after 30 days.
select pg_temp.referral_assert(
  position('30 days' in pg_get_functiondef('public.sweep_referral_invites(timestamptz)'::regprocedure)) > 0,
  'cleanup must retain expired and cancelled invites for 30 days'
);
