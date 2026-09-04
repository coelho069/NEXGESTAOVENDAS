-- RBAC/RLS deny-by-default hardening.
-- This migration is forward-only. It preserves store_members.role as the
-- authority and never uses profiles.default_role for authorization.

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.user_has_store_access(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.store_members sm
    JOIN public.stores s
      ON s.id = sm.store_id
     AND s.org_id = sm.org_id
    WHERE (SELECT auth.uid()) IS NOT NULL
      AND p_store_id IS NOT NULL
      AND sm.user_id = (SELECT auth.uid())
      AND sm.store_id = p_store_id
      AND sm.org_id = public.current_user_org_id()
      AND s.is_active IS TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.user_store_role(p_store_id uuid)
RETURNS public.member_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT sm.role
  FROM public.store_members sm
  JOIN public.stores s
    ON s.id = sm.store_id
   AND s.org_id = sm.org_id
  WHERE (SELECT auth.uid()) IS NOT NULL
    AND p_store_id IS NOT NULL
    AND sm.user_id = (SELECT auth.uid())
    AND sm.store_id = p_store_id
    AND sm.org_id = public.current_user_org_id()
    AND s.is_active IS TRUE
  LIMIT 1;
$$;

-- Organization-scoped resources still require a real active membership in at
-- least one store. A profile row alone is not access.
CREATE OR REPLACE FUNCTION public.user_has_org_membership()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.store_members sm
    JOIN public.stores s
      ON s.id = sm.store_id
     AND s.org_id = sm.org_id
    WHERE (SELECT auth.uid()) IS NOT NULL
      AND sm.user_id = (SELECT auth.uid())
      AND sm.org_id = public.current_user_org_id()
      AND s.is_active IS TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.user_has_org_role(
  p_store_id uuid,
  p_roles public.member_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.store_members sm
    JOIN public.stores s
      ON s.id = sm.store_id
     AND s.org_id = sm.org_id
    WHERE (SELECT auth.uid()) IS NOT NULL
      AND p_store_id IS NOT NULL
      AND p_roles IS NOT NULL
      AND sm.user_id = (SELECT auth.uid())
      AND sm.store_id = p_store_id
      AND sm.org_id = public.current_user_org_id()
      AND sm.role = ANY (p_roles)
      AND s.is_active IS TRUE
  );
$$;

-- The helper validates the supplied organization against the authenticated
-- context. It is not an oracle for arbitrary organizations and returns false
-- (never NULL) for NULL category IDs or users without membership.
CREATE OR REPLACE FUNCTION public.category_belongs_to_org(
  p_category_id uuid,
  p_org_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COALESCE(
    p_category_id IS NOT NULL
    AND p_org_id IS NOT NULL
    AND p_org_id = public.current_user_org_id()
    AND public.user_has_org_membership() IS TRUE
    AND EXISTS (
      SELECT 1
      FROM public.categories c
      WHERE c.id = p_category_id
        AND c.org_id = p_org_id
    ),
    false
  );
$$;

-- COALESCE is intentional: a missing membership produces a hard denial,
-- rather than SQL NULL propagating through a PL/pgSQL IF or an RLS predicate.
CREATE OR REPLACE FUNCTION public.user_can_manage_inventory(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COALESCE(
    public.user_store_role(p_store_id) IN ('admin', 'manager'),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.user_can_view_reports(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COALESCE(
    public.user_store_role(p_store_id) IN ('admin', 'manager'),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_store_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_store_access(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_has_store_access(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.user_store_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_store_role(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_store_role(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.user_has_org_membership() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_org_membership() FROM anon;
GRANT EXECUTE ON FUNCTION public.user_has_org_membership() TO authenticated;

REVOKE ALL ON FUNCTION public.user_has_org_role(uuid, public.member_role[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_org_role(uuid, public.member_role[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_has_org_role(uuid, public.member_role[]) TO authenticated;

REVOKE ALL ON FUNCTION public.category_belongs_to_org(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.category_belongs_to_org(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.category_belongs_to_org(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.user_can_manage_inventory(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_can_manage_inventory(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_can_manage_inventory(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.user_can_view_reports(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_can_view_reports(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_can_view_reports(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Fail-fast checks and composite tenant constraints
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.inventory_balances ib
    LEFT JOIN public.stores s
      ON s.id = ib.store_id
     AND s.org_id = ib.org_id
    WHERE s.id IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy_inventory_balance_store_org_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_balances ib
    LEFT JOIN public.products p
      ON p.id = ib.product_id
     AND p.org_id = ib.org_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy_inventory_balance_product_org_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sales s
    LEFT JOIN public.stores st
      ON st.id = s.store_id
     AND st.org_id = s.org_id
    WHERE st.id IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy_sale_store_org_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_movements im
    LEFT JOIN public.stores s
      ON s.id = im.store_id
     AND s.org_id = im.org_id
    WHERE s.id IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy_inventory_movement_store_org_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_movements im
    LEFT JOIN public.products p
      ON p.id = im.product_id
     AND p.org_id = im.org_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy_inventory_movement_product_org_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payments p
    LEFT JOIN public.sales s
      ON s.id = p.sale_id
     AND s.org_id = p.org_id
    WHERE s.id IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy_payment_sale_org_mismatch'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_id_org
  ON public.stores (id, org_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_id_org
  ON public.products (id, org_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_id_org
  ON public.sales (id, org_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'fk_sales_store_same_org'
      AND conrelid = 'public.sales'::regclass
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT fk_sales_store_same_org
      FOREIGN KEY (store_id, org_id)
      REFERENCES public.stores (id, org_id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'fk_inventory_balances_store_same_org'
      AND conrelid = 'public.inventory_balances'::regclass
  ) THEN
    ALTER TABLE public.inventory_balances
      ADD CONSTRAINT fk_inventory_balances_store_same_org
      FOREIGN KEY (store_id, org_id)
      REFERENCES public.stores (id, org_id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'fk_inventory_balances_product_same_org'
      AND conrelid = 'public.inventory_balances'::regclass
  ) THEN
    ALTER TABLE public.inventory_balances
      ADD CONSTRAINT fk_inventory_balances_product_same_org
      FOREIGN KEY (product_id, org_id)
      REFERENCES public.products (id, org_id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'fk_inventory_movements_store_same_org'
      AND conrelid = 'public.inventory_movements'::regclass
  ) THEN
    ALTER TABLE public.inventory_movements
      ADD CONSTRAINT fk_inventory_movements_store_same_org
      FOREIGN KEY (store_id, org_id)
      REFERENCES public.stores (id, org_id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'fk_inventory_movements_product_same_org'
      AND conrelid = 'public.inventory_movements'::regclass
  ) THEN
    ALTER TABLE public.inventory_movements
      ADD CONSTRAINT fk_inventory_movements_product_same_org
      FOREIGN KEY (product_id, org_id)
      REFERENCES public.products (id, org_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'fk_payments_sale_same_org'
      AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT fk_payments_sale_same_org
      FOREIGN KEY (sale_id, org_id)
      REFERENCES public.sales (id, org_id)
      ON DELETE CASCADE;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Protected RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.adjust_inventory(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid := (p_payload->>'store_id')::uuid;
  v_product_id uuid := (p_payload->>'product_id')::uuid;
  v_delta numeric(12, 3) := (p_payload->>'delta')::numeric(12, 3);
  v_reason text := NULLIF(btrim(p_payload->>'reason'), '');
  v_type public.inventory_movement_type :=
    COALESCE(NULLIF(p_payload->>'movement_type', ''), 'adjustment')::public.inventory_movement_type;
  v_org_id uuid;
  v_role public.member_role;
  v_balance numeric(12, 3);
  v_next numeric(12, 3);
  v_movement_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_store_id IS NULL OR v_product_id IS NULL OR v_delta IS NULL THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  IF v_type NOT IN ('restock', 'adjustment') THEN
    RAISE EXCEPTION 'invalid_movement_type' USING ERRCODE = '22023';
  END IF;
  IF v_type = 'restock' AND v_delta <= 0 THEN
    RAISE EXCEPTION 'restock_requires_positive_delta' USING ERRCODE = '22023';
  END IF;
  IF v_delta = 0 THEN
    RAISE EXCEPTION 'delta_cannot_be_zero' USING ERRCODE = '22023';
  END IF;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;

  v_role := public.user_store_role(v_store_id);

  -- Every term is explicit: NULL role, missing profile organization, inactive
  -- store, and cross-organization context are all denials.
  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
    OR v_role IS NULL
    OR v_role NOT IN ('admin', 'manager')
  THEN
    RAISE EXCEPTION 'forbidden_inventory' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = v_product_id
      AND p.org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.inventory_balances (org_id, store_id, product_id, quantity)
  VALUES (v_org_id, v_store_id, v_product_id, 0)
  ON CONFLICT (store_id, product_id) DO NOTHING;

  SELECT ib.quantity
  INTO v_balance
  FROM public.inventory_balances ib
  WHERE ib.org_id = v_org_id
    AND ib.store_id = v_store_id
    AND ib.product_id = v_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory_scope_mismatch' USING ERRCODE = '23514';
  END IF;

  v_next := v_balance + v_delta;
  IF v_next < 0 THEN
    RAISE EXCEPTION 'negative_stock' USING ERRCODE = '22023';
  END IF;

  UPDATE public.inventory_balances
  SET quantity = v_next,
      updated_at = now()
  WHERE org_id = v_org_id
    AND store_id = v_store_id
    AND product_id = v_product_id;

  INSERT INTO public.inventory_movements (
    org_id, store_id, product_id, movement_type, quantity_change, balance_after,
    created_by, reason, actor_role
  )
  VALUES (
    v_org_id, v_store_id, v_product_id, v_type, v_delta, v_next,
    v_user_id, v_reason, v_role
  )
  RETURNING id INTO v_movement_id;

  INSERT INTO public.audit_logs (
    org_id, store_id, user_id, entity_type, entity_id, action, payload
  )
  VALUES (
    v_org_id, v_store_id, v_user_id, 'inventory_movement', v_movement_id,
    'adjust_inventory',
    jsonb_build_object(
      'delta', v_delta,
      'reason', v_reason,
      'actor_role', v_role,
      'movement_type', v_type,
      'product_id', v_product_id,
      'balance_after', v_next
    )
  );

  RETURN jsonb_build_object(
    'movement_id', v_movement_id,
    'balance_after', v_next::text,
    'delta', v_delta::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, analytics, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_org_id uuid;
  v_from date;
  v_to date;
  v_after_sku text;
  v_limit integer;
  v_summary jsonb;
  v_rows jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  v_store_id := (p_payload->>'store_id')::uuid;
  v_from := COALESCE(
    (p_payload->>'from')::date,
    (timezone('America/Sao_Paulo', now()))::date
  );
  v_to := COALESCE((p_payload->>'to')::date, v_from);
  v_after_sku := NULLIF(p_payload->>'cursor_sku', '');
  v_limit := LEAST(COALESCE((p_payload->>'limit')::integer, 20), 100);

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'store_id_required' USING ERRCODE = '22023';
  END IF;
  IF public.user_can_view_reports(v_store_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'forbidden_reports' USING ERRCODE = '42501';
  END IF;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;

  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
  THEN
    RAISE EXCEPTION 'forbidden_reports' USING ERRCODE = '42501';
  END IF;
  IF v_from > v_to THEN
    RAISE EXCEPTION 'invalid_period' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'revenue', to_char(COALESCE(sum(m.revenue), 0), 'FM999999999.00'),
    'cogs', to_char(COALESCE(sum(m.cogs), 0), 'FM999999999.00'),
    'gross_profit', to_char(COALESCE(sum(m.gross_profit), 0), 'FM999999999.00'),
    'margin_percent', CASE
      WHEN COALESCE(sum(m.revenue), 0) = 0 THEN '0.00'
      ELSE to_char(
        round(100 * COALESCE(sum(m.gross_profit), 0) / sum(m.revenue), 2),
        'FM999999999.00'
      )
    END,
    'units_sold', COALESCE(sum(m.units_sold), 0),
    'sell_through', CASE
      WHEN COALESCE(sum(m.units_sold), 0) + COALESCE((
        SELECT sum(ib.quantity)
        FROM public.inventory_balances ib
        WHERE ib.org_id = v_org_id
          AND ib.store_id = v_store_id
      ), 0) = 0 THEN '0.00'
      ELSE to_char(
        round(
          100 * COALESCE(sum(m.units_sold), 0)
          / (
            COALESCE(sum(m.units_sold), 0)
            + COALESCE((
              SELECT sum(ib.quantity)
              FROM public.inventory_balances ib
              WHERE ib.org_id = v_org_id
                AND ib.store_id = v_store_id
            ), 0)
          ),
          2
        ),
        'FM999999999.00'
      )
    END
  )
  INTO v_summary
  FROM analytics.product_period_metrics m
  WHERE m.store_id = v_store_id
    AND m.org_id = v_org_id
    AND m.period_day BETWEEN v_from AND v_to;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.sku), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      agg.product_id,
      agg.sku,
      agg.product_name,
      to_char(agg.revenue, 'FM999999999.00') AS revenue,
      to_char(agg.cogs, 'FM999999999.00') AS cogs,
      to_char(agg.gross_profit, 'FM999999999.00') AS gross_profit,
      agg.units_sold,
      COALESCE(ib.quantity, 0) AS on_hand,
      CASE
        WHEN (agg.units_sold + COALESCE(ib.quantity, 0)) = 0 THEN '0.00'
        ELSE to_char(
          round(100 * agg.units_sold / (agg.units_sold + COALESCE(ib.quantity, 0)), 2),
          'FM999999999.00'
        )
      END AS sell_through
    FROM (
      SELECT
        m.product_id,
        m.sku,
        m.product_name,
        sum(m.revenue) AS revenue,
        sum(m.cogs) AS cogs,
        sum(m.gross_profit) AS gross_profit,
        sum(m.units_sold) AS units_sold
      FROM analytics.product_period_metrics m
      WHERE m.store_id = v_store_id
        AND m.org_id = v_org_id
        AND m.period_day BETWEEN v_from AND v_to
      GROUP BY m.product_id, m.sku, m.product_name
    ) agg
    LEFT JOIN public.inventory_balances ib
      ON ib.org_id = v_org_id
     AND ib.store_id = v_store_id
     AND ib.product_id = agg.product_id
    WHERE v_after_sku IS NULL OR agg.sku > v_after_sku
    ORDER BY agg.sku
    LIMIT v_limit
  ) t;

  RETURN jsonb_build_object(
    'summary', v_summary,
    'rows', v_rows,
    'from', v_from,
    'to', v_to,
    'next_cursor', CASE
      WHEN jsonb_array_length(v_rows) = v_limit
        THEN v_rows -> (v_limit - 1) ->> 'sku'
      ELSE NULL
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_inventory_page(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_org_id uuid;
  v_after_sku text;
  v_limit integer;
  v_can_manage boolean;
  v_rows jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  v_store_id := (p_payload->>'store_id')::uuid;
  v_after_sku := NULLIF(p_payload->>'cursor_sku', '');
  v_limit := LEAST(COALESCE((p_payload->>'limit')::integer, 20), 100);

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'store_id_required' USING ERRCODE = '22023';
  END IF;
  IF public.user_has_store_access(v_store_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'forbidden_store' USING ERRCODE = '42501';
  END IF;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;

  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
  THEN
    RAISE EXCEPTION 'forbidden_store' USING ERRCODE = '42501';
  END IF;

  v_can_manage := public.user_can_manage_inventory(v_store_id);

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.sku), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      p.id AS product_id,
      p.sku,
      p.name,
      p.is_active,
      to_char(p.unit_price, 'FM999999999.00') AS unit_price,
      CASE
        WHEN v_can_manage IS TRUE
          THEN to_char(p.cost_price, 'FM999999999.00')
        ELSE NULL
      END AS cost_price,
      COALESCE(ib.quantity, 0) AS quantity
    FROM public.products p
    LEFT JOIN public.inventory_balances ib
      ON ib.org_id = v_org_id
     AND ib.store_id = v_store_id
     AND ib.product_id = p.id
    WHERE p.org_id = v_org_id
      AND (p.is_active IS TRUE OR v_can_manage IS TRUE)
      AND (v_after_sku IS NULL OR p.sku > v_after_sku)
    ORDER BY p.sku
    LIMIT v_limit
  ) t;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'next_cursor', CASE
      WHEN jsonb_array_length(v_rows) = v_limit
        THEN v_rows -> (v_limit - 1) ->> 'sku'
      ELSE NULL
    END,
    'can_adjust', v_can_manage
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.process_sale(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_store_id uuid;
  v_client_mutation_id uuid;
  v_org_id uuid;
  v_discount numeric := 0;
  v_gross_subtotal numeric := 0;
  v_item jsonb;
  v_existing_sale_id uuid;
  v_status text;
  v_total numeric(12, 2);
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_sale_payload_integrity(p_payload);

  v_store_id := (p_payload->>'store_id')::uuid;
  v_client_mutation_id := (p_payload->>'client_mutation_id')::uuid;
  v_discount := COALESCE((p_payload->>'discount')::numeric, 0);

  IF v_store_id IS NULL OR v_client_mutation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF public.user_has_store_access(v_store_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'store_access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT s.org_id
  INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id
    AND s.is_active IS TRUE;

  IF v_org_id IS NULL
    OR v_org_id IS DISTINCT FROM public.current_user_org_id()
  THEN
    RAISE EXCEPTION 'store_access_denied' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_store_id::text || ':' || v_client_mutation_id::text, 0)
  );

  SELECT k.sale_id
  INTO v_existing_sale_id
  FROM public.sale_idempotency_keys k
  WHERE k.store_id = v_store_id
    AND k.client_mutation_id = v_client_mutation_id
  FOR UPDATE;

  IF v_existing_sale_id IS NULL THEN
    SELECT s.id
    INTO v_existing_sale_id
    FROM public.sales s
    WHERE s.store_id = v_store_id
      AND s.client_mutation_id = v_client_mutation_id
    FOR UPDATE;
  END IF;

  IF v_existing_sale_id IS NOT NULL THEN
    SELECT s.status::text, s.total
    INTO v_status, v_total
    FROM public.sales s
    WHERE s.id = v_existing_sale_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'idempotency_incomplete' USING ERRCODE = '40001';
    END IF;
    IF NOT public.sale_payload_matches(v_existing_sale_id, p_payload) THEN
      RAISE EXCEPTION 'idempotency_payload_mismatch' USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'sale_id', v_existing_sale_id,
      'client_mutation_id', v_client_mutation_id,
      'replay', true,
      'status', v_status,
      'total', v_total,
      'stock_reconciled', true
    );
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb)) AS t(value)
  LOOP
    v_gross_subtotal := v_gross_subtotal + round(
      COALESCE((v_item->>'quantity')::numeric, 0)
      * COALESCE((v_item->>'unit_price')::numeric, 0),
      2
    );
    v_discount := v_discount + COALESCE((v_item->>'discount')::numeric, 0);
  END LOOP;

  PERFORM public.assert_sale_discount_cap(v_store_id, v_discount, v_gross_subtotal);

  RETURN public.process_sale_core(p_payload)
    || jsonb_build_object(
      'client_mutation_id', v_client_mutation_id,
      'stock_reconciled', true
    );
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_inventory(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_inventory(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.get_dashboard_metrics(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dashboard_metrics(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.get_inventory_page(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_inventory_page(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_page(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.process_sale(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_sale(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_sale(jsonb) TO authenticated;

-- The core implementation is callable only from trusted server-side wrappers.
REVOKE ALL ON FUNCTION public.process_sale_core(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_sale_core(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.process_sale_core(jsonb) FROM authenticated;

-- ---------------------------------------------------------------------------
-- RLS policies: require membership and use store-scoped role authority
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS organizations_select ON public.organizations;
CREATE POLICY organizations_select ON public.organizations
  FOR SELECT TO authenticated
  USING (
    public.user_has_org_membership() IS TRUE
    AND id = public.current_user_org_id()
  );

DROP POLICY IF EXISTS stores_select ON public.stores;
CREATE POLICY stores_select ON public.stores
  FOR SELECT TO authenticated
  USING (public.user_has_store_access(id) IS TRUE);

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (
    public.user_has_org_membership() IS TRUE
    AND (
      id = (SELECT auth.uid())
      OR org_id = public.current_user_org_id()
    )
  );

DROP POLICY IF EXISTS store_members_select ON public.store_members;
CREATE POLICY store_members_select ON public.store_members
  FOR SELECT TO authenticated
  USING (public.user_has_store_access(store_id) IS TRUE);

DROP POLICY IF EXISTS categories_select ON public.categories;
CREATE POLICY categories_select ON public.categories
  FOR SELECT TO authenticated
  USING (
    public.user_has_org_membership() IS TRUE
    AND org_id = public.current_user_org_id()
    AND is_active IS TRUE
  );

DROP POLICY IF EXISTS products_select_active ON public.products;
CREATE POLICY products_select_active ON public.products
  FOR SELECT TO authenticated
  USING (
    public.user_has_org_membership() IS TRUE
    AND org_id = public.current_user_org_id()
    AND is_active IS TRUE
  );

DROP POLICY IF EXISTS inventory_balances_select ON public.inventory_balances;
CREATE POLICY inventory_balances_select ON public.inventory_balances
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_store_access(store_id) IS TRUE
  );

DROP POLICY IF EXISTS customers_select ON public.customers;
CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated
  USING (
    public.user_has_org_membership() IS TRUE
    AND org_id = public.current_user_org_id()
  );

DROP POLICY IF EXISTS customers_insert ON public.customers;
CREATE POLICY customers_insert ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_org_membership() IS TRUE
    AND org_id = public.current_user_org_id()
  );

DROP POLICY IF EXISTS sales_select ON public.sales;
CREATE POLICY sales_select ON public.sales
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_store_access(store_id) IS TRUE
  );

DROP POLICY IF EXISTS sale_items_select ON public.sale_items;
CREATE POLICY sale_items_select ON public.sale_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sales s
      WHERE s.id = sale_id
        AND s.org_id = public.current_user_org_id()
        AND public.user_has_store_access(s.store_id) IS TRUE
    )
  );

DROP POLICY IF EXISTS payments_select ON public.payments;
CREATE POLICY payments_select ON public.payments
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.sales s
      WHERE s.id = sale_id
        AND s.org_id = public.current_user_org_id()
        AND public.user_has_store_access(s.store_id) IS TRUE
    )
  );

DROP POLICY IF EXISTS inventory_movements_select ON public.inventory_movements;
CREATE POLICY inventory_movements_select ON public.inventory_movements
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_store_access(store_id) IS TRUE
  );

DROP POLICY IF EXISTS audit_logs_store_select ON public.audit_logs;
CREATE POLICY audit_logs_store_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_can_view_reports(store_id) IS TRUE
  );

DROP POLICY IF EXISTS fiscal_documents_store_select ON public.fiscal_documents;
CREATE POLICY fiscal_documents_store_select ON public.fiscal_documents
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_store_access(store_id) IS TRUE
  );

-- Defense in depth: critical writes happen through SECURITY DEFINER RPCs only.
REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.organizations,
  public.stores,
  public.profiles,
  public.store_members,
  public.products,
  public.inventory_balances,
  public.inventory_movements,
  public.sales,
  public.sale_items,
  public.payments,
  public.fiscal_documents,
  public.sale_idempotency_keys,
  public.audit_logs
FROM authenticated;
