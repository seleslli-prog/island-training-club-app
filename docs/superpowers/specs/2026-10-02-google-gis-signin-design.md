# Google Identity Services Sign-In (No Supabase Callback URL)

**Date:** 2 October 2026
**Status:** Draft for review
**Branch:** `feature/hyrox-island-ecc-windows`
**Base:** current feature HEAD

## Summary

Live Google sign-in must stop sending the browser through
`*.supabase.co/auth/v1/callback`. That URL is the default Supabase OAuth
redirect. Hiding it with a custom auth domain is a paid Supabase add-on; this
change must not require that plan, Auth.js, Clerk, Auth0, or any other paid
auth product.

Google Identity Services (GIS) runs on the current origin, returns a Google ID
token, and the existing live app creates a Supabase session with
`signInWithIdToken`. Address bar never shows the Supabase callback. Existing
signed-in members, profiles, bookings, and avatars stay as they are.

## Problem

`store.signInWithGoogle()` currently calls `supabase.auth.signInWithOAuth`.
Google then redirects to `https://<project>.supabase.co/auth/v1/callback`, then
to the app’s `redirectTo`. Members see the Supabase host. Preview and testing
origins also bounce to production when that origin’s `/app/` URL is missing
from Supabase Redirect URLs, because Supabase falls back to Site URL.

## Confirmed decisions

- Use GIS on this origin, then `supabase.auth.signInWithIdToken`. Not Auth.js.
- Keep the existing ITC **Continue with Google** button (label, placement, busy
  “Connecting…” behaviour).
- Keep Supabase as the live session store. GIS only changes how Google proves
  identity for a **new tap** of that button.
- Same Google OAuth client already configured in Supabase. Do not rotate the
  client ID or secret. Do not disable the Google provider.
- **Existing users are unaffected:** no session migration, no mass sign-out, no
  schema change, no invalidation of current `itc.supabase.session` rows. A
  member who is already signed in stays signed in.
- No paid custom auth domain. No new npm dependency. No new Vercel server
  route.
- Email magic links stay on the current Supabase OTP path.
- Shop, Giving, and merchandise stay untouched.

## Goals

1. After tapping Continue with Google, the address bar must never show
   `*.supabase.co/auth/v1/callback`.
2. Sign-in started on a testing or feature origin must return to that same
   origin, signed in (when that origin is listed as a Google JavaScript
   origin).
3. A successful GIS sign-in must produce the same Supabase session the rest of
   live mode already uses (`SIGNED_IN` → `getCurrentUser`, apply redirect,
   avatars).
4. A failed or cancelled tap must toast (or stay quiet on cancel), restore the
   button, and leave any already-signed-in user on another device/browser
   untouched.
5. LocalStorage-only mode (empty `SUPABASE_URL` / anon key) must not load GIS
   or call Google.

## Non-goals

- Auth.js, NextAuth, or a first-party `/api/auth` callback.
- Replacing Supabase Auth, RLS, or Edge Function JWT checks.
- Paid Supabase custom domain / vanity auth URL.
- Changing magic-link email, SMTP, or membership approval.
- Google One Tap auto-prompt on every page load (sign-in stays an explicit
  button tap).
- Supporting hashed, one-off Vercel preview hostnames that are not added as
  JavaScript origins.
- Changing avatar CORS / `ITC_APP_ORIGINS` in this spec (already a separate
  ops task).

## User experience

1. Member taps **Continue with Google** (Home or Account).
2. Control shows **Connecting…**, disables, sets `aria-busy`. Duplicate taps
   do nothing until the attempt finishes (existing `withBusyControl`).
3. Google’s account picker appears as a GIS popup or prompt on this origin.
   The document origin does not navigate to `supabase.co`.
4. Member completes Google, or closes the picker.
5. On success, the existing live `SIGNED_IN` listener hydrates the profile
   (pending members still go to `#/apply` when they have no application).
6. On cancel (closed picker): restore the button; no error toast.
7. On failure (script blocked, origin not allowed, token rejected, network):
   restore the button and toast a short message. Stay signed out **for that
   attempt only**. Do not call `signOut` on an existing session from a
   background tab or another user.

## Architecture

```
[ITC button tap]
    → GIS (this origin) → Google ID token
    → supabase.auth.signInWithIdToken({ provider: "google", token, nonce })
    → existing persistSession + onAuthStateChange("SIGNED_IN")
```

- Public Google **client ID** is added beside the existing live values in
  `app/index.html` as `window.GOOGLE_CLIENT_ID`. It is not a secret.
- Google **client secret** stays only in the Supabase Google provider
  settings. It must not appear in HTML, Git, or browser JS.
