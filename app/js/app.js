// ==========================================================================
// ITC prototype — router, event delegation, boot.
// ==========================================================================

import * as store from "./store.js";
import { buildICS, findSession, todayLocal, mondayOf, addDays, isoDate, donorIdProblem } from "./data.js";
import { buildIndemnityCsv } from "./exports.js";
import * as views from "./views.js";
import { isLive, supabase } from "./config.js";
import * as components from "./components.js";
import { openAvatarManager } from "./avatar-cropper.js";
import {
  normalizeMeetingPoint,
  normalizeVenueLocation,
  TAMAR_DEFAULT_MEETING_POINT,
} from "./venue.js";
import { syncWebPushSubscription } from "./web-push.js";

const viewEl = document.getElementById("view");
const navEl = document.getElementById("bottom-nav");
const notificationEl = document.getElementById("top-notifications");
const avatarEl = document.getElementById("top-avatar");
const toastStack = document.getElementById("toast-stack");
const MAP_FALLBACK_HTML = `<p class="muted small activity-map-fallback" role="status">Couldn't find the venue on the map — tap Get directions instead.</p>`;

export function revealAvatarInitials(image) {
  const isAvatarImage = image?.classList?.contains?.("avatar__image")
    || String(image?.className || "").split(/\s+/).includes("avatar__image");
  if (!isAvatarImage) return false;
  const wrapper = image.closest?.(".avatar") || image.parentElement;
  wrapper?.classList?.toggle?.("is-error", true);
  image.hidden = true;
  return true;
}

document.addEventListener("error", (event) => {
  revealAvatarInitials(event.target);
}, true);

export function commitOwnAvatarPresentation(presentation) {
  const user = store.currentUser();
  if (!user?.id) return false;
  avatarEl.dataset.avatarSource = presentation?.source || "initials";
  avatarEl.innerHTML = views.avatarHTML(user, presentation);
  const profileButton = viewEl.querySelector?.('[data-action="manage-profile-photo"]');
  if (profileButton) profileButton.innerHTML = views.profileAvatarHTML(user, presentation);
  return true;
}

const canManageOwnAvatar = (user) => user?.status === "approved"
  && ["member", "admin", "superadmin", "super_admin"].includes(user.role);

function rosterRowMatchesViewer(row, viewer) {
  if (!row || !viewer) return false;
  if (row.profileId && row.profileId === viewer.id) return true;
  const label = String(row.displayName || "").trim().toLowerCase();
  if (!label) return false;
  const full = String(viewer.fullName || "").trim().toLowerCase();
  const preferred = String(viewer.preferredName || "").trim().toLowerCase();
  if (full && label === full) return true;
  if (preferred && label === preferred) return true;
  if (preferred && full) {
    const parts = full.split(/\s+/).filter(Boolean);
    const last = parts[parts.length - 1] || "";
    if (last && label === `${preferred} ${last[0]}.`) return true;
  }
  return false;
}

async function applyOwnAvatarToRoster(rows, viewer) {
  if (!Array.isArray(rows) || !rows.length || !canManageOwnAvatar(viewer)) return rows;
  const own = await store.getOwnAvatar().catch(() => null);
  if (!own?.url) return rows;
  return rows.map((row) => {
    if (!rosterRowMatchesViewer(row, viewer)) return row;
    return {
      ...row,
      profileId: row.profileId || viewer.id,
      url: own.url,
      source: own.source,
      state: own.state || "active",
      expiresAt: own.expiresAt ?? null,
    };
  });
}

function initialsRosterFromNames(attendeeNames) {
  return attendeeNames.map((displayName) => ({
    displayName,
    url: null,
    source: "initials",
    state: "active",
  }));
}

export async function openOwnAvatarManager(openManager = openAvatarManager) {
  const user = store.currentUser();
  if (!canManageOwnAvatar(user)) {
    throw new Error("Approved membership is required to manage a profile photo.");
  }
  const presentation = await store.getOwnAvatar();
  return openManager({
    memberName: user.fullName,
    presentation,
    moderated: ["hidden", "pending_review"].includes(presentation.state),
    onUpload: async (jpegBlob) => {
      const next = await store.uploadMyAvatar(jpegBlob);
      commitOwnAvatarPresentation(next);
      toast(next.state === "pending_review" ? "Photo sent for approval" : "Profile photo saved");
      return next;
    },
    onRemove: async () => {
      const next = await store.removeMyAvatar();
      commitOwnAvatarPresentation(next);
      toast("Profile photo removed");
      return next;
    },
  });
}

async function syncApprovedGoogleAvatar({ ifMissing = false } = {}) {
  if (!canManageOwnAvatar(store.currentUser())) return null;
  try {
    if (ifMissing) {
      const current = await store.getOwnAvatar();
      if (current.source !== "initials" || current.state !== "active") return current;
    }
    const presentation = await store.syncGoogleAvatar();
    commitOwnAvatarPresentation(presentation);
    return presentation;
  } catch {
    return null;
  }
}

export function loadActivityMapModule() {
  return import("./map.js");
}

export async function mountCommittedActivityMap(host, options = {}) {
  const {
    ownsGeneration = () => true,
    loadModule = loadActivityMapModule,
  } = options;
  try {
    const { mountActivityMap } = await loadModule();
    return await mountActivityMap(host, { ownsGeneration });
  } catch (_err) {
    if (ownsGeneration() && host?.isConnected) host.innerHTML = MAP_FALLBACK_HTML;
    return false;
  }
}

export async function syncWeekVenuePicker(form, options = {}) {
  const ownsGeneration = options.ownsGeneration || (() => true);
  if (!(form instanceof HTMLFormElement) || !String(form.dataset.session || "").startsWith("wnt-")) {
    return false;
  }
  const locationField = form.querySelector('[name="location"]');
  const latField = form.querySelector('[name="meetingLat"]');
  const lngField = form.querySelector('[name="meetingLng"]');
  const shell = form.querySelector("[data-venue-picker-shell]");
  const host = form.querySelector("[data-venue-picker]");
  if (!locationField || !latField || !lngField || !shell || !host) return false;
  const isTamar = normalizeVenueLocation(locationField.value) === "tamar park";
  shell.classList.toggle("hidden", !isTamar);
  if (!isTamar) {
    latField.value = "";
    lngField.value = "";
    venuePickerControllers.get(form)?.destroy();
    venuePickerControllers.delete(form);
    return false;
  }
  const initialPoint = normalizeMeetingPoint(latField.value, lngField.value)
    || TAMAR_DEFAULT_MEETING_POINT;
  latField.value = String(initialPoint.lat);
  lngField.value = String(initialPoint.lng);
  if (venuePickerControllers.has(form)) return true;
  const { mountVenuePicker } = await (options.loadModule || loadActivityMapModule)();
  const controller = await mountVenuePicker(host, {
    initialPoint,
    ownsGeneration,
    onChange(point) {
      latField.value = String(point.lat);
      lngField.value = String(point.lng);
    },
  });
  const stillTamar = normalizeVenueLocation(locationField.value) === "tamar park";
  if (!controller || !ownsGeneration() || !stillTamar) {
    controller?.destroy();
    return false;
  }
  venuePickerControllers.set(form, controller);
  return true;
}

export function mountVenueImageFallback(image, options = {}) {
  const {
    ownsGeneration = () => true,
    mountMap = mountCommittedActivityMap,
  } = options;
  if (!image || !ownsGeneration()) return false;
  const query = String(image.dataset.fallbackQuery || "").trim();
  image.addEventListener("error", () => {
    if (!ownsGeneration() || !image.isConnected) return;
    const figure = image.closest("figure");
    if (!figure) return;
    if (!query) {
      figure.remove();
      return;
    }
    const section = document.createElement("section");
    section.className = "activity-map-section";
    section.setAttribute("aria-label", "Venue map");
    const host = document.createElement("div");
    host.className = "activity-map";
    host.id = "activity-map";
    host.dataset.mapsQuery = query;
    const status = document.createElement("p");
    status.className = "muted small";
    status.setAttribute("role", "status");
    status.textContent = "Loading map…";
    host.appendChild(status);
    section.appendChild(host);
    figure.replaceWith(section);
    void mountMap(host, { ownsGeneration });
  }, { once: true });
  return true;
}

export function mountDetailPhotoFallback(image, options = {}) {
  const ownsGeneration = options.ownsGeneration || (() => true);
  const fallbackSrc = String(image?.dataset?.photoFallback || "").trim();
  if (!image || !fallbackSrc || !ownsGeneration()) return false;
  let fallbackAttempted = false;
  image.addEventListener("error", () => {
    if (!ownsGeneration() || !image.isConnected) return;
    if (!fallbackAttempted && image.getAttribute("src") !== fallbackSrc) {
      fallbackAttempted = true;
      image.src = fallbackSrc;
      return;
    }
    image.remove();
  });
  return true;
}

// --- Toasts --------------------------------------------------------------------

export function toast(msg, isErr = false) {
  const el = document.createElement("div");
  el.className = `toast${isErr ? " err" : ""}`;
  el.setAttribute("role", isErr ? "alert" : "status");
  el.textContent = msg;
  toastStack.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// --- Router ----------------------------------------------------------------------

function parseHash() {
  return location.hash
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean);
}

function replaceRoute(route) {
  history.replaceState(history.state, "", `${location.pathname}${location.search}${route}`);
}

const NAV_FOR = {
  home: "home",
  schedule: "schedule",
  activity: "schedule",
  hyrox: "schedule",
  community: "community",
  giving: "giving",
  notifications: "notifications",
  account: "account",
  apply: "account",
  checkout: "account",
  pay: "account",
  booking: "account",
  replacement: "account",
  receipt: "account",
  admin: "admin",
};

