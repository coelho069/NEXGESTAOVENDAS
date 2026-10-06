#!/usr/bin/env bash
# Local-only proof for sandbox refund settlement. Refuses remote databases.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
db_url="${LOCAL_SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
case "$db_url" in
  *supabase.co*|*vjhdnynsbxjkqjomugww*)
    echo "refusing remote database" >&2
    exit 1
    ;;
  *127.0.0.1:54322*|*localhost:54322*)
    ;;
  *)
    echo "refusing non-local database" >&2
    exit 1
    ;;
esac

migration="$root/supabase/migrations/20261006193000_refund_sandbox_processing.sql"
rollback="$root/supabase/rollbacks/20261006193000_refund_sandbox_processing.sql"
scenario="$root/tests/sql/refund-sandbox-processing.sql"
export PGOPTIONS="-c statement_timeout=20000"

psql_cmd() {
  psql "$db_url" -X -v ON_ERROR_STOP=1 -q "$@"
}

cleanup() {
  local pid
  if [[ -n "${background_pids:-}" ]]; then
    for pid in $background_pids; do
      kill "$pid" >/dev/null 2>&1 || true
    done
  fi
  psql_cmd -c "DELETE FROM public.refund_requests WHERE id IN (
    '58321000-0000-4000-8000-0000000000e2',
    '58321000-0000-4000-8000-0000000000e4',
    '58321000-0000-4000-8000-0000000000e6',
    '58321000-0000-4000-8000-0000000000e8',
    '58321000-0000-4000-8000-0000000000ea',
    '58321000-0000-4000-8000-0000000000ec',
    '58321000-0000-4000-8000-0000000000ee',
    '58321000-0000-4000-8000-0000000000f0'
  ); DELETE FROM public.checkout_sessions WHERE id IN (
    '58321000-0000-4000-8000-0000000000e1',
    '58321000-0000-4000-8000-0000000000e3',
    '58321000-0000-4000-8000-0000000000e5',
    '58321000-0000-4000-8000-0000000000e7',
    '58321000-0000-4000-8000-0000000000e9',
    '58321000-0000-4000-8000-0000000000eb',
    '58321000-0000-4000-8000-0000000000ed',
    '58321000-0000-4000-8000-0000000000ef'
  );" >/dev/null 2>&1 || true
  psql_cmd -f "$rollback" >/dev/null 2>&1 || true
}
trap cleanup EXIT

background_pids=""
if ! psql "$db_url" -X -tA -c "SELECT 1" >/dev/null 2>&1; then
  echo "local database is not reachable; sandbox SQL was not applied" >&2
  exit 2
fi

ready="$(psql "$db_url" -X -tA -c "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'refund_requests' AND column_name = 'idempotency_key'")"
if [[ "$ready" != "1" ]]; then
  echo "local refund claim schema is absent; sandbox SQL was not applied" >&2
  exit 2
fi

psql_cmd --single-transaction -f "$migration" >/dev/null
psql_cmd -f "$scenario" >/dev/null

actor="$(psql "$db_url" -X -tA -c "SELECT onboarding_user_id FROM public.checkout_sessions WHERE id = '58321000-0000-4000-8000-0000000000ed'")"
mock="sandbox_fedcba9876543210fedcba9876543210"

wait_for_sleep() {
  local count
  local _
  for _ in $(seq 1 50); do
    count="$(psql "$db_url" -X -tA -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND query ILIKE '%pg_sleep%' AND datname = current_database()")"
    if [[ "${count:-0}" != "0" ]]; then
      return 0
    fi
    sleep 0.1
  done
  echo "timed out waiting for the local sandbox lock" >&2
  return 1
}

psql_cmd >/tmp/nex-sandbox-race-a.txt <<SQL &
BEGIN;
SELECT id FROM public.refund_requests WHERE id = '58321000-0000-4000-8000-0000000000ee' FOR UPDATE;
SELECT public.complete_sandbox_refund(
  '58321000-0000-4000-8000-0000000000ee',
  '${actor}',
  '${mock}',
  100.00,
  'BRL'
);
SELECT pg_sleep(3);
COMMIT;
SQL
background_pids="$!"
wait_for_sleep
psql_cmd -c "SELECT public.complete_sandbox_refund(
  '58321000-0000-4000-8000-0000000000ee',
  '${actor}',
  '${mock}',
  100.00,
  'BRL'
);" >/tmp/nex-sandbox-race-b.txt
wait "$background_pids"
background_pids=""

race_status="$(psql "$db_url" -X -tA -c "SELECT status FROM public.refund_requests WHERE id = '58321000-0000-4000-8000-0000000000ee'")"
race_provider="$(psql "$db_url" -X -tA -c "SELECT provider_refund_status FROM public.refund_requests WHERE id = '58321000-0000-4000-8000-0000000000ee'")"
race_attempts="$(psql "$db_url" -X -tA -c "SELECT processing_attempts FROM public.refund_requests WHERE id = '58321000-0000-4000-8000-0000000000ee'")"
race_effect="$(psql "$db_url" -X -tA -c "SELECT financial_effect FROM public.refund_requests WHERE id = '58321000-0000-4000-8000-0000000000ee'")"
race_count="$(psql "$db_url" -X -tA -c "SELECT count(*) FROM public.refund_requests WHERE mp_payment_id = '910583210408' AND status = 'refunded'")"
[[ "$race_status" == "refunded" ]]
[[ "$race_provider" == "completed" ]]
[[ "$race_attempts" == "1" ]]
[[ "$race_effect" == "f" ]]
[[ "$race_count" == "1" ]]
grep -q 'replay' /tmp/nex-sandbox-race-b.txt

psql_cmd -c "DELETE FROM public.refund_requests WHERE id IN (
  '58321000-0000-4000-8000-0000000000e2',
  '58321000-0000-4000-8000-0000000000e4',
  '58321000-0000-4000-8000-0000000000e6',
  '58321000-0000-4000-8000-0000000000e8',
  '58321000-0000-4000-8000-0000000000ea',
  '58321000-0000-4000-8000-0000000000ec',
  '58321000-0000-4000-8000-0000000000ee',
  '58321000-0000-4000-8000-0000000000f0'
); DELETE FROM public.checkout_sessions WHERE id IN (
  '58321000-0000-4000-8000-0000000000e1',
  '58321000-0000-4000-8000-0000000000e3',
  '58321000-0000-4000-8000-0000000000e5',
  '58321000-0000-4000-8000-0000000000e7',
  '58321000-0000-4000-8000-0000000000e9',
  '58321000-0000-4000-8000-0000000000eb',
  '58321000-0000-4000-8000-0000000000ed',
  '58321000-0000-4000-8000-0000000000ef'
);" >/dev/null

psql_cmd -f "$rollback" >/dev/null
dispatch_left="$(psql "$db_url" -X -tA -c "SELECT count(*) FROM pg_proc WHERE proname = 'dispatch_sandbox_refund'")"
effect_left="$(psql "$db_url" -X -tA -c "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'refund_requests' AND column_name = 'financial_effect'")"
claim_left="$(psql "$db_url" -X -tA -c "SELECT count(*) FROM pg_proc WHERE proname = 'claim_refund_processing'")"
[[ "$dispatch_left" == "0" ]]
[[ "$effect_left" == "0" ]]
[[ "$claim_left" == "1" ]]
echo "local sandbox refund verified"
