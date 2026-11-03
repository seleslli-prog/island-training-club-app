-- One membership mobile number can be saved by one account.
-- Existing rows that already share a number are left in place. A later
-- insert, or a change onto someone else's number, is rejected. The Admin
-- Members list collapses those existing rows to one account.

create or replace function private.membership_phone_key(p_mobile text)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select case
    when digits = '' then null
    when digits ~ '^852[0-9]{8}$' then substring(digits from 4)
    else digits
  end
  from (
    select regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g') as digits
  ) cleaned;
$$;

create or replace function public.reject_duplicate_membership_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := private.membership_phone_key(new.mobile);
  v_previous text := case
    when tg_op = 'UPDATE' then private.membership_phone_key(old.mobile)
    else null
  end;
begin
  if v_key is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and v_key is not distinct from v_previous then
    return new;
  end if;
  if exists (
    select 1
      from public.applications existing
     where existing.profile_id <> new.profile_id
       and private.membership_phone_key(existing.mobile) = v_key
  ) then
    raise exception 'This mobile number is already used by another ITC account.'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_duplicate_membership_phone()
  from public, anon, authenticated;

drop trigger if exists applications_reject_duplicate_mobile
  on public.applications;
create trigger applications_reject_duplicate_mobile
  before insert or update of mobile on public.applications
  for each row execute function public.reject_duplicate_membership_phone();
