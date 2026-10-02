// Google Identity Services helper for live Google sign-in.
// Obtains an OpenID ID token on the current origin. Never redirects
// through supabase.co/auth/v1/callback.

export const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
export const GIS_CANCELLED = "GIS_CANCELLED";
export const GIS_ORIGIN_ERROR = "Google sign-in isn’t available on this URL.";
export const GIS_LOAD_ERROR = "Google sign-in couldn’t start.";

let pendingLoad = null;

export function googleClientId() {
  const id = typeof window !== "undefined" ? String(window.GOOGLE_CLIENT_ID || "").trim() : "";
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
  return (typeof window !== "undefined" && window.google?.accounts?.id)
    || (typeof globalThis !== "undefined" && globalThis.google?.accounts?.id)
    || null;
}

function cancelledError() {
  const error = new Error(GIS_CANCELLED);
  error.code = GIS_CANCELLED;
  return error;
}

export function preloadGoogleGis() {
  if (gisApi()) return Promise.resolve();
  if (pendingLoad) return pendingLoad;
  const doc = typeof document !== "undefined" ? document : window?.document;
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

export async function requestGoogleIdCredential() {
  const clientId = googleClientId();
  if (!clientId) throw new Error("signInWithGoogle requires GOOGLE_CLIENT_ID");
  await preloadGoogleGis();
  const api = gisApi();
  if (!api?.initialize || !api.prompt) throw new Error(GIS_LOAD_ERROR);
  const nonce = createGoogleNonce();
  const nonceHash = await hashGoogleNonce(nonce);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    api.initialize({
      client_id: clientId,
      nonce: nonceHash,
      ux_mode: "popup",
      auto_select: false,
      callback: (response) => {
        if (!response?.credential) {
          finish(reject, cancelledError());
          return;
        }
        finish(resolve, { token: response.credential, nonce });
      },
    });
    api.prompt((notification) => {
      const reason = String(notification?.getNotDisplayedReason?.() || "");
      if (reason === "unregistered_origin") {
        finish(reject, new Error(GIS_ORIGIN_ERROR));
        return;
      }
      if (
        notification?.isNotDisplayed?.()
        || notification?.isSkippedMoment?.()
        || notification?.isDismissedMoment?.()
      ) {
        finish(reject, cancelledError());
      }
    });
  });
}
