// Google sign-in helper for live mode.
// Uses a single full-page Google OIDC redirect. Keeping one auth path avoids
// overlapping GIS/FedCM prompt UI and the redirect fallback racing each other.

export const GIS_LOAD_ERROR = "Google sign-in couldn’t start.";
export const GIS_NONCE_KEY = "itc.gis.nonce";
export const GIS_OIDC_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";

function envWindow() {
  return typeof window !== "undefined" ? window : globalThis;
}

export function googleClientId() {
  const id = String(envWindow()?.GOOGLE_CLIENT_ID || "").trim();
  return id || null;
}

export function createGoogleNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

export async function hashGoogleNonce(nonce) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(nonce)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sessionStore() {
  return envWindow()?.sessionStorage || globalThis.sessionStorage || null;
}

function persistNonce(nonce) {
  const storage = sessionStore();
  if (!storage?.setItem) throw new Error(GIS_LOAD_ERROR);
  storage.setItem(GIS_NONCE_KEY, nonce);
}

function readAndClearNonce() {
  const storage = sessionStore();
  if (!storage?.getItem) return null;
  const nonce = storage.getItem(GIS_NONCE_KEY);
  storage.removeItem?.(GIS_NONCE_KEY);
  return nonce || null;
}

export function googleRedirectUri() {
  const origin = envWindow()?.location?.origin;
  if (!origin) throw new Error(GIS_LOAD_ERROR);
  return new URL("/app/", origin).toString();
}

export function buildGoogleOidcUrl({ clientId, nonce }) {
  const url = new URL(GIS_OIDC_AUTH);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", googleRedirectUri());
  url.searchParams.set("response_type", "id_token");
  url.searchParams.set("scope", "openid email profile");
  // Google copies this into the ID token. Supabase hashes the raw nonce
  // before comparing, so this must be the SHA-256 hex — not the raw value.
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

function navigateTo(href) {
  const loc = envWindow()?.location;
  if (!loc) throw new Error(GIS_LOAD_ERROR);
  if (typeof loc.assign === "function") loc.assign(href);
  else loc.href = href;
}

function restoreAppHash() {
  const loc = envWindow()?.location;
  if (!loc) return;
  const path = loc.pathname || "/app/";
  const search = loc.search || "";
  const next = `${path}${search}#/home`;
  const hist = envWindow()?.history;
  try {
    hist?.replaceState?.(hist.state, "", next);
  } catch {
    // Tests and some hosts expose a location object without History.
  }
  loc.hash = "#/home";
}

export function consumeGoogleRedirectCredential() {
  const loc = envWindow()?.location;
  if (!loc) return null;
  const raw = String(loc.hash || "");
  const hash = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!hash.includes("id_token=")) return null;
  const token = new URLSearchParams(hash).get("id_token");
  if (!token || token.split(".").length !== 3) return null;
  const nonce = readAndClearNonce();
  restoreAppHash();
  if (!nonce) return null;
  return { token, nonce };
}

export async function requestGoogleIdCredential() {
  const clientId = googleClientId();
  if (!clientId) throw new Error("signInWithGoogle requires GOOGLE_CLIENT_ID");
  const nonce = createGoogleNonce();
  persistNonce(nonce);
  const nonceHash = await hashGoogleNonce(nonce);
  navigateTo(buildGoogleOidcUrl({ clientId, nonce: nonceHash }));
  return { redirected: true };
}
