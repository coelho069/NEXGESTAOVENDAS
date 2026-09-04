-- Test-only concurrency harness for scripts/pg-rbac-validation.sql.
--
-- pg_rbac.dblink_connection is a SESSION GUC (not a table). Non-superuser
-- postgres on Supabase local cannot dblink over trust/unix sockets because
-- PostgreSQL requires password-based auth for non-superuser dblink. This
-- bootstrap probes TCP endpoints that request SCRAM and sets the GUC.
--
-- Override (optional):
--   SELECT set_config(
--     'pg_rbac.dblink_connection',
--     'host=... port=54322 dbname=postgres user=postgres password=postgres',
--     false
--   );
--
-- Credentials here are the local Supabase demo defaults only. Never point this
-- harness at a remote/production database.

CREATE EXTENSION IF NOT EXISTS dblink;

CREATE OR REPLACE FUNCTION pg_temp.pg_rbac_probe_dblink(p_conn text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_conn IS NULL OR btrim(p_conn) = '' THEN
    RETURN false;
  END IF;
  BEGIN
    PERFORM dblink_connect('pg_rbac_probe', p_conn);
    PERFORM dblink_disconnect('pg_rbac_probe');
    RETURN true;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      PERFORM dblink_disconnect('pg_rbac_probe');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN false;
  END;
END;
$$;

DO $bootstrap_dblink$
DECLARE
  v_existing text := nullif(btrim(current_setting('pg_rbac.dblink_connection', true)), '');
  v_candidates text[];
  v_conn text;
  v_chosen text := NULL;
  v_listen text;
  v_host text;
BEGIN
  v_candidates := ARRAY[
    v_existing,
    -- Stable paths for `supabase start` (published 54322 + docker bridge).
    'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres',
    'hostaddr=172.17.0.1 port=54322 dbname=postgres user=postgres password=postgres',
    -- Direct to the database container's non-loopback interface (SCRAM).
    'hostaddr=172.18.0.2 port=5432 dbname=postgres user=postgres password=postgres',
    'hostaddr=172.18.0.3 port=5432 dbname=postgres user=postgres password=postgres',
    'hostaddr=172.18.0.4 port=5432 dbname=postgres user=postgres password=postgres',
    'hostaddr=172.19.0.2 port=5432 dbname=postgres user=postgres password=postgres',
    'hostaddr=172.20.0.2 port=5432 dbname=postgres user=postgres password=postgres'
  ];

  -- Prefer the address the server believes it is listening on when available.
  BEGIN
    v_listen := nullif(current_setting('listen_addresses', true), '');
  EXCEPTION WHEN OTHERS THEN
    v_listen := NULL;
  END;

  IF inet_server_addr() IS NOT NULL THEN
    v_host := host(inet_server_addr());
    IF v_host IS NOT NULL AND v_host NOT IN ('127.0.0.1', '::1') THEN
      v_candidates := array_prepend(
        format(
          'hostaddr=%s port=5432 dbname=postgres user=postgres password=postgres',
          v_host
        ),
        v_candidates
      );
    END IF;
  END IF;

  FOREACH v_conn IN ARRAY v_candidates LOOP
    IF pg_temp.pg_rbac_probe_dblink(v_conn) THEN
      v_chosen := v_conn;
      EXIT;
    END IF;
  END LOOP;

  IF v_chosen IS NULL THEN
    RAISE EXCEPTION
      'PG-RBAC concurrency harness failed: could not establish dblink TCP connection. Set pg_rbac.dblink_connection explicitly for this session.';
  END IF;

  -- Session-level so it survives COMMIT/ROLLBACK inside the validation script.
  PERFORM set_config('pg_rbac.dblink_connection', v_chosen, false);
  PERFORM set_config('pg_rbac.dblink_ready', '1', false);
  RAISE NOTICE 'PG-RBAC concurrency harness ready';
END
$bootstrap_dblink$;
