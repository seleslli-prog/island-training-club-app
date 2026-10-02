# Island ECC HYROX Signup Windows and Collector Finalize Reminders

**Date:** 2 October 2026
**Status:** Draft for review
**Branch:** `feature/hyrox-island-ecc-windows` (from `origin/main`)

## Summary

Island ECC remains the only live HYROX product, with two Saturday slots. This
change does not revive the retired BFT/Midtown pool. It adds a weekly HKT
signup clock, makes Thursday 18:00 the standard pay-by, reminds leftover
unpaid members and the collector on Friday 18:00, and asks the collector to
finalize with Island ECC and the coach by Friday 21:00 if possible.

A member may hold **one** Island ECC commitment per Saturday: reserved,
confirmed, attended, or waitlisted. They may not reserve one slot and
waitlist the other.

## Confirmed decisions

- Approach A: Thursday 18:00 HKT is the real payment deadline for original
  holds. Friday 18:00 is a leftover reminder, not a second member deadline.
- Exclusive slots: no dual hold (reserve + other waitlist). Switch-waitlist
  is out of scope.
- All timestamps are `Asia/Hong_Kong`, never the browser `setHours` local zone
  and never the legacy SQL `Thursday 15:59` wall-clock that is not 18:00 HKT.
- Feature work starts from **`origin/main`**, not `testing` and not this
  conversation’s older pool-era checkout.
- After the work is on `main`, `testing` may be fast-forwarded to `main` when
  git allows a fast-forward (see Branching).
- Shop, Giving, and merchandise stay untouched.
- Notifications stay in-app (and existing web-push fan-out if the new kinds
  are wired). No WhatsApp.

## Goals

1. Lock future Saturday Island ECC slots until Monday 18:00 HKT of that week,
   then open **both** slots together.
2. Keep one-slot-per-Saturday exclusivity for bookings, queues, and
   replacements.
3. Expire unpaid original holds at Thursday 18:00 HKT onto that slot’s
   waitlist.
4. Give post-Thursday promotions and late reserves a Friday 21:00 HKT pay-by.
5. At Friday 18:00 HKT, remind still-unpaid holders and the on-duty collector
   to finalize with Island ECC and the coach.
6. At Friday 21:00 HKT, nudge the collector again if either slot is not
   gym-finalized. Do not auto-finalize or auto-lock.
7. Match local prototype and live Supabase behaviour, with smoke and SQL
   coverage.

## Non-goals

- Switch-waitlist (hold 10:30, queue 9:15 as a move).
- Reviving BFT/Midtown pool UI, cycles, or revoked pool RPCs.
- Changing slot times, capacities, price, or venue copy.
- Real PayMe/FPS capture or refunds.
- Hard-locking Admin gym finalize at Friday 21:00.
- WhatsApp, email, or new push infrastructure.
- Fast-forwarding `testing` by force-reset if it has diverged.

## Session identity

Unchanged from the 29 September slots spec:

| Slot | Activity ID | Saturday time | Capacity | Price |
| --- | --- | --- | ---: | ---: |
| Early | `hyrox-quarry-bay-early` | 09:15–10:15 | 30 | HK$180 |
| Late | `hyrox-quarry-bay` | 10:30–11:30 | 30 | HK$180 |

Cross-slot exclusivity already exists in
`20260929000001_island_ecc_hyrox_slots.sql` (`Choose one Island ECC HYROX
slot per Saturday.`). This work keeps that contract and extends it to the
new signup-window rejects.

## Weekly timeline (HKT)

For Saturday session date `S`:

| Instant | Members | Collector |
| --- | --- | --- |
| Before Monday 18:00 of that week (`S − 5 days 18:00`) | Both slots visible, **locked**. No reserve, no waitlist. | — |
| Monday 18:00 | Both slots open. One commitment per member. | — |
| Monday 18:00 through session start | Remaining spots may still be reserved or waitlisted. | — |
| Thursday 18:00 (`S − 2 days 18:00`) | Unpaid **original** holds (not waitlist promotions) expire; waitlist promotes into the vacancy. | — |
| After Thursday 18:00 | New reserve or promotion pay-by is Friday 21:00. | — |
| Friday 18:00 (`S − 1 day 18:00`) | Reminder if still reserved and unpaid. | Reminder: finalize both lists with Island ECC and the coach. |
| Friday 21:00 (`S − 1 day 21:00`) | Leftover unpaid holds stay until collector action or session start. | Second nudge if either slot `gym_confirmed_at` is null. Operational target only. |

