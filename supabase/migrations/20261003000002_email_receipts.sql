-- Email receipts: Gmail SMTP from itc.admin.ops@gmail.com to profiles.email
-- when applications.email_receipts is on. Secrets stay in Edge Function env
-- and private.email_receipt_settings — never in this repo.

create schema if not exists private;

create table if not exists private.email_receipt_settings (
  id          integer primary key default 1 check (id = 1),
  hook_secret text not null,
  hook_url    text,
  updated_at  timestamptz not null default now()
);

revoke all on schema private from public, anon, authenticated;
revoke all on table private.email_receipt_settings from public, anon, authenticated;

create or replace function public.request_email_receipt()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, private
as $$
declare
  v_url text;
  v_secret text;
  v_wants boolean;
  v_email text;
begin
  if NEW.status is not null and NEW.status <> 'issued' then
    return NEW;
  end if;

  select coalesce(a.email_receipts, false), nullif(btrim(p.email), '')
    into v_wants, v_email
    from public.profiles p
    left join public.applications a on a.profile_id = p.id
   where p.id = NEW.profile_id;
  if not coalesce(v_wants, false) or v_email is null or position('@' in v_email) = 0 then
    return NEW;
  end if;

  select nullif(s.hook_secret, ''), nullif(s.hook_url, '')
    into v_secret, v_url
    from private.email_receipt_settings s
   where s.id = 1;

  v_url := coalesce(
    v_url,
    'https://krxbvgyolxvmzgysfjkj.supabase.co/functions/v1/send-email-receipt'
  );
  if v_secret is null then
    return NEW;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-email-receipt-secret', v_secret
    ),
    body := jsonb_build_object(
      'receipt_id', NEW.id,
      'profile_id', NEW.profile_id,
      'receipt_number', NEW.receipt_number,
      'amount_hkd', NEW.amount_hkd,
      'currency', NEW.currency,
      'payment_method', NEW.payment_method,
      'session_id', NEW.session_id,
      'issued_at', NEW.issued_at
    )
  );
  return NEW;
exception
  when others then
    return NEW;
end;
$$;

drop trigger if exists operational_receipts_request_email on public.operational_receipts;
create trigger operational_receipts_request_email
  after insert on public.operational_receipts
  for each row execute function public.request_email_receipt();

revoke all on function public.request_email_receipt() from public, anon, authenticated;

comment on table private.email_receipt_settings is
  'One-row hook secret/url for send-email-receipt. Set via SQL editor; not exposed to clients.';
comment on function public.request_email_receipt() is
  'AFTER INSERT fan-out to Edge Function send-email-receipt. From itc.admin.ops@gmail.com to profiles.email when email_receipts is on.';
