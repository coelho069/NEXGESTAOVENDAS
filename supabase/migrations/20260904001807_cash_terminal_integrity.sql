-- Blocker 5: server-authoritative cash sessions and immutable cash ledger.
--
-- Cash register mutations are online-only. Existing sales remain compatible
-- with NULL cash_session_id; the application passes a session for new
-- register-aware sales through process_sale_with_cash, whose durable sale
-- outbox reconciles the cash movement when connectivity returns.

DO $$
BEGIN
  CREATE TYPE public.cash_session_status AS ENUM ('open', 'closed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE public.cash_movement_type AS ENUM (
    'sale_cash',
    'supply',
    'withdrawal',
    'adjustment'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS stores_id_org_key
  ON public.stores (id, org_id);

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS cash_session_id uuid;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS store_id uuid,
  ADD COLUMN IF NOT EXISTS cash_session_id uuid;

UPDATE public.payments p
SET store_id = s.store_id
FROM public.sales s
WHERE s.id = p.sale_id
  AND p.store_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.payments p
    LEFT JOIN public.sales s
      ON s.id = p.sale_id
    WHERE p.store_id IS NULL
       OR s.id IS NULL
       OR p.org_id IS DISTINCT FROM s.org_id
       OR p.store_id IS DISTINCT FROM s.store_id
  ) THEN
    RAISE EXCEPTION 'legacy_payment_sale_scope_violation'
      USING ERRCODE = '23514';
  END IF;
END
$$;

ALTER TABLE public.payments
  ALTER COLUMN store_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sales_id_org_store_key
  ON public.sales (id, org_id, store_id);

CREATE UNIQUE INDEX IF NOT EXISTS payments_id_org_store_key
  ON public.payments (id, org_id, store_id);

