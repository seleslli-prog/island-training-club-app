// Reusable read-and-accept modal component.
// Owns: backdrop, focus trap, ESC-to-close, scroll-end detection,
// sticky acknowledgement button, and the acknowledgement callback.
//
// Public API:
//   SCROLL_END_THRESHOLD_PX                          — constant exported for testing
//   isAtScrollEnd(top,h,scroll)                      — pure scroll-end math
//   applyDocumentAcceptance(trigger)                 — DOM-mutation helper for the ack callback
//   validateApplyDocumentAcceptance(form)            — Submit-time unread-doc warnings
//   openReadAndAcceptModal({docKey, onAccept, trigger}) — the modal itself
//
// Documents come from the DOCUMENTS registry in documents.js. The modal is
// document-agnostic: pass any registry key and it renders that document.
//
// Pairing convention (used by the apply forms and Profile > Indemnity):
//   <div data-doc-accept="privacy">
//     <p class="muted small" data-doc-hint>Click on the highlighted link below…</p>
//     … <a data-action="open-doc" data-doc="privacy">privacy policy</a> …
//     <input … disabled data-doc-checkbox>
//     <button … disabled data-doc-submit>Accept &amp; Confirm</button>
//     <p class="form-error" data-doc-warn hidden role="alert"></p>
//   </div>
// applyDocumentAcceptance(trigger) finds the trigger's nearest
// [data-doc-accept] container and unlocks its checkbox and/or submit button —
// so several gated documents can share one form without cross-talk.

import { DOCUMENTS } from "./documents.js";

export const SCROLL_END_THRESHOLD_PX = 4;

export function isAtScrollEnd(scrollTop, clientHeight, scrollHeight) {
  return scrollTop + clientHeight >= scrollHeight - SCROLL_END_THRESHOLD_PX;
}

export function applyDocumentAcceptance(trigger) {
  const container = trigger && trigger.closest ? trigger.closest("[data-doc-accept]") : null;
  if (!container || !container.querySelector) return false;
  const checkbox = container.querySelector("[data-doc-checkbox]");
  const submit = container.querySelector("[data-doc-submit]");
  if (!checkbox && !submit) return false;
  if (checkbox) {
    checkbox.disabled = false;
    checkbox.checked = true;
  }
  if (submit) submit.disabled = false;
  const hint = container.querySelector("[data-doc-hint]");
  if (hint) hint.hidden = true;
  const warn = container.querySelector("[data-doc-warn]");
  if (warn) {
    warn.hidden = true;
    warn.textContent = "";
  }
  return true;
}

const APPLY_DOC_WARN_LABELS = {
  privacy: "privacy policy",
  guidelines: "community guidelines",
  indemnity: "Indemnity form",
};

// Returns true when every gated Apply document is unlocked and checked.
// Disabled required checkboxes are skipped by reportValidity(), so Submit
// must call this and surface [data-doc-warn] under each unread document.
export function validateApplyDocumentAcceptance(form) {
  if (!form?.querySelectorAll) return true;
  const containers = [...form.querySelectorAll("[data-doc-accept]")];
  let firstWarn = null;
  let ok = true;
  for (const container of containers) {
    const checkbox = container.querySelector("[data-doc-checkbox]");
    const warn = container.querySelector("[data-doc-warn]");
    if (!checkbox || !warn) continue;
    const accepted = !checkbox.disabled && checkbox.checked;
    if (accepted) {
      warn.hidden = true;
      warn.textContent = "";
      continue;
    }
    const key = typeof container.getAttribute === "function"
      ? (container.getAttribute("data-doc-accept") || "")
      : "";
    const label = APPLY_DOC_WARN_LABELS[key] || "document";
    warn.textContent = `Open and read the ${label} to enable acceptance.`;
    warn.hidden = false;
    ok = false;
    if (!firstWarn) firstWarn = warn;
  }
  if (firstWarn?.scrollIntoView) {
    firstWarn.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  return ok;
}

export function openReadAndAcceptModal({ docKey, onAccept, trigger } = {}) {
  const doc = DOCUMENTS[docKey];
  if (!doc) return;

  const previouslyFocused = document.activeElement;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";

  const dialog = document.createElement("div");
  dialog.className = "modal-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "doc-modal-title");

  dialog.innerHTML = `
    <header class="modal-header">
      <h2 id="doc-modal-title" class="display sm">${doc.title}</h2>
      <button type="button" class="modal-close" aria-label="Close document">×</button>
    </header>
    <div class="modal-doc">
      <div class="modal-doc-body${doc.provisional ? " doc-provisional" : ""}" tabindex="0">
        ${doc.renderBody()}
      </div>
      <footer class="modal-doc-ack">
        <p class="muted small" data-modal-hint>Scroll to the end of the document to continue.</p>
        <button type="button" class="btn" disabled data-modal-ack>I have read this document</button>
      </footer>
    </div>`;

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const body = dialog.querySelector(".modal-doc-body");
  const ackButton = dialog.querySelector("[data-modal-ack]");

  function updateAckState() {
    ackButton.disabled = !isAtScrollEnd(body.scrollTop, body.clientHeight, body.scrollHeight);
  }
  body.addEventListener("scroll", updateAckState, { passive: true });
  requestAnimationFrame(updateAckState);

  // --- focus trap ---
  function getFocusables() {
    return [...dialog.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter((el) => !el.disabled && el.offsetParent !== null);
  }
  function trapFocus(e) {
    if (e.key !== "Tab") return;
    const focusables = getFocusables();
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  dialog.addEventListener("keydown", trapFocus);
  (getFocusables()[0] || dialog).focus();

  // --- close paths ---
  function close() {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    if (previouslyFocused && typeof previouslyFocused.focus === "function") {
      previouslyFocused.focus();
    }
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  dialog.querySelector(".modal-close").addEventListener("click", close);

  // --- acknowledgement ---
  ackButton.addEventListener("click", () => {
    if (typeof onAccept === "function") onAccept(trigger || null);
    close();
  });
}
