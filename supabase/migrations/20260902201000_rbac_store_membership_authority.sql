-- RBAC authority is the active store_members.role for auth.uid() and store_id.
-- profiles.default_role remains metadata only and is not consulted by authorization.

CREATE OR REPLACE FUNCTION public.user_has_store_access(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.store_members sm
      JOIN public.stores s ON s.id = sm.store_id AND s.org_id = sm.org_id
      WHERE sm.user_id = (SELECT auth.uid())
        AND sm.store_id = p_store_id
        AND sm.org_id = public.current_user_org_id()
        AND s.is_active
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
  JOIN public.stores s ON s.id = sm.store_id AND s.org_id = sm.org_id
  WHERE sm.user_id = (SELECT auth.uid())
    AND sm.store_id = p_store_id
    AND sm.org_id = public.current_user_org_id()
    AND s.is_active
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.user_has_org_role(p_roles public.member_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND p_roles IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.store_members sm
      JOIN public.stores s ON s.id = sm.store_id AND s.org_id = sm.org_id
      WHERE sm.user_id = (SELECT auth.uid())
        AND sm.org_id = public.current_user_org_id()
        AND sm.role = ANY (p_roles)
        AND s.is_active
    );
$$;

CREATE OR REPLACE FUNCTION public.user_can_manage_inventory(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.user_store_role(p_store_id) IN ('admin', 'manager');
$$;

CREATE OR REPLACE FUNCTION public.user_can_view_reports(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.user_store_role(p_store_id) IN ('admin', 'manager');
$$;

REVOKE ALL ON FUNCTION public.user_has_store_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_store_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_org_role(public.member_role[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_can_manage_inventory(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_can_view_reports(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_store_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_store_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_org_role(public.member_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_manage_inventory(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_view_reports(uuid) TO authenticated;

-- Remove permissive historical policies whose predicates used profiles.default_role.
DROP POLICY IF EXISTS categories_admin_write ON public.categories;
DROP POLICY IF EXISTS categories_manager_write ON public.categories;
DROP POLICY IF EXISTS products_admin_insert ON public.products;
DROP POLICY IF EXISTS products_admin_update ON public.products;
DROP POLICY IF EXISTS products_admin_delete ON public.products;
DROP POLICY IF EXISTS products_manager_insert ON public.products;
DROP POLICY IF EXISTS products_manager_update ON public.products;
DROP POLICY IF EXISTS products_select_managed ON public.products;
DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;

CREATE POLICY products_membership_insert ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.current_user_org_id()
    AND public.user_has_org_role(ARRAY['admin', 'manager']::public.member_role[])
    AND public.category_belongs_to_org(category_id, public.current_user_org_id())
  );

CREATE POLICY products_membership_update ON public.products
  FOR UPDATE TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_org_role(ARRAY['admin', 'manager']::public.member_role[])
  )
  WITH CHECK (
    org_id = public.current_user_org_id()
    AND public.user_has_org_role(ARRAY['admin', 'manager']::public.member_role[])
    AND public.category_belongs_to_org(category_id, public.current_user_org_id())
  );

CREATE POLICY products_membership_delete ON public.products
  FOR DELETE TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_org_role(ARRAY['admin']::public.member_role[])
  );

CREATE POLICY products_membership_select ON public.products
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_org_role(ARRAY['admin', 'manager']::public.member_role[])
  );

CREATE POLICY categories_membership_write ON public.categories
  FOR ALL TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_org_role(ARRAY['admin', 'manager']::public.member_role[])
  )
  WITH CHECK (
    org_id = public.current_user_org_id()
    AND public.user_has_org_role(ARRAY['admin', 'manager']::public.member_role[])
  );

CREATE POLICY audit_logs_membership_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_org_role(ARRAY['admin', 'manager']::public.member_role[])
  );

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

  SELECT s.org_id INTO v_org_id
  FROM public.stores s
  WHERE s.id = v_store_id AND s.is_active;

  v_role := public.user_store_role(v_store_id);
  IF v_org_id IS NULL OR v_role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'forbidden_inventory' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = v_product_id AND p.org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.inventory_balances (org_id, store_id, product_id, quantity)
  VALUES (v_org_id, v_store_id, v_product_id, 0)
  ON CONFLICT (store_id, product_id) DO NOTHING;

  SELECT ib.quantity INTO v_balance
  FROM public.inventory_balances ib
  WHERE ib.store_id = v_store_id AND ib.product_id = v_product_id
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

REVOKE ALL ON FUNCTION public.adjust_inventory(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_inventory(jsonb) TO authenticated;
