// Google OIDC redirect helper regressions. Run: node app/google-gis-smoke.mjs

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const sessionMem = new Map();
const assignedHrefs = [];
globalThis.sessionStorage = {
  getItem: (key) => (sessionMem.has(key) ? sessionMem.get(key) : null),
  setItem: (key, value) => sessionMem.set(key, String(value)),
  removeItem: (key) => sessionMem.delete(key),
};
globalThis.history = {
  state: null,
  replaceState(_state, _title, url) {
    const next = String(url || "");
    const hashAt = next.indexOf("#");
    if (hashAt >= 0) globalThis.window.location.hash = next.slice(hashAt);
  },
};
globalThis.window = {
  GOOGLE_CLIENT_ID: "test-google-client.apps.googleusercontent.com",
  sessionStorage: globalThis.sessionStorage,
  history: globalThis.history,
  location: {
    origin: "https://feature.example",
    pathname: "/app/",
    search: "",
    hash: "#/account",
    assign(href) { assignedHrefs.push(href); },
  },
};

function reset() {
  assignedHrefs.length = 0;
  sessionMem.clear();
  window.location.hash = "#/account";
  delete window.google;
  delete globalThis.google;
}

const gis = await import("./js/google-gis.js");

assert.equal(gis.GIS_LOAD_ERROR, "Google sign-in couldn’t start.");
assert.equal(gis.GIS_NONCE_KEY, "itc.gis.nonce");
assert.equal(gis.GIS_OIDC_AUTH, "https://accounts.google.com/o/oauth2/v2/auth");
assert.equal(gis.googleClientId(), "test-google-client.apps.googleusercontent.com");
assert.equal(gis.googleRedirectUri(), "https://feature.example/app/");

{
  const expected = createHash("sha256").update("abc", "utf8").digest("hex");
  assert.equal(await gis.hashGoogleNonce("abc"), expected);
  console.log("ok  hashGoogleNonce SHA-256 hex of UTF-8 nonce");
}

{
  reset();
  const result = await gis.requestGoogleIdCredential();
  assert.deepEqual(result, { redirected: true });
  assert.equal(assignedHrefs.length, 1);
  const oidc = new URL(assignedHrefs[0]);
  assert.equal(oidc.origin, "https://accounts.google.com");
  assert.equal(oidc.pathname, "/o/oauth2/v2/auth");
  assert.equal(oidc.searchParams.get("response_type"), "id_token");
  assert.equal(oidc.searchParams.get("redirect_uri"), "https://feature.example/app/");
  assert.equal(oidc.searchParams.get("client_id"), window.GOOGLE_CLIENT_ID);
  assert.equal(oidc.searchParams.get("prompt"), "select_account");
  assert.doesNotMatch(assignedHrefs[0], /supabase\.co/);
  const storedNonce = window.sessionStorage.getItem(gis.GIS_NONCE_KEY);
  assert.equal(typeof storedNonce, "string");
  assert.ok(storedNonce.length > 0);
  assert.equal(oidc.searchParams.get("nonce"), await gis.hashGoogleNonce(storedNonce));
  assert.notEqual(oidc.searchParams.get("nonce"), storedNonce);
  console.log("ok  requestGoogleIdCredential uses one OIDC redirect");
}

{
  reset();
  // A GIS API, if injected by the browser, must be irrelevant. The pure
  // redirect implementation does not initialize or prompt it.
  let initialized = 0;
  let prompted = 0;
  window.google = {
    accounts: {
      id: {
        initialize() { initialized += 1; },
        prompt() { prompted += 1; },
      },
    },
  };
  const result = await gis.requestGoogleIdCredential();
  assert.deepEqual(result, { redirected: true });
  assert.equal(initialized, 0);
  assert.equal(prompted, 0);
  assert.equal(assignedHrefs.length, 1);
  console.log("ok  injected GIS API is not initialized or prompted");
}

{
  const previous = window.GOOGLE_CLIENT_ID;
  window.GOOGLE_CLIENT_ID = "";
  await assert.rejects(
    gis.requestGoogleIdCredential(),
    /signInWithGoogle requires GOOGLE_CLIENT_ID/,
  );
  window.GOOGLE_CLIENT_ID = previous;
  console.log("ok  missing client ID rejects configuration error");
}

{
  reset();
  window.sessionStorage.setItem(gis.GIS_NONCE_KEY, "raw-nonce");
  window.location.hash = "#id_token=aaa.bbb.ccc&authuser=0";
  const credential = gis.consumeGoogleRedirectCredential();
  assert.deepEqual(credential, { token: "aaa.bbb.ccc", nonce: "raw-nonce" });
  assert.equal(window.sessionStorage.getItem(gis.GIS_NONCE_KEY), null);
  assert.equal(window.location.hash, "#/home");
  assert.equal(gis.consumeGoogleRedirectCredential(), null);
  console.log("ok  consumeGoogleRedirectCredential reads fragment ID token");
}

console.log("All google-gis smoke tests passed.");
