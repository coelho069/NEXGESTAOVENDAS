#!/usr/bin/env bash
# Local-only proof for the checkout snapshot and the persistent refund claim.
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

migration="$root/supabase/migrations/20261006183000_checkout_payment_snapshot_and_refund_claim.sql"
rollback="$root/supabase/rollbacks/20261006183000_checkout_payment_snapshot_and_refund_claim.sql"
scenario="$root/tests/sql/checkout-snapshot-idempotency.sql"
export PGOPTIONS="-c statement_timeout=20000"

psql_cmd() {
  psql "$db_url" -X -v ON_ERROR_STOP=1 -q "$@"
}

restore_schema() {
  psql_cmd -f "$migration" >/dev/null
}

cleanup() {
  local pid
  if [[ -n "${background_pids:-}" ]]; then
    for pid in $background_pids; do
      kill "$pid" >/dev/null 2>&1 || true
    done
  fi
  psql_cmd -c "DELETE FROM public.refund_requests WHERE id IN (
    '58321000-0000-4000-8000-0000000000a1',
    '58321000-0000-4000-8000-0000000000a2',
    '58321000-0000-4000-8000-0000000000a3',
    '58321000-0000-4000-8000-0000000000a4',
    '58321000-0000-4000-8000-0000000000a5'
  ); DELETE FROM public.checkout_sessions WHERE id IN (
    '58321000-0000-4000-8000-000000000010',
    '58321000-0000-4000-8000-000000000012',
    '58321000-0000-4000-8000-000000000014',
    '58321000-0000-4000-8000-0000000000b1'
  );" >/dev/null || true
  restore_schema || true
}
trap cleanup EXIT

background_pids=""
psql_cmd -f "$migration" >/dev/null
psql_cmd -f "$scenario" >/dev/null

restart_key="$(psql "$db_url" -X -tA -c "SELECT idempotency_key FROM public.refund_requests WHERE id = '58321000-0000-4000-8000-0000000000a1'")"
restart_state="$(psql "$db_url" -X -tA -c "SELECT processing_state FROM public.refund_requests WHERE id = '58321000-0000-4000-8000-0000000000a1'")"
[[ "$restart_key" == "mercadopago:refund:58321000-0000-4000-8000-0000000000a1" ]]
[[ "$restart_state" == "processing" ]]

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
  echo "timed out waiting for the local claim lock" >&2
  return 1
}

psql_cmd >/tmp/nex-snapshot-race-a.txt <<'SQL' &
BEGIN;
SELECT id FROM public.checkout_sessions WHERE id = '58321000-0000-4000-8000-0000000000b1' FOR UPDATE;
SELECT public.record_checkout_payment_snapshot(
  '58321000-0000-4000-8000-0000000000b2',
  '910583210201',
  'approved',
  NULL,
  100.00,
  'BRL',
  '2026-10-06 15:00:00+00'
);
SELECT pg_sleep(3);
COMMIT;
SQL
background_pids="$!"
wait_for_sleep
psql_cmd -c "SELECT public.record_checkout_payment_snapshot(
  '58321000-0000-4000-8000-0000000000b2',
  '910583210201',
  'approved',
  NULL,
  90.00,
  'BRL',
  '2026-10-06 16:00:00+00'
);" >/tmp/nex-snapshot-race-b.txt
wait "$background_pids"
background_pids=""

race_amount="$(psql "$db_url" -X -tA -c "SELECT transaction_amount FROM public.checkout_sessions WHERE id = '58321000-0000-4000-8000-0000000000b1'")"
race_conflict="$(psql "$db_url" -X -tA -c "SELECT transaction_snapshot_conflict FROM public.checkout_sessions WHERE id = '58321000-0000-4000-8000-0000000000b1'")"
[[ "$race_amount" == "100.00" ]]
[[ "$race_conflict" == "amount" ]]

psql_cmd >/tmp/nex-refund-race-a.txt <<'SQL' &
BEGIN;
SELECT id FROM public.refund_requests WHERE id = '58321000-0000-4000-8000-0000000000a5' FOR UPDATE;
SELECT public.claim_refund_processing('58321000-0000-4000-8000-0000000000a5', false);
SELECT pg_sleep(3);
COMMIT;
SQL
background_pids="$!"
wait_for_sleep
psql_cmd -c "SELECT public.claim_refund_processing('58321000-0000-4000-8000-0000000000a5', false);" >/tmp/nex-refund-race-b.txt
wait "$background_pids"
background_pids=""

race_attempts="$(psql "$db_url" -X -tA -c "SELECT processing_attempts FROM public.refund_requests WHERE id = '58321000-0000-4000-8000-0000000000a5'")"
race_state="$(psql "$db_url" -X -tA -c "SELECT processing_state FROM public.refund_requests WHERE id = '58321000-0000-4000-8000-0000000000a5'")"
race_reason="$(psql "$db_url" -X -tA -c "SELECT count(*) FROM public.refund_requests WHERE mp_payment_id = '910583210305' AND processing_state IS NOT NULL")"
[[ "$race_attempts" == "1" ]]
[[ "$race_state" == "processing" ]]
[[ "$race_reason" == "1" ]]
grep -q 'in_progress' /tmp/nex-refund-race-b.txt

psql_cmd -c "DELETE FROM public.refund_requests WHERE id IN (
  '58321000-0000-4000-8000-0000000000a1',
  '58321000-0000-4000-8000-0000000000a2',
  '58321000-0000-4000-8000-0000000000a3',
  '58321000-0000-4000-8000-0000000000a4',
  '58321000-0000-4000-8000-0000000000a5'
); DELETE FROM public.checkout_sessions WHERE id IN (
  '58321000-0000-4000-8000-000000000010',
  '58321000-0000-4000-8000-000000000012',
  '58321000-0000-4000-8000-000000000014',
  '58321000-0000-4000-8000-0000000000b1'
);" >/dev/null

psql_cmd -f "$rollback" >/dev/null
amount_after_rollback="$(psql "$db_url" -X -tA -c "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'checkout_sessions' AND column_name = 'transaction_amount'")"
claim_after_rollback="$(psql "$db_url" -X -tA -c "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'refund_requests' AND column_name = 'idempotency_key'")"
payment_column="$(psql "$db_url" -X -tA -c "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'checkout_sessions' AND column_name = 'mp_payment_id'")"
[[ "$amount_after_rollback" == "0" ]]
[[ "$claim_after_rollback" == "0" ]]
[[ "$payment_column" == "1" ]]

restore_schema
amount_restored="$(psql "$db_url" -X -tA -c "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'checkout_sessions' AND column_name = 'transaction_amount'")"
[[ "$amount_restored" == "1" ]]
echo "local snapshot and claim verified"
