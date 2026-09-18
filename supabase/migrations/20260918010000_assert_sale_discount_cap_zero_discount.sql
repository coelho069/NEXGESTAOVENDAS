-- Allow service-role PIX/card webhooks to confirm sales with zero discount.
-- assert_sale_discount_cap previously checked auth/store access before the
-- zero-discount early return, raising forbidden_store under service_role JWT.

CREATE OR REPLACE FUNCTION public.assert_sale_discount_cap(
  p_store_id uuid,
  p_discount numeric,
  p_subtotal numeric
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_role public.member_role;
  v_percent numeric(12, 2);
  v_max numeric;
BEGIN
  IF p_discount IS NULL OR p_discount <= 0 THEN
    RETURN;
  END IF;
  IF (SELECT auth.uid()) IS NULL OR NOT public.user_has_store_access(p_store_id) THEN
    RAISE EXCEPTION 'forbidden_store' USING ERRCODE = '42501';
  END IF;

  v_role := public.user_store_role(p_store_id);
  v_percent := CASE v_role
    WHEN 'cashier' THEN 5
    WHEN 'manager' THEN 20
    WHEN 'admin' THEN 100
  END;
  v_max := round(COALESCE(p_subtotal, 0) * v_percent / 100.0, 2);

  IF p_discount > v_max THEN
    RAISE EXCEPTION 'discount_limit_exceeded' USING ERRCODE = '42501';
  END IF;
END;
$$;
