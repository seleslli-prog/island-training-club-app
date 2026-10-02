# Google Identity Services Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google sign-in obtains an ID token on the current origin via GIS and creates the existing Supabase session with `signInWithIdToken`, so the browser never opens `*.supabase.co/auth/v1/callback`.

**Architecture:** New `app/js/google-gis.js` loads GIS, hashes a nonce, and returns `{ token, nonce }`. `store.signInWithGoogle()` calls that helper then `supabase.auth.signInWithIdToken`. Live `boot()` preloads the GIS script. Magic links, persisted sessions, and membership rows stay unchanged.

**Tech Stack:** Vanilla ES modules, Google Identity Services (`accounts.google.com/gsi/client`), existing `@supabase/supabase-js` `signInWithIdToken`, Node smokes.

**Spec:** `docs/superpowers/specs/2026-10-02-google-gis-signin-design.md`

## Global Constraints

- Stay on `feature/hyrox-island-ecc-windows` in `.worktrees/hyrox-island-ecc-windows`. Do not use `.worktrees/testing`.
- No npm, no build, no Auth.js, no `/api/auth` route, no paid auth add-on.
- Same Google client already in Supabase. Public client ID in `app/index.html` only: `872938958702-65vqt7g43r0rh2ugps5bganbcs4g803r.apps.googleusercontent.com`. Never commit the client secret.
- Do not call `signInWithOAuth` from `signInWithGoogle` (no fallback).
- Existing users: no session migration, no mass `signOut`, no Google-provider disable, no client rotation.
- ITC **Continue with Google** label and `Connecting…` busy control stay. Do not render Google’s blue button.
- Shop / Giving / merchandise stay untouched.
- Exact copy: `Google sign-in isn’t available on this URL.` and `Google sign-in couldn’t start.`
- Cancel code: `GIS_CANCELLED` (error `code` property). Store swallows it (no throw to the click handler).

## Review Focus

- Missing `window.GOOGLE_CLIENT_ID` in live mode: throw `signInWithGoogle requires GOOGLE_CLIENT_ID`; `signInWithOAuth` is never called.
- Member closes the Google picker: `signInWithGoogle` resolves without throwing; no toast.
- GIS `prompt` reason `unregistered_origin`: throw `Google sign-in isn’t available on this URL.`
- GIS script `onerror`: throw `Google sign-in couldn’t start.` Live boot still completes if preload rejects.
- `preloadGoogleGis()` must not call `signInWithIdToken` or `signOut` (already-signed-in members stay signed in).

---

### Task 1: GIS helper (load, nonce, credential)

**Files:**
- Create: `app/js/google-gis.js`
- Create: `app/google-gis-smoke.mjs`

**Interfaces:**
- Consumes: `window.GOOGLE_CLIENT_ID`, `window.google.accounts.id`, `crypto.getRandomValues`, `crypto.subtle.digest`
- Produces:
  - `GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client"`
  - `GIS_CANCELLED = "GIS_CANCELLED"`
  - `GIS_ORIGIN_ERROR = "Google sign-in isn’t available on this URL."`
  - `GIS_LOAD_ERROR = "Google sign-in couldn’t start."`
  - `googleClientId() -> string | null` — trimmed `window.GOOGLE_CLIENT_ID` or `null`
  - `createGoogleNonce() -> string` — 32 random bytes, base64
  - `hashGoogleNonce(nonce: string) -> Promise<string>` — SHA-256 hex of the UTF-8 nonce
  - `preloadGoogleGis() -> Promise<void>` — no-op if `window.google.accounts.id` exists; otherwise inject `GIS_SCRIPT_SRC` once
  - `requestGoogleIdCredential() -> Promise<{ token: string, nonce: string }>` — preload, hash nonce, `google.accounts.id.initialize({ client_id, nonce: hash, ux_mode: "popup", auto_select: false, callback })`, then `prompt`. Resolve with GIS `credential` + original nonce. Reject `Error` with `code: GIS_CANCELLED` on close/skip/dismiss without a credential. Reject `GIS_ORIGIN_ERROR` when the prompt notification reason is `unregistered_origin`. Reject `GIS_LOAD_ERROR` when the script fails. Reject `signInWithGoogle requires GOOGLE_CLIENT_ID` when `googleClientId()` is null.

