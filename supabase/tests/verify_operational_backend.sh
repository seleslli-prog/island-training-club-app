#!/usr/bin/env bash
# Island Training Club — destructive disposable-database verifier for the
# shared HYROX operational backend.
#
# Mirrors verify_giving_campaigns.sh: refuses to touch any database that is
# not explicitly acknowledged as disposable, then applies every ordered
# migration and runs the schema/member/admin/atomicity/seed integration tests.
#
# Required environment:
#   ITC_OPERATIONS_TEST_DATABASE_URL  Supabase-compatible disposable database
#   ITC_ALLOW_DATABASE_RESET=1        explicit acknowledgment the target is unused
# Optional:
#   ITC_OPERATIONS_PSQL_BIN           psql binary (default: psql)
#
# Usage:
#   bash supabase/tests/verify_operational_backend.sh
#   bash supabase/tests/verify_operational_backend.sh --safety-check-only
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
psql_bin="${ITC_OPERATIONS_PSQL_BIN:-psql}"

if [[ -z "${ITC_OPERATIONS_TEST_DATABASE_URL:-}" ]]; then
  echo "ERROR: set ITC_OPERATIONS_TEST_DATABASE_URL to a disposable, empty Supabase-compatible database." >&2
  exit 2
fi
if [[ "${ITC_ALLOW_DATABASE_RESET:-}" != "1" ]]; then
  echo "ERROR: set ITC_ALLOW_DATABASE_RESET=1 to confirm the target is disposable." >&2
  exit 2
fi
if ! command -v "$psql_bin" >/dev/null 2>&1; then
  echo "ERROR: psql is required (PostgreSQL client)." >&2
  exit 2
fi

psql_cmd=("$psql_bin" "${ITC_OPERATIONS_TEST_DATABASE_URL}" -X -P pager=off -v ON_ERROR_STOP=1)

# Destructive migration verification is admitted only for an acknowledged,
# unused Supabase database. Check both baseline compatibility and freshness.
if [[ "$("${psql_cmd[@]}" -Atqc "select to_regclass('public.profiles') is null")" != "t" ]]; then
  echo "ERROR: public.profiles already exists; use a fresh disposable database." >&2
  exit 3
fi
for required in auth.users auth.uid anon authenticated; do
  case "$required" in
    auth.users) check="select to_regclass('auth.users') is not null" ;;
    auth.uid) check="select to_regprocedure('auth.uid()') is not null" ;;
    *) check="select exists (select 1 from pg_roles where rolname = '$required')" ;;
  esac
  if [[ "$("${psql_cmd[@]}" -Atqc "$check")" != "t" ]]; then
    echo "ERROR: target is not Supabase-compatible; missing $required." >&2
    exit 3
  fi
done
if [[ "$("${psql_cmd[@]}" -Atqc "select count(*) from auth.users")" != "0" ]]; then
  echo "ERROR: auth.users is not empty; refusing to modify a used database." >&2
  exit 3
fi

unexpected_public_objects="$("${psql_cmd[@]}" -Atqc "
  select count(*) from (
    select c.oid
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_class'::regclass
            and d.objid = c.oid and d.deptype = 'e'
       )
    union all
    select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_proc'::regclass
            and d.objid = p.oid and d.deptype = 'e'
       )
    union all
    select t.oid
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typrelid = 0
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_type'::regclass
            and d.objid = t.oid and d.deptype = 'e'
       )
  ) unexpected
")"
if [[ "$unexpected_public_objects" != "0" ]]; then
  echo "ERROR: public contains $unexpected_public_objects unexpected user object(s); use an empty disposable database." >&2
  exit 3
fi

echo "Safety gate passed: acknowledged disposable target; auth.users and public user objects are empty."
if [[ "${1:-}" == "--safety-check-only" ]]; then
  exit 0
fi
if [[ $# -gt 0 ]]; then
  echo "ERROR: unknown argument: $1" >&2
  exit 2
fi

# pgTAP is optional for the integration script: Task 1 ships plain SQL
# assertions, while Tasks 2+ add pgTAP-style transactional checks. The
# script itself uses raise notice to surface failures; the dispatcher
# observes any non-zero exit from psql.

for migration in "$repo_root"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$migration")"
  "${psql_cmd[@]}" --single-transaction -f "$migration" >/dev/null
done

# Disposable-database grants: the in-tree migrations do not grant on the
# auth schema or auth helpers because live Supabase ships these
# automatically. The disposable target needs them so the integration tests
# can read through RLS as the `authenticated` role.
"${psql_cmd[@]}" -c "grant usage on schema auth to authenticated;" >/dev/null
"${psql_cmd[@]}" -c "grant execute on function auth.uid() to authenticated;" >/dev/null
"${psql_cmd[@]}" -c "grant execute on function auth.jwt() to authenticated;" >/dev/null
"${psql_cmd[@]}" -c "grant execute on function auth.role() to authenticated;" >/dev/null
"${psql_cmd[@]}" -c "grant execute on function auth.email() to authenticated;" >/dev/null

echo "Running preserved admin notification integration checks"
"${psql_cmd[@]}" -f "$repo_root/supabase/tests/admin_notifications_integration.sql" >/dev/null
echo "Running Giving integration checks"
"${psql_cmd[@]}" -f "$repo_root/supabase/tests/giving_campaigns_integration.sql" >/dev/null
echo "Running shared operational backend integration checks"
"${psql_cmd[@]}" -f "$repo_root/supabase/tests/operational_backend_integration.sql"
echo "Running Island ECC signup-window integration checks"
"${psql_cmd[@]}" -f "$repo_root/supabase/tests/island_ecc_windows_integration.sql"
echo "Running bounded RSVP concurrency checks"
ITC_OPERATIONS_PSQL_BIN="$psql_bin" \
  bash "$repo_root/supabase/tests/operational_rsvp_concurrency.sh"

echo "Running pooled HYROX concurrency checks"
ITC_OPERATIONS_PSQL_BIN="$psql_bin" \
  bash "$repo_root/supabase/tests/operational_hyrox_cycle_concurrency.sh"

echo "All operational backend verifications passed."
