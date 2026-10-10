const AVATAR_STATES = new Set(["active", "hidden", "pending_review"]);
const AVATAR_SOURCES = new Set(["custom", "google"]);
const SIGNED_AVATAR_PATH = "/storage/v1/object/sign/profile-avatars/";
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const OUTPUT_SIZE = 512;

const escapeHTML = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);

const finitePositive = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError(`${label} must be positive`);
  return number;
};

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function trustedSupabaseOrigin(url) {
  const configuredURL = typeof window !== "undefined" ? window.SUPABASE_URL : null;
  if (typeof configuredURL === "string" && configuredURL) {
    try {
      return url.origin === new URL(configuredURL).origin;
    } catch {
      return false;
    }
  }
  return /^[a-z0-9-]+[.]supabase[.]co$/i.test(url.hostname);
}

function safeSignedAvatarURL(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !trustedSupabaseOrigin(url) ||
      url.username ||
      url.password ||
      !url.pathname.startsWith(SIGNED_AVATAR_PATH) ||
      !url.searchParams.get("token")
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function avatarInitials(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const selected = words.length === 1 ? [words[0]] : [words[0], words.at(-1)];
  return selected.map((word) => Array.from(word)[0] ?? "").join("").toLocaleUpperCase("en");
}

export function normalizeAvatarPresentation(value) {
  const input = value && typeof value === "object" ? value : {};
  if (!AVATAR_STATES.has(input.state)) {
    return { url: null, source: "initials", state: "hidden", expiresAt: null };
  }
  const state = input.state;
  const url = safeSignedAvatarURL(input.url);
  const source = AVATAR_SOURCES.has(input.source) ? input.source : "initials";
  if (!url || source === "initials" || state === "hidden") {
    return { url: null, source: "initials", state, expiresAt: null };
  }
  const expiresAt = typeof input.expiresAt === "string" && Number.isFinite(Date.parse(input.expiresAt))
    ? input.expiresAt
    : null;
  return { url, source, state, expiresAt };
}

export function avatarMarkup({
  name,
  presentation,
  size = 48,
  className = "",
  decorative = false,
  eager = false,
} = {}) {
  const normalized = normalizeAvatarPresentation(presentation);
  const pixelSize = clamp(Math.round(finitePositive(size, "Avatar size")), 16, 256);
  const classes = String(className ?? "").split(/\s+/)
    .filter((token) => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(token));
  const wrapperClass = ["avatar", ...classes].join(" ");
  const initials = escapeHTML(avatarInitials(name));
  const accessibleName = `${String(name ?? "").trim() || "Member"}'s profile photo`;
  const wrapperAccessibility = decorative
    ? ' aria-hidden="true"'
    : normalized.url
    ? ""
    : ` role="img" aria-label="${escapeHTML(accessibleName)}"`;
  const image = normalized.url
    ? `<img class="avatar__image" src="${escapeHTML(normalized.url)}" alt="${
      decorative ? "" : escapeHTML(accessibleName)
    }" width="${pixelSize}" height="${pixelSize}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'}>`
    : "";
  return `<span class="${escapeHTML(wrapperClass)}" style="--avatar-size:${pixelSize}px"${wrapperAccessibility}>` +
    `<span class="avatar__initials" aria-hidden="true">${initials}</span>${image}</span>`;
}

export function fitCrop({ imageWidth, imageHeight, viewportSize }) {
  const width = finitePositive(imageWidth, "Image width");
  const height = finitePositive(imageHeight, "Image height");
  const viewport = finitePositive(viewportSize, "Viewport size");
  return {
    imageWidth: width,
    imageHeight: height,
    viewportSize: viewport,
    baseScale: viewport / Math.min(width, height),
    zoom: MIN_ZOOM,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    offsetX: 0,
    offsetY: 0,
    outputSize: OUTPUT_SIZE,
  };
}

export function clampCrop(state) {
  if (!state || typeof state !== "object") throw new TypeError("Crop state is required");
  const imageWidth = finitePositive(state.imageWidth, "Image width");
  const imageHeight = finitePositive(state.imageHeight, "Image height");
  const viewportSize = finitePositive(state.viewportSize, "Viewport size");
  const baseScale = viewportSize / Math.min(imageWidth, imageHeight);
  const minZoom = MIN_ZOOM;
  const maxZoom = MAX_ZOOM;
  const zoom = clamp(Number(state.zoom) || minZoom, minZoom, maxZoom);
  const renderedWidth = imageWidth * baseScale * zoom;
  const renderedHeight = imageHeight * baseScale * zoom;
  const maxOffsetX = Math.max(0, (renderedWidth - viewportSize) / 2);
  const maxOffsetY = Math.max(0, (renderedHeight - viewportSize) / 2);
  return {
    ...state,
    imageWidth,
    imageHeight,
    viewportSize,
    baseScale,
    zoom,
    minZoom,
    maxZoom,
    offsetX: clamp(Number(state.offsetX) || 0, -maxOffsetX, maxOffsetX),
    offsetY: clamp(Number(state.offsetY) || 0, -maxOffsetY, maxOffsetY),
    outputSize: OUTPUT_SIZE,
  };
}

export function cropSourceRect(state) {
  const crop = clampCrop(state);
  const scale = crop.baseScale * crop.zoom;
  const sourceEdge = crop.viewportSize / scale;
  const centerX = crop.imageWidth / 2 - crop.offsetX / scale;
  const centerY = crop.imageHeight / 2 - crop.offsetY / scale;
  const sx = clamp(centerX - sourceEdge / 2, 0, crop.imageWidth - sourceEdge);
  const sy = clamp(centerY - sourceEdge / 2, 0, crop.imageHeight - sourceEdge);
  return { sx, sy, sw: sourceEdge, sh: sourceEdge };
}
