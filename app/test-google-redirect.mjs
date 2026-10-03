// Focused tests for the Google sign-in flow.
// Asserts that requestGoogleIdCredential() uses a same-origin OIDC
// redirect (no GIS popup), so a single click cannot produce both a
// GIS One Tap prompt and a redirect to accounts.google.com.
//
// Run: node --test app/test-google-redirect.mjs
//
// These tests are independent of the smoke suite and run in milliseconds.

import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal browser shims. The GIS module reads from window/sessionStorage
// and navigates by setting window.location. We only need the values it
// reads at request time, not a full DOM.
class FakeLocation {
  constructor(origin, pathname = "/app/", search = "", hash = "") {
    this.origin = origin;
    this.pathname = pathname;
    this.search = search;
    this.hash = hash;
    this.assign = (href) => { this._lastAssigned = href; };
    this.href = "";
  }
}

class FakeSessionStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

function makeEnv({ origin = "https://islandtrainingclub.app", clientId = "test-client-id.apps.googleusercontent.com" } = {}) {
  const sessionStorage = new FakeSessionStorage();
  const location = new FakeLocation(origin);
  const win = {
    GOOGLE_CLIENT_ID: clientId,
    location,
    sessionStorage,
    // Intentionally no `google.accounts.id` — the GIS API must not be
    // required to reach the redirect path. If the implementation still
    // tries GIS, the redirect will not be reached and these tests fail.
  };
  globalThis.window = win;
  globalThis.sessionStorage = sessionStorage;
  return { win, location, sessionStorage };
}

test("requestGoogleIdCredential goes straight to redirect without touching GIS", async () => {
  const { location } = makeEnv();
  // Dynamic import after env shim is installed.
  const gis = await import("./js/google-gis.js?redirect-only");
  const result = await gis.requestGoogleIdCredential();
  assert.equal(result?.redirected, true, "must signal a same-origin redirect");
  assert.ok(location._lastAssigned, "must assign a Google OIDC URL");
  const url = new URL(location._lastAssigned);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.pathname, "/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), "test-client-id.apps.googleusercontent.com");
  assert.equal(url.searchParams.get("response_type"), "id_token");
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("prompt"), "select_account");
  // Nonce stored in sessionStorage must round-trip into the URL as the
  // SHA-256 hex hash (per Supabase's nonce handling).
  const storedNonce = globalThis.sessionStorage.getItem("itc.gis.nonce");
  assert.ok(storedNonce, "raw nonce must be persisted in sessionStorage");
  const urlNonce = url.searchParams.get("nonce");
  assert.notEqual(urlNonce, storedNonce, "URL nonce must be the SHA-256 hash, not the raw value");
  assert.equal(urlNonce.length, 64, "SHA-256 hex is 64 chars");
});

test("requestGoogleIdCredential does not require google.accounts.id", async () => {
  const { location, win } = makeEnv();
  // win.google is intentionally undefined.
  const gis = await import("./js/google-gis.js?no-gis");
  const result = await gis.requestGoogleIdCredential();
  assert.equal(result?.redirected, true, "redirect must be the primary path, not gated on GIS");
  assert.ok(location._lastAssigned, "redirect must fire even without GIS API");
});

test("module does not load accounts.google.com/gsi/client", async () => {
  // Re-shim with a document that records any script element appended.
  const { location } = makeEnv();
  const appended = [];
  globalThis.document = {
    createElement: (tag) => {
      const el = { tag, _attrs: {} };
      Object.defineProperty(el, "src", {
        get() { return el._attrs.src; },
        set(v) {
          el._attrs.src = v;
          if (tag === "script") appended.push(v);
        },
      });
      return el;
    },
    head: { appendChild: (el) => appended.push(el._attrs?.src || el) },
  };
  const gis = await import("./js/google-gis.js?no-script");
  await gis.requestGoogleIdCredential();
  assert.equal(
    appended.length,
    0,
    "must not load accounts.google.com/gsi/client — the popup path is gone",
  );
});

test("preloadGoogleGis is removed (no GIS preloader exported)", async () => {
  const gis = await import("./js/google-gis.js?no-preload");
  assert.equal(
    typeof gis.preloadGoogleGis,
    "undefined",
    "preloadGoogleGis must be removed along with the popup path",
  );
});

test("consumeGoogleRedirectCredential extracts token + nonce from the hash and rewinds to #/home", async () => {
  const token = "header." + "x".repeat(64) + ".sig";
  const { location } = makeEnv({
    origin: "https://islandtrainingclub.app",
  });
  location.hash = `#id_token=${token}&state=abc`;
  globalThis.sessionStorage.setItem("itc.gis.nonce", "raw-nonce-123");
  const gis = await import("./js/google-gis.js?consume");
  const credential = gis.consumeGoogleRedirectCredential();
  assert.ok(credential, "must parse a valid id_token from the hash");
  assert.equal(credential.token, token);
  assert.equal(credential.nonce, "raw-nonce-123");
  assert.equal(
    globalThis.sessionStorage.getItem("itc.gis.nonce"),
    null,
    "nonce must be cleared from sessionStorage on consume",
  );
  assert.match(location.hash, /#\/home$/, "hash must be rewound to #/home");
});
