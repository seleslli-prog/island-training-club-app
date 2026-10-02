// app/js/config.js
// Reads env vars injected via inline <script> in index.html and returns a
// configured Supabase client, or null when running without Supabase (local
// prototype). `isLive()` is a function so tests can re-evaluate it after
// stubbing `window`; in production it returns whether the supabase client
// was created.

export const config = {
  url: typeof window !== "undefined" ? window.SUPABASE_URL || null : null,
  anonKey: typeof window !== "undefined" ? window.SUPABASE_ANON_KEY || null : null,
  googleClientId: typeof window !== "undefined" ? String(window.GOOGLE_CLIENT_ID || "").trim() || null : null,
};

export const supabase = config.url && config.anonKey && typeof window !== "undefined" && window.supabase
  ? window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "itc.supabase.session",
      },
    })
  : null;

export function isLive() {
  return supabase !== null;
}