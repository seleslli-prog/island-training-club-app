# Email receipts — live deploy runbook

When a payment receipt is issued and the member has **Email receipts** on, send one email from **Island Training Club `<itc.admin.ops@gmail.com>`** to `profiles.email` (the Membership Details / Google application email). Local prototype mode records the intended send and does not contact Gmail.

Do not send real Gmail without secrets. Do not commit the Google App Password.

## Prerequisites

- Migration `20261003000002_email_receipts.sql` applied.
- `applications.email_receipts` already exists (default off).
- Gmail account `itc.admin.ops@gmail.com` has 2-step verification and a dedicated App Password labelled for receipt SMTP. From `@gmail.com` only works when that same Gmail account authenticates; do not try to spoof this address through another ESP.

## One-time secrets

Set Edge Function secrets (never commit them):

```sh
supabase secrets set \
  EMAIL_RECEIPT_HOOK_SECRET='generate-a-long-random-string' \
  GMAIL_SMTP_APP_PASSWORD='gmail-app-password'
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are normally provided to functions by the platform.

Configure the DB hook secret (required or the trigger no-ops):

```sql
insert into private.email_receipt_settings (id, hook_secret, hook_url)
values (
  1,
  'same-as-EMAIL_RECEIPT_HOOK_SECRET',
  'https://krxbvgyolxvmzgysfjkj.supabase.co/functions/v1/send-email-receipt'
)
on conflict (id) do update
  set hook_secret = excluded.hook_secret,
      hook_url = excluded.hook_url,
      updated_at = now();
```

## Deploy function

```sh
supabase functions deploy send-email-receipt --no-verify-jwt
```

`verify_jwt` is false so `pg_net` can call with `x-email-receipt-secret` only.

SMTP: `smtp.gmail.com` port `465` SSL, username `itc.admin.ops@gmail.com`.

## Member path

1. Profile → Notifications → turn on **Email receipts**.
2. Collector confirms a payment (live `approve_operational_payment` or equivalent receipt insert).
3. Member receives the receipt at the Membership Details email.

## Disable

Uncheck Email receipts. Existing receipts are not re-sent.

## Smoke / verification

- `node app/smoke.mjs` — copy, opt-in/opt-out local recording, migration/function markers, no secrets in git.
- Function logs: Supabase Dashboard → Edge Functions → `send-email-receipt`.
- Do not test against a real inbox until secrets are set in the project, not in the repo.
