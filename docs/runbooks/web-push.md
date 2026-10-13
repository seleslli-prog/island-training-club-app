# Web Push — live deploy runbook

Browser Web Push mirrors every trusted in-app notification for an opted-in
member or admin: application events, approvals, role changes, welcome/member
alerts, operations, reminders, and community announcements. The inbox remains
the source of truth.

## Prerequisites

- Migrations applied through `20261012000001_repair_notification_delivery.sql`.
  This idempotent repair also reasserts application/role notification triggers,
  push subscriptions, the private hook settings table, and all-category push
  eligibility.
- App served over **HTTPS** (or localhost). Canonical production root is `/` (not `/app/`); `vercel.json` rewrites `/push-sw.js` → `/app/push-sw.js` so root-scope registration works.
- Desktop Chrome/Firefox/Edge, or Android Chrome. **iOS** requires Add to Home Screen (installed PWA) on a recent iOS version.
- If Invocations return `skipped: missing_notification`, the trigger body is still id-only or the Edge Function is stale — apply the snapshot migration and redeploy `send-web-push`.

## One-time secrets

Generate a VAPID pair (if rotating):

```sh
npx web-push generate-vapid-keys
```

Put the **public** key in `app/index.html` as `window.VAPID_PUBLIC_KEY`.

Set Edge Function secrets (never commit the private key):

```sh
supabase secrets set \
  WEB_PUSH_HOOK_SECRET='generate-a-long-random-string' \
  VAPID_PUBLIC_KEY='(same as window.VAPID_PUBLIC_KEY)' \
  VAPID_PRIVATE_KEY='(private from generate-vapid-keys)' \
  VAPID_SUBJECT='mailto:itc@islandecc.hk'
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are normally provided to functions by the platform.

Configure the DB hook secret (required or the trigger no-ops).  
Hosted Supabase **cannot** use `alter database … set app.web_push_hook_secret` (permission denied). Use the private settings row instead:

```sql
-- After applying 20260927000002_web_push_settings_table.sql (or the SQL below):
insert into private.web_push_settings (id, hook_secret, hook_url)
values (
  1,
  'same-as-WEB_PUSH_HOOK_SECRET',
  'https://krxbvgyolxvmzgysfjkj.supabase.co/functions/v1/send-web-push'
)
on conflict (id) do update
  set hook_secret = excluded.hook_secret,
      hook_url = excluded.hook_url,
      updated_at = now();
```

## Deploy function

```sh
supabase functions deploy send-web-push --no-verify-jwt
```

`verify_jwt` is false so `pg_net` can call with `x-web-push-secret` only.

## Member enable path

1. Sign in (live).
2. Profile → Privacy & Notifications → enable **Web push** → Allow in the browser prompt.
3. Trigger an application, approval, role-change, member, operations, reminder,
   or community event while the tab is backgrounded or closed.
4. OS notification should appear; click opens the trusted destination route.

## Disable

Uncheck the Privacy toggle (unsubscribes and deletes `push_subscriptions` rows) or revoke site notification permission in the browser.

## Smoke / verification

- `node app/smoke.mjs` — migration markers, producer triggers, all-category
  eligibility, push-sw background handling, and privacy round-trips.
- SQL: `select * from push_subscriptions where profile_id = auth.uid();` after enabling.
- SQL: verify `applications.session_alerts`, `applications.web_push_ops`,
  `notifications.destination`, and the `notifications_request_web_push` trigger.
- Function logs: Supabase Dashboard → Edge Functions → `send-web-push`.