let prevPage = null;
let renderGeneration = 0;
let notificationRouteRows = null;
let pendingNotificationRouteRequest = null;
const controlBusy = new WeakSet();
const avatarModerationBusy = new Set();
const venuePickerControllers = new WeakMap();
const APPLY_DRAFT_DEBOUNCE_MS = 500;
let applyDraftTimer = null;

// --- Async render + busy + feedback helpers (canonical Auth baseline) ---

async function withBusyControl(control, busyLabel, work, options = {}) {
  const busyKey = options.busyKey || control;
  if (!control || !busyKey || controlBusy.has(busyKey)) return;
  controlBusy.add(busyKey);
  const controls = [...new Set(options.controls || [control])];
  const disabledStates = controls.map((item) => [item, Boolean(item.disabled)]);
  const label = control.textContent;
  const canReplaceLabel = options.replaceLabel ?? control.tagName !== "SELECT";
  const announceWithoutReplacing = options.announceWithoutReplacing === true;
  const hadAriaLabel = control.hasAttribute("aria-label");
  const ariaLabel = control.getAttribute("aria-label");
  controls.forEach((item) => { item.disabled = true; });
  control.setAttribute("aria-busy", "true");
  if (canReplaceLabel) control.textContent = busyLabel;
  if (announceWithoutReplacing) {
    control.setAttribute("aria-label", busyLabel);
    control.classList.toggle("is-busy", true);
  }
  try {
    return await work();
  } finally {
    controlBusy.delete(busyKey);
    disabledStates.forEach(([item, disabled]) => { item.disabled = disabled; });
    control.removeAttribute("aria-busy");
    if (canReplaceLabel) control.textContent = label;
    if (announceWithoutReplacing) {
      if (hadAriaLabel) control.setAttribute("aria-label", ariaLabel);
      else control.removeAttribute("aria-label");
      control.classList.toggle("is-busy", false);
    }
  }
}

function campaignMutationControls(form, control = null) {
  const controls = [...(form?.querySelectorAll?.("input, textarea, select, button") || [])];
  if (control && !controls.includes(control)) controls.push(control);
  return controls;
}

function withCampaignMutationControl(form, control, busyLabel, work) {
  return withBusyControl(control, busyLabel, work, {
    busyKey: form,
    controls: campaignMutationControls(form, control),
  });
}

function lockCampaignMutationControls(form) {
  campaignMutationControls(form).forEach((control) => { control.disabled = true; });
}

function campaignFormPayload(form) {
  const fd = new FormData(form);
  return {
    id: form.dataset.campaign || "",
    title: fd.get("title"), description: fd.get("description"), goalHKD: fd.get("goalHKD"),
    fpsId: fd.get("fpsId"), fpsPayee: fd.get("fpsPayee"),
  };
}

function clearCampaignError(form) {
  const host = form?.querySelector?.("#campaign-error");
  if (host) { host.textContent = ""; host.className = ""; host.removeAttribute("role"); }
}

function showCampaignError(control, message) {
  const host = control?.closest?.("form")?.querySelector?.("#campaign-error");
  if (host) { host.textContent = message; host.className = "form-error"; host.setAttribute("role", "alert"); }
}

async function refreshAfterAdminMutation(successMessage) {
  toast(successMessage);
  try {
    await renderWithFeedback();
    return { refreshed: true, message: "" };
  } catch (err) {
    const detail = err.message || "Refresh failed";
    const message = `Change saved, but this Admin view could not refresh. ${detail}`;
    toast(message, true);
    return { refreshed: false, message };
  }
}

function lockAdminMutationControls(control) {
  const group = control?.closest?.(".member-role-actions");
  const controls = group?.querySelectorAll?.("button, select") || [control];
  [...controls].forEach((item) => { item.disabled = true; });
}

function clearFieldError(field) {
  if (!field?.id) return;
  const errorId = `${field.id}-error`;
  document.getElementById(errorId)?.remove();
  const describedBy = (field.getAttribute("aria-describedby") || "")
    .split(/\s+/)
    .filter((id) => id && id !== errorId);
  if (describedBy.length) field.setAttribute("aria-describedby", describedBy.join(" "));
  else field.removeAttribute("aria-describedby");
  field.removeAttribute("aria-invalid");
}

function showFieldError(form, field, errorHost, message) {
  if (!form || !field || !errorHost) return;
  clearFieldError(field);
  errorHost.innerHTML = "";
  const alert = document.createElement("div");
  alert.className = "form-error";
  alert.id = `${field.id}-error`;
  alert.setAttribute("role", "alert");
  alert.textContent = message;
  errorHost.appendChild(alert);
  field.setAttribute("aria-invalid", "true");
  field.setAttribute(
    "aria-describedby",
    [field.getAttribute("aria-describedby"), alert.id].filter(Boolean).join(" ")
  );
  field.focus();
}

function showInlineFormError(host, message) {
  if (!host) return;
  host.innerHTML = "";
  const alert = document.createElement("div");
  alert.className = "form-error";
  alert.setAttribute("role", "alert");
  alert.textContent = message;
  host.appendChild(alert);
}

function showMagicLinkFeedback(form, message, isError = false) {
  const host = form.querySelector("[data-magic-link-feedback]");
  if (!host) return;
  host.textContent = message;
  host.setAttribute("role", isError ? "alert" : "status");
}

export async function maybeRedirectToApply() {
  if (!isLive()) return;
  const cu = await store.getCurrentUser();
  if (!cu || cu.role !== "pending") return;
  const app = await store.getMyApplication();
  if (store.shouldRedirectPendingApplicant({
    role: cu.role,
    hasApplication: Boolean(app),
    route: window.location.hash,
  })) {
    window.location.hash = "#/apply";
  }
}

function commitNotificationCount(unreadCount, active) {
  notificationEl.innerHTML = views.notificationBellHTML(unreadCount, active);
  notificationEl.setAttribute(
    "aria-label",
    unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"
  );
}

function renderNotificationChrome(user, active, generation, rowsPromise = null) {
  notificationEl.hidden = !user;
  notificationEl.innerHTML = user ? views.notificationBellHTML(0, active) : "";
  if (!user) {
    notificationEl.removeAttribute("aria-label");
    notificationEl.removeAttribute("aria-current");
    return null;
  }

  notificationEl.setAttribute("aria-label", "Notifications");
  if (active) notificationEl.setAttribute("aria-current", "page");
  else notificationEl.removeAttribute("aria-current");

  // Best-effort and detached from ordinary route renders. The Notifications
  // page passes its own request so page content and the badge share one query.
  const request = rowsPromise || store.listMyNotifications();
  request.then((rows) => {
    if (generation !== renderGeneration) return;
    const unreadCount = rows.filter((row) => !row.read_at).length;
    commitNotificationCount(unreadCount, active);
  }).catch(() => {});
  return request;
}

async function renderWithFeedback() {
  const generation = ++renderGeneration;
  const routeLoader = document.getElementById("route-loader");
  viewEl.setAttribute("aria-busy", "true");
  const timer = setTimeout(() => {
    if (generation === renderGeneration) {
      if (routeLoader) routeLoader.hidden = false;
    }
  }, 300);
  try {
    await render(generation);
  } catch (err) {
    if (generation === renderGeneration) throw err;
  } finally {
    clearTimeout(timer);
    if (generation === renderGeneration) {
      if (routeLoader) routeLoader.hidden = true;
      viewEl.removeAttribute("aria-busy");
    }
  }
}