- GIS script (`https://accounts.google.com/gsi/client`) preloads at live
  boot so the click handler can start Google without an async gap that
  browsers treat as a blocked popup.
- `signInWithGoogle()` in `store.js` stops calling `signInWithOAuth`. Magic
  link still uses `signInWithOtp` and `authCallbackUrl()` for email only.
- Isolate GIS load + nonce + credential callback in a small helper (for
  example `app/js/google-gis.js`) so `store.js` stays the session seam and
  tests can stub the helper.

Nonce (required for `signInWithIdToken` with GIS):

- Generate a random nonce in the browser.
- Send the SHA-256 hash of that nonce to GIS `initialize`.
- Send the original nonce to `signInWithIdToken`.

The visible CTA stays the ITC **Continue with Google** control. GIS is started
from that click (popup or prompt). Do not replace it with Google’s blue button.

## Existing-user guarantee

| Change | Allowed? |
|---|---|
| New Google tap uses GIS instead of OAuth redirect | Yes |
| Invalidate or rewrite stored sessions | No |
| Rotate Google client ID/secret | No |
| Disable Google in Supabase | No |
| Change `auth.users` / `profiles` rows for current members | No |
| Force production users to sign in again | No |

`signInWithIdToken` failure means **this tap** did not create a session. It is
not a command to sign anyone else out.

## Error handling

- **GIS script failed to load:** toast that Google sign-in could not start;
  magic link remains available on Account.
- **Origin not in Authorized JavaScript origins:** toast that sign-in is not
  available on this URL.
- **Missing `GOOGLE_CLIENT_ID` in live mode:** treat as configuration error;
  do not call `signInWithOAuth` as a fallback (that would restore the
  `supabase.co` callback).
- **Member closes Google picker:** restore button; no toast.
- **`signInWithIdToken` error:** toast the failed attempt; remain signed out
  on that page; do not migrate or clear other sessions.
- **Already signed in, taps Google again:** existing busy control + Supabase
  session rules apply; do not design a second identity.

## Operator setup (not paid)

### Google Cloud Console — existing Web client

Add **Authorized JavaScript origins** (scheme + host, no path):

- `https://islandtrainingclub.app`
- `https://island-training-club.vercel.app`
- `https://island-training-club-app-git-testing-seles-labs.vercel.app`
- `https://island-training-club-app-git-feature-hyrox-is-083ff7-seles-labs.vercel.app`
- `http://127.0.0.1:4173`

Leave the existing Authorized redirect URI that points at
`https://krxbvgyolxvmzgysfjkj.supabase.co/auth/v1/callback` in place so current
provider config is not disturbed. GIS sign-in does not use it.

### Supabase Dashboard

- Leave Google enabled with the **same** client ID.
- No custom domain purchase.
- Redirect URLs are not used by the new Google path. Magic-link email still
  needs `/app/` Redirect URLs if that path stays in use.

## Code changes

- `app/index.html` — public `window.GOOGLE_CLIENT_ID`.
- `app/js/config.js` — expose that client ID to live code.
- `app/js/google-gis.js` (new) — load script, nonce, request credential.
- `app/js/store.js` — `signInWithGoogle()` uses GIS + `signInWithIdToken`.
- `app/js/app.js` — preload GIS during live `boot()`.
- `app/live-auth-smoke.mjs` — stop asserting `signInWithOAuth` /
  `redirectTo …/app/` for Google; assert ID-token sign-in and no OAuth
  redirect.
- `docs/runbooks/live-auth.md` — document GIS origins and that Google no
  longer uses the Supabase callback URL.

## Testing

Automated:

- Button busy / duplicate-tap / restore / failure toast still pass.
- Live-auth: Google path calls `signInWithIdToken` with provider `google` and
  never `signInWithOAuth`.
- Session restore for an already-persisted live session still passes.
- Magic-link tests unchanged.
- `node app/smoke.mjs`, `node app/live-auth-smoke.mjs`, and
  `node app/hyrox-retirement-smoke.mjs` must pass before the change is done.

Manual after deploy (testing alias, after Vercel preview login if SSO-gated):

1. Signed-out: Continue with Google.
2. Address bar never shows `supabase.co/auth/v1/callback`.
3. Land signed-in on the **same** testing origin.
4. Production: a member who was already signed in is still signed in without
   tapping Google again.

## Acceptance

- Browser never navigates to `*.supabase.co/auth/v1/callback` for Google.
- No paid auth add-on.
- Existing members keep their sessions and accounts.
- Testing origin does not bounce to production after Google.
- Smoke suites listed above pass.
