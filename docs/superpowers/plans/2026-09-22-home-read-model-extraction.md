# Home Read-Model Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Home’s session/booking selection into a testable read-model workflow while preserving its exact rendered states and Store compatibility seam.

**Architecture:** `home-workflow.js` is a pure projection that receives the viewer, a prepared Schedule window, and the current week range. It returns the existing Home heading, empty copy, and rows (including pooled HYROX bookings) without importing Store, Supabase, or the DOM. `views.js` remains responsible only for markup; `app.js` continues to obtain the Schedule window through `store.scheduleWindow()`.

**Tech Stack:** Vanilla ES modules, Node smoke scripts.

**Spec:** `docs/superpowers/specs/2026-09-22-workflow-modules-performance-design.md`

## Global Constraints

- Preserve all Home copy, links, session ordering, booking eligibility, and local/live behavior.
- Do not change avatar fetching or rendering.
- Do not add dependencies, a build step, Supabase calls, or localStorage access to the new workflow.
- Keep Store as the compatibility facade and use the existing Schedule-window model.
- Run `node app/smoke.mjs` and `node app/live-auth-smoke.mjs` before commit.

---

### Task 1: Add a pure Home projection

**Files:**
- Create: `app/js/home-workflow.js`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Consumes: `{ user, sessions, viewerBookings, weekStart, weekEnd }`.
- Produces: `{ rows, emptyMsg, weekHeading }`.
- `rows` contains original session objects and original pooled booking objects; it never transforms display fields.

- [ ] **Step 1: Write a failing test**

Add a direct import and test a confirmed direct booking plus a confirmed pooled booking. Assert the result retains only the direct session once, includes the pooled booking, returns `My Week`, and preserves the existing empty copy literal.

- [ ] **Step 2: Verify RED**

Run `node app/smoke.mjs`. Expect `ERR_MODULE_NOT_FOUND` for `app/js/home-workflow.js`.

- [ ] **Step 3: Implement the pure selector**

Create `projectHomeWeek()` with no Store imports. Use explicit `dateISO`/snapshot date extraction and the existing confirmed-status rules. Exclude direct pooled child sessions when the corresponding confirmed cycle booking is rendered.

- [ ] **Step 4: Verify GREEN**

Run `node app/smoke.mjs`. The new projection assertion and all existing smoke checks must pass.

### Task 2: Make Home consume the prepared model

**Files:**
- Modify: `app/js/views.js`
- Modify: `app/smoke.mjs`

**Interfaces:**
- `viewHome(scheduleModel?)` passes the current viewer and prepared Schedule values to `projectHomeWeek()`.
- Existing direct `viewHome()` callers continue to use Store fallback values while router calls use the bounded model.

- [ ] **Step 1: Write a failing rendered-Home test**

Build a supplied Schedule model with one confirmed direct booking and one confirmed pooled booking. Assert `viewHome(model)` includes both existing row links and does not include an unbooked session.

- [ ] **Step 2: Verify RED**

Run `node app/smoke.mjs`. Expect the direct projection/markup assertion to fail before `views.js` delegates.

- [ ] **Step 3: Delegate selection to the workflow**

Import `projectHomeWeek()` in `views.js`. Replace only Home’s visitor/pending/approved row selection with its projection output; retain all template markup and `sessionRow`/`pooledBookingRow` calls.

- [ ] **Step 4: Verify and commit**

Run:

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
git diff --check
git add app/js/home-workflow.js app/js/views.js app/smoke.mjs docs/superpowers/plans/2026-09-22-home-read-model-extraction.md
git commit -m "refactor: extract home read model"
```

Expected: both suites pass, no whitespace errors, and Home output retains its existing behavior.