async function render(generation = renderGeneration) {
  const parts = parseHash();
  const [page, arg, arg2] = parts.length ? parts : ["home"];

  // Keep the last committed Notifications rows available while a same-route
  // refresh is pending so a displayed unread row can still complete its
  // read/remove/navigation sequence. Other routes must not reuse that cache.
  if (page !== "notifications") notificationRouteRows = null;

  // Entering the Schedule tab fresh (bottom nav, Home, Profile…) resets it
  // to this week + today — a week offset left over from earlier browsing
  // must not hide today's sessions. Back links from activity/checkout keep
  // the week and day you were looking at.
  if (page === "schedule" && !["schedule", "activity", "checkout"].includes(prevPage)) {
    views.resetScheduleState();
  }

  const notificationsActive = page === "notifications";
  const routeUser = store.currentUser();
  let notificationRowsPromise = null;
  let nextNotificationRouteRows = null;

  // Commit the bell and its active state before the Notifications request can
  // delay route content. This same promise is also consumed by the page.
  if (notificationsActive) {
    notificationRowsPromise = pendingNotificationRouteRequest
      || (routeUser ? store.listMyNotifications() : Promise.resolve([]));
    pendingNotificationRouteRequest = null;
    renderNotificationChrome(routeUser, true, generation, notificationRowsPromise);
  }

  let out;
  switch (page) {
    case "home":
      out = views.viewHome();
      break;
    case "schedule":
      out = views.viewSchedule();
      break;
    case "activity": {
      if (store.isRetiredHyroxMemberRoute("activity", arg)) {
        out = views.viewRetiredSession();
        break;
      }
      const session = store.getSession(arg);
      const viewer = store.currentUser();
      let attendeeNames;
      let avatarRows = null;
      if (viewer?.status === "approved") {
        try {
          attendeeNames = await store.attendeeNamesFor(arg);
          // If the names RPC is empty but hydrated bookings show people
          // (common when count is ahead of roster RPC), use cache names.
          if (Array.isArray(attendeeNames) && !attendeeNames.length && session) {
            const cachedNames = store.attendeesFor(session);
            if (cachedNames.length) attendeeNames = cachedNames;
          }
        } catch (err) {
          console.warn("Unable to load attendee names", err);
          attendeeNames = session ? store.attendeesFor(session) : null;
          if (Array.isArray(attendeeNames) && !attendeeNames.length) attendeeNames = null;
        }
        if ((session?.kind === "paid" || store.sessionRequiresRsvp(session))
            && canManageOwnAvatar(viewer)) {
          try {
            avatarRows = await store.getSessionAvatars(arg);
            if (Array.isArray(attendeeNames) && attendeeNames.length) {
              if (!Array.isArray(avatarRows) || !avatarRows.length) {
                avatarRows = initialsRosterFromNames(attendeeNames);
              } else {
                avatarRows = avatarRows.map((row, index) => ({
                  ...row,
                  displayName: attendeeNames[index] || row.displayName,
                }));
              }
            }
          } catch {
            avatarRows = Array.isArray(attendeeNames) && attendeeNames.length
              ? initialsRosterFromNames(attendeeNames)
              : null;
          }
          // Session avatar resolver can omit photos for RSVP rosters; keep the
          // viewer's header photo on their own Who's coming row.
          if (Array.isArray(avatarRows) && avatarRows.length) {
            avatarRows = await applyOwnAvatarToRoster(avatarRows, viewer);
          }
        }
      }
      out = views.viewActivity(arg, { attendeeNames, avatarRows });
      break;
    }
    case "hyrox":
      out = store.isRetiredHyroxMemberRoute("hyrox", arg)
        ? views.viewRetiredSession()
        : views.viewNotFound();
      break;
    case "community":
      out = await views.viewCommunity(arg);
      break;
    case "giving":
      out = await views.viewGiving({ ownsGeneration: () => generation === renderGeneration });
      break;
    case "account":
      out = await views.viewAccount(arg, arg2);
      break;
    case "apply": {
      const u = store.currentUser();
      out = u && u.status === "approved" ? { redirect: "#/account" } : await views.viewApply();
      break;
    }
    case "notifications":
      nextNotificationRouteRows = await notificationRowsPromise;
      out = await views.viewNotifications(new Date(), nextNotificationRouteRows);
      break;
    case "checkout":
      out = store.isRetiredHyroxMemberRoute("checkout", arg)
        ? views.viewRetiredSession()
        : views.viewCheckout(arg);
      break;
    case "pay":
      if (store.isRetiredHyroxMemberRoute("pay", arg)) {
        out = views.viewRetiredSession();
        break;
      }
      if (isLive() && routeUser?.status === "approved") {
        await store.hydrateLiveOperations({ force: true });
      }
      out = views.viewPay(arg);
      break;
    case "booking":
      out = store.isRetiredHyroxMemberRoute("booking", arg)
        ? views.viewRetiredSession()
        : views.viewBooking(arg);
      break;
    case "replacement":
      out = await views.viewReplacementInvite(arg);
      break;
    case "receipt":
      out = store.isRetiredHyroxMemberRoute("receipt", arg)
        ? views.viewRetiredSession()
        : views.viewReceipt(arg);
      break;
    case "admin":
      out = arg === "activity"
        ? await views.viewAdminActivity(arg2)
        : arg === "campaign"
          ? await views.viewAdminCampaign(arg2)
          : arg === "announcements" && arg2 === "new"
            ? await views.viewAdminAnnouncementCompose()
            : arg === "users"
              ? { redirect: "#/admin/members" }
              : await views.viewAdmin(arg || "members");
      break;
    default:
      out = views.viewNotFound();
  }

  // A newer route may finish while this view was awaiting live data. Only
  // the latest generation may redirect or commit shared page chrome.
  if (generation !== renderGeneration) return;

  if (out && typeof out === "object" && out.redirect) {
    location.hash = out.redirect;
    return;
  }

  // Keep the local filter cache paired with this generation's HTML commit.
  if (notificationsActive) notificationRouteRows = nextNotificationRouteRows;
  const user = store.currentUser();
  const ownAvatar = canManageOwnAvatar(user)
    ? await store.getOwnAvatar().catch(() => null)
    : null;
  if (generation !== renderGeneration) return;

  viewEl.innerHTML = out;
  if (!viewEl.querySelector("[data-route-not-found]")) {
    store.rememberLastRoute(location.hash, user?.id);
  }
  navEl.innerHTML = views.navHTML(NAV_FOR[page] ?? "home", user);
  avatarEl.classList.toggle("is-empty", !user);
  avatarEl.dataset.avatarSource = ownAvatar?.source || "initials";
  avatarEl.innerHTML = views.avatarHTML(user, ownAvatar);
  if (!notificationsActive) renderNotificationChrome(user, false, generation);
  if (page === "activity") {
    const ownsGeneration = () => generation === renderGeneration;
    const mapHost = viewEl.querySelector("#activity-map");
    if (mapHost) {
      void mountCommittedActivityMap(mapHost, { ownsGeneration });
    }
    const venueImage = viewEl.querySelector("[data-venue-image]");
    if (venueImage) mountVenueImageFallback(venueImage, { ownsGeneration });
    const detailPhoto = viewEl.querySelector(".detail-photo");
    if (detailPhoto) mountDetailPhotoFallback(detailPhoto, { ownsGeneration });
  }
  if (page === "admin" && arg === "activities") {
    const ownsGeneration = () => generation === renderGeneration;
    const venueForms = viewEl.querySelectorAll?.('form[data-action="form-week-venue"]') || [];
    [...venueForms].forEach((form) => { void syncWeekVenuePicker(form, { ownsGeneration }); });
  }
  window.scrollTo({ top: 0 });
  viewEl.focus({ preventScroll: true });
  prevPage = page;
}

document.addEventListener("input", async (e) => {
  const field = e.target;
  if (field?.getAttribute?.("aria-invalid") === "true") clearFieldError(field);
  if (field?.name === "location") {
    const venueForm = field.closest?.('form[data-action="form-week-venue"]');
    if (venueForm) {
      const generation = renderGeneration;
      void syncWeekVenuePicker(venueForm, {
        ownsGeneration: () => generation === renderGeneration,
      });
    }
  }
  if (field?.dataset?.input === "member-search") {
    views.adminMemberFilters.query = field.value;
    const cursor = field.selectionStart;
    await renderWithFeedback();
    const nextSearch = document.getElementById("member-search");
    nextSearch?.focus();
    nextSearch?.setSelectionRange?.(cursor, cursor);
  }
});

// --- Apply/details forms: toggle minor-only fields when age status changes --------

document.addEventListener("change", (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement) || t.name !== "age_over_18") return;
  const form = t.closest("form");
  if (!form || (!["apply", "membership-details"].includes(form.dataset.form) && form.id !== "form-apply")) return;
  const block = form.querySelector("[data-minor-only]");
  if (!block) return;
  const isMinor = t.value === "no";
  block.hidden = !isMinor;
  block.querySelectorAll("input").forEach((input) => {
    input.required = isMinor;
    if (!isMinor) input.value = "";
  });
});

function collectApplyDraftFields(form) {
  const fields = {};
  for (const [name, value] of new FormData(form).entries()) fields[name] = value;
  form.querySelectorAll('input[type="checkbox"][name]').forEach((input) => {
    fields[input.name] = input.checked;
  });
  return fields;
}

function updateApplyDraftStatus(form, draft) {
  const status = form.querySelector("[data-draft-status]");
  if (!status || !draft) return;
  const time = new Date(draft.savedAt).toLocaleTimeString("en-HK", {
    hour: "numeric",
    minute: "2-digit",
  });
  status.textContent = `Saved at ${time}`;
}

function saveApplyDraftForm(form) {
  const draft = store.saveApplyDraft({
    fields: collectApplyDraftFields(form),
    profileId: store.currentUser()?.id || null,
  });
  updateApplyDraftStatus(form, draft);
  return draft;
}

const scheduleApplyDraftSave = (e) => {
  const form = e.target?.closest?.('form[data-form="apply"]');
  if (!form) return;
  clearTimeout(applyDraftTimer);
  applyDraftTimer = setTimeout(() => saveApplyDraftForm(form), APPLY_DRAFT_DEBOUNCE_MS);
};
document.addEventListener("input", scheduleApplyDraftSave);
document.addEventListener("change", scheduleApplyDraftSave);

// --- ICS download -------------------------------------------------------------------

function appleCalendarClient() {
  const ua = navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const safari = /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|Edg/i.test(ua);
  return iOS || safari;
}

async function downloadICS(session) {
  const ics = buildICS(session);
  const filename = `itc-${session.id}.ics`;
  const file = typeof File === "function"
    ? new File([ics], filename, { type: "text/calendar;charset=utf-8" })
    : null;

  // iOS Safari is more reliable when the .ics is handed to its share sheet
  // than when a Blob URL is treated as a download. Choosing Calendar there
  // opens the native event form, where the member still confirms the event.
  if (file && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: session.name,
        text: "Add this Island Training Club session to your calendar.",
      });
      toast("Calendar event shared — choose Calendar to add it");
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
      // Fall through when the share sheet cannot accept the file.
    }
  }

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  // Safari without file sharing ignores the download attribute and saves the
  // file to Files. Navigating to the blob opens the calendar preview instead.
  if (appleCalendarClient()) {
    window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast("Opening calendar…");
    return;
  }

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
  toast("Calendar file ready — open it to add to your calendar");
}

