# Web Push — live deploy runbook

Browser Web Push for operational booking / payment / venue notifications.

## Prerequisites

- Migrations applied through `20260929000002_web_push_payload_snapshot.sql` (and earlier pref + delivery + settings migrations).
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
2. Profile → Privacy & Notifications → enable **Web push for bookings & venue** → Allow in the browser prompt.
3. Trigger an allowlisted event (e.g. venue confirm/update) while the tab is backgrounded.
4. OS notification should appear; click opens the activity / notifications route.

## Disable

Uncheck the Privacy toggle (unsubscribes and deletes `push_subscriptions` rows) or revoke site notification permission in the browser.

## Smoke / verification

- `node app/smoke.mjs` — migration markers, push-sw has no `caches`, privacy toggle still round-trips.
- SQL: `select * from push_subscriptions where profile_id = auth.uid();` after enabling.
- Function logs: Supabase Dashboard → Edge Functions → `send-web-push`.
