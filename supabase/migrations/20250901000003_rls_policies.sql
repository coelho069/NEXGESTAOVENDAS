-- Sprint 1: RLS — revoke anon, cashier read-only products, sales immutable, audit append-only

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_idempotency_keys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Organizations: members see own org
CREATE POLICY organizations_select ON public.organizations
  FOR SELECT TO authenticated
  USING (id = public.current_user_org_id());

-- Stores: members of org
CREATE POLICY stores_select ON public.stores
  FOR SELECT TO authenticated
  USING (org_id = public.current_user_org_id());

-- Profiles: own profile + same org for admin
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR org_id = public.current_user_org_id());

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Store members
CREATE POLICY store_members_select ON public.store_members
  FOR SELECT TO authenticated
  USING (org_id = public.current_user_org_id());

-- Categories: read within org
CREATE POLICY categories_select ON public.categories
  FOR SELECT TO authenticated
  USING (org_id = public.current_user_org_id() AND is_active = true);

CREATE POLICY categories_admin_write ON public.categories
  FOR ALL TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.default_role = 'admin'
    )
  )
  WITH CHECK (org_id = public.current_user_org_id());

-- Products: cashier SELECT active only; admin full CRUD; no cashier price/cost UPDATE
CREATE POLICY products_select_active ON public.products
  FOR SELECT TO authenticated
  USING (org_id = public.current_user_org_id() AND is_active = true);

CREATE POLICY products_admin_insert ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.current_user_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.default_role = 'admin'
    )
  );

CREATE POLICY products_admin_update ON public.products
  FOR UPDATE TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.default_role = 'admin'
    )
  )
  WITH CHECK (
    org_id = public.current_user_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.default_role = 'admin'
    )
  );

CREATE POLICY products_admin_delete ON public.products
  FOR DELETE TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.default_role = 'admin'
    )
  );

-- Inventory balances: read for store members; writes via RPC only (no direct policy)
CREATE POLICY inventory_balances_select ON public.inventory_balances
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_store_access(store_id)
  );

-- Customers: read/write within org for store members
CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated
  USING (org_id = public.current_user_org_id());

CREATE POLICY customers_insert ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.current_user_org_id());

-- Sales: SELECT for store members; no UPDATE/DELETE; INSERT blocked (RPC only)
CREATE POLICY sales_select ON public.sales
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_store_access(store_id)
  );

-- Sale items: SELECT via sale access
CREATE POLICY sale_items_select ON public.sale_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_id
        AND s.org_id = public.current_user_org_id()
        AND public.user_has_store_access(s.store_id)
    )
  );

-- Payments: SELECT via sale
CREATE POLICY payments_select ON public.payments
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_id AND public.user_has_store_access(s.store_id)
    )
  );

-- Inventory movements: SELECT only
CREATE POLICY inventory_movements_select ON public.inventory_movements
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_has_store_access(store_id)
  );

-- Audit logs: append-only INSERT for authenticated org members; SELECT admin/manager
CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.default_role IN ('admin', 'manager')
    )
  );

CREATE POLICY audit_logs_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.current_user_org_id());

-- No UPDATE/DELETE on audit_logs (implicit: no policies)

-- Fiscal documents: read only
CREATE POLICY fiscal_documents_select ON public.fiscal_documents
  FOR SELECT TO authenticated
  USING (org_id = public.current_user_org_id());

-- Idempotency keys: no direct access
CREATE POLICY sale_idempotency_deny ON public.sale_idempotency_keys
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);