- [ ] **Step 1: Write `app/google-gis-smoke.mjs` (failing)**

Stub `window.google.accounts.id` (`initialize` + `prompt`). Assert:

- `hashGoogleNonce("abc")` equals the SHA-256 hex of UTF-8 `"abc"`
- `initialize` receives `nonce` equal to that hash of the returned `nonce`, `ux_mode === "popup"`, `auto_select === false`, and `client_id` from `window.GOOGLE_CLIENT_ID`
- success path: `prompt` invokes the initialize callback with `{ credential: "gis-id-token" }` → `{ token: "gis-id-token", nonce }`
- cancel: `prompt` notification `isSkippedMoment() === true` and no callback credential → reject `code === GIS_CANCELLED`
- origin: notification `getNotDisplayedReason() === "unregistered_origin"` → reject message `GIS_ORIGIN_ERROR`
- missing client ID: `window.GOOGLE_CLIENT_ID = ""` → reject `signInWithGoogle requires GOOGLE_CLIENT_ID`
- `preloadGoogleGis()` with `window.google.accounts.id` already present does not inject a `<script>` and does not call `prompt` / `initialize`
- `preloadGoogleGis()` with no `google` injects `script.src === GIS_SCRIPT_SRC` once (second call reuses the same tag)
- injected script `onerror` → `preloadGoogleGis()` rejects message `GIS_LOAD_ERROR`

Do not import `store.js` in this file.

- [ ] **Step 2: Run the helper smoke**

Run: `node app/google-gis-smoke.mjs`

Expected: FAIL — `app/js/google-gis.js` missing.

- [ ] **Step 3: Implement the exports in `app/js/google-gis.js`**

Use GIS `google.accounts.id` only (no `signInWithOAuth`, no `initTokenClient`). Map skipped/dismissed/closed-without-credential to `GIS_CANCELLED`.

- [ ] **Step 4: Re-run `node app/google-gis-smoke.mjs`**

Expected: PASS (file prints ok lines and exits 0).

- [ ] **Step 5: Commit**

```bash
git add app/js/google-gis.js app/google-gis-smoke.mjs
git commit -m "$(cat <<'EOF'
feat(auth): add Google Identity Services credential helper

EOF
)"
```

---

### Task 2: Live Google sign-in uses ID token, not OAuth redirect

**Files:**
- Modify: `app/js/store.js` (`signInWithGoogle` only; leave `signInWithMagicLink` / `authCallbackUrl` for email)
- Modify: `app/js/config.js` — add `googleClientId` on `config` from `window.GOOGLE_CLIENT_ID`
- Modify: `app/live-auth-smoke.mjs` — fake `signInWithIdToken`; replace the Google button `redirectTo` assertion

**Interfaces:**
- Consumes: Task 1 `requestGoogleIdCredential()`, `GIS_CANCELLED`
- Produces: `signInWithGoogle() -> Promise<void>`
  - Guard: `!isLive() || !supabase` → throw `signInWithGoogle requires SUPABASE_URL and SUPABASE_ANON_KEY`
  - Call `requestGoogleIdCredential()`. If rejected with `code === GIS_CANCELLED`, return.
  - Else `await supabase.auth.signInWithIdToken({ provider: "google", token, nonce })`; throw `error` if set.
  - Never call `signInWithOAuth`.

- [ ] **Step 1: Extend the live-auth fake and failing assertions**

On `window` (before `store` import): `GOOGLE_CLIENT_ID` test value; fake `window.google.accounts.id` that succeeds with `{ credential: "gis-id-token" }`.

On `fakeSupabase.auth` add `signInWithIdToken(options)` mirroring the OAuth fake (count, capture options, then `releaseIdToken`). Keep `signInWithOAuth` so the test can assert it was **not** called.

Replace the Google control block that currently asserts `oauthOptions?.options?.redirectTo === \`${location.origin}/app/\`` with:

- `oauthCalls === 0`
- one `signInWithIdToken` call: `provider === "google"`, `token === "gis-id-token"`, `nonce` is a non-empty string
- duplicate tap while pending still yields a single ID-token call
- failure: `releaseIdToken({ error: new Error("OAuth unavailable") })` still toasts `OAuth unavailable` and restores **Continue with Google**
- extra case: GIS cancel (`code: GIS_CANCELLED`) → `signInWithIdToken` not called, toast stack empty, button restored