CREATE TABLE public.cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  terminal_id uuid NOT NULL,
  status public.cash_session_status NOT NULL DEFAULT 'open',
  opening_amount numeric(12, 2) NOT NULL DEFAULT 0,
  expected_amount numeric(12, 2),
  counted_amount numeric(12, 2),
  difference numeric(12, 2),
  open_client_mutation_id uuid NOT NULL,
  close_client_mutation_id uuid,
  opened_by uuid NOT NULL REFERENCES auth.users (id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid REFERENCES auth.users (id),
  closed_at timestamptz,
  CONSTRAINT cash_sessions_scope_key
    UNIQUE (id, org_id, store_id),
  CONSTRAINT cash_sessions_terminal_scope_key
    UNIQUE (id, org_id, store_id, terminal_id),
  CONSTRAINT cash_sessions_store_scope_fk
    FOREIGN KEY (store_id, org_id)
    REFERENCES public.stores (id, org_id),
  CONSTRAINT cash_sessions_opening_amount_check
    CHECK (opening_amount >= 0),
  CONSTRAINT cash_sessions_closed_values_check
    CHECK (
      (
        status = 'open'
        AND expected_amount IS NULL
        AND counted_amount IS NULL
        AND difference IS NULL
        AND close_client_mutation_id IS NULL
        AND closed_by IS NULL
        AND closed_at IS NULL
      )
      OR (
        status = 'closed'
        AND expected_amount IS NOT NULL
        AND counted_amount IS NOT NULL
        AND difference IS NOT NULL
        AND close_client_mutation_id IS NOT NULL
        AND closed_by IS NOT NULL
        AND closed_at IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_open_per_terminal
  ON public.cash_sessions (org_id, store_id, terminal_id)
  WHERE status = 'open';

CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_open_mutation_key
  ON public.cash_sessions (org_id, store_id, open_client_mutation_id);

CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_close_mutation_key
  ON public.cash_sessions (org_id, store_id, close_client_mutation_id)
  WHERE close_client_mutation_id IS NOT NULL;

CREATE TABLE public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  terminal_id uuid NOT NULL,
  movement_type public.cash_movement_type NOT NULL,
  amount numeric(12, 2) NOT NULL,
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  client_mutation_id uuid NOT NULL,
  sale_id uuid,
  payment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_movements_session_scope_fk
    FOREIGN KEY (cash_session_id, org_id, store_id, terminal_id)
    REFERENCES public.cash_sessions (id, org_id, store_id, terminal_id),
  CONSTRAINT cash_movements_sale_scope_fk
    FOREIGN KEY (sale_id, org_id, store_id)
    REFERENCES public.sales (id, org_id, store_id),
  CONSTRAINT cash_movements_payment_scope_fk
    FOREIGN KEY (payment_id, org_id, store_id)
    REFERENCES public.payments (id, org_id, store_id),
  CONSTRAINT cash_movements_identity_check
    CHECK (
      (
        movement_type = 'sale_cash'
        AND amount >= 0
        AND sale_id IS NOT NULL
        AND payment_id IS NOT NULL
      )
      OR (
        movement_type = 'supply'
        AND amount > 0
        AND sale_id IS NULL
        AND payment_id IS NULL
      )
      OR (
        movement_type = 'withdrawal'
        AND amount < 0
        AND sale_id IS NULL
        AND payment_id IS NULL
      )
      OR (
        movement_type = 'adjustment'
        AND amount <> 0
        AND sale_id IS NULL
        AND payment_id IS NULL
      )
    ),
  CONSTRAINT cash_movements_reason_check
    CHECK (length(btrim(reason)) BETWEEN 1 AND 500)
);

CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_mutation_key
  ON public.cash_movements (org_id, store_id, client_mutation_id);

CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_sale_key
  ON public.cash_movements (sale_id)
  WHERE sale_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_payment_key
  ON public.cash_movements (payment_id)
  WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cash_sessions_store_terminal_opened_idx
  ON public.cash_sessions (org_id, store_id, terminal_id, opened_at DESC);

CREATE INDEX IF NOT EXISTS cash_movements_session_created_idx
  ON public.cash_movements (cash_session_id, created_at ASC, id ASC);

ALTER TABLE public.sales
  ADD CONSTRAINT sales_cash_session_scope_fk
  FOREIGN KEY (cash_session_id, org_id, store_id)
  REFERENCES public.cash_sessions (id, org_id, store_id);

ALTER TABLE public.payments
  ADD CONSTRAINT payments_sale_store_scope_fk
  FOREIGN KEY (sale_id, org_id, store_id)
  REFERENCES public.sales (id, org_id, store_id);

ALTER TABLE public.payments
  ADD CONSTRAINT payments_cash_session_scope_fk
  FOREIGN KEY (cash_session_id, org_id, store_id)
  REFERENCES public.cash_sessions (id, org_id, store_id);

CREATE OR REPLACE FUNCTION public.fill_payment_store_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
BEGIN
  SELECT *
  INTO v_sale
  FROM public.sales
  WHERE id = NEW.sale_id;

  IF NOT FOUND
    OR v_sale.org_id IS DISTINCT FROM NEW.org_id
  THEN
    RAISE EXCEPTION 'payment_sale_scope_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.store_id IS NULL THEN
    NEW.store_id := v_sale.store_id;
  END IF;

  IF NEW.store_id IS DISTINCT FROM v_sale.store_id THEN
    RAISE EXCEPTION 'payment_sale_scope_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.cash_session_id IS NOT NULL
    AND v_sale.cash_session_id IS DISTINCT FROM NEW.cash_session_id
  THEN
    RAISE EXCEPTION 'payment_cash_session_scope_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fill_payment_store_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fill_payment_store_scope() FROM anon;
REVOKE ALL ON FUNCTION public.fill_payment_store_scope() FROM authenticated;

DROP TRIGGER IF EXISTS fill_payment_store_scope ON public.payments;
CREATE TRIGGER fill_payment_store_scope
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.fill_payment_store_scope();

CREATE OR REPLACE FUNCTION public.assert_cash_movement_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_session public.cash_sessions%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_sale public.sales%ROWTYPE;
BEGIN
  SELECT *
  INTO v_session
  FROM public.cash_sessions
  WHERE id = NEW.cash_session_id;

  IF NOT FOUND
    OR v_session.org_id IS DISTINCT FROM NEW.org_id
    OR v_session.store_id IS DISTINCT FROM NEW.store_id
    OR v_session.terminal_id IS DISTINCT FROM NEW.terminal_id
    OR v_session.status <> 'open'
  THEN
    RAISE EXCEPTION 'cash_movement_session_invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.movement_type = 'sale_cash' THEN
    SELECT *
    INTO v_sale
    FROM public.sales
    WHERE id = NEW.sale_id;

    SELECT *
    INTO v_payment
    FROM public.payments
    WHERE id = NEW.payment_id;

    IF NOT FOUND
      OR v_payment.method <> 'cash'
      OR v_payment.status <> 'captured'
      OR v_payment.org_id IS DISTINCT FROM NEW.org_id
      OR v_payment.store_id IS DISTINCT FROM NEW.store_id
      OR v_payment.cash_session_id IS DISTINCT FROM NEW.cash_session_id
      OR v_sale.id IS NULL
      OR v_sale.org_id IS DISTINCT FROM NEW.org_id
      OR v_sale.store_id IS DISTINCT FROM NEW.store_id
      OR v_sale.cash_session_id IS DISTINCT FROM NEW.cash_session_id
      OR v_payment.amount IS DISTINCT FROM NEW.amount
    THEN
      RAISE EXCEPTION 'cash_movement_sale_scope_mismatch'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_cash_movement_integrity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_cash_movement_integrity() FROM anon;
REVOKE ALL ON FUNCTION public.assert_cash_movement_integrity() FROM authenticated;

DROP TRIGGER IF EXISTS assert_cash_movement_integrity
  ON public.cash_movements;
CREATE TRIGGER assert_cash_movement_integrity
  BEFORE INSERT ON public.cash_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_cash_movement_integrity();

CREATE OR REPLACE FUNCTION public.prevent_cash_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'cash_movement_immutable'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_cash_movement_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_cash_movement_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_cash_movement_mutation() FROM authenticated;

DROP TRIGGER IF EXISTS cash_movements_immutable
  ON public.cash_movements;
CREATE TRIGGER cash_movements_immutable
  BEFORE UPDATE OR DELETE ON public.cash_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_cash_movement_mutation();

ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_sessions_select
  ON public.cash_sessions
  FOR SELECT
  TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_store_access(store_id)
  );

CREATE POLICY cash_movements_select
  ON public.cash_movements
  FOR SELECT
  TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_store_access(store_id)
  );

