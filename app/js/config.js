// app/js/config.js
// Reads env vars injected via inline <script> in index.html and returns a
// configured Supabase client, or null when running without Supabase (local
// prototype). The pinned UMD may load after first paint so Google redirect
// is not blocked on a 200kb parse. `isLive()` is a function so tests can
// re-evaluate it after stubbing `window`; in production it returns whether
// the supabase client was created.

export const LIVE_SESSION_STORAGE_KEY = "itc.supabase.session";
export const SUPABASE_VENDOR_SRC = "/app/vendor/supabase-js.2.117.2.umd.js";
export const SUPABASE_VENDOR_INTEGRITY = "sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok";

const AUTH_OPTIONS = {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: LIVE_SESSION_STORAGE_KEY,
  },
};

export const config = {
  url: typeof window !== "undefined" ? window.SUPABASE_URL || null : null,
  anonKey: typeof window !== "undefined" ? window.SUPABASE_ANON_KEY || null : null,
  googleClientId: typeof window !== "undefined" ? String(window.GOOGLE_CLIENT_ID || "").trim() || null : null,
};

export let supabase = config.url && config.anonKey && typeof window !== "undefined" && window.supabase
  ? window.supabase.createClient(config.url, config.anonKey, AUTH_OPTIONS)
  : null;

let vendorLoad = null;

export function isLiveConfigured() {
  return Boolean(config.url && config.anonKey);
}

export function isLive() {
  return supabase !== null;
}

export function peekStoredLiveSession() {
  try {
    const raw = globalThis.localStorage?.getItem(LIVE_SESSION_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;
    return Boolean(
      parsed.access_token
      || parsed.currentSession?.access_token
      || parsed.user
      || parsed.currentSession?.user
    );
  } catch {
    return false;
  }
}

export function returningFromAuthRedirect() {
  try {
    const loc = globalThis.location;
    const hash = String(loc?.hash || "");
    const search = String(loc?.search || "");
    return hash.includes("id_token=")
      || hash.includes("access_token=")
      || hash.includes("error=")
      || /[?&]code=/.test(search)
      || /[?&]error=/.test(search);
  } catch {
    return false;
  }
}

function loadVendorScript() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("supabase vendor requires a browser"));
  }
  if (window.supabase?.createClient) return Promise.resolve();
  if (vendorLoad) return vendorLoad;
  vendorLoad = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SUPABASE_VENDOR_SRC;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.integrity = SUPABASE_VENDOR_INTEGRITY;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load sign-in"));
    document.head.appendChild(script);
  });
  return vendorLoad;
}

export async function ensureLiveClient() {
  if (supabase) return supabase;
  if (!isLiveConfigured()) return null;
  if (!window.supabase?.createClient) await loadVendorScript();
  if (!window.supabase?.createClient) return null;
  supabase = window.supabase.createClient(config.url, config.anonKey, AUTH_OPTIONS);
  return supabase;
}
