#!/usr/bin/env bash
# Runs scripts/pg-rbac-validation.sql with a deterministic dblink concurrency harness.
# Local Supabase only. Does not touch remote projects or apply migrations.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER="${PG_RBAC_DB_CONTAINER:-supabase_db_nexgestaovendas}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Container $CONTAINER is not running. Start local Supabase first." >&2
  exit 1
fi

# Prefer an explicit override; otherwise build a TCP/SCRAM DSN to the container IP.
if [[ -n "${PG_RBAC_DBLINK_CONNECTION:-}" ]]; then
  DBLINK_CONN="$PG_RBAC_DBLINK_CONNECTION"
else
  DB_IP="$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER" | awk 'NF{print; exit}')"
  if [[ -z "$DB_IP" ]]; then
    echo "Could not resolve container IP for $CONTAINER" >&2
    exit 1
  fi
  # Non-loopback TCP forces SCRAM so non-superuser dblink is allowed.
  DBLINK_CONN="hostaddr=${DB_IP} port=5432 dbname=postgres user=postgres password=postgres"
fi

# Escape single quotes for SQL literal.
DBLINK_SQL_LITERAL="${DBLINK_CONN//\'/\'\'}"

docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT set_config('pg_rbac.dblink_connection', '${DBLINK_SQL_LITERAL}', false);" \
  -f - < "$ROOT/scripts/pg-rbac-validation.sql"