REVOKE ALL ON TABLE public.cash_sessions, public.cash_movements
  FROM anon;
REVOKE ALL ON TABLE public.cash_sessions, public.cash_movements
  FROM authenticated;
GRANT SELECT ON TABLE public.cash_sessions, public.cash_movements
  TO authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON TABLE public.sales, public.payments, public.audit_logs
  FROM anon, authenticated;
GRANT SELECT ON TABLE public.sales, public.payments, public.audit_logs
  TO authenticated;

CREATE OR REPLACE FUNCTION public.open_cash_session(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_terminal_id uuid;
  v_mutation_id uuid;
  v_org_id uuid;
  v_opening numeric;
  v_existing public.cash_sessions%ROWTYPE;
  v_session public.cash_sessions%ROWTYPE;
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_cash_payload' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(jsonb_typeof(p_payload->'store_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'terminal_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'client_mutation_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'opening_amount') <> 'string', true)
  THEN
    RAISE EXCEPTION 'invalid_cash_payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_terminal_id := NULLIF(p_payload->>'terminal_id', '')::uuid;
    v_mutation_id := NULLIF(p_payload->>'client_mutation_id', '')::uuid;
    v_opening := (p_payload->>'opening_amount')::numeric;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_cash_payload' USING ERRCODE = '22023';
  END;

  IF v_store_id IS NULL
    OR v_terminal_id IS NULL
    OR v_mutation_id IS NULL
    OR v_opening IS NULL
    OR v_opening::text IN ('NaN', 'Infinity', '-Infinity')
    OR v_opening < 0
    OR abs(v_opening) > 9999999999.99
    OR scale(v_opening) > 2
  THEN
    RAISE EXCEPTION 'invalid_cash_payload' USING ERRCODE = '22023';
  END IF;
  v_opening := v_opening::numeric(12, 2);

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;

  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
    OR public.user_store_role(v_store_id) IS NULL
  THEN
    RAISE EXCEPTION 'forbidden_cash' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_org_id::text || ':' || v_store_id::text || ':cash-open:' || v_terminal_id::text,
      0
    )
  );

  SELECT *
  INTO v_existing
  FROM public.cash_sessions cs
  WHERE cs.org_id = v_org_id
    AND cs.store_id = v_store_id
    AND cs.open_client_mutation_id = v_mutation_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.terminal_id IS DISTINCT FROM v_terminal_id
      OR v_existing.opening_amount IS DISTINCT FROM v_opening
    THEN
      RAISE EXCEPTION 'cash_idempotency_payload_mismatch'
        USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'cash_session_id', v_existing.id,
      'org_id', v_existing.org_id,
      'store_id', v_existing.store_id,
      'terminal_id', v_existing.terminal_id,
      'status', v_existing.status,
      'opening_amount', v_existing.opening_amount::text,
      'expected_amount', COALESCE(v_existing.expected_amount, v_existing.opening_amount)::text,
      'counted_amount', v_existing.counted_amount::text,
      'difference', v_existing.difference::text,
      'opened_by', v_existing.opened_by,
      'opened_at', v_existing.opened_at::text,
      'closed_by', v_existing.closed_by,
      'closed_at', v_existing.closed_at::text,
      'replay', true
    );
  END IF;

  BEGIN
    INSERT INTO public.cash_sessions (
      org_id,
      store_id,
      terminal_id,
      opening_amount,
      open_client_mutation_id,
      opened_by
    )
    VALUES (
      v_org_id,
      v_store_id,
      v_terminal_id,
      v_opening,
      v_mutation_id,
      v_user_id
    )
    RETURNING *
    INTO v_session;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'cash_session_already_open'
        USING ERRCODE = '23505';
  END;

  INSERT INTO public.audit_logs (
    org_id,
    store_id,
    user_id,
    entity_type,
    entity_id,
    action,
    payload
  )
  VALUES (
    v_org_id,
    v_store_id,
    v_user_id,
    'cash_session',
    v_session.id,
    'cash.opened',
    jsonb_build_object(
      'cash_session_id', v_session.id,
      'terminal_id', v_terminal_id,
      'opening_amount', v_opening,
      'client_mutation_id', v_mutation_id
    )
  );

  RETURN jsonb_build_object(
    'cash_session_id', v_session.id,
    'org_id', v_session.org_id,
    'store_id', v_session.store_id,
    'terminal_id', v_session.terminal_id,
    'status', v_session.status,
    'opening_amount', v_session.opening_amount::text,
    'expected_amount', v_session.opening_amount::text,
    'counted_amount', NULL,
    'difference', NULL,
    'opened_by', v_session.opened_by,
    'opened_at', v_session.opened_at::text,
    'closed_by', NULL,
    'closed_at', NULL,
    'replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_cash_movement(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_session_id uuid;
  v_store_id uuid;
  v_terminal_id uuid;
  v_mutation_id uuid;
  v_movement_type public.cash_movement_type;
  v_amount numeric;
  v_signed_amount numeric;
  v_reason text;
  v_role public.member_role;
  v_session public.cash_sessions%ROWTYPE;
  v_existing public.cash_movements%ROWTYPE;
  v_expected numeric(12, 2);
  v_movement public.cash_movements%ROWTYPE;
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
    OR COALESCE(jsonb_typeof(p_payload->'cash_session_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'store_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'terminal_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'client_mutation_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'movement_type') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'amount') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'reason') <> 'string', true)
  THEN
    RAISE EXCEPTION 'invalid_cash_payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_session_id := NULLIF(p_payload->>'cash_session_id', '')::uuid;
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_terminal_id := NULLIF(p_payload->>'terminal_id', '')::uuid;
    v_mutation_id := NULLIF(p_payload->>'client_mutation_id', '')::uuid;
    v_amount := (p_payload->>'amount')::numeric;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_cash_payload' USING ERRCODE = '22023';
  END;

  IF p_payload->>'movement_type' NOT IN ('supply', 'withdrawal', 'adjustment') THEN
    RAISE EXCEPTION 'invalid_cash_movement_type' USING ERRCODE = '22023';
  END IF;
  v_movement_type := (p_payload->>'movement_type')::public.cash_movement_type;
  v_reason := NULLIF(btrim(p_payload->>'reason'), '');

  IF v_session_id IS NULL
    OR v_store_id IS NULL
    OR v_terminal_id IS NULL
    OR v_mutation_id IS NULL
    OR v_amount IS NULL
    OR v_amount::text IN ('NaN', 'Infinity', '-Infinity')
    OR v_amount = 0
    OR abs(v_amount) > 9999999999.99
    OR scale(v_amount) > 2
    OR v_reason IS NULL
    OR length(v_reason) > 500
  THEN
    RAISE EXCEPTION 'invalid_cash_payload' USING ERRCODE = '22023';
  END IF;

  IF v_movement_type IN ('supply', 'withdrawal') AND v_amount < 0 THEN
    RAISE EXCEPTION 'cash_amount_must_be_positive' USING ERRCODE = '22023';
  END IF;
  v_signed_amount := CASE
    WHEN v_movement_type = 'withdrawal' THEN -v_amount
    ELSE v_amount
  END CASE;
  v_signed_amount := v_signed_amount::numeric(12, 2);

  SELECT *
  INTO v_session
  FROM public.cash_sessions cs
  WHERE cs.id = v_session_id
  FOR UPDATE;

  v_role := public.user_store_role(v_session.store_id);
  IF NOT FOUND
    OR v_session.store_id IS DISTINCT FROM v_store_id
    OR v_session.terminal_id IS DISTINCT FROM v_terminal_id
    OR v_session.org_id IS DISTINCT FROM public.current_user_org_id()
    OR v_role IS NULL
    OR (
      v_movement_type = 'adjustment'
      AND v_role NOT IN ('admin', 'manager')
    )
  THEN
    RAISE EXCEPTION 'forbidden_cash' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_session.org_id::text || ':' || v_session.store_id::text
        || ':cash-movement:' || v_mutation_id::text,
      0
    )
  );

  SELECT *
  INTO v_existing
  FROM public.cash_movements cm
  WHERE cm.org_id = v_session.org_id
    AND cm.store_id = v_session.store_id
    AND cm.client_mutation_id = v_mutation_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.cash_session_id IS DISTINCT FROM v_session_id
      OR v_existing.terminal_id IS DISTINCT FROM v_terminal_id
      OR v_existing.movement_type IS DISTINCT FROM v_movement_type
      OR v_existing.amount IS DISTINCT FROM v_signed_amount
      OR v_existing.reason IS DISTINCT FROM v_reason
    THEN
      RAISE EXCEPTION 'cash_idempotency_payload_mismatch'
        USING ERRCODE = '22023';
    END IF;

    SELECT v_session.opening_amount + COALESCE(sum(cm.amount), 0)
    INTO v_expected
    FROM public.cash_movements cm
    WHERE cm.cash_session_id = v_session_id;

    RETURN jsonb_build_object(
      'cash_movement_id', v_existing.id,
      'cash_session_id', v_existing.cash_session_id,
      'store_id', v_existing.store_id,
      'terminal_id', v_existing.terminal_id,
      'movement_type', v_existing.movement_type,
      'amount', v_existing.amount::text,
      'reason', v_existing.reason,
      'client_mutation_id', v_existing.client_mutation_id,
      'created_by', v_existing.created_by,
      'created_at', v_existing.created_at::text,
      'expected_amount', v_expected::text,
      'replay', true
    );
  END IF;

  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'cash_session_closed' USING ERRCODE = '40901';
  END IF;

  SELECT v_session.opening_amount + COALESCE(sum(cm.amount), 0)
  INTO v_expected
  FROM public.cash_movements cm
  WHERE cm.cash_session_id = v_session_id;
  v_expected := (v_expected + v_signed_amount)::numeric(12, 2);

  IF v_expected < 0 THEN
    RAISE EXCEPTION 'cash_negative_balance' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.cash_movements (
    cash_session_id,
    org_id,
    store_id,
    terminal_id,
    movement_type,
    amount,
    reason,
    created_by,
    client_mutation_id
  )
  VALUES (
    v_session_id,
    v_session.org_id,
    v_session.store_id,
    v_session.terminal_id,
    v_movement_type,
    v_signed_amount,
    v_reason,
    v_user_id,
    v_mutation_id
  )
  RETURNING *
  INTO v_movement;

  INSERT INTO public.audit_logs (
    org_id,
    store_id,
    user_id,
    entity_type,
    entity_id,
    action,
    payload
  )
  VALUES (
    v_session.org_id,
    v_session.store_id,
    v_user_id,
    'cash_movement',
    v_movement.id,
    'cash.movement_recorded',
    jsonb_build_object(
      'cash_session_id', v_session_id,
      'terminal_id', v_terminal_id,
      'movement_type', v_movement_type,
      'amount', v_signed_amount,
      'reason', v_reason,
      'client_mutation_id', v_mutation_id,
      'expected_amount', v_expected
    )
  );

  RETURN jsonb_build_object(
    'cash_movement_id', v_movement.id,
    'cash_session_id', v_movement.cash_session_id,
    'store_id', v_movement.store_id,
    'terminal_id', v_movement.terminal_id,
    'movement_type', v_movement.movement_type,
    'amount', v_movement.amount::text,
    'reason', v_movement.reason,
    'client_mutation_id', v_movement.client_mutation_id,
    'created_by', v_movement.created_by,
    'created_at', v_movement.created_at::text,
    'expected_amount', v_expected::text,
    'replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_cash_session(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_terminal_id uuid;
  v_org_id uuid;
  v_session public.cash_sessions%ROWTYPE;
  v_expected numeric(12, 2);
  v_movements jsonb;
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
    OR COALESCE(jsonb_typeof(p_payload->'store_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'terminal_id') <> 'string', true)
  THEN
    RAISE EXCEPTION 'invalid_cash_payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_terminal_id := NULLIF(p_payload->>'terminal_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_cash_payload' USING ERRCODE = '22023';
  END;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;
  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
    OR public.user_store_role(v_store_id) IS NULL
  THEN
    RAISE EXCEPTION 'forbidden_cash' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_session
  FROM public.cash_sessions cs
  WHERE cs.org_id = v_org_id
    AND cs.store_id = v_store_id
    AND cs.terminal_id = v_terminal_id
  ORDER BY cs.opened_at DESC, cs.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'session', NULL,
      'movements', '[]'::jsonb,
      'expected_amount', '0.00'
    );
  END IF;

  SELECT v_session.opening_amount + COALESCE(sum(cm.amount), 0)
  INTO v_expected
  FROM public.cash_movements cm
  WHERE cm.cash_session_id = v_session.id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'cash_movement_id', cm.id,
        'cash_session_id', cm.cash_session_id,
        'store_id', cm.store_id,
        'terminal_id', cm.terminal_id,
        'movement_type', cm.movement_type,
        'amount', cm.amount::text,
        'reason', cm.reason,
        'created_by', cm.created_by,
        'client_mutation_id', cm.client_mutation_id,
        'sale_id', cm.sale_id,
        'payment_id', cm.payment_id,
        'created_at', cm.created_at::text
      )
      ORDER BY cm.created_at, cm.id
    ),
    '[]'::jsonb
  )
  INTO v_movements
  FROM public.cash_movements cm
  WHERE cm.cash_session_id = v_session.id;

  RETURN jsonb_build_object(
    'session', jsonb_build_object(
      'cash_session_id', v_session.id,
      'org_id', v_session.org_id,
      'store_id', v_session.store_id,
      'terminal_id', v_session.terminal_id,
      'status', v_session.status,
      'opening_amount', v_session.opening_amount::text,
      'expected_amount', v_expected::text,
      'counted_amount', v_session.counted_amount::text,
      'difference', v_session.difference::text,
      'opened_by', v_session.opened_by,
      'opened_at', v_session.opened_at::text,
      'closed_by', v_session.closed_by,
      'closed_at', v_session.closed_at::text
    ),
    'movements', v_movements,
    'expected_amount', v_expected::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.close_cash_session(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_session_id uuid;
  v_store_id uuid;
  v_terminal_id uuid;
  v_mutation_id uuid;
  v_counted numeric;
  v_session public.cash_sessions%ROWTYPE;
  v_expected numeric(12, 2);
  v_difference numeric(12, 2);
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
    OR COALESCE(jsonb_typeof(p_payload->'cash_session_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'store_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'terminal_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'client_mutation_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'counted_amount') <> 'string', true)
  THEN
    RAISE EXCEPTION 'invalid_cash_payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_session_id := NULLIF(p_payload->>'cash_session_id', '')::uuid;
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_terminal_id := NULLIF(p_payload->>'terminal_id', '')::uuid;
    v_mutation_id := NULLIF(p_payload->>'client_mutation_id', '')::uuid;
    v_counted := (p_payload->>'counted_amount')::numeric;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_cash_payload' USING ERRCODE = '22023';
  END;

  IF v_session_id IS NULL
    OR v_store_id IS NULL
    OR v_terminal_id IS NULL
    OR v_mutation_id IS NULL
    OR v_counted IS NULL
    OR v_counted::text IN ('NaN', 'Infinity', '-Infinity')
    OR v_counted < 0
    OR abs(v_counted) > 9999999999.99
    OR scale(v_counted) > 2
  THEN
    RAISE EXCEPTION 'invalid_cash_payload' USING ERRCODE = '22023';
  END IF;
  v_counted := v_counted::numeric(12, 2);

  SELECT *
  INTO v_session
  FROM public.cash_sessions cs
  WHERE cs.id = v_session_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_session.store_id IS DISTINCT FROM v_store_id
    OR v_session.terminal_id IS DISTINCT FROM v_terminal_id
    OR v_session.org_id IS DISTINCT FROM public.current_user_org_id()
    OR public.user_store_role(v_session.store_id) IS NULL
  THEN
    RAISE EXCEPTION 'forbidden_cash' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_session.org_id::text || ':' || v_session.store_id::text
        || ':cash-close:' || v_mutation_id::text,
      0
    )
  );

  SELECT *
  INTO v_session
  FROM public.cash_sessions cs
  WHERE cs.id = v_session_id
  FOR UPDATE;

  IF v_session.close_client_mutation_id IS NOT NULL THEN
    IF v_session.close_client_mutation_id IS DISTINCT FROM v_mutation_id THEN
      RAISE EXCEPTION 'cash_session_closed' USING ERRCODE = '40901';
    END IF;
    IF v_session.counted_amount IS DISTINCT FROM v_counted THEN
      RAISE EXCEPTION 'cash_idempotency_payload_mismatch'
        USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'cash_session_id', v_session.id,
      'org_id', v_session.org_id,
      'store_id', v_session.store_id,
      'terminal_id', v_session.terminal_id,
      'status', v_session.status,
      'opening_amount', v_session.opening_amount::text,
      'expected_amount', v_session.expected_amount::text,
      'counted_amount', v_session.counted_amount::text,
      'difference', v_session.difference::text,
      'opened_by', v_session.opened_by,
      'opened_at', v_session.opened_at::text,
      'closed_by', v_session.closed_by,
      'closed_at', v_session.closed_at::text,
      'replay', true
    );
  END IF;

  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'cash_session_closed' USING ERRCODE = '40901';
  END IF;

  SELECT v_session.opening_amount + COALESCE(sum(cm.amount), 0)
  INTO v_expected
  FROM public.cash_movements cm
  WHERE cm.cash_session_id = v_session_id;
  v_difference := (v_counted - v_expected)::numeric(12, 2);

  UPDATE public.cash_sessions
  SET status = 'closed',
      expected_amount = v_expected,
      counted_amount = v_counted,
      difference = v_difference,
      close_client_mutation_id = v_mutation_id,
      closed_by = v_user_id,
      closed_at = now()
  WHERE id = v_session_id;

  INSERT INTO public.audit_logs (
    org_id,
    store_id,
    user_id,
    entity_type,
    entity_id,
    action,
    payload
  )
  VALUES (
    v_session.org_id,
    v_session.store_id,
    v_user_id,
    'cash_session',
    v_session.id,
    'cash.closed',
    jsonb_build_object(
      'cash_session_id', v_session.id,
      'terminal_id', v_session.terminal_id,
      'expected_amount', v_expected,
      'counted_amount', v_counted,
      'difference', v_difference,
      'client_mutation_id', v_mutation_id
    )
  );

  SELECT *
  INTO v_session
  FROM public.cash_sessions cs
  WHERE cs.id = v_session_id;

  RETURN jsonb_build_object(
    'cash_session_id', v_session.id,
    'org_id', v_session.org_id,
    'store_id', v_session.store_id,
    'terminal_id', v_session.terminal_id,
    'status', v_session.status,
    'opening_amount', v_session.opening_amount::text,
    'expected_amount', v_session.expected_amount::text,
    'counted_amount', v_session.counted_amount::text,
    'difference', v_session.difference::text,
    'opened_by', v_session.opened_by,
    'opened_at', v_session.opened_at::text,
    'closed_by', v_session.closed_by,
    'closed_at', v_session.closed_at::text,
    'replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.process_sale_with_cash(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_session_id uuid;
  v_terminal_id uuid;
  v_client_mutation_id uuid;
  v_org_id uuid;
  v_result jsonb;
  v_session public.cash_sessions%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_movement public.cash_movements%ROWTYPE;
BEGIN
  IF v_user_id IS NULL
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
    OR COALESCE(jsonb_typeof(p_payload->'store_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'cash_session_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'terminal_id') <> 'string', true)
    OR COALESCE(jsonb_typeof(p_payload->'client_mutation_id') <> 'string', true)
  THEN
    RAISE EXCEPTION 'invalid_cash_sale_payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_session_id := NULLIF(p_payload->>'cash_session_id', '')::uuid;
    v_terminal_id := NULLIF(p_payload->>'terminal_id', '')::uuid;
    v_client_mutation_id := NULLIF(p_payload->>'client_mutation_id', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_cash_sale_payload' USING ERRCODE = '22023';
  END;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;

  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
    OR public.user_store_role(v_store_id) IS NULL
  THEN
    RAISE EXCEPTION 'forbidden_cash' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_org_id::text || ':' || v_store_id::text
        || ':cash-sale:' || v_session_id::text,
      0
    )
  );

  SELECT s.*
  INTO v_session
  FROM public.cash_sessions s
  WHERE s.id = v_session_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_session.org_id IS DISTINCT FROM v_org_id
    OR v_session.store_id IS DISTINCT FROM v_store_id
    OR v_session.terminal_id IS DISTINCT FROM v_terminal_id
  THEN
    RAISE EXCEPTION 'cash_session_closed' USING ERRCODE = '40901';
  END IF;

  IF v_session.status <> 'open' THEN
    SELECT *
    INTO v_sale
    FROM public.sales s
    WHERE s.store_id = v_store_id
      AND s.client_mutation_id = v_client_mutation_id
    FOR UPDATE;

    IF NOT FOUND
      OR v_sale.cash_session_id IS DISTINCT FROM v_session_id
    THEN
      RAISE EXCEPTION 'cash_session_closed' USING ERRCODE = '40901';
    END IF;

    SELECT *
    INTO v_movement
    FROM public.cash_movements cm
    WHERE cm.sale_id = v_sale.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'cash_sale_not_reconciled'
        USING ERRCODE = '23514';
    END IF;

    RETURN jsonb_build_object(
      'sale_id', v_sale.id,
      'client_mutation_id', v_sale.client_mutation_id,
      'replay', true,
      'status', v_sale.status,
      'total', v_sale.total,
      'stock_reconciled', true,
      'cash_session_id', v_session_id,
      'terminal_id', v_terminal_id
    );
  END IF;

  v_result := public.process_sale(
    p_payload - 'cash_session_id' - 'terminal_id'
  );

  IF v_result->>'sale_id' IS NULL THEN
    RAISE EXCEPTION 'cash_sale_missing_sale' USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_sale
  FROM public.sales s
  WHERE s.id = (v_result->>'sale_id')::uuid
  FOR UPDATE;

  IF v_result->>'replay' = 'true' THEN
    IF v_sale.cash_session_id IS DISTINCT FROM v_session_id THEN
      RAISE EXCEPTION 'cash_sale_session_mismatch'
        USING ERRCODE = '23514';
    END IF;

    SELECT *
    INTO v_movement
    FROM public.cash_movements cm
    WHERE cm.sale_id = v_sale.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'cash_sale_not_reconciled'
        USING ERRCODE = '23514';
    END IF;

    RETURN v_result
      || jsonb_build_object(
        'cash_session_id', v_session_id,
        'terminal_id', v_terminal_id
      );
  END IF;

  UPDATE public.sales
  SET cash_session_id = v_session_id
  WHERE id = v_sale.id
    AND org_id = v_org_id
    AND store_id = v_store_id;

  SELECT *
  INTO v_payment
  FROM public.payments p
  WHERE p.sale_id = v_sale.id
    AND p.org_id = v_org_id
    AND p.store_id = v_store_id
    AND p.method = 'cash'
  ORDER BY p.id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cash_sale_missing_payment'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.payments
  SET cash_session_id = v_session_id
  WHERE id = v_payment.id;

  INSERT INTO public.cash_movements (
    cash_session_id,
    org_id,
    store_id,
    terminal_id,
    movement_type,
    amount,
    reason,
    created_by,
    client_mutation_id,
    sale_id,
    payment_id
  )
  VALUES (
    v_session_id,
    v_org_id,
    v_store_id,
    v_terminal_id,
    'sale_cash',
    v_payment.amount,
    'Venda em dinheiro',
    v_user_id,
    v_sale.client_mutation_id,
    v_sale.id,
    v_payment.id
  )
  RETURNING *
  INTO v_movement;

  INSERT INTO public.audit_logs (
    org_id,
    store_id,
    user_id,
    entity_type,
    entity_id,
    action,
    payload
  )
  VALUES (
    v_org_id,
    v_store_id,
    v_user_id,
    'cash_movement',
    v_movement.id,
    'cash.sale_captured',
    jsonb_build_object(
      'cash_session_id', v_session_id,
      'sale_id', v_sale.id,
      'payment_id', v_payment.id,
      'amount', v_payment.amount,
      'client_mutation_id', v_sale.client_mutation_id
    )
  );

  RETURN v_result
    || jsonb_build_object(
      'cash_session_id', v_session_id,
      'terminal_id', v_terminal_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.open_cash_session(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_cash_session(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.open_cash_session(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.record_cash_movement(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_cash_movement(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_cash_movement(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.get_cash_session(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cash_session(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_cash_session(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.close_cash_session(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_cash_session(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_cash_session(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.process_sale_with_cash(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_sale_with_cash(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_sale_with_cash(jsonb) TO authenticated;