Drop the current local **Friday 14:00** checkpoint and **2-hour last-minute**
pay window (`finalCheckpointFor`, `LAST_MINUTE_WINDOW_MS`).

## Member experience

- Locked card/detail: **Opens Monday at 6 PM**. Reserve and Join waitlist
  are absent or disabled; the action must not call the RPC.
- Open card: existing Reserve / Pay / Waitlist.
- Pay copy uses the booking’s real deadline (Thursday 6 PM or Friday 9 PM),
  not a blanket Thursday line after Thursday.
- If the member already has an Island ECC reserved, confirmed, attended, or
  active waitlist row that Saturday, the other slot shows they are already
  registered this Saturday and cannot reserve or queue.
- Existing replacement exclusivity stays: a replacement member who already
  has a commitment that Saturday is rejected.

## Collector and Admin

- Friday 18:00 notification to the assigned weekly collector: finalize both
  Island ECC slots with the gym and the coach. Destination `#/admin/payments`.
- Friday 21:00 notification to the same collector if either Saturday slot is
  not gym-finalized.
- Finalize remains the existing per-session `finalize_operational_gym`
  control. This work does not auto-write `gym_confirmed_at`.
- Admins are not given a bypass to reserve Island ECC before Monday 18:00.

## Helpers and deadlines

Add HKT helpers next to `hktEventStartMs` (parse `YYYY-MM-DDTHH:mm:ss+08:00`).
Reuse the same instants in SQL with
`(session_date - N) + time 'HH:MM'` `at time zone 'Asia/Hong_Kong'`.

| Helper | Instant |
| --- | --- |
| `islandEccSignupOpensAt(S)` | Monday 18:00 HKT (`S − 5`) |
| `islandEccPaymentDeadlineAt(S)` | Thursday 18:00 HKT (`S − 2`) |
| `islandEccLeftoverPayByAt(S)` | Friday 21:00 HKT (`S − 1`) |
| `islandEccMemberReminderAt(S)` | Friday 18:00 HKT (`S − 1`) |
| `islandEccCollectorFinalizeNudgeAt(S)` | Friday 21:00 HKT (`S − 1`) |

`nextPayDeadline(S, now)` for Island ECC only:

- if `now < Thursday 18:00` → Thursday 18:00
- otherwise → Friday 21:00

Non-HYROX paid sessions keep their current deadline helper unless they
already share `nextPayDeadline`. If they share it, introduce an Island
ECC-specific function and leave other paid sessions on the old helper so
this change cannot retarget lunch or one-offs.

Live `reserve_operational_session` currently stamps
`(session_date - 2 days) + time '15:59'` (commented as Thursday 23:59 HK).
Replace **Island ECC** inserts and waitlist-promotion inserts with the
helpers above. Do not edit already-applied migration files; wrap or replace
the function in a new forward migration.

## Signup lock

`reserve_operational_session` and `join_operational_queue` for
`hyrox-quarry-bay-early` and `hyrox-quarry-bay` must reject with a stable
member-facing error when `now < islandEccSignupOpensAt(session_date)`, for
example `HYROX sign-up opens Monday at 6 PM HKT.`

Local `reserveSpot` / queue join must throw the same error. Schedule and
activity views must hide those actions while locked so the first failure is
not a toast after a click.

## Exclusivity

Keep the existing advisory lock on `(profile_id, session_date)` and the
reject when the member already has:

- an Island ECC booking in `reserved | confirmed | attended`, or
- an active Island ECC waitlist on **the other** slot.

Waitlisting the **same** full slot remains allowed. Waitlisting the other
slot while holding this one remains forbidden.

