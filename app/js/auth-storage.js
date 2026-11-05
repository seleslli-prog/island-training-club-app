// Durable copy of the Supabase session.
// localStorage is wiped when some phones close an installed web app.
// A first-party cookie is the copy that is still there on the next open.
// Sign out removes both. The cookie is readable by script, same as localStorage.

const COOKIE_PREFIX = "itc_sess_";
const CHUNK_SIZE = 2400;
const MAX_CHUNKS = 12;
const ONE_YEAR = 60 * 60 * 24 * 365;

function readLocal(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Private mode and quota errors still leave the cookie copy.
  }
}

function removeLocal(key) {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Ignore storage failures while clearing.
  }
}

function canUseCookie() {
  return typeof document !== "undefined" && typeof document.cookie === "string";
}

function cookieSecure() {
  try {
    return globalThis.location?.protocol === "https:" ? "; Secure" : "";
  } catch {
    return "";
  }
}

function encodedChunks(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const chunks = [];
  for (let i = 0; i < encoded.length && chunks.length < MAX_CHUNKS; i += CHUNK_SIZE) {
    chunks.push(encoded.slice(i, i + CHUNK_SIZE));
  }
  if (chunks.length * CHUNK_SIZE < encoded.length) return null;
  return chunks.length ? chunks : [""];
}

function decodeChunks(chunks) {
  const encoded = chunks.join("");
  const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function cookieEntries() {
  if (!canUseCookie() || !document.cookie) return [];
  return document.cookie.split(/; */).flatMap((part) => {
    const eq = part.indexOf("=");
    if (eq <= 0) return [];
    const name = part.slice(0, eq);
    if (!name.startsWith(COOKIE_PREFIX)) return [];
    const index = Number(name.slice(COOKIE_PREFIX.length));
    if (!Number.isInteger(index) || index < 0) return [];
    return [[index, part.slice(eq + 1)]];
  });
}

function clearCookie() {
  if (!canUseCookie()) return;
  const secure = cookieSecure();
  for (const [index] of cookieEntries()) {
    document.cookie = `${COOKIE_PREFIX}${index}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  }
}

function readCookie() {
  const entries = cookieEntries();
  if (!entries.length) return null;
  const chunks = [];
  for (const [index, value] of entries) chunks[index] = value;
  if (chunks.some((chunk) => chunk == null)) {
    clearCookie();
    return null;
  }
  try {
    return decodeChunks(chunks);
  } catch {
    clearCookie();
    return null;
  }
}

function writeCookie(value) {
  if (!canUseCookie()) return;
  const chunks = encodedChunks(value);
  if (!chunks) return;
  const existing = cookieEntries().map(([index]) => index);
  const secure = cookieSecure();
  const attrs = `; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure}`;
  chunks.forEach((chunk, index) => {
    document.cookie = `${COOKIE_PREFIX}${index}=${chunk}${attrs}`;
  });
  for (const index of existing) {
    if (index >= chunks.length) {
      document.cookie = `${COOKIE_PREFIX}${index}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    }
  }
}

export function createDurableAuthStorage(storageKey) {
  return {
    getItem(key) {
      const local = readLocal(key);
      if (local != null) {
        // Copy an older local-only sign-in into the cookie before a phone
        // can wipe localStorage, and extend the cookie when it is used.
        if (key === storageKey && !readCookie()) writeCookie(local);
        return local;
      }
      if (key !== storageKey) return null;
      const cookie = readCookie();
      if (cookie == null) return null;
      writeLocal(key, cookie);
      writeCookie(cookie);
      return cookie;
    },
    setItem(key, value) {
      const stored = String(value);
      writeLocal(key, stored);
      if (key === storageKey) writeCookie(stored);
    },
    removeItem(key) {
      removeLocal(key);
      if (key === storageKey) clearCookie();
    },
  };
}
