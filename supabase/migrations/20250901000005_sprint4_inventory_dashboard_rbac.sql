-- Sprint 4: inventory audit columns, dashboard views, RBAC RPCs.
-- Does not replace Sprint 1-3 migrations or process_sale.

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS actor_role public.member_role;

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_product ON public.sale_items (sale_id, product_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON public.sale_items (product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_store_created
  ON public.inventory_movements (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_store_status_created
  ON public.sales (store_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.user_can_manage_inventory(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND public.user_has_store_access(p_store_id)
    AND (
      public.user_store_role(p_store_id) IN ('admin', 'manager')
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = (SELECT auth.uid())
          AND p.default_role IN ('admin', 'manager')
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.user_can_view_reports(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_can_manage_inventory(p_store_id);
$$;

REVOKE ALL ON FUNCTION public.user_can_manage_inventory(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_can_view_reports(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_manage_inventory(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_view_reports(uuid) TO authenticated;

-- Manager product/category writes (admin policies from Sprint 1 remain).
CREATE POLICY products_manager_insert ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.current_user_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.default_role = 'manager'
    )
  );

CREATE POLICY products_manager_update ON public.products
  FOR UPDATE TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.default_role = 'manager'
    )
  )
  WITH CHECK (
    org_id = public.current_user_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.default_role = 'manager'
    )
  );

CREATE POLICY products_select_managed ON public.products
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.default_role IN ('admin', 'manager')
    )
  );

CREATE POLICY categories_manager_write ON public.categories
  FOR ALL TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.default_role = 'manager'
    )
  )
  WITH CHECK (org_id = public.current_user_org_id());

CREATE SCHEMA IF NOT EXISTS analytics;
REVOKE ALL ON SCHEMA analytics FROM PUBLIC;
REVOKE ALL ON SCHEMA analytics FROM anon;
REVOKE ALL ON SCHEMA analytics FROM authenticated;

CREATE OR REPLACE VIEW analytics.product_period_metrics
WITH (security_invoker = true) AS
SELECT
  s.org_id,
  s.store_id,
  si.product_id,
  p.sku,
  p.name AS product_name,
  (date_trunc('day', timezone('America/Sao_Paulo', s.created_at)))::date AS period_day,
  sum(si.total)::numeric(12, 2) AS revenue,
  sum(round(si.quantity * p.cost_price, 2))::numeric(12, 2) AS cogs,
  (sum(si.total) - sum(round(si.quantity * p.cost_price, 2)))::numeric(12, 2) AS gross_profit,
  sum(si.quantity)::numeric(12, 3) AS units_sold
FROM public.sales s
JOIN public.sale_items si ON si.sale_id = s.id
JOIN public.products p ON p.id = si.product_id
WHERE s.status = 'confirmed'
GROUP BY s.org_id, s.store_id, si.product_id, p.sku, p.name,
  (date_trunc('day', timezone('America/Sao_Paulo', s.created_at)))::date;

CREATE OR REPLACE FUNCTION public.adjust_inventory(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_product_id uuid;
  v_delta numeric(12, 3);
  v_reason text;
  v_type public.inventory_movement_type;
  v_org_id uuid;
  v_role public.member_role;
  v_balance numeric(12, 3);
  v_next numeric(12, 3);
  v_movement_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  v_store_id := (p_payload->>'store_id')::uuid;
  v_product_id := (p_payload->>'product_id')::uuid;
  v_delta := (p_payload->>'delta')::numeric(12, 3);
  v_reason := NULLIF(btrim(p_payload->>'reason'), '');
  v_type := COALESCE(NULLIF(p_payload->>'movement_type', ''), 'adjustment')::public.inventory_movement_type;

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
  IF NOT public.user_can_manage_inventory(v_store_id) THEN
    RAISE EXCEPTION 'forbidden_inventory' USING ERRCODE = '42501';
  END IF;

  SELECT org_id INTO v_org_id FROM public.stores WHERE id = v_store_id;
  IF v_org_id IS NULL OR v_org_id <> public.current_user_org_id() THEN
    RAISE EXCEPTION 'store_not_in_org' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = v_product_id AND p.org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = '22023';
  END IF;

  v_role := COALESCE(public.user_store_role(v_store_id), (
    SELECT default_role FROM public.profiles WHERE id = v_user_id
  ));

  INSERT INTO public.inventory_balances (org_id, store_id, product_id, quantity)
  VALUES (v_org_id, v_store_id, v_product_id, 0)
  ON CONFLICT (store_id, product_id) DO NOTHING;

  SELECT quantity INTO v_balance
  FROM public.inventory_balances
  WHERE store_id = v_store_id AND product_id = v_product_id
  FOR UPDATE;

  v_next := v_balance + v_delta;
  IF v_next < 0 THEN
    RAISE EXCEPTION 'negative_stock' USING ERRCODE = '22023';
  END IF;

  UPDATE public.inventory_balances
  SET quantity = v_next, updated_at = now()
  WHERE store_id = v_store_id AND product_id = v_product_id;

  INSERT INTO public.inventory_movements (
    org_id, store_id, product_id, movement_type, quantity_change, balance_after,
    created_by, reason, actor_role
  )
  VALUES (
    v_org_id, v_store_id, v_product_id, v_type, v_delta, v_next,
    v_user_id, v_reason, v_role
  )
  RETURNING id INTO v_movement_id;

  INSERT INTO public.audit_logs (org_id, store_id, user_id, entity_type, entity_id, action, payload)
  VALUES (
    v_org_id,
    v_store_id,
    v_user_id,
    'inventory_movement',
    v_movement_id,
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
SET search_path = public, analytics
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
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
  v_from := COALESCE((p_payload->>'from')::date, (timezone('America/Sao_Paulo', now()))::date);
  v_to := COALESCE((p_payload->>'to')::date, v_from);
  v_after_sku := NULLIF(p_payload->>'cursor_sku', '');
  v_limit := LEAST(COALESCE((p_payload->>'limit')::integer, 20), 100);

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'store_id_required' USING ERRCODE = '22023';
  END IF;
  IF NOT public.user_can_view_reports(v_store_id) THEN
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
      ELSE to_char(round(100 * COALESCE(sum(m.gross_profit), 0) / sum(m.revenue), 2), 'FM999999999.00')
    END,
    'units_sold', COALESCE(sum(m.units_sold), 0),
    'sell_through', CASE
      WHEN COALESCE(sum(m.units_sold), 0) + COALESCE((
        SELECT sum(ib.quantity) FROM public.inventory_balances ib WHERE ib.store_id = v_store_id
      ), 0) = 0 THEN '0.00'
      ELSE to_char(
        round(
          100 * COALESCE(sum(m.units_sold), 0)
          / (
            COALESCE(sum(m.units_sold), 0)
            + COALESCE((SELECT sum(ib.quantity) FROM public.inventory_balances ib WHERE ib.store_id = v_store_id), 0)
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
    AND m.org_id = public.current_user_org_id()
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
        AND m.org_id = public.current_user_org_id()
        AND m.period_day BETWEEN v_from AND v_to
      GROUP BY m.product_id, m.sku, m.product_name
    ) agg
    LEFT JOIN public.inventory_balances ib
      ON ib.store_id = v_store_id AND ib.product_id = agg.product_id
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
      WHEN jsonb_array_length(v_rows) = v_limit THEN v_rows -> (v_limit - 1) ->> 'sku'
      ELSE NULL
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_inventory_page(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_after_sku text;
  v_limit integer;
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
  IF NOT public.user_has_store_access(v_store_id) THEN
    RAISE EXCEPTION 'forbidden_store' USING ERRCODE = '42501';
  END IF;

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
        WHEN public.user_can_manage_inventory(v_store_id)
          THEN to_char(p.cost_price, 'FM999999999.00')
        ELSE NULL
      END AS cost_price,
      COALESCE(ib.quantity, 0) AS quantity
    FROM public.products p
    LEFT JOIN public.inventory_balances ib
      ON ib.store_id = v_store_id AND ib.product_id = p.id
    WHERE p.org_id = public.current_user_org_id()
      AND (p.is_active = true OR public.user_can_manage_inventory(v_store_id))
      AND (v_after_sku IS NULL OR p.sku > v_after_sku)
    ORDER BY p.sku
    LIMIT v_limit
  ) t;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'next_cursor', CASE
      WHEN jsonb_array_length(v_rows) = v_limit THEN v_rows -> (v_limit - 1) ->> 'sku'
      ELSE NULL
    END,
    'can_adjust', public.user_can_manage_inventory(v_store_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_inventory(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dashboard_metrics(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_inventory_page(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_inventory(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inventory_page(jsonb) TO authenticated;
