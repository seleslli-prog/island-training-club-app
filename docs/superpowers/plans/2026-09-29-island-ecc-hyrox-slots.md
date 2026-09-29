# Island ECC HYROX Slots Implementation Plan

Date: 2026-09-29

1. Add a shared Island ECC activity-ID set and deterministic session comparator
   in `app/js/data.js`; seed 9:15 AM and 10:30 AM sessions.
2. Advance local state to v27, migrate the recurring templates and matching
   booking snapshots, and enforce one Island ECC slot per member per date.
3. Apply the comparator to Schedule, upcoming-session, and Admin handoff lists;
   include both Island ECC activity IDs in Admin controls.
4. Add a forward Supabase migration that creates/retimes sessions and guards
   cross-slot bookings and queues.
5. Update local/live smoke fixtures, SQL integration checks, and current
   product/runbook documentation.
6. Run all relevant smoke suites, inspect the scoped diff, commit, and update
   `main`.