async function downloadIndemnityList(control) {
  await withBusyControl(control, "Preparing…", async () => {
    const records = await store.listIndemnityRecords();
    const blob = new Blob([buildIndemnityCsv(records)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `itc-indemnity-list-${isoDate(todayLocal())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`${records.length} indemnity records downloaded`);
  });
}

// --- Click delegation -----------------------------------------------------------------

export async function runAvatarModeration(control) {
  const action = {
    "avatar-hide": "hide",
    "avatar-approve": "approve",
    "avatar-reject": "reject",
  }[control?.dataset?.action];
  const profileId = String(control?.dataset?.profileId || "");
  if (!action || !profileId || avatarModerationBusy.has(profileId)) return false;
  const card = control.closest?.("[data-avatar-moderation-card]");
  const reasonInput = card?.querySelector?.("[data-avatar-moderation-reason]");
  const reason = String(reasonInput?.value || "").trim();
  if (["hide", "reject"].includes(action) && !reason) {
    toast("Enter a moderation reason", true);
    reasonInput?.focus?.();
    return false;
  }

  avatarModerationBusy.add(profileId);
  const controls = [...(card?.querySelectorAll?.("button, input") || [control])];
  const originalLabel = control.textContent;
  const busyLabel = action === "approve" ? "Approving…" : action === "reject" ? "Rejecting…" : "Hiding…";
  controls.forEach((item) => { item.disabled = true; });
  control.textContent = busyLabel;
  control.setAttribute?.("aria-busy", "true");
  let mutationSucceeded = false;
  let refreshed = false;
  try {
    await store.moderateAvatar(profileId, action, reason);
    mutationSucceeded = true;
    const name = control.dataset.memberName || "Member";
    const message = action === "approve"
      ? `${name}’s profile photo approved.`
      : action === "reject"
      ? `${name}’s replacement rejected.`
      : `${name}’s profile photo hidden.`;
    const result = await refreshAfterAdminMutation(message);
    refreshed = result.refreshed;
    return true;
  } catch (error) {
    toast(error.message || "Profile photo moderation failed", true);
    return false;
  } finally {
    avatarModerationBusy.delete(profileId);
    control.textContent = originalLabel;
    control.removeAttribute?.("aria-busy");
    if (!mutationSucceeded || refreshed) controls.forEach((item) => { item.disabled = false; });
  }
}

document.addEventListener("click", async (e) => {
  // Drill-down anchor links (e.g. Admin HYROX status counts) point at in-page
  // element IDs without changing the route. The router treats any hash as a
  // full navigation, which would land on the not-found page; intercepting
  // the click keeps the user on Admin/Payments and just scrolls the target
  // into view.
  const anchor = e.target.closest && e.target.closest("a[href^='#']:not([href='#'])");
  if (anchor && !anchor.dataset.action && !e.defaultPrevented) {
    const href = anchor.getAttribute("href") || "";
    // Only in-page element anchors are valid selectors. SPA route hashes like
    // #/receipt/<id> must fall through to the router: querySelector would throw
    // a SyntaxError on them, and they must never be intercepted as scroll targets.
    const isInPageAnchor = /^#[A-Za-z][A-Za-z0-9_-]*$/.test(href);
    const target = isInPageAnchor ? document.querySelector(href) : null;
    if (target && href.startsWith("#") && href.length > 1) {
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      history.replaceState(null, "", `${location.pathname}${location.search}${href}`);
      return;
    }
  }
  const el = e.target.closest("[data-action]");
  // Repeated forms route through the submit delegate via data-action. If a
  // nested submit button resolves to its parent form here, preventDefault()
  // below cancels the browser's submit event before that handler can run.
  if (!el || el instanceof HTMLFormElement) return;
  const { action } = el.dataset;
  e.preventDefault?.();

  switch (action) {
    case "avatar-hide":
    case "avatar-approve":
    case "avatar-reject":
      await runAvatarModeration(el);
      break;
    case "notification-filter": {
      const kind = el.dataset.notificationFilter;
      const allowedKinds = ["all", "application", "decision", "role", "club", "personal"];
      if (parseHash()[0] !== "notifications" || !allowedKinds.includes(kind) || !notificationRouteRows) break;
      views.notificationFilters.kind = kind;
      viewEl.innerHTML = await views.viewNotifications(new Date(), notificationRouteRows);
      viewEl.querySelector(
        `[data-action="notification-filter"][data-notification-filter="${kind}"]`
      )?.focus();
      break;
    }
    case "download-indemnity-list": {
      const viewer = store.currentUser();
      if (!viewer || !["admin", "superadmin", "super_admin"].includes(viewer.role)) break;
      try {
        await downloadIndemnityList(el);
      } catch (err) {
        toast(err.message || "Unable to download indemnity list", true);
      }
      break;
    }
    case "admin-member-filter": {
      const { filterKey, filterValue } = el.dataset;
      const allowedValues = {
        status: ["all", "approved", "pending", "declined"],
        role: ["all", "member", "admin", "superadmin"],
      };
      if (!allowedValues[filterKey]?.includes(filterValue)) break;
      views.adminMemberFilters[filterKey] = filterValue;
      await renderWithFeedback();
      document.getElementById(`member-filter-${filterKey}-${filterValue}`)?.focus();
      break;
    }
    case "admin-member-filters-clear":
      views.adminMemberFilters.query = "";
      views.adminMemberFilters.status = "all";
      views.adminMemberFilters.role = "all";
      await renderWithFeedback();
      document.getElementById("member-search")?.focus();
      break;
    case "save-draft": {
      const form = el.closest('form[data-form="apply"]');
      if (!form) break;
      clearTimeout(applyDraftTimer);
      const draft = saveApplyDraftForm(form);
      toast(draft ? "Draft saved on this device" : "Unable to save draft", !draft);
      break;
    }
    case "open-doc": {
      const docKey = el.dataset.doc;
      if (!docKey) break;
      components.openReadAndAcceptModal({
        docKey,
        trigger: el,
        onAccept: (openingTrigger) => {
          components.applyDocumentAcceptance(openingTrigger || el);
        },
      });
      break;
    }
    case "discard-draft":
      clearTimeout(applyDraftTimer);
      store.clearApplyDraft({ profileId: store.currentUser()?.id || null });
      toast("Application draft discarded");
      await renderWithFeedback();
      break;
    case "manage-profile-photo":
      try {
        await openOwnAvatarManager();
      } catch (err) {
        toast(err.message || "Unable to manage profile photo", true);
      }
      break;
    case "sign-in-google":
      try {
        await withBusyControl(el, "Connecting…", () => store.signInWithGoogle());
      } catch (err) {
        toast(err.message || "Sign-in failed", true);
      }
      break;
    case "notification-open": {
      if (controlBusy.has(el)) break;
      const destination = el.dataset.destination || "#/account";
      if (el.dataset.notificationRead !== "true") {
        try {
          await withBusyControl(
            el,
            "Opening…",
            () => store.markNotificationRead(el.dataset.notificationId),
            { replaceLabel: false, announceWithoutReplacing: true }
          );
        } catch {
          toast("Failed to mark notification read", true);
          break;
        }

        if (parseHash()[0] === "notifications" && notificationRouteRows) {
          ++renderGeneration;
          notificationRouteRows = notificationRouteRows.filter(
            (row) => row.id !== el.dataset.notificationId
          );
          viewEl.innerHTML = await views.viewNotifications(new Date(), notificationRouteRows);
          commitNotificationCount(
            notificationRouteRows.filter((row) => !row.read_at).length,
            true
          );
        }
      }

      // The successful read is removed from the unread-only window before the
      // single hashchange route path renders and reports destination failures.
      // A successful mark-read must never be relabelled as failed because the
      // destination itself could not load.
      location.hash = destination;
      break;
    }
    case "revoke-member": {
      const viewer = store.currentUser();
      if (!viewer || !["superadmin", "super_admin"].includes(viewer.role) || viewer.id === el.dataset.user) break;
      const name = el.dataset.memberName || "this member";
      if (!window.confirm(`Revoke ${name}’s access and move them to Pending?`)) break;
      let refreshResult = null;
      try {
        await withBusyControl(el, "Revoking…", async () => {
          if (isLive()) {
            await store.updateProfileRole(el.dataset.user, "pending");
          } else if (!store.setRole(el.dataset.user, "pending")) {
            throw new Error("Unable to confirm revoked access.");
          }
          refreshResult = await refreshAfterAdminMutation(`${name} moved to Pending.`);
        });
        if (refreshResult && !refreshResult.refreshed) lockAdminMutationControls(el);
      } catch (err) {
        toast(err.message || "Unable to revoke access", true);
      }
      break;
    }
    case "approve":
    case "decline": {
      if (el.disabled) break;
      const name = el.dataset.applicantName || "this member";
      if (action === "decline" && !window.confirm(`Decline ${name}’s membership application?`)) break;

      const decision = action === "approve" ? "member" : "declined";
      const card = el.closest("[data-approval-card]");
      const controls = [...(card?.querySelectorAll('[data-action="approve"], [data-action="decline"]') || [el])];
      const decisionError = card?.querySelector(".decision-error");
      if (decisionError) {
        decisionError.textContent = "";
        decisionError.hidden = true;
      }
      controls.forEach((control) => { control.disabled = true; });
      let mutationSucceeded = false;
      let refreshResult = null;
      try {
        await withBusyControl(el, action === "approve" ? "Approving…" : "Declining…", async () => {
          await store.decideApplication(el.dataset.user, decision);
          mutationSucceeded = true;
          refreshResult = await refreshAfterAdminMutation(action === "approve" ? "Approved." : "Declined.");
        });
        if (refreshResult && !refreshResult.refreshed && decisionError) {
          decisionError.textContent = refreshResult.message;
          decisionError.setAttribute("role", "alert");
          decisionError.hidden = false;
        }
      } catch (err) {
        const message = err.message || "Decision failed";
        if (decisionError) {
          decisionError.textContent = message;
          decisionError.setAttribute("role", "alert");
          decisionError.hidden = false;
        }
        toast(message, true);
      } finally {
        controls.forEach((control) => { control.disabled = mutationSucceeded && !refreshResult?.refreshed; });
      }
      break;
    }
    case "sched-day":
      views.scheduleState.selected = el.dataset.date;
      render();
      break;

    case "sched-week": {
      const st = views.scheduleState;
      st.weekOffset += Number(el.dataset.dir);
      st.selected = views.scheduleSelectionForWeek(todayLocal(), st.weekOffset);
      render();
      break;
    }

    case "sched-filter":
      views.scheduleState.filter = el.dataset.filter;
      render();
      break;

    case "ics": {
      const s = findSession(store.activities(), el.dataset.session);
      if (s) await downloadICS(s);
      break;
    }

    case "ics-booking": {
      const b = store.getBooking(el.dataset.booking);
      if (!b) break;
      if (!b.sessionId) {
        toast("Calendar details are not available until a venue is assigned", true);
        break;
      }
      {
        const session = b.sessionId ? store.getSession(b.sessionId) : null;
        const snapshot = b.snapshot || {};
        const dateISO = session?.dateISO ?? snapshot.dateISO;
        const time = session?.time || session?.startTime || snapshot.time || snapshot.startTime;
        if (!dateISO || !time) {
          toast("Calendar details are not available yet", true);
          break;
        }
        await downloadICS({
          id: b.sessionId,
          name: session?.name ?? snapshot.name,
          dateISO,
          time,
          durationMin: session?.durationMin ?? snapshot.durationMin,
          location: session?.location ?? snapshot.location,
          blurb: "",
        });
      }
      break;
    }

    case "signout": {
      try {
        await withBusyControl(el, "Signing out…", async () => {
          await store.signOutLive();
          toast("Signed out");
          location.hash = "#/account";
          await renderWithFeedback();
        });
      } catch (err) {
        toast(err.message || "Sign-out failed", true);
      }
      break;
    }
    case "cancel-booking":
      if (confirm("Cancel this booking? A full refund will be issued (prototype rule).")) {
        try {
          store.cancelBooking(el.dataset.booking);
          toast("Booking cancelled — refund issued");
          render();
        } catch (err) { toast(err.message || "Unable to cancel booking", true); }
      }
      break;

    case "replacement-create":
      if (controlBusy.has(el)) break;
      try {
        await withBusyControl(el, "Creating invite…", async () => {
          const request = await store.createReplacementRequest(el.dataset.booking, Date.now());
          toast(request?.cachePending
            ? "Private replacement invite created — details unavailable; retry refresh"
            : "Private replacement invite created — share it via WhatsApp");
          await renderWithFeedback();
        });
      } catch (err) { toast(err.message || "Unable to create replacement invite", true); }
      break;

    case "replacement-refresh":
      if (controlBusy.has(el)) break;
      try {
        await withBusyControl(el, "Refreshing…", async () => {
          const request = await store.refreshReplacementRequest(el.dataset.booking);
          toast(request?.cachePending
            ? "Invite created — details unavailable; retry refresh"
            : "Replacement details refreshed", !!request?.cachePending);
          await renderWithFeedback();
        });
      } catch (err) { toast(err.message || "Unable to refresh replacement details", true); }
      break;

    case "replacement-accept":
    case "replacement-decline": {
      if (controlBusy.has(el)) break;
      const accepting = action === "replacement-accept";
      try {
        await withBusyControl(el, accepting ? "Accepting…" : "Declining…", async () => {
          if (accepting) await store.acceptReplacement(el.dataset.token, Date.now());
          else await store.declineReplacement(el.dataset.token, Date.now());
          toast(accepting ? "Replacement accepted — awaiting Admin confirmation" : "Replacement declined");
          await renderWithFeedback();
        });
      } catch (err) { toast(err.message || "Unable to update replacement invite", true); }
      break;
    }

    case "replacement-cancel":
      if (controlBusy.has(el)) break;
      try {
        await withBusyControl(el, "Cancelling…", async () => {
          await store.cancelReplacement(el.dataset.request, Date.now());
          toast("Replacement invite cancelled");
          await renderWithFeedback();
        });
      } catch (err) { toast(err.message || "Unable to cancel replacement invite", true); }
      break;

    case "replacement-decision":
      if (controlBusy.has(el)) break;
      try {
        const confirming = el.dataset.confirmed === "1";
        await withBusyControl(el, confirming ? "Confirming…" : "Rejecting…", async () => {
          await store.decideReplacement(el.dataset.request, confirming, null, Date.now());
          toast(confirming ? "Replacement confirmed — attendee roster updated" : "Replacement rejected — original booking unchanged");
          await renderWithFeedback();
        });
      } catch (err) { toast(err.message || "Unable to update replacement request", true); }
      break;

    case "release-reservation":
      if (controlBusy.has(el)) break;
      if (confirm("Cancel this unpaid booking? Your spot will be released.")) {
        try {
          await withBusyControl(el, "Cancelling…", async () => {
            const released = await store.releaseReservation(el.dataset.booking);
            toast(released ? "Booking cancelled" : "Booking cannot be cancelled", !released);
            await renderWithFeedback();
          });
        } catch (err) { toast(err.message || "Unable to cancel booking", true); }
      }
      break;

    case "defer-to":
      if (confirm("Defer to this session? Your current spot will be released and your payment will carry over.")) {
        try {
          const moved = await store.deferBooking(el.dataset.booking, el.dataset.session);
          toast("Booking moved — previous spot released and payment carried over");
          location.hash = `#/booking/${moved.id}`;
          render();
        } catch (err) { toast(err.message || "Unable to move booking", true); }
      }
      break;

    case "retry-prayer-requests":
      try {
        await withBusyControl(el, "Retrying…", () => renderWithFeedback());
      } catch {
        toast("Prayer requests could not be loaded. Please try again.", true);
      }
      break;

    case "retry-admin-prayer-requests":
      try {
        await withBusyControl(el, "Retrying…", () => renderWithFeedback());
      } catch {
        toast("Prayer requests could not be loaded for Admin. Please try again.", true);
      }
      break;

    case "mark-prayer-prayed":
    case "close-admin-prayer": {
      const prayedFor = action === "mark-prayer-prayed";
      const prayerRequest = el.closest(".admin-prayer-request");
      const controls = prayerRequest?.querySelectorAll?.(
        '[data-action="mark-prayer-prayed"], [data-action="close-admin-prayer"]'
      ) || [el];
      try {
        await withBusyControl(el, prayedFor ? "Updating…" : "Closing…", async () => {
          await store.setAdminPrayerRequestStatus(
            el.dataset.prayer,
            prayedFor ? "prayed_for" : "closed"
          );
          toast(prayedFor ? "Prayer request marked as prayed for" : "Prayer request closed");
          await renderWithFeedback();
        }, { busyKey: prayerRequest || el, controls });
      } catch {
        toast("Prayer request status could not be updated. Please try again.", true);
      }
      break;
    }

    case "close-prayer-request":
    case "withdraw-prayer-request": {
      const withdrawing = action === "withdraw-prayer-request";
      const prayerRequest = el.closest(".prayer-request");
      const busyKey = prayerRequest || el;
      if (controlBusy.has(busyKey)) break;
      if (withdrawing
          && !confirm("Withdraw this request? Its text will be permanently removed.")) return;
      const controls = prayerRequest?.querySelectorAll?.(
        '[data-action="close-prayer-request"], [data-action="withdraw-prayer-request"]'
      ) || [el];
      try {
        await withBusyControl(el, withdrawing ? "Withdrawing…" : "Closing…", async () => {
          await store.setMyPrayerRequestState(
            el.dataset.prayer,
            withdrawing ? "withdraw" : "close"
          );
          toast(withdrawing ? "Prayer request withdrawn" : "Prayer request closed");
          await renderWithFeedback();
        }, { busyKey, controls });
      } catch {
        toast("Prayer request could not be updated. Please try again.", true);
      }
      break;
    }

    case "connect-interest":
      // Stub for fellowship/meal sign-ups — the real flow will notify leaders.
      toast(`Noted — a leader will reach out about ${el.dataset.topic}`);
      break;

    case "giving-amount": {
      const input = document.getElementById("give-amount");
      if (input) input.value = el.dataset.amount;
      el.closest(".chip-row")?.querySelectorAll(".chip")
        .forEach((chip) => chip.classList.toggle("active", chip === el));
      break;
    }
    case "giving-back":
      views.givingState.step = 1;
      await renderWithFeedback();
      break;
    case "giving-confirm": {
      const g = views.givingState;
      const user = store.currentUser();
      try {
        await withBusyControl(el, "Recording…", async () => {
          store.recordDonation({ userId: user?.id, name: g.name, amount: g.amount, note: g.note, ref: g.ref, campaignId: g.campaignId });
          g.step = 3;
          toast("Gift recorded — awaiting confirmation");
          await renderWithFeedback();
        });
      } catch (err) { toast(err.message || "Unable to record gift", true); }
      break;
    }
    case "giving-reset":
      views.resetGivingState();
      await renderWithFeedback();
      break;
    case "campaign-publish": {
      const form = el.closest?.("form");
      if (!form || controlBusy.has(form) || !form.reportValidity()) break;
      clearCampaignError(form);
      const payload = campaignFormPayload(form);
      const name = String(payload.title || "").trim() || "this campaign";
      if (!window.confirm(`Publish “${name}”? Approved members will be notified.`)) break;
      try {
        await withCampaignMutationControl(form, el, "Publishing…", async () => {
          const campaign = await store.saveGivingCampaign(payload);
          await store.publishGivingCampaign(campaign.id);
          await refreshAfterAdminMutation(`“${name}” published.`);
        });
      } catch (err) { showCampaignError(el, err.message); toast(err.message || "Unable to publish campaign", true); }
      break;
    }
    case "campaign-close": {
      const form = el.closest?.("form");
      if (!form || controlBusy.has(form)) break;
      const name = el.dataset.campaignName || "this campaign";
      if (!window.confirm(`Close “${name}”? Closed campaigns cannot be edited or republished.`)) break;
      try {
        await withCampaignMutationControl(form, el, "Closing…", async () => {
          await store.closeGivingCampaign(el.dataset.campaign);
          await refreshAfterAdminMutation(`“${name}” closed.`);
        });
      } catch (err) { showCampaignError(el, err.message); toast(err.message || "Unable to close campaign", true); }
      break;
    }

    case "join-waitlist":
      try {
        await withBusyControl(el, "Joining…", async () => {
          await store.joinWaitlist(store.currentUser().id, el.dataset.session);
          const pos = store.waitlistPosition(store.currentUser().id, el.dataset.session);
          toast(pos ? `You're #${pos} on the waitlist` : "Joined the waitlist");
          await renderWithFeedback();
        });
      } catch (err) { toast(err.message || "Unable to join the waitlist", true); }
      break;

    case "leave-waitlist":
      try {
        await withBusyControl(el, "Leaving…", async () => {
          await store.leaveWaitlist(store.currentUser().id, el.dataset.session);
          toast("Left the waitlist");
          await renderWithFeedback();
        });
      } catch (err) { toast(err.message || "Unable to leave the waitlist", true); }
      break;

    case "duty-claim":
      try {
        await withBusyControl(el, "Claiming…", async () => {
          await store.setDuty(store.currentUser().id, el.dataset.week);
          toast("You're on duty this week");
          await renderWithFeedback();
        });
      } catch (err) { toast(err.message || "Unable to claim collector duty", true); }
      break;

    case "confirm-payment": {
      try {
        await withBusyControl(el, "Confirming…", async () => {
          const res = await store.confirmBookingPayment(el.dataset.booking);
          toast(res ? "Payment confirmed — member notified" : "Nothing to confirm", !res);
          await renderWithFeedback();
        });
      } catch (err) { toast(err.message || "Unable to confirm payment", true); }
      break;
    }

    case "attendance-toggle": {
      const bookingId = String(el.dataset.booking || "");
      if (!bookingId || !["0", "1"].includes(el.dataset.arrived)) break;
      const arrived = el.dataset.arrived === "1";
      try {
        await withBusyControl(el, arrived ? "Marking…" : "Undoing…", async () => {
          await store.setBookingAttendance(bookingId, arrived);
          toast(arrived ? "Marked Arrived" : "Attendance reset to Expected");
          await renderWithFeedback();
        });
      } catch (err) {
        toast(err.message || "Unable to update attendance", true);
        try {
          await store.hydrateLiveOperations({ force: true });
          await renderWithFeedback();
        } catch (refreshError) {
          console.warn("Unable to refresh attendance after mutation failure", refreshError);
        }
      }
      break;
    }

    case "venue-tbc-toggle":
      try {
        await withBusyControl(el, "Updating…", async () => {
          await store.setVenueTBC(el.dataset.session, el.dataset.on === "1");
          toast(el.dataset.on === "1" ? "Venue marked TBC" : "Venue confirmed");
          await renderWithFeedback();
        });
      } catch (err) { toast(err.message || "Unable to update the venue status", true); }
      break;

    case "delete-event": {
      if (!confirm("Delete this event? Only possible before anyone books — afterwards cancel it instead.")) return;
      withBusyControl(el, "Deleting…", async () => {
        try {
          await store.deleteOneOffEvent(el.dataset.session);
          toast("Event deleted");
          await renderWithFeedback();
        } catch (err) {
          toast(err.message || "Unable to delete event", true);
        }
      }, { busyKey: el });
      break;
    }

    case "repost-rsvp": {
      if (!confirm("Reopen this event? Existing cancelled RSVPs stay cancelled, so members must RSVP again.")) return;
      await withBusyControl(el, "Reopening…", async () => {
        try {
          await store.repostRsvpEvent(el.dataset.session);
          toast("Event reopened");
          await renderWithFeedback();
        } catch (err) {
          toast(err.message || "Unable to reopen event", true);
        }
      }, { busyKey: el });
      break;
    }

    case "rsvp-join": {
      withBusyControl(el, "Counting you in…", async () => {
        try {
          await store.rsvpSession(store.currentUser()?.id, el.dataset.session);
          toast("You’re coming");
          await renderWithFeedback();
        } catch (err) {
          toast(err.message || "Unable to RSVP", true);
        }
      }, { busyKey: el });
      break;
    }

    case "rsvp-withdraw": {
      if (!confirm("Cancel your RSVP? The team is counting heads.")) return;
      withBusyControl(el, "Withdrawing…", async () => {
        try {
          await store.withdrawRsvp(el.dataset.booking);
          toast("RSVP cancelled");
          await renderWithFeedback();
        } catch (err) {
          toast(err.message || "Unable to cancel RSVP", true);
        }
      }, { busyKey: el });
      break;
    }

    case "reset-week-venue": {
      const control = el;
      withBusyControl(control, "Resetting\u2026", async () => {
        try {
          await store.setWeekVenue(el.dataset.session, {
            location: null, mapsQuery: null, meetingLat: null, meetingLng: null,
          });
          toast("Venue reset to the activity default");
          await renderWithFeedback();
        } catch (err) {
          toast(err.message || "Unable to reset venue", true);
        }
      }, { busyKey: control });
      break;
    }

    case "copy-fps":
    case "copy-reference": {
      const value = String(el.dataset.copyValue || "").trim();
      const successMessage = {
        id: "FPS ID copied",
        number: "FPS number copied",
        reference: "Payment reference copied",
        "giving-reference": "Giving reference copied",
      }[el.dataset.copyKind] || "Copied";
      if (!value || !navigator.clipboard?.writeText) {
        toast("Copy unavailable — select and copy the value manually", true);
        break;
      }
      try {
        await navigator.clipboard.writeText(value);
        toast(successMessage);
      } catch (_err) {
        toast("Copy unavailable — select and copy the value manually", true);
      }
      break;
    }

    case "copy-payment-note": {
      const note = String(el.dataset.note || "");
      if (!note.trim() || !navigator.clipboard?.writeText) {
        toast("Unable to copy payment note", true);
        break;
      }
      try {
        await navigator.clipboard.writeText(note);
        toast("Payment note copied");
      } catch {
        toast("Unable to copy payment note", true);
      }
      break;
    }

    case "copy-gym":
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(el.dataset.msg);
        toast(`Message to ${el.dataset.venueLabel || "Gym"} copied`);
      } else {
        toast("Copy unsupported on this device");
      }
      break;
  }
});

