-- P0 hotfix: PDV catalog failed with SQLSTATE 42501 (permission denied for table products).
-- RLS policy products_select_active allowed SELECT for authenticated, but the role lacked
-- GRANT SELECT on public.products (only service_role had table-level access). Policies alone
-- do not grant privileges; both GRANT and RLS must align.

GRANT SELECT ON TABLE public.products TO authenticated;
