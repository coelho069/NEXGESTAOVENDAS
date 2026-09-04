-- Blocker 9: server-authoritative financial reporting.
--
-- The dashboard reads only confirmed sales with captured payments. Suspended,
-- incomplete, cancelled/refunded sales and non-captured payments are excluded.
-- Date filters are local calendar ranges with [start, end) semantics in
-- America/Sao_Paulo. Historical COGS is N/D when an old sale item has no
-- immutable cost snapshot; new sale items receive that snapshot at insertion.

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS cost_price numeric(12, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'sale_items_cost_price_finite'
      AND conrelid = 'public.sale_items'::regclass
  ) THEN
    ALTER TABLE public.sale_items
      ADD CONSTRAINT sale_items_cost_price_finite
      CHECK (
        cost_price IS NULL
        OR (
          cost_price <> 'NaN'::numeric
          AND cost_price >= 0
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS sales_dashboard_scope_created_idx
  ON public.sales (org_id, store_id, created_at, id)
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS payments_dashboard_scope_status_sale_idx
  ON public.payments (org_id, store_id, status, sale_id);

CREATE INDEX IF NOT EXISTS sale_items_dashboard_sale_idx
  ON public.sale_items (sale_id, id);

CREATE INDEX IF NOT EXISTS cash_movements_dashboard_scope_created_idx
  ON public.cash_movements (org_id, store_id, created_at, movement_type);

CREATE OR REPLACE FUNCTION public.set_sale_item_cost_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_cost_price numeric(12, 2);
BEGIN
  IF NEW.cost_price IS NULL THEN
    SELECT p.cost_price
    INTO v_cost_price
    FROM public.products p
    WHERE p.id = NEW.product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'sale_item_product_not_found'
        USING ERRCODE = '23503';
    END IF;

    NEW.cost_price := v_cost_price;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_sale_item_cost_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_sale_item_cost_snapshot() FROM anon;
REVOKE ALL ON FUNCTION public.set_sale_item_cost_snapshot() FROM authenticated;

DROP TRIGGER IF EXISTS set_sale_item_cost_snapshot ON public.sale_items;
CREATE TRIGGER set_sale_item_cost_snapshot
  BEFORE INSERT ON public.sale_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_sale_item_cost_snapshot();

-- Keep the legacy analytics relation safe for any caller that still uses it.
-- The dashboard RPC below is the canonical report and additionally allocates
-- persisted sale-level discounts to product rows.
CREATE OR REPLACE VIEW analytics.product_period_metrics
WITH (security_invoker = true) AS
SELECT
  s.org_id,
  s.store_id,
  si.product_id,
  si.product_sku AS sku,
  si.product_name,
  (date_trunc('day', timezone('America/Sao_Paulo', s.created_at)))::date AS period_day,
  sum(si.total)::numeric(12, 2) AS revenue,
  sum(round(si.quantity * si.cost_price, 2))::numeric(12, 2) AS cogs,
  (
    sum(si.total) - sum(round(si.quantity * si.cost_price, 2))
  )::numeric(12, 2) AS gross_profit,
  sum(si.quantity)::numeric(12, 3) AS units_sold
FROM public.sales s
JOIN public.sale_items si
  ON si.sale_id = s.id
JOIN public.payments p
  ON p.sale_id = s.id
 AND p.org_id = s.org_id
 AND p.store_id = s.store_id
WHERE s.status = 'confirmed'
  AND p.status = 'captured'
  AND p.amount = s.total
GROUP BY
  s.org_id,
  s.store_id,
  si.product_id,
  si.product_sku,
  si.product_name,
  (date_trunc('day', timezone('America/Sao_Paulo', s.created_at)))::date;

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_store_id uuid;
  v_org_id uuid;
  v_from date;
  v_to date;
  v_after_sku text;
  v_limit integer;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_response jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_store_id := NULLIF(p_payload->>'store_id', '')::uuid;
    v_from := COALESCE(
      NULLIF(p_payload->>'from', '')::date,
      (timezone('America/Sao_Paulo', now()))::date
    );
    v_to := COALESCE(
      NULLIF(p_payload->>'to', '')::date,
      v_from + 1
    );
    v_after_sku := NULLIF(p_payload->>'cursor_sku', '');
    v_limit := LEAST(
      GREATEST(COALESCE((p_payload->>'limit')::integer, 20), 1),
      100
    );
  EXCEPTION
    WHEN invalid_text_representation
      OR datetime_field_overflow
      OR numeric_value_out_of_range
    THEN
      RAISE EXCEPTION 'invalid_period' USING ERRCODE = '22023';
  END;

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

  IF v_from >= v_to OR v_to > v_from + 366 THEN
    RAISE EXCEPTION 'invalid_period' USING ERRCODE = '22023';
  END IF;

  v_start_at := v_from::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_end_at := v_to::timestamp AT TIME ZONE 'America/Sao_Paulo';

  /*
   * All official values below are produced by this single SQL statement.
   * MATERIALIZED CTEs prevent the rows, summary and auxiliary totals from
   * using different report populations while the statement is running.
   */
  WITH eligible_sales AS MATERIALIZED (
    SELECT
      s.id AS sale_id,
      s.org_id,
      s.store_id,
      s.subtotal,
      s.discount AS sale_discount,
      s.total,
      s.created_at,
      p.id AS payment_id,
      p.method AS payment_method,
      p.amount AS payment_amount,
      p.status AS payment_status
    FROM public.sales s
    JOIN public.payments p
      ON p.sale_id = s.id
     AND p.org_id = s.org_id
     AND p.store_id = s.store_id
    WHERE s.org_id = v_org_id
      AND s.store_id = v_store_id
      AND s.created_at >= v_start_at
      AND s.created_at < v_end_at
      AND s.status = 'confirmed'
      AND p.status = 'captured'
      AND p.amount = s.total
  ),
  line_base AS MATERIALIZED (
    SELECT
      es.sale_id,
      es.sale_discount,
      es.total AS sale_total,
      es.payment_method,
      es.payment_amount,
      es.created_at,
      si.id AS sale_item_id,
      si.product_id,
      si.product_sku,
      si.product_name,
      si.quantity,
      si.discount AS item_discount,
      si.total AS item_total,
      si.cost_price,
      sum(si.total) OVER (PARTITION BY si.sale_id) AS sale_items_total,
      row_number() OVER (
        PARTITION BY si.sale_id
        ORDER BY si.id
      ) AS item_position,
      count(*) OVER (PARTITION BY si.sale_id) AS item_count
    FROM eligible_sales es
    JOIN public.sale_items si
      ON si.sale_id = es.sale_id
  ),
  line_allocations AS MATERIALIZED (
    SELECT
      lb.*,
      CASE
        WHEN lb.sale_items_total = 0 THEN 0::numeric
        WHEN lb.item_position < lb.item_count THEN
          round(lb.sale_discount * lb.item_total / lb.sale_items_total, 2)
        ELSE
          lb.sale_discount - COALESCE(
            sum(
              CASE
                WHEN lb.item_position < lb.item_count THEN
                  round(
                    lb.sale_discount
                      * lb.item_total
                      / NULLIF(lb.sale_items_total, 0),
                    2
                  )
                ELSE 0::numeric
              END
            ) OVER (
              PARTITION BY lb.sale_id
              ORDER BY lb.item_position
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ),
            0
          )
      END AS allocated_sale_discount
    FROM line_base lb
  ),
  financial_lines AS MATERIALIZED (
    SELECT DISTINCT ON (la.sale_item_id)
      la.sale_id,
      la.product_id,
      la.product_sku,
      la.product_name,
      la.quantity,
      la.item_discount,
      la.allocated_sale_discount,
      round(la.item_total - la.allocated_sale_discount, 2) AS line_revenue,
      la.cost_price,
      CASE
        WHEN la.cost_price IS NULL THEN NULL
        ELSE round(la.quantity * la.cost_price, 2)
      END AS line_cogs,
      la.payment_method
    FROM line_allocations la
    ORDER BY la.sale_item_id, la.item_position DESC
  ),
  product_rows AS MATERIALIZED (
    SELECT
      fl.product_id,
      fl.product_sku AS sku,
      fl.product_name,
      round(sum(fl.line_revenue), 2)::text AS revenue,
      round(
        sum(fl.item_discount + fl.allocated_sale_discount),
        2
      )::text AS discounts,
      CASE
        WHEN bool_and(fl.cost_price IS NOT NULL)
          THEN round(sum(fl.line_cogs), 2)::text
        ELSE NULL
      END AS cogs,
      CASE
        WHEN bool_and(fl.cost_price IS NOT NULL)
          THEN round(sum(fl.line_revenue) - sum(fl.line_cogs), 2)::text
        ELSE NULL
      END AS gross_profit,
      COALESCE(sum(fl.quantity), 0) AS units_sold,
      COALESCE(ib.quantity, 0) AS on_hand,
      CASE
        WHEN sum(fl.quantity) + COALESCE(ib.quantity, 0) = 0 THEN '0.00'
        ELSE round(
          100 * sum(fl.quantity)
            / (sum(fl.quantity) + COALESCE(ib.quantity, 0)),
          2
        )::text
      END AS sell_through,
      bool_and(fl.cost_price IS NOT NULL) AS cogs_available
    FROM financial_lines fl
    LEFT JOIN public.inventory_balances ib
      ON ib.org_id = v_org_id
     AND ib.store_id = v_store_id
     AND ib.product_id = fl.product_id
    GROUP BY
      fl.product_id,
      fl.product_sku,
      fl.product_name,
      ib.quantity
  ),
  paged_rows AS MATERIALIZED (
    SELECT
      pr.*,
      row_number() OVER (ORDER BY pr.sku) AS page_position
    FROM product_rows pr
    WHERE v_after_sku IS NULL OR pr.sku > v_after_sku
    ORDER BY pr.sku
    LIMIT v_limit + 1
  ),
  page_metadata AS (
    SELECT
      COALESCE(
        jsonb_agg(
          (to_jsonb(pr) - 'page_position')
          ORDER BY pr.sku
        ) FILTER (WHERE pr.page_position <= v_limit),
        '[]'::jsonb
      ) AS rows,
      CASE
        WHEN count(*) > v_limit
          THEN max(pr.sku) FILTER (WHERE pr.page_position = v_limit)
        ELSE NULL
      END AS next_cursor
    FROM paged_rows pr
  ),
  inventory_totals AS (
    SELECT
      COALESCE(sum(ib.quantity), 0) AS on_hand_quantity,
      count(*)::integer AS sku_count,
      count(*) FILTER (WHERE ib.quantity < 0)::integer AS negative_quantity_rows
    FROM public.inventory_balances ib
    WHERE ib.org_id = v_org_id
      AND ib.store_id = v_store_id
  ),
  payment_totals AS (
    SELECT
      jsonb_build_object(
        'cash', round(COALESCE(sum(payment_amount) FILTER (WHERE payment_method = 'cash'), 0), 2)::text,
        'card', round(COALESCE(sum(payment_amount) FILTER (WHERE payment_method = 'card'), 0), 2)::text,
        'pix', round(COALESCE(sum(payment_amount) FILTER (WHERE payment_method = 'pix'), 0), 2)::text,
        'voucher', round(COALESCE(sum(payment_amount) FILTER (WHERE payment_method = 'voucher'), 0), 2)::text,
        'other', round(COALESCE(sum(payment_amount) FILTER (WHERE payment_method = 'other'), 0), 2)::text
      ) AS amounts,
      jsonb_build_object(
        'cash', count(*) FILTER (WHERE payment_method = 'cash'),
        'card', count(*) FILTER (WHERE payment_method = 'card'),
        'pix', count(*) FILTER (WHERE payment_method = 'pix'),
        'voucher', count(*) FILTER (WHERE payment_method = 'voucher'),
        'other', count(*) FILTER (WHERE payment_method = 'other')
      ) AS counts
    FROM eligible_sales
  ),
  discount_totals AS (
    SELECT
      round(COALESCE(sum(fl.item_discount), 0), 2) AS item_discounts,
      round(COALESCE((
        SELECT sum(es.sale_discount)
        FROM eligible_sales es
      ), 0), 2) AS sale_discounts
    FROM financial_lines fl
  ),
  cash_totals AS (
    SELECT
      round(COALESCE(sum(cm.amount) FILTER (WHERE cm.movement_type = 'sale_cash'), 0), 2) AS cash_ledger_sales,
      round(COALESCE(sum(cm.amount), 0), 2) AS cash_ledger_net,
      round(COALESCE(sum(cm.amount) FILTER (WHERE cm.movement_type = 'supply'), 0), 2) AS supplies,
      round(COALESCE(sum(cm.amount) FILTER (WHERE cm.movement_type = 'withdrawal'), 0), 2) AS withdrawals
    FROM public.cash_movements cm
    WHERE cm.org_id = v_org_id
      AND cm.store_id = v_store_id
      AND cm.created_at >= v_start_at
      AND cm.created_at < v_end_at
  ),
  cash_session_totals AS (
    SELECT
      count(*) FILTER (
        WHERE cs.status = 'open'
          AND cs.opened_at < v_end_at
          AND (
            cs.closed_at IS NULL
            OR cs.closed_at >= v_start_at
          )
      )::integer AS open_sessions,
      count(*) FILTER (
        WHERE cs.status = 'closed'
          AND cs.closed_at >= v_start_at
          AND cs.closed_at < v_end_at
      )::integer AS closed_sessions,
      round(COALESCE(sum(cs.expected_amount) FILTER (
        WHERE cs.status = 'closed'
          AND cs.closed_at >= v_start_at
          AND cs.closed_at < v_end_at
      ), 0), 2) AS closed_expected,
      round(COALESCE(sum(cs.counted_amount) FILTER (
        WHERE cs.status = 'closed'
          AND cs.closed_at >= v_start_at
          AND cs.closed_at < v_end_at
      ), 0), 2) AS closed_counted,
      round(COALESCE(sum(cs.difference) FILTER (
        WHERE cs.status = 'closed'
          AND cs.closed_at >= v_start_at
          AND cs.closed_at < v_end_at
      ), 0), 2) AS closed_difference
    FROM public.cash_sessions cs
    WHERE cs.org_id = v_org_id
      AND cs.store_id = v_store_id
  ),
  excluded_sales AS (
    SELECT COALESCE(jsonb_object_agg(status, total), '{}'::jsonb) AS values
    FROM (
      SELECT
        s.status::text AS status,
        count(*)::integer AS total
      FROM public.sales s
      WHERE s.org_id = v_org_id
        AND s.store_id = v_store_id
        AND s.created_at >= v_start_at
        AND s.created_at < v_end_at
        AND s.status <> 'confirmed'
      GROUP BY s.status
      UNION ALL
      SELECT
        'payment_' || COALESCE(p.status::text, 'missing') AS status,
        count(*)::integer AS total
      FROM public.sales s
      LEFT JOIN public.payments p
        ON p.sale_id = s.id
       AND p.org_id = s.org_id
       AND p.store_id = s.store_id
      WHERE s.org_id = v_org_id
        AND s.store_id = v_store_id
        AND s.created_at >= v_start_at
        AND s.created_at < v_end_at
        AND s.status = 'confirmed'
        AND (
          p.status IS DISTINCT FROM 'captured'
          OR p.amount IS DISTINCT FROM s.total
        )
      GROUP BY p.status
    ) excluded
  ),
  excluded_payments AS (
    SELECT COALESCE(jsonb_object_agg(status, total), '{}'::jsonb) AS values
    FROM (
      SELECT
        p.status::text AS status,
        count(*)::integer AS total
      FROM public.payments p
      JOIN public.sales s
        ON s.id = p.sale_id
       AND s.org_id = p.org_id
       AND s.store_id = p.store_id
      WHERE s.org_id = v_org_id
        AND s.store_id = v_store_id
        AND s.created_at >= v_start_at
        AND s.created_at < v_end_at
        AND p.status <> 'captured'
      GROUP BY p.status
    ) excluded
  ),
  fiscal_totals AS (
    SELECT COALESCE(jsonb_object_agg(status, total), '{}'::jsonb) AS values
    FROM (
      SELECT
        COALESCE(fd.status::text, 'missing') AS status,
        count(*)::integer AS total
      FROM eligible_sales es
      LEFT JOIN public.fiscal_documents fd
        ON fd.sale_id = es.sale_id
       AND fd.org_id = es.org_id
       AND fd.store_id = es.store_id
      GROUP BY COALESCE(fd.status::text, 'missing')
    ) fiscal
  ),
  sales_totals AS (
    SELECT
      COALESCE(sum(es.total), 0) AS revenue,
      count(*)::integer AS sales_count
    FROM eligible_sales es
  ),
  line_totals AS (
    SELECT
      COALESCE(sum(fl.quantity), 0) AS units_sold,
      count(fl.sale_id)::integer AS line_count,
      COALESCE(bool_and(fl.cost_price IS NOT NULL), false) AS cogs_available,
      COALESCE(sum(fl.line_cogs), 0) AS cogs
    FROM financial_lines fl
  ),
  financial_summary AS (
    SELECT
      jsonb_build_object(
        'revenue', round(st.revenue, 2)::text,
        'cogs', CASE
          WHEN lt.line_count > 0 AND lt.cogs_available
            THEN round(lt.cogs, 2)::text
          ELSE NULL
        END,
        'gross_profit', CASE
          WHEN lt.line_count > 0 AND lt.cogs_available
            THEN round(st.revenue - lt.cogs, 2)::text
          ELSE NULL
        END,
        'margin_percent', CASE
          WHEN lt.line_count > 0
            AND lt.cogs_available
            AND st.revenue > 0
            THEN round(
              100 * (st.revenue - lt.cogs) / st.revenue,
              2
            )::text
          ELSE NULL
        END,
        'units_sold', lt.units_sold,
        'sell_through', CASE
          WHEN lt.units_sold
            + (SELECT on_hand_quantity FROM inventory_totals) = 0
            THEN '0.00'
          ELSE round(
            100 * lt.units_sold
              / (
                lt.units_sold
                + (SELECT on_hand_quantity FROM inventory_totals)
              ),
            2
          )::text
        END,
        'sales_count', st.sales_count,
        'average_ticket', CASE
          WHEN st.sales_count = 0 THEN NULL
          ELSE round(
            st.revenue / st.sales_count,
            2
          )::text
        END,
        'total_discounts', round(
          (SELECT item_discounts + sale_discounts FROM discount_totals),
          2
        )::text,
        'item_discounts', (
          SELECT item_discounts::text FROM discount_totals
        ),
        'sale_discounts', (
          SELECT sale_discounts::text FROM discount_totals
        ),
        'payments_by_method', (
          SELECT amounts FROM payment_totals
        ),
        'payment_counts_by_method', (
          SELECT counts FROM payment_totals
        ),
        'cash', jsonb_build_object(
          'captured_cash_payments', round(
            COALESCE((SELECT amounts->>'cash' FROM payment_totals), '0.00')::numeric,
            2
          )::text,
          'cash_ledger_sales', (SELECT cash_ledger_sales::text FROM cash_totals),
          'cash_ledger_net', (SELECT cash_ledger_net::text FROM cash_totals),
          'supplies', (SELECT supplies::text FROM cash_totals),
          'withdrawals', (SELECT withdrawals::text FROM cash_totals),
          'open_sessions', (SELECT open_sessions FROM cash_session_totals),
          'closed_sessions', (SELECT closed_sessions FROM cash_session_totals),
          'closed_expected', (SELECT closed_expected::text FROM cash_session_totals),
          'closed_counted', (SELECT closed_counted::text FROM cash_session_totals),
          'closed_difference', (SELECT closed_difference::text FROM cash_session_totals)
        ),
        'inventory', jsonb_build_object(
          'on_hand_quantity', (
            SELECT on_hand_quantity::text FROM inventory_totals
          ),
          'sku_count', (SELECT sku_count FROM inventory_totals),
          'negative_quantity_rows', (
            SELECT negative_quantity_rows FROM inventory_totals
          )
        ),
        'excluded_sales', (SELECT values FROM excluded_sales),
        'excluded_payments', (SELECT values FROM excluded_payments),
        'fiscal_by_status', (SELECT values FROM fiscal_totals),
        'cogs_available', (
          lt.line_count > 0
          AND lt.cogs_available
        )
      ) AS summary
    FROM sales_totals st
    CROSS JOIN line_totals lt
  )
  SELECT jsonb_build_object(
    'summary', (SELECT summary FROM financial_summary),
    'rows', (SELECT rows FROM page_metadata),
    'from', v_from,
    'to', v_to,
    'next_cursor', (SELECT next_cursor FROM page_metadata)
  )
  INTO v_response;

  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_metrics(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dashboard_metrics(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics(jsonb) TO authenticated;