// --- Form delegation ---------------------------------------------------------------------

document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;

  if (form.dataset.form === "apply") {
    e.preventDefault();
    const docsReady = components.validateApplyDocumentAcceptance(form);
    if (!form.reportValidity() || !docsReady) return;
    const control = form.querySelector('[type="submit"]');
    await withBusyControl(control, "Submitting…", async () => {
      const fd = new FormData(form);
      const payload = Object.fromEntries(fd.entries());
      payload.photo_consent = !!fd.get("photo_consent");
      payload.waiver = !!fd.get("waiver");
      try {
        await store.saveMyApplication(payload);
        toast(form.dataset.toast || "Application submitted.");
        location.hash = "#/home";
        await renderWithFeedback();
      } catch (err) {
        toast(err.message || "Submit failed", true);
      }
    });
    return;
  }

  if (form.dataset.form === "membership-details") {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const control = form.querySelector('[type="submit"]');
    await withBusyControl(control, "Saving…", async () => {
      try {
        await store.updateMyMembershipDetails(Object.fromEntries(new FormData(form).entries()));
        toast("Membership details saved");
        location.hash = "#/account/details";
        await renderWithFeedback();
      } catch (err) {
        toast(err.message || "Unable to save membership details", true);
      }
    });
    return;
  }

  if (form.id === "form-privacy") {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const control = form.querySelector('[type="submit"]');
    await withBusyControl(control, "Saving…", async () => {
      try {
        const entries = Object.fromEntries(new FormData(form).entries());
        const enabled = !!entries.web_push_ops;
        await store.updateMyPrivacyPreferences(entries);
        if (isLive()) {
          try {
            const pushResult = await syncWebPushSubscription({ enabled });
            if (enabled && pushResult?.endpoint) {
              toast("Privacy preferences saved — browser push on");
              location.hash = "#/account/privacy";
              await renderWithFeedback();
              return;
            }
          } catch (pushErr) {
            if (enabled) {
              // Prefer stays saved; surface push setup failure separately.
              console.error("[itc web-push]", pushErr);
              toast(pushErr.message || "Privacy saved, but browser push was not enabled", true);
              location.hash = "#/account/privacy";
              await renderWithFeedback();
              return;
            }
          }
        } else if (enabled) {
          toast("Privacy saved locally — web push needs live Supabase mode", true);
          location.hash = "#/account/privacy";
          await renderWithFeedback();
          return;
        }
        toast("Privacy preferences saved");
        location.hash = "#/account/privacy";
        await renderWithFeedback();
      } catch (err) {
        toast(err.message || "Unable to save privacy preferences", true);
      }
    });
    return;
  }

  const formAction = form.id || form.dataset.action;

  switch (formAction) {
    case "form-magic-link": {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const email = form.querySelector('[name="email"]');
      const control = form.querySelector('[type="submit"]');
      const emailValue = new FormData(form).get("email");
      showMagicLinkFeedback(form, "");
      await withBusyControl(control, "Sending…", async () => {
        try {
          await store.signInWithMagicLink(emailValue);
          showMagicLinkFeedback(
            form,
            "Check your inbox. We sent a private sign-in link. Open it on this device to continue."
          );
        } catch {
          showMagicLinkFeedback(
            form,
            "We couldn’t send the link. Wait a moment and try again.",
            true
          );
        }
      }, { controls: [email, control] });
      break;
    }

    case "form-signin": {
      e.preventDefault();
      const email = new FormData(form).get("email");
      const res = store.signIn(email);
      const errEl = form.querySelector("#signin-error");
      if (!res.ok) {
        errEl.innerHTML = `<div class="form-error">No account found for that email — apply for membership below, then sign in with the same email to check your application.</div>`;
        return;
      }
      toast(`Welcome back, ${res.user.preferredName || res.user.fullName}`);
      location.hash = /^#\/replacement\/[^/?#]+$/.test(location.hash)
        ? location.hash
        : "#/home";
      render();
      break;
    }

    case "form-apply": {
      e.preventDefault();
      const docsReady = components.validateApplyDocumentAcceptance(form);
      if (!form.reportValidity() || !docsReady) return;
      const fd = new FormData(form);
      const errEl = form.querySelector("#apply-error");
      if (donorIdProblem(fd.get("donorId"))) {
        showInlineFormError(errEl, "That Donor ID doesn’t look right — it needs a hyphen between your last name and the 4- or 5-digit number (e.g. CHUI-08879 or CHUI-8879). Please enter it again, or leave it blank if you don’t have one.");
        return;
      }
      const payload = {
        fullName: fd.get("fullName") || "",
        preferredName: fd.get("preferredName") || "",
        email: fd.get("email") || "",
        phone: fd.get("phone") || "",
        emergencyName: fd.get("emergencyName") || "",
        emergencyRelationship: fd.get("emergencyRelationship") || "",
        emergencyPhone: fd.get("emergencyPhone") || "",
        heard: fd.get("heard") || "",
        ageConfirmed: fd.get("ageConfirmed") === "on",
        mediaConsent: fd.get("mediaConsent") === "on",
        donorId: fd.get("donorId") || "",
        indemnity: fd.get("indemnity") === "on",
        indemnitySignature: fd.get("indemnitySignature") || "",
        indemnitySignedAt: fd.get("indemnitySignedAt") || "",
      };
      try {
        const res = store.applyForMembership(payload);
        if (!res.ok) {
          showInlineFormError(errEl, "An application already exists for that email — try signing in instead.");
          return;
        }
      } catch (err) {
        showInlineFormError(errEl, err.message || "Unable to submit application");
        return;
      }
      toast("Application submitted — a leader will review it");
      location.hash = "#/account";
      render();
      break;
    }

    case "form-reserve": {
      e.preventDefault();
      const user = store.currentUser();
      if (!form.dataset.session || !user || user.status !== "approved") return;
      const control = form.querySelector('[type="submit"]');
      const controls = [...form.querySelectorAll("input, button")];
      try {
        await withBusyControl(control, "Reserving…", async () => {
          const booking = await store.reserveSession(user.id, form.dataset.session);
          toast("Spot reserved — pay before the deadline");
          location.hash = `#/pay/${booking.id}`;
        }, { busyKey: form, controls });
      } catch (err) {
        toast(err.message || "Unable to reserve this spot", true);
      }
      break;
    }

    case "form-mark-paid": {
      e.preventDefault();
      const booking = store.getBooking(form.dataset.booking);
      const user = store.currentUser();
      if (!booking || !user || booking.userId !== user.id) return;
      const fd = new FormData(form);
      const control = form.querySelector('[type="submit"]');
      const controls = [...form.querySelectorAll("input, button")];
      try {
        await withBusyControl(control, "Marking paid…", async () => {
          await store.markBookingPaid(booking.id, fd.get("method"), fd.get("ref"));
          toast("Payment marked — awaiting collector confirmation");
          location.hash = `#/booking/${booking.id}`;
        }, { busyKey: form, controls });
      } catch (err) {
        toast(err.message || "Unable to mark payment", true);
      }
      break;
    }

    case "form-giving": {
      e.preventDefault();
      const fd = new FormData(form);
      const amount = Math.round(Number(fd.get("amount")));
      const name = String(fd.get("name") || "").trim();
      const errEl = form.querySelector("#giving-error");
      if (!amount || amount < 1) { errEl.innerHTML = `<div class="form-error">Enter an amount of at least HK$1.</div>`; return; }
      if (!name) { errEl.innerHTML = `<div class="form-error">Add your name so a leader can match your transfer.</div>`; return; }
      Object.assign(views.givingState, {
        step: 2, amount, name, note: String(fd.get("note") || "").trim(),
        ref: `GIVE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      });
      await renderWithFeedback();
      break;
    }

    case "form-indemnity": {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const errorEl = form.querySelector("#indemnity-error");
      const acceptButton = form.querySelector("[data-doc-submit]");
      if (!acceptButton || acceptButton.disabled) {
        showInlineFormError(errorEl, "Read the full Indemnity before confirming");
        return;
      }
      try {
        await store.acceptMyIndemnity({
          signature: fd.get("signature") || "",
          signedAt: fd.get("signedAt") || "",
          emergencyRelationship: fd.get("emergencyRelationship") || "",
        });
        toast("Indemnity accepted & confirmed");
        await renderWithFeedback();
      } catch (err) {
        showInlineFormError(errorEl, err.message || "Unable to accept the Indemnity");
      }
      break;
    }

    case "form-prayer": {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const request = String(fd.get("request") || "").trim();
      const errorEl = form.querySelector("#prayer-error");
      if (!request) {
        showInlineFormError(errorEl, "Write your prayer request first.");
        return;
      }
      errorEl.innerHTML = "";
      const control = form.querySelector('[type="submit"]');
      try {
        await withBusyControl(control, "Sending…", async () => {
          await store.submitPrayerRequest({
            request,
            anonymousToLeaders: fd.get("anonymousToLeaders") === "on",
          });
          toast("Prayer request sent privately");
          await renderWithFeedback();
        });
      } catch {
        showInlineFormError(errorEl, "Prayer request could not be sent. Please try again.");
      }
      break;
    }

    case "form-cancel-week": {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const reason = String(new FormData(form).get("reason") || "").trim();
      if (!confirm("Cancel this session? Paid bookings auto-defer; waitlists dissolve.")) return;
      const control = form.querySelector('[type="submit"]');
      const controls = [...form.querySelectorAll("input, button")];
      try {
        await withBusyControl(control, "Cancelling…", async () => {
          await store.cancelSessionWeek(form.dataset.session, reason);
          toast("Session cancelled — members notified");
          await renderWithFeedback();
        }, { busyKey: form, controls });
      } catch (err) {
        toast(err.message || "Unable to cancel the session", true);
      }
      break;
    }

    case "form-one-off-event": {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const control = form.querySelector('[type="submit"]');
      const fd = new FormData(form);
      const kind = String(fd.get("kind") || "free");
      await withBusyControl(control, "Adding…", async () => {
        try {
          await store.createOneOffEvent({
            name: fd.get("name"),
            dateISO: fd.get("date"),
            time: fd.get("time"),
            durationMin: fd.get("durationMin"),
            location: fd.get("location"),
            mapsQuery: fd.get("mapsQuery"),
            category: fd.get("category"),
            price: kind === "paid" ? Number(fd.get("price")) : 0,
            capacity: fd.get("capacity"),
          });
          toast("Event added");
          await renderWithFeedback();
        } catch (err) {
          toast(err.message || "Unable to add event", true);
        }
      }, { busyKey: form });
      break;
    }

    case "form-session-time": {
      e.preventDefault();
      const time = new FormData(form).get("time");
      const control = form.querySelector('[type="submit"]');
      const controls = [...form.querySelectorAll("input, button")];
      try {
        await withBusyControl(control, "Saving…", async () => {
          await store.setSessionTime(form.dataset.session, time);
          toast("Session time updated");
          await renderWithFeedback();
        }, { busyKey: form, controls });
      } catch (err) {
        toast(err.message || "Unable to update the session time", true);
      }
      break;
    }

    case "form-session-notice": {
      e.preventDefault();
      const notice = new FormData(form).get("notice");
      const control = form.querySelector('[type="submit"]');
      const controls = [...form.querySelectorAll("input, button")];
      try {
        await withBusyControl(control, "Posting…", async () => {
          await store.setSessionNotice(form.dataset.session, notice);
          toast("Session note posted");
          await renderWithFeedback();
        }, { busyKey: form, controls });
      } catch (err) {
        toast(err.message || "Unable to post the session note", true);
      }
      break;
    }

    case "form-payouts": {
      e.preventDefault();
      const control = form.querySelector('[type="submit"]');
      const controls = [...form.querySelectorAll("input, button")];
      const fd = new FormData(form);
      await withBusyControl(control, "Saving…", async () => {
        try {
          const member = store.currentUser();
          const renderedFpsPhone = String(form.dataset.fpsPhone || member?.phone || "").trim();
          await store.updateCollectorPayouts(member.id, {
            paymeLink: fd.get("paymeLink"),
            fpsPhone: renderedFpsPhone,
          });
          toast("Payout details saved");
          await renderWithFeedback();
        } catch (err) {
          toast(err.message || "Unable to save payout details", true);
        }
      }, { busyKey: form, controls });
      break;
    }

    case "form-gym-note": {
      e.preventDefault();
      try {
        await store.confirmGymBooking(form.dataset.session, new FormData(form).get("note"));
        toast("Marked confirmed with the gym");
        render();
      } catch (err) {
        toast(err.message || "Unable to record gym confirmation", true);
      }
      break;
    }

    case "form-week-venue": {
      e.preventDefault();
      const control = form.querySelector('[type="submit"]');
      const controls = [...form.querySelectorAll("input, button")];
      const fd = new FormData(form);
      const location = String(fd.get("location") || "").trim();
      const enteredMapsQuery = String(fd.get("mapsQuery") || "").trim();
      const mapsQuery = location.toUpperCase() === "TBC"
        ? ""
        : (enteredMapsQuery || location);
      await withBusyControl(control, "Saving\u2026", async () => {
        try {
          await store.setWeekVenue(form.dataset.session, {
            location: location.toUpperCase() === "TBC" ? "TBC" : location,
            mapsQuery,
            meetingLat: location.toUpperCase() === "TBC" ? null : fd.get("meetingLat"),
            meetingLng: location.toUpperCase() === "TBC" ? null : fd.get("meetingLng"),
          });
          toast("Venue saved for this week");
          await renderWithFeedback();
        } catch (err) {
          toast(err.message || "Unable to save venue", true);
        }
      }, { busyKey: form, controls });
      break;
    }

    case "form-campaign": {
      e.preventDefault();
      if (controlBusy.has(form) || !form.reportValidity()) return;
      const control = form.querySelector('[type="submit"]');
      clearCampaignError(form);
      await withCampaignMutationControl(form, control, "Saving…", async () => {
        try {
          const campaign = await store.saveGivingCampaign(campaignFormPayload(form));
          toast(form.dataset.campaign ? "Campaign saved." : "Campaign draft created.");
          location.hash = `#/admin/campaign/${campaign.id}`;
          await renderWithFeedback();
        } catch (err) { showCampaignError(control, err.message); toast(err.message || "Unable to save campaign", true); }
      });
      break;
    }

    case "form-announcement-publish": {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const control = form.querySelector('[type="submit"]');
      await withBusyControl(control, "Publishing…", async () => {
        try {
          const title = fd.get("title");
          const body = fd.get("body");
          const photoUrl = fd.get("photo_url");
          await store.publishAnnouncement({ title, body, photoUrl });
          toast("Announcement published");
          location.hash = "#/community/announcements";
          await renderWithFeedback();
        } catch (err) {
          toast(err.message || "Unable to publish announcement", true);
        }
      });
      break;
    }

    case "form-activity": {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const res = store.saveActivity({
        id: form.dataset.activity || "",
        name: String(fd.get("name") || "").trim(),
        kind: fd.get("kind"),
        category: fd.get("category"),
        weekday: fd.get("weekday"),
        time: fd.get("time") || "19:00",
        durationMin: fd.get("durationMin"),
        location: String(fd.get("location") || "").trim(),
        mapsQuery: String(fd.get("location") || "").trim(),
        blurb: String(fd.get("blurb") || "").trim(),
        memberNote: String(fd.get("memberNote") || "").trim(),
        photo: "../assets/itc/main.webp",
        price: fd.get("price"),
        capacity: fd.get("capacity"),
        published: fd.get("published") === "on",
      });
      toast(res.created ? "Activity created" : "Activity saved");
      location.hash = "#/admin/activities";
      render();
      break;
    }
  }
});

