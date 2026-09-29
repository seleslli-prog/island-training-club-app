// Live-mode browser Web Push helpers (Push API + push-only service worker).
// No-ops when not live or when VAPID public key is unset.

import { isLive, supabase } from "./config.js";

function vapidPublicKey() {
  if (typeof window === "undefined") return "";
  return String(window.VAPID_PUBLIC_KEY || "").trim();
}

/** Resolve push-sw URL + registration scope for live (/) and local /app/ layouts. */
function appPaths() {
  // Live Vercel: canonical URL is "/" ( /app/ redirects home ). The SW file lives
  // at /app/push-sw.js and vercel.json rewrites /push-sw.js → that file so the
  // worker can register with root scope from pages at "/#/…".
  if (isLive()) {
    const basePath = "/";
    const swUrl = new URL("/push-sw.js", location.origin).href;
    const scope = new URL(basePath, location.origin).href;
    return { basePath, swUrl, scope };
  }

  const path = String(location.pathname || "/");
  let basePath = "/app/";
  if (path.includes("/app/")) {
    basePath = `${path.slice(0, path.indexOf("/app/") + 4)}/`;
  } else if (path === "/" || path.endsWith("/index.html") || /\.(html?)$/i.test(path)) {
    // python -m http.server run from inside app/ → docs at /
    basePath = path.replace(/\/[^/]*$/, "/") || "/";
  }
  const swUrl = new URL("push-sw.js", `${location.origin}${basePath}`).href;
  const scope = new URL(basePath, location.origin).href;
  return { basePath, swUrl, scope };
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export function webPushSupported() {
  return typeof window !== "undefined"
    && window.isSecureContext
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

async function waitForActivation(reg) {
  const worker = reg.installing || reg.waiting || reg.active;
  if (!worker) return reg;
  if (worker.state === "activated") return reg;
  await new Promise((resolve) => {
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated" || worker.state === "redundant") resolve();
    });
  });
  return reg;
}

async function registration() {
  if (!webPushSupported()) {
    throw new Error("Web push needs HTTPS (or localhost) and a supported browser.");
  }
  const { swUrl, scope } = appPaths();
  const probe = await fetch(swUrl, { method: "GET", cache: "no-store" });
  if (!probe.ok) {
    throw new Error(`Push service worker missing (${probe.status}): ${swUrl}`);
  }
  const reg = await navigator.serviceWorker.register(swUrl, { scope });
  await waitForActivation(reg);
  return reg;
}

export async function syncWebPushSubscription({ enabled } = {}) {
  if (!isLive() || !supabase) {
    if (enabled) {
      throw new Error("Web push only works in live Supabase mode (check SUPABASE_URL in index.html).");
    }
    return { ok: true, skipped: "local" };
  }
  if (!webPushSupported()) {
    if (enabled) {
      throw new Error("Web push needs HTTPS (or localhost) and a supported browser.");
    }
    return { ok: true, skipped: "unsupported" };
  }

  const { scope } = appPaths();

  if (!enabled) {
    try {
      const reg = await navigator.serviceWorker.getRegistration(scope)
        || await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
        await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
      }
    } catch (_err) {
      /* best-effort unsubscribe */
    }
    return { ok: true, disabled: true };
  }

  const publicKey = vapidPublicKey();
  if (!publicKey) {
    throw new Error("Web push is not configured yet (missing VAPID public key).");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Browser notification permission was not granted.");
  }

  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // Re-subscribe if the existing sub was created with a different VAPID key.
    try {
      await sub.unsubscribe();
    } catch (_err) {
      /* continue and create a fresh subscription */
    }
    sub = null;
  }
  sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const json = sub.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    throw new Error("Unable to read push subscription keys.");
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const profileId = userData?.user?.id;
  if (!profileId) throw new Error("Not signed in");

  const { error } = await supabase.from("push_subscriptions").upsert({
    profile_id: profileId,
    endpoint,
    p256dh,
    auth,
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });
  if (error) {
    throw new Error(error.message || "Unable to save push subscription.");
  }

  console.info("[itc web-push] subscribed", { endpoint: endpoint.slice(0, 48), sw: reg.active?.scriptURL });
  return { ok: true, endpoint, scriptURL: reg.active?.scriptURL || null };
}

// Manual retry from DevTools: await window.__itcSyncWebPush(true)
if (typeof window !== "undefined") {
  window.__itcSyncWebPush = (enabled = true) => syncWebPushSubscription({ enabled: !!enabled });
  window.__itcWebPushPaths = appPaths;
}
