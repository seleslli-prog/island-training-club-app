import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  avatarInitials,
  avatarMarkup,
  clampCrop,
  cropSourceRect,
  fitCrop,
  normalizeAvatarPresentation,
} from "./js/avatar.js";
import {
  AVATAR_FILE_ACCEPT,
  moveCropByKey,
  openAvatarManager,
  renderCropToJpeg,
} from "./js/avatar-cropper.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.disabled = false;
    this.hidden = false;
    this.value = "";
    this.files = [];
    this.textContent = "";
    this.className = "";
    this.width = 0;
    this.height = 0;
  }

  append(...children) {
    for (const child of children) {
      if (!child || typeof child === "string") continue;
      child.parentNode = this;
      this.children.push(child);
    }
  }

  appendChild(child) {
    this.append(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async emit(type, properties = {}) {
    const event = {
      type,
      target: this,
      currentTarget: this,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
      ...properties,
    };
    for (const listener of this.listeners.get(type) ?? []) await listener(event);
    return event;
  }

  click() {
    return this.emit("click");
  }

  focus() {
    this.ownerDocument.activeElement = this;
    this.focusCount = (this.focusCount ?? 0) + 1;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  matches(selector) {
    if (selector.startsWith(".")) return this.className.split(/\s+/).includes(selector.slice(1));
    const dataMatch = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
    if (dataMatch) return this.getAttribute(dataMatch[1]) === dataMatch[2];
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }

  setPointerCapture() {}
  releasePointerCapture() {}
}

class FakeDocument {
  constructor() {
    this.activeElement = null;
    this.body = new FakeElement("body", this);
    this.body.style = {};
    this.canvasLog = [];
  }

  createElement(tagName) {
    const element = new FakeElement(tagName, this);
    if (tagName === "canvas") {
      element.getContext = () => ({
        clearRect: () => {},
        drawImage: (...args) => this.canvasLog.push({ canvas: element, args }),
      });
      element.toBlob = (callback, type, quality) => {
        this.lastBlobRequest = { canvas: element, type, quality };
        callback(this.blobFactory ? this.blobFactory(type) : new Blob(["jpeg"], { type }));
      };
    }
    return element;
  }
}

const SIGNED_URL = "https://project.supabase.co/storage/v1/object/sign/profile-avatars/member/custom.jpg?token=signed-token";

test("initials handle empty, single, and multi-word names", () => {
  assert.equal(avatarInitials(""), "?");
  assert.equal(avatarInitials("  Cher  "), "C");
  assert.equal(avatarInitials("Ada Lovelace"), "AL");
  assert.equal(avatarInitials("Ada Byron Lovelace"), "AL");
});

test("presentation accepts only private HTTPS signed avatar URLs", () => {
  assert.deepEqual(
    normalizeAvatarPresentation({
      url: SIGNED_URL,
      source: "custom",
      state: "active",
      expiresAt: "2026-09-17T10:10:00.000Z",
    }),
    {
      url: SIGNED_URL,
      source: "custom",
      state: "active",
      expiresAt: "2026-09-17T10:10:00.000Z",
    },
  );

  for (const url of [
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "https://lh3.googleusercontent.com/a/provider-photo",
    "https://evil.invalid/avatar.jpg",
    "https://evil.invalid/storage/v1/object/sign/profile-avatars/avatar.jpg?token=fake",
    "https://project.supabase.co/storage/v1/object/public/profile-avatars/avatar.jpg",
    "http://project.supabase.co/storage/v1/object/sign/profile-avatars/avatar.jpg?token=x",
  ]) {
    assert.deepEqual(
      normalizeAvatarPresentation({ url, source: "google", state: "active" }),
      { url: null, source: "initials", state: "active", expiresAt: null },
    );
  }
});

test("hidden and malformed presentation states always normalize to initials", () => {
  assert.deepEqual(
    normalizeAvatarPresentation({ url: SIGNED_URL, source: "custom", state: "hidden" }),
    { url: null, source: "initials", state: "hidden", expiresAt: null },
  );
  for (const state of [undefined, null, "visible", 1]) {
    assert.deepEqual(
      normalizeAvatarPresentation({ url: SIGNED_URL, source: "custom", state }),
      { url: null, source: "initials", state: "hidden", expiresAt: null },
    );
  }
});

test("avatar markup escapes content and keeps an independent initials sibling", () => {
  const html = avatarMarkup({
    name: `Ada <Admin> & "Coach"`,
    presentation: { url: SIGNED_URL, source: "custom", state: "active" },
    size: 48,
    className: "attendee-avatar unsafe<script>",
  });
  assert.match(html, /class="avatar attendee-avatar"/);
  assert.doesNotMatch(html, /unsafe<script>/);
  assert.match(html, /alt="Ada &lt;Admin&gt; &amp; &quot;Coach&quot;&#39;s profile photo"/);
  assert.match(html, /width="48" height="48"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /class="avatar__initials"/);
  assert.doesNotMatch(html, /onerror=/i);
});

test("decorative eager avatar emits empty alt and omits lazy loading", () => {
  const html = avatarMarkup({
    name: "Ada Lovelace",
    presentation: { url: SIGNED_URL, source: "custom", state: "active" },
    decorative: true,
    eager: true,
  });
  assert.match(html, /alt=""/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /fetchpriority="high"/);
  assert.doesNotMatch(html, /loading="lazy"/);
});

test("initials fallback omits image markup", () => {
  const html = avatarMarkup({
    name: "Ada Lovelace",
    presentation: { url: "https://evil.invalid/photo", source: "custom", state: "active" },
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="Ada Lovelace&#39;s profile photo"/);
  assert.match(html, />AL</);
});

test("fitCrop centers portrait and landscape sources for a square viewport", () => {
  const portrait = fitCrop({ imageWidth: 1000, imageHeight: 2000, viewportSize: 300 });
  assert.equal(portrait.offsetX, 0);
  assert.equal(portrait.offsetY, 0);
  assert.equal(portrait.zoom, 1);
  assert.equal(portrait.outputSize, 512);
  assert.deepEqual(cropSourceRect(portrait), { sx: 0, sy: 500, sw: 1000, sh: 1000 });

  const landscape = fitCrop({ imageWidth: 2000, imageHeight: 1000, viewportSize: 300 });
  assert.deepEqual(cropSourceRect(landscape), { sx: 500, sy: 0, sw: 1000, sh: 1000 });
});

test("clampCrop enforces zoom bounds and keeps image covering viewport", () => {
  const base = fitCrop({ imageWidth: 2000, imageHeight: 1000, viewportSize: 300 });
  const clamped = clampCrop({ ...base, zoom: 99, offsetX: 99999, offsetY: -99999 });
  assert.equal(clamped.zoom, 4);
  assert.equal(clamped.offsetX, 1050);
  assert.equal(clamped.offsetY, -450);

  const minimum = clampCrop({ ...base, zoom: 0.1, offsetX: 999, offsetY: 100 });
  assert.equal(minimum.zoom, 1);
  assert.equal(minimum.offsetX, 150);
  assert.equal(minimum.offsetY, 0);
});

test("cropSourceRect reflects clamped drag and zoom without changing output intent", () => {
  const base = fitCrop({ imageWidth: 1000, imageHeight: 2000, viewportSize: 300 });
  const moved = clampCrop({ ...base, zoom: 2, offsetY: 150 });
  assert.deepEqual(cropSourceRect(moved), { sx: 250, sy: 500, sw: 500, sh: 500 });
  assert.equal(moved.outputSize, 512);
});

test("crop renderer uses a 512-square canvas and JPEG blob output", async () => {
  const documentRef = new FakeDocument();
  const crop = fitCrop({ imageWidth: 1200, imageHeight: 800, viewportSize: 280 });
  const blob = await renderCropToJpeg({ image: {}, crop, documentRef });
  assert.equal(blob.type, "image/jpeg");
  assert.equal(documentRef.lastBlobRequest.canvas.width, 512);
  assert.equal(documentRef.lastBlobRequest.canvas.height, 512);
  assert.equal(documentRef.lastBlobRequest.type, "image/jpeg");
  assert.equal(documentRef.canvasLog.at(-1).args.at(-1), 512);
});

test("keyboard crop movement respects zoom and drag bounds", () => {
  const base = fitCrop({ imageWidth: 2000, imageHeight: 1000, viewportSize: 300 });
  assert.equal(moveCropByKey(base, { key: "ArrowRight" }).offsetX, 8);
  assert.equal(moveCropByKey(base, { key: "ArrowDown", shiftKey: true }).offsetY, 0);
  const zoomed = clampCrop({ ...base, zoom: 4, offsetX: 1050 });
  assert.equal(moveCropByKey(zoomed, { key: "ArrowRight", shiftKey: true }).offsetX, 1050);
  assert.equal(moveCropByKey(base, { key: "Enter" }), base);
});

test("manager uses the standard picker and suppresses duplicate saves", async () => {
  const documentRef = new FakeDocument();
  const trigger = documentRef.createElement("button");
  documentRef.body.append(trigger);
  trigger.focus();
  let releaseCount = 0;
  let uploadCount = 0;
  let resolveUpload;
  const uploaded = new Promise((resolve) => { resolveUpload = resolve; });

  openAvatarManager({
    memberName: "Ada Lovelace",
    presentation: { url: null, source: "initials", state: "active" },
    moderated: false,
    onUpload: async () => {
      uploadCount += 1;
      await uploaded;
      return { url: SIGNED_URL, source: "custom", state: "active" };
    },
    onRemove: async () => ({ url: null, source: "initials", state: "active" }),
  }, {
    documentRef,
    decodeImage: async () => ({
      image: { width: 1000, height: 800 },
      release: () => { releaseCount += 1; },
    }),
    renderCrop: async () => new Blob(["jpeg"], { type: "image/jpeg" }),
  });

  const overlay = documentRef.body.children.at(-1);
  assert.equal(overlay.querySelector('[data-avatar-title="manager"]').textContent, "Manage Profile Photo");
  assert.match(overlay.querySelector('[data-avatar-fallback="copy"]').textContent, /initials/i);
  const picker = overlay.querySelector('[data-avatar-action="picker"]');
  assert.equal(picker.getAttribute("accept"), AVATAR_FILE_ACCEPT);
  assert.equal(picker.getAttribute("capture"), null);
  picker.files = [{ name: "portrait.webp", type: "image/webp", size: 1024 }];
  await picker.emit("change");

  const zoom = overlay.querySelector('[data-avatar-action="zoom"]');
  assert.equal(zoom.getAttribute("min"), "1");
  assert.equal(zoom.getAttribute("max"), "4");
  const save = overlay.querySelector('[data-avatar-action="save"]');
  const firstSave = save.click();
  const duplicateSave = save.click();
  await duplicateSave;
  assert.equal(uploadCount, 1);
  assert.equal(save.disabled, true);
  resolveUpload();
  await firstSave;
  assert.equal(releaseCount, 1);
  assert.equal(trigger.focusCount, 2);
  assert.equal(documentRef.body.children.includes(overlay), false);
});

test("manager shows the current profile photo until a new crop is selected", async () => {
  const documentRef = new FakeDocument();
  const manager = openAvatarManager({
    memberName: "Ada Lovelace",
    presentation: { url: SIGNED_URL, source: "google", state: "active" },
    onUpload: async () => null,
    onRemove: async () => null,
  }, {
    documentRef,
    decodeImage: async () => ({ image: { width: 900, height: 1200 }, release() {} }),
  });
  const overlay = documentRef.body.children.at(-1);
  const stage = overlay.querySelector('[data-avatar-action="crop"]');
  const currentImage = stage.querySelector(".avatar-crop-current-image");
  const initials = stage.querySelector(".avatar-crop-current-initials");
  const canvas = stage.querySelector(".avatar-crop-canvas");
  const status = overlay.querySelector(".avatar-manager-status");
  assert.equal(currentImage.getAttribute("src"), SIGNED_URL);
  assert.equal(stage.getAttribute("data-cropping"), "false");
  assert.equal(currentImage.hidden, false);
  assert.equal(initials.hidden, true);
  assert.equal(canvas.hidden, true);
  assert.equal(status.textContent, "");

  const picker = overlay.querySelector('[data-avatar-action="picker"]');
  picker.files = [{ name: "replacement.webp", type: "image/webp", size: 1000 }];
  await picker.emit("change");
  assert.equal(currentImage.hidden, true);
  assert.equal(initials.hidden, true);
  assert.equal(canvas.hidden, false);
  assert.equal(stage.getAttribute("data-cropping"), "true");
  await currentImage.emit("error");
  assert.equal(initials.hidden, true, "a late current-image failure must not cover the selected crop");
  assert.match(status.textContent, /Photo ready/);
  manager.close();
});

test("Google-only presentation explains fallback and cannot offer custom removal", () => {
  const documentRef = new FakeDocument();
  const manager = openAvatarManager({
    memberName: "Grace Hopper",
    presentation: { url: SIGNED_URL, source: "google", state: "active" },
    onUpload: async () => null,
    onRemove: async () => { throw new Error("must not run"); },
  }, { documentRef });
  const overlay = documentRef.body.children.at(-1);
  assert.match(overlay.querySelector('[data-avatar-fallback="copy"]').textContent, /Google account photo/i);
  assert.equal(overlay.querySelector('[data-avatar-action="remove"]').disabled, true);
  manager.close();
});

test("manager close cleans decoded image resources and restores focus", async () => {
  const documentRef = new FakeDocument();
  const trigger = documentRef.createElement("button");
  documentRef.body.append(trigger);
  trigger.focus();
  let releaseCount = 0;
  const manager = openAvatarManager({
    memberName: "Ada Lovelace",
    presentation: { url: null, source: "initials", state: "hidden" },
    moderated: true,
    onUpload: async () => null,
    onRemove: async () => null,
  }, {
    documentRef,
    decodeImage: async () => ({
      image: { width: 800, height: 1200 },
      release: () => { releaseCount += 1; },
    }),
  });
  const overlay = documentRef.body.children.at(-1);
  const picker = overlay.querySelector('[data-avatar-action="picker"]');
  picker.files = [{ name: "portrait.jpg", type: "image/jpeg", size: 1000 }];
  await picker.emit("change");
  manager.close();
  manager.close();
  assert.equal(releaseCount, 1);
  assert.equal(trigger.focusCount, 2);
  assert.equal(documentRef.body.style.overflow, "");
});

test("crop renderer rejects missing or oversized JPEG output", async () => {
  const crop = fitCrop({ imageWidth: 512, imageHeight: 512, viewportSize: 280 });
  const missing = new FakeDocument();
  missing.blobFactory = () => null;
  await assert.rejects(renderCropToJpeg({ image: {}, crop, documentRef: missing }), /could not be created/);

  const oversized = new FakeDocument();
  oversized.blobFactory = (type) => new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type });
  await assert.rejects(renderCropToJpeg({ image: {}, crop, documentRef: oversized }), /larger than 2 MB/);
});

test("short crop dialogs scroll without compressing the preview into actions", () => {
  const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const bodyRule = styles.match(/[.]avatar-manager-body\s*\{([^}]*)\}/)?.[1] ?? "";
  const stageRule = styles.match(/[.]avatar-crop-stage\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(bodyRule, /grid-auto-rows:\s*max-content/);
  assert.match(bodyRule, /align-content:\s*start/);
  assert.match(bodyRule, /min-height:\s*0/);
  assert.match(stageRule, /--avatar-crop-size:/);
  assert.match(stageRule, /height:\s*var\(--avatar-crop-size\)/);
});

test("cropper source never persists image bytes or embeds base64 data", () => {
  const source = readFileSync(new URL("./js/avatar-cropper.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /localStorage/);
  assert.doesNotMatch(source, /base64/i);
  assert.doesNotMatch(source, /readAsDataURL/);
});

let failures = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok  ${name}`);
    console.error(error);
  }
}
if (failures) process.exitCode = 1;
else console.log(`\nAll ${tests.length} avatar smoke tests passed.`);