## Expiry and promotion

`sweep_operational_deadlines` already expires unpaid reserved rows at
`pay_deadline_at` and marks a waitlist entry promoted. For Island ECC it
must also **create** the promoted reserved booking (if the live sweep does
not already) with:

- `pay_deadline_at = nextPayDeadline(S, sweep_now)`
- the same exclusive-slot check (skip that waitlist member if they somehow
  already hold the other slot; take the next waitlist row)

Local sweep must match.

Original unpaid holds expire Thursday 18:00. Unpaid leftover holds (late
reserve or waitlist promotion) expire Friday 21:00 via the same sweep on
`pay_deadline_at`. Friday 21:00 collector gym finalize stays “if possible”:
the nudge does not write `gym_confirmed_at`.

## Notifications

Do **not** reuse retired pool kinds. `hyrox-retirement.js` hides
`operational_hyrox_payment_reminder` and
`operational_hyrox_collector_payment_reminder` for every row of those kinds.

New kinds:

| Kind | Audience | When | Destination |
| --- | --- | --- | --- |
| `operational_island_ecc_payment_reminder` | Unpaid reserved holder | Friday 18:00, once per booking | `#/pay/{bookingId}` |
| `operational_island_ecc_collector_finalize_reminder` | On-duty collector | Friday 18:00, once per Saturday | `#/admin/payments` |
| `operational_island_ecc_collector_finalize_nudge` | On-duty collector | Friday 21:00 if either slot lacks `gym_confirmed_at`, once per Saturday | `#/admin/payments` |

Copy (member): pay for this Saturday’s Island ECC HYROX by the booking
deadline shown; the Friday 18:00 send is for people still unpaid.
Copy (collector 18:00): finalize both Island ECC sessions with Island ECC
and the coach.
Copy (collector 21:00): still not finalized — please confirm with Island ECC
and the coach if possible.

Wire kinds through notification destination maps and web-push allowlists
used by current operational notifications. Honour existing HYROX payment
reminder opt-out on the member Friday 18:00 kind only.

Pool reminder RPCs stay revoked. Add new Island ECC reminder functions
(or extend the generic deadline sweep) that query Island ECC sessions, not
`operational_hyrox_cycles`.

Idempotency: persist send timestamps (booking-level for members; Saturday-
level for collector 18:00/21:00) so a second sweep does not duplicate.

## Local state

`STATE_VERSION` is 27 on `main`. Bump to **28** only to recompute
`payDeadlineAt` on unpaid future Island ECC reservations using the new
helpers. Do not resurrect pool records. Do not rewrite confirmed or past
bookings.

## Testing

- Smoke: locked future Saturday, Monday open, exclusive slot, Thursday
  expire, leftover Friday pay-by, Friday 18:00 dual reminder, Friday 21:00
  collector nudge, no pool card.
- SQL integration: HKT instants, signup reject, exclusivity, expire +
  promote with leftover deadline, reminder idempotency, retirement boundary
  still hides BFT/Midtown.
- `node app/smoke.mjs` and the operational/Island ECC SQL harness used on
  `main` must stay green.

## Branching

1. `git fetch origin`
2. Create `feature/hyrox-island-ecc-windows` from **`origin/main`**.
3. Implement on that branch (forward migration, helpers, UI, tests).
4. Merge to `main` through the usual review.
5. **Then** update `testing`:

```sh
git fetch origin
git checkout testing
git merge --ff-only origin/main
git push origin testing
```

Fast-forward succeeds only if every `testing` commit is already in `main`.
That is the expected case when `main` moved ahead after pool retirement.
If `--ff-only` fails, `testing` has unique commits: merge `origin/main`
into `testing` (merge commit), do not `--force` unless an operator
explicitly wants to discard `testing`-only history.

Do not start this feature from `origin/testing`. It is behind `main` and
may still lack later Island ECC slot work.

## Out of scope follow-ups

- Switch-waitlist between 9:15 and 10:30.
- Aligning `testing` by hard reset.
- Changing collector assignment rules.