// --- Change delegation (selects) ------------------------------------------------------------

document.addEventListener("change", async (e) => {
  const el = e.target.closest("[data-change]");
  if (!el) return;

  switch (el.dataset.change) {
    case "set-role": {
      const viewer = store.currentUser();
      if (!viewer || !["superadmin", "super_admin"].includes(viewer.role) || viewer.id === el.dataset.user) break;
      const labels = { member: "Member", admin: "Admin", superadmin: "Super Admin" };
      const name = el.dataset.memberName || "this member";
      const targetLabel = labels[el.value];
      if (!window.confirm(`Change ${name}’s role to ${targetLabel}?`)) {
        el.value = el.dataset.currentRole;
        break;
      }
      let refreshResult = null;
      try {
        await withBusyControl(el, "Updating…", async () => {
          if (isLive()) {
            const liveRole = el.value === "superadmin" ? "super_admin" : el.value;
            await store.updateProfileRole(el.dataset.user, liveRole);
          } else if (!store.setRole(el.dataset.user, el.value)) {
            throw new Error("Unable to confirm the role change.");
          }
          refreshResult = await refreshAfterAdminMutation(`${name} is now ${targetLabel}.`);
        });
        if (refreshResult && !refreshResult.refreshed) lockAdminMutationControls(el);
      } catch (err) {
        el.value = el.dataset.currentRole;
        toast(err.message || "Unable to change role", true);
      }
      break;
    }

    case "duty-set":
      if (el.value) {
        try {
          await withBusyControl(el, "Updating…", async () => {
            await store.setDuty(el.value, el.dataset.week);
            toast("Duty handed over");
            await renderWithFeedback();
          });
        } catch (err) {
          toast(err.message || "Unable to hand over collector duty", true);
        }
      }
      break;

    case "kind-toggle":
      form_kind_toggle(el);
      break;
  }
});