- [ ] **Step 2: Run `node app/live-auth-smoke.mjs`**

Expected: FAIL — still `signInWithOAuth` / old `redirectTo` assertion, or `signInWithIdToken` missing.

- [ ] **Step 3: Implement `signInWithGoogle` in `app/js/store.js` and `config.googleClientId`**

Import `requestGoogleIdCredential` and `GIS_CANCELLED` from `./google-gis.js`.

- [ ] **Step 4: Re-run live-auth + helper smokes**

Run:

```bash
node app/google-gis-smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both exit 0. Magic-link assertions still use `emailRedirectTo` `${origin}/app/`.

- [ ] **Step 5: Commit**

```bash
git add app/js/store.js app/js/config.js app/live-auth-smoke.mjs
git commit -m "$(cat <<'EOF'
feat(auth): sign in with Google ID token instead of OAuth redirect

EOF
)"
```

---

### Task 3: Preload GIS, public client ID, runbook

**Files:**
- Modify: `app/index.html` — `window.GOOGLE_CLIENT_ID = "872938958702-65vqt7g43r0rh2ugps5bganbcs4g803r.apps.googleusercontent.com";` next to the other live `window.*` assignments
- Modify: `app/js/app.js` — in live `boot()`, after `isLive() && supabase` is known, `void preloadGoogleGis().catch(() => {})` before `onAuthStateChange`; must not await in a way that blocks first paint if GIS is slow, and must not call `signOut` / `signInWithIdToken`
- Modify: `app/live-auth-smoke.mjs` — source contract: `app.js` contains `preloadGoogleGis` and does not pair it with `signInWithIdToken`
- Modify: `docs/runbooks/live-auth.md` — Google section: GIS JavaScript origins (the five origins from the spec); Google no longer uses `supabase.co/auth/v1/callback`; magic-link `/app/` Redirect URLs remain for email; leave the old Supabase Google redirect URI in Google Cloud (do not delete)

**Interfaces:**
- Consumes: Task 1 `preloadGoogleGis()`
- Produces: live boot preloads GIS; HTML exposes the public client ID

- [ ] **Step 1: Write the failing `app.js` source contract in `app/live-auth-smoke.mjs`**

Read `app/js/app.js` text. Assert it includes `preloadGoogleGis` and that `signInWithIdToken` does not appear in `app.js` (session creation stays in `store.js`).

- [ ] **Step 2: Run `node app/live-auth-smoke.mjs`**

Expected: FAIL — preload not present.

- [ ] **Step 3: Add HTML client ID, boot preload, and runbook GIS origins**

Operator list (verbatim):

- `https://islandtrainingclub.app`
- `https://island-training-club.vercel.app`
- `https://island-training-club-app-git-testing-seles-labs.vercel.app`
- `https://island-training-club-app-git-feature-hyrox-is-083ff7-seles-labs.vercel.app`
- `http://127.0.0.1:4173`

- [ ] **Step 4: Run the three smokes plus retirement**

```bash
node app/google-gis-smoke.mjs
node app/smoke.mjs
node app/live-auth-smoke.mjs
node app/hyrox-retirement-smoke.mjs
```

Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/index.html app/js/app.js app/live-auth-smoke.mjs docs/runbooks/live-auth.md
git commit -m "$(cat <<'EOF'
feat(auth): preload GIS and document JavaScript origins

EOF
)"
```

---

### Task 4: Operator check (no code)

**Files:** none (Google Cloud Console + manual browser)

- [ ] **Step 1: In Google Cloud, on the existing Web client, add the five Authorized JavaScript origins from Task 3. Do not remove the existing Supabase callback URI. Do not rotate the client secret.**

- [ ] **Step 2: On the testing alias, signed-out, tap Continue with Google. Address bar must never show `supabase.co/auth/v1/callback`. Stay on that origin. Confirm a production tab that was already signed in is still signed in.**

No commit.

---

## Execution notes

Work only in `.worktrees/hyrox-island-ecc-windows`. Do not implement Task 4 in code. GIS script load cannot be fully exercised against accounts.google.com in Node; Task 1 covers inject/reuse and Task 4 covers the real picker.
