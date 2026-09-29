# Island ECC HYROX Slots Design

Date: 2026-09-29

## Goal

Show Saturday activities in chronological order and offer two independently
capacitated Island ECC HYROX sessions:

- 9:15 AM–10:15 AM
- 10:30 AM–11:30 AM
- Post-Training Lunch remains at 12:45 PM and therefore appears after both

Each HYROX slot costs HK$180, has capacity 30, and uses
`10/F, Island ECC, Quarry Bay`.

## Session identity

Keep `hyrox-quarry-bay` for the later slot so existing booking, receipt, queue,
notification, and deep-link references remain valid. Change its recurring time
from 11:00 AM to 10:30 AM.

Add `hyrox-quarry-bay-early` for the 9:15 AM slot. Its dated session IDs are
`hyrox-quarry-bay-early-YYYY-MM-DD`.

The two slots have separate capacities. A member may hold or queue for only one
Island ECC HYROX slot on a given date.

## Ordering

All session collections used for Schedule display are ordered by:

1. `dateISO`
2. start time
3. stable session ID

The tie-breaker makes local and live Supabase rendering deterministic even if
their source arrays arrive in different orders.

## Persistence and live data

Local state advances to v27. The migration appends the early-slot template,
changes the exact former 11:00 AM late-slot default to 10:30 AM, and updates
matching future booking snapshots without deleting existing state.

A forward-only Supabase migration expands the template ID constraint, inserts
the early template, updates the late template and future materialized late
sessions, generates the early sessions, and adds server-side cross-slot
booking/queue guards. Existing applied migrations remain unchanged.

## Administration

Both Island ECC activity IDs appear in paid-session controls and venue handoff
cards. Cards use the same chronological comparator so the early slot appears
first.

## Verification

Regression coverage proves:

- seed details for both slots
- local v27 migration behavior
- Saturday order: 9:15, 10:30, 12:45
- one-slot-per-date booking and queue rules
- live fixtures admit both Island ECC IDs while still hiding retired BFT and
  Midtown sessions
- the Supabase migration contains the template, materialization, and
  exclusivity contracts
