-- Follow-up hardening for the authoritative dashboard boundary.
--
-- Sale items carry product snapshots, but their product foreign key was only
-- scoped by product id. Reject cross-organization attribution at the database
-- boundary before any report can observe it.

CREATE OR REPLACE FUNCTION public.assert_sale_item_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_sale_org uuid;
  v_product_org uuid;
BEGIN
  SELECT s.org_id
  INTO v_sale_org
  FROM public.sales s
  WHERE s.id = NEW.sale_id;

  SELECT p.org_id
  INTO v_product_org
  FROM public.products p
  WHERE p.id = NEW.product_id;

  IF v_sale_org IS NULL
    OR v_product_org IS NULL
    OR v_sale_org IS DISTINCT FROM v_product_org
  THEN
    RAISE EXCEPTION 'sale_item_scope_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_sale_item_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_sale_item_scope() FROM anon;
REVOKE ALL ON FUNCTION public.assert_sale_item_scope() FROM authenticated;

DROP TRIGGER IF EXISTS assert_sale_item_scope ON public.sale_items;
CREATE TRIGGER assert_sale_item_scope
  BEFORE INSERT OR UPDATE OF sale_id, product_id
  ON public.sale_items
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_sale_item_scope();

DROP POLICY IF EXISTS fiscal_documents_store_select ON public.fiscal_documents;
CREATE POLICY fiscal_documents_store_select
  ON public.fiscal_documents
  FOR SELECT
  TO authenticated
  USING (
    org_id = public.current_user_org_id()
    AND public.user_can_view_reports(store_id) IS TRUE
  );
