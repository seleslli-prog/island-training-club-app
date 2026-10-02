// Google Identity Services helper for live Google sign-in.
// Obtains an OpenID ID token on the current origin. Never redirects
// through supabase.co/auth/v1/callback.

export const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
export const GIS_CANCELLED = "GIS_CANCELLED";
export const GIS_ORIGIN_ERROR = "Google sign-in isn’t available on this URL.";
export const GIS_LOAD_ERROR = "Google sign-in couldn’t start.";
export const GIS_NONCE_KEY = "itc.gis.nonce";
export const GIS_OIDC_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GIS_PROMPT_TIMEOUT_MS = 1500;

let pendingLoad = null;

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

function gisApi() {
  const host = envWindow();
  return host?.google?.accounts?.id
    || (typeof globalThis !== "undefined" && globalThis.google?.accounts?.id)
    || null;
}

function sessionStore() {
  return envWindow()?.sessionStorage || globalThis.sessionStorage || null;
}

function persistNonce(nonce) {
  const storage = sessionStore();
  if (!storage?.setItem) throw new Error(GIS_LOAD_ERROR);
  storage.setItem(GIS_NONCE_KEY, nonce);
}

function clearNonce() {
  sessionStore()?.removeItem?.(GIS_NONCE_KEY);
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

export function googleOriginErrorMessage(origin = envWindow()?.location?.origin) {
  const host = String(origin || "").trim();
  return host ? `${GIS_ORIGIN_ERROR} (${host})` : GIS_ORIGIN_ERROR;
}

function originUnavailableError() {
  return new Error(googleOriginErrorMessage());
}

export function buildGoogleOidcUrl({ clientId, nonce }) {
  const url = new URL(GIS_OIDC_AUTH);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", googleRedirectUri());
  url.searchParams.set("response_type", "id_token");
  url.searchParams.set("scope", "openid email profile");
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

export function preloadGoogleGis() {
  if (gisApi()) return Promise.resolve();
  if (pendingLoad) return pendingLoad;
  const doc = typeof document !== "undefined" ? document : envWindow()?.document;
  if (!doc?.createElement || !doc.head?.appendChild) {
    return Promise.reject(new Error(GIS_LOAD_ERROR));
  }
  pendingLoad = new Promise((resolve, reject) => {
    const script = doc.createElement("script");
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      pendingLoad = null;
      resolve();
    };
    script.onerror = () => {
      pendingLoad = null;
      reject(new Error(GIS_LOAD_ERROR));
    };
    doc.head.appendChild(script);
  });
  return pendingLoad;
}

function tryGisPrompt(api, clientId, nonce, nonceHash) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer != null) clearTimeout(timer);
      resolve(value);
    };
    api.initialize({
      client_id: clientId,
      nonce: nonceHash,
      ux_mode: "popup",
      auto_select: false,
      callback: (response) => {
        if (!response?.credential) {
          finish(null);
          return;
        }
        finish({ token: response.credential, nonce });
      },
    });
    timer = setTimeout(() => finish(null), GIS_PROMPT_TIMEOUT_MS);
    api.prompt((notification) => {
      const reason = String(notification?.getNotDisplayedReason?.() || "");
      if (reason === "unregistered_origin") {
        finish({ originError: true });
        return;
      }
      if (
        notification?.isNotDisplayed?.()
        || notification?.isSkippedMoment?.()
        || notification?.isDismissedMoment?.()
      ) {
        finish(null);
      }
    });
  });
}

export async function requestGoogleIdCredential() {
  const clientId = googleClientId();
  if (!clientId) throw new Error("signInWithGoogle requires GOOGLE_CLIENT_ID");
  const nonce = createGoogleNonce();
  persistNonce(nonce);
  await preloadGoogleGis().catch(() => {});
  const api = gisApi();
  if (api?.initialize && api.prompt) {
    const nonceHash = await hashGoogleNonce(nonce);
    const prompted = await tryGisPrompt(api, clientId, nonce, nonceHash);
    if (prompted?.token) {
      clearNonce();
      return { token: prompted.token, nonce };
    }
    if (prompted?.originError) {
      clearNonce();
      throw originUnavailableError();
    }
  }
  navigateTo(buildGoogleOidcUrl({ clientId, nonce }));
  return { redirected: true };
}
