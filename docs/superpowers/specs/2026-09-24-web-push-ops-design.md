# Web push for operational notices and community announcements

**Date:** 2026-09-24  
**Updated:** 2026-09-30  
**Status:** On `main`. `feature/web-push-delivery` is the known-good snapshot of this line (merged from `main`) if a later `main` change breaks web push.  
**Earlier checkpoints (do not fast-forward):** `feature/web-push-ops-pref` is phase 1 only. `fix/web-push-subscribe-path` is the subscribe-path fix before the production-root and payload-snapshot fixes.

## Decisions

1. **Events:** operational booking, payment, and venue shared rows (`WEB_PUSH_OPS_KINDS`), plus shared community announcements. Venue audit title `Session venue updated` is excluded. Community audit kind `community_announcement_audit` is excluded.
2. **Gate:** `applications.web_push_ops` (opt-in) **and** a row in `push_subscriptions`. Community inbox rows are already limited to members with `community_news` (plus the publishing admin). Push does not add a second community-news check; it mirrors the inbox row when web push is on.
3. **Inbox remains source of truth.** Push mirrors allowlisted inserts; it does not replace in-app notifications.
4. **Service worker:** [`app/push-sw.js`](../../app/push-sw.js) is **push-only** (no offline/asset cache). Explicit exception to the prototype “no service worker” rule for this live channel only.
5. **Click path:** production opens `/#/…` on the site root. Live Vercel redirects `/app/` to `/`. Local prototype pages under `/app/` still register `push-sw.js` from that directory.

## Architecture

```text
notifications INSERT (kind/title eligible)
  → applications.web_push_ops
  → push_subscriptions for profile
  → pg_net POST Edge Function send-web-push (x-web-push-secret)
     body includes the notification snapshot (id, profile, kind, title, body, destination)
  → VAPID Web Push → OS notification
  → click opens /#/…
```

Client: Privacy toggle ON → permission → `PushManager.subscribe` → upsert `push_subscriptions`.  
OFF → unsubscribe + delete rows.

Production registers `/push-sw.js` with scope `/` (`vercel.json` rewrites that URL to `/app/push-sw.js`).

## Allowlist

| Kind | Push? |
|---|---|
| `operational_booking_reserved` | yes |
| `operational_rsvp_confirmed` | yes |
| `operational_payment_approved` | yes |
| `operational_session_deferred` | yes |
| `operational_session_cancelled` | yes |
| `operational_session_cancelled_no_defer` | yes |
| `operational_session_venue_updated` | shared titles only: `Venue confirmed`, `Venue updated` |
| `community_announcement_published` | yes; destination `#/community/announcements` |
| `community_announcement_audit` | no |
| Admin / payment-ops kinds (`operational_payment_marked`, `admin_*`, …) | no |

Client constant: `WEB_PUSH_OPS_KINDS` in `app/js/data.js`.  
SQL: `public.web_push_ops_kind_eligible`, replaced by `20260930000001_web_push_community_announcement.sql`.

## What is on main

- Phase 1: `applications.web_push_ops`, Privacy toggle, local `webPushOps` (`STATE_VERSION` 26)
- Phase 2: `push_subscriptions`, `send-web-push`, `app/push-sw.js`, `app/js/web-push.js`, `window.VAPID_PUBLIC_KEY`
- Hook secret in `private.web_push_settings` (hosted Supabase rejects `ALTER DATABASE`)
- Payload snapshot in the `pg_net` body (`20260929000002_web_push_payload_snapshot.sql`) so the function does not depend on the inserting transaction being visible
- Community shared rows included (`20260930000001_web_push_community_announcement.sql`)
- Runbook: [web-push.md](../../runbooks/web-push.md)

## Non-goals

- Offline caching service worker
- WhatsApp / email
- Local-mode OS notifications (the Privacy toggle saves locally and tells the member that push needs live Supabase)
- iOS banners without Add to Home Screen