function form_kind_toggle(select) {
  const form = select.closest("form");
  if (!form) return;
  const isPaid = select.value === "paid";
  form.querySelectorAll(".paid-only").forEach((block) => block.classList.toggle("hidden", !isPaid));
}

// --- Boot ---------------------------------------------------------------------------------------

function consumeAuthCallbackError() {
  const params = new URLSearchParams(location.search);
  const error = params.get("error");
  const code = params.get("error_code");
  const description = params.get("error_description");
  if (!error && !code && !description) return null;
  params.delete("error");
  params.delete("error_code");
  params.delete("error_description");
  const query = params.toString();
  history.replaceState(
    history.state,
    "",
    `${location.pathname}${query ? `?${query}` : ""}${location.hash}`
  );
  if (code === "bad_oauth_state" || /oauth state has expired/i.test(description || "")) {
    return "That Google sign-in expired. Please try signing in again.";
  }
  const detail = String(description || code || error || "")
    .replace(/\+/g, " ")
    .trim();
  return detail ? `Sign-in failed: ${detail}` : "Sign-in failed. Please try again.";
}

async function boot() {
  store.load();
  const authCallbackError = consumeAuthCallbackError();
  // Live mode: hydrate the synchronous view model before the first render
  // so Home renders with the correct signed-in state. The callback lock
  // is held by Supabase's own handler, so getCurrentUser() must not run
  // while it is held.
  if (isLive()) {
    let bootError = null;
    try {
      await store.getCurrentUser();
      await store.fetchApplicationForUser(store.currentUser());
      await syncApprovedGoogleAvatar({ ifMissing: true });
      await store.hydrateLiveOperations({ ensureWindow: true });
    } catch (err) {
      bootError = err;
    }
    if (authCallbackError) toast(authCallbackError, true);
    if (bootError) {
      toast(bootError.message || "Application read failed", true);
    }
  } else if (authCallbackError) {
    toast(authCallbackError, true);
  }
  const startup = store.startupRoute(location.hash, store.currentUser()?.id);
  if (startup !== location.hash) replaceRoute(startup);
  window.addEventListener("hashchange", async () => {
    const generation = ++renderGeneration;
    // The Payment/Auth baseline hydrates identity before rendering. Commit
    // Notifications chrome synchronously so direct inbox navigation still
    // exposes its active state while that hydration is in flight.
    if (parseHash()[0] === "notifications") {
      const user = store.currentUser();
      pendingNotificationRouteRequest = user
        ? store.listMyNotifications()
        : Promise.resolve([]);
      renderNotificationChrome(user, true, generation, pendingNotificationRouteRequest);
    } else {
      pendingNotificationRouteRequest = null;
    }
    viewEl.setAttribute("aria-busy", "true");
    const routeLoader = document.getElementById("route-loader");
    const loaderTimer = setTimeout(() => {
      if (generation === renderGeneration && routeLoader) routeLoader.hidden = false;
    }, 300);
    let navError = null;
    if (isLive()) {
      try {
        await store.getCurrentUser();
        await store.fetchApplicationForUser(store.currentUser());
      } catch (err) {
        navError = err;
      }
    }
    if (navError) {
      toast(navError.message || "Application read failed", true);
    }
    // Do not commit if a newer navigation arrived while we were waiting.
    if (generation !== renderGeneration) {
      // Older listener: let the latest nav own the busy state and the DOM.
      return;
    }
    clearTimeout(loaderTimer);
    try {
      await renderWithFeedback();
    } catch (err) {
      toast(err.message || "Unable to load your account", true);
    }
  });

  // Mobile app switching can relaunch the installed app without its hash.
  // Recover the last committed route in that case. An intact non-Payment
  // route needs no work; Payment still refreshes its least-privilege collector
  // details whenever the member returns from PayMe.
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    const resumedRoute = store.startupRoute(location.hash, store.currentUser()?.id);
    const recoveredRoute = resumedRoute !== location.hash;
    if (recoveredRoute) replaceRoute(resumedRoute);
    if (!recoveredRoute && parseHash()[0] !== "pay") return;
    try {
      await renderWithFeedback();
    } catch (err) {
      toast(err.message || "Unable to refresh the current page", true);
    }
  });

  // Supabase may emit SIGNED_IN again when an existing session regains focus.
  // Refresh identity without replacing the current route; only a pending
  // applicant still needs the follow-up redirect to /apply.
  if (isLive() && supabase) {
    supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN") return;
      setTimeout(async () => {
        try {
          await store.getCurrentUser();
          await syncApprovedGoogleAvatar({ ifMissing: true });
          await renderWithFeedback();
          await maybeRedirectToApply();
        } catch (err) {
          toast(err.message || "Sign-in failed", true);
        }
      }, 0);
    });
  }

  await renderWithFeedback();
  if (isLive()) await maybeRedirectToApply();
}

export const bootPromise = boot().catch((err) => {
  console.error("Boot failed", err);
  const message = err?.message || String(err) || "Startup failed";
  toast(message, true);
  throw err;
});
