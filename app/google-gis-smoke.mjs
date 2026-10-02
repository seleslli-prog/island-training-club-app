// GIS helper regressions. Run: node app/google-gis-smoke.mjs

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const scripts = [];
const documentStub = {
  createElement(tag) {
    return {
      tagName: String(tag).toUpperCase(),
      src: "",
      async: false,
      onload: null,
      onerror: null,
    };
  },
  head: {
    appendChild(el) {
      scripts.push(el);
      return el;
    },
  },
  querySelector() {
    return null;
  },
};

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
globalThis.document = documentStub;
globalThis.window = {
  GOOGLE_CLIENT_ID: "test-google-client.apps.googleusercontent.com",
  document: documentStub,
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

let initializeOptions = null;
let promptCalls = 0;
let promptHandler = null;
function resetGisStub() {
  initializeOptions = null;
  promptCalls = 0;
  promptHandler = null;
  assignedHrefs.length = 0;
  sessionMem.clear();
  window.location.hash = "#/account";
}
const googleId = {
  initialize(options) {
    initializeOptions = options;
  },
  prompt(cb) {
    promptCalls += 1;
    promptHandler = cb;
  },
};

globalThis.window.google = { accounts: { id: googleId } };
globalThis.google = globalThis.window.google;

async function waitFor(getValue, label, pending) {
  const deadline = Date.now() + 2000;
  let settledError = null;
  pending?.catch((error) => { settledError = error; });
  while (Date.now() < deadline) {
    if (settledError) throw settledError;
    const value = getValue();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const gis = await import("./js/google-gis.js");

assert.equal(gis.GIS_SCRIPT_SRC, "https://accounts.google.com/gsi/client");
assert.equal(gis.GIS_CANCELLED, "GIS_CANCELLED");
assert.equal(gis.GIS_ORIGIN_ERROR, "Google sign-in isn’t available on this URL.");
assert.equal(gis.GIS_LOAD_ERROR, "Google sign-in couldn’t start.");
assert.equal(gis.googleClientId(), "test-google-client.apps.googleusercontent.com");
assert.equal(gis.googleRedirectUri(), "https://feature.example/app/");
assert.equal(
  gis.googleOriginErrorMessage("https://hashed.example"),
  "Google sign-in isn’t available on this URL. (https://hashed.example)",
);

{
  const expected = createHash("sha256").update("abc", "utf8").digest("hex");
  assert.equal(await gis.hashGoogleNonce("abc"), expected);
  console.log("ok  hashGoogleNonce SHA-256 hex of UTF-8 nonce");
}

{
  resetGisStub();
  const pending = gis.requestGoogleIdCredential();
  const options = await waitFor(() => initializeOptions, "GIS initialize", pending);
  assert.equal(options.client_id, window.GOOGLE_CLIENT_ID);
  assert.equal(options.ux_mode, "popup");
  assert.equal(options.auto_select, false);
  options.callback({ credential: "gis-id-token" });
  const result = await pending;
  assert.equal(result.token, "gis-id-token");
  assert.equal(typeof result.nonce, "string");
  assert.ok(result.nonce.length > 0);
  assert.equal(options.nonce, await gis.hashGoogleNonce(result.nonce));
  assert.equal(assignedHrefs.length, 0, "GIS success must not redirect");
  console.log("ok  requestGoogleIdCredential initialize options and success token");
}

{
  resetGisStub();
  const pending = gis.requestGoogleIdCredential();
  await waitFor(() => promptHandler, "GIS prompt", pending);
  promptHandler({
    isSkippedMoment: () => true,
    isNotDisplayed: () => false,
    isDismissedMoment: () => false,
    getNotDisplayedReason: () => "",
  });
  const result = await pending;
  assert.equal(result.redirected, true);
  assert.equal(assignedHrefs.length, 1);
  const oidc = new URL(assignedHrefs[0]);
  assert.equal(oidc.origin, "https://accounts.google.com");
  assert.equal(oidc.pathname, "/o/oauth2/v2/auth");
  assert.equal(oidc.searchParams.get("response_type"), "id_token");
  assert.equal(oidc.searchParams.get("redirect_uri"), "https://feature.example/app/");
  assert.equal(oidc.searchParams.get("client_id"), window.GOOGLE_CLIENT_ID);
  assert.doesNotMatch(assignedHrefs[0], /supabase\.co/);
  assert.equal(typeof oidc.searchParams.get("nonce"), "string");
  assert.ok(oidc.searchParams.get("nonce").length > 0);
  console.log("ok  skipped prompt falls back to origin OIDC redirect");
}

{
  resetGisStub();
  const pending = gis.requestGoogleIdCredential();
  await waitFor(() => promptHandler, "GIS prompt", pending);
  promptHandler({
    isSkippedMoment: () => false,
    isNotDisplayed: () => true,
    isDismissedMoment: () => false,
    getNotDisplayedReason: () => "unregistered_origin",
  });
  await assert.rejects(pending, (err) => (
    err?.message === "Google sign-in isn’t available on this URL. (https://feature.example)"
  ));
  assert.equal(assignedHrefs.length, 0, "unregistered origin must not open Google");
  console.log("ok  unregistered_origin rejects GIS_ORIGIN_ERROR with this origin");
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
  resetGisStub();
  window.sessionStorage.setItem(gis.GIS_NONCE_KEY, "raw-nonce");
  window.location.hash = "#id_token=aaa.bbb.ccc&authuser=0";
  const credential = gis.consumeGoogleRedirectCredential();
  assert.deepEqual(credential, { token: "aaa.bbb.ccc", nonce: "raw-nonce" });
  assert.equal(window.sessionStorage.getItem(gis.GIS_NONCE_KEY), null);
  assert.equal(window.location.hash, "#/home");
  assert.equal(gis.consumeGoogleRedirectCredential(), null);
  console.log("ok  consumeGoogleRedirectCredential reads fragment ID token");
}

{
  promptCalls = 0;
  initializeOptions = null;
  const before = scripts.length;
  await gis.preloadGoogleGis();
  assert.equal(scripts.length, before, "existing GIS must not inject a script");
  assert.equal(promptCalls, 0, "preload must not call prompt");
  assert.equal(initializeOptions, null, "preload must not call initialize");
  console.log("ok  preload no-ops when google.accounts.id exists");
}

{
  delete globalThis.window.google;
  delete globalThis.google;
  const before = scripts.length;
  const first = gis.preloadGoogleGis();
  assert.equal(scripts.length, before + 1);
  assert.equal(scripts[scripts.length - 1].src, gis.GIS_SCRIPT_SRC);
  const second = gis.preloadGoogleGis();
  assert.equal(scripts.length, before + 1, "second preload reuses the same tag");
  scripts[scripts.length - 1].onload?.();
  await first;
  await second;
  console.log("ok  preload injects GIS_SCRIPT_SRC once");
}

{
  delete globalThis.window.google;
  delete globalThis.google;
  const pending = gis.preloadGoogleGis();
  const tag = scripts[scripts.length - 1];
  tag.onerror?.(new Event("error"));
  await assert.rejects(pending, (err) => err?.message === gis.GIS_LOAD_ERROR);
  console.log("ok  injected script onerror rejects GIS_LOAD_ERROR");
}

console.log("All google-gis smoke tests passed.");
