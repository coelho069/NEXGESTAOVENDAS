-- Sale discount cap by store role. Does not change RLS or Dexie.
-- Wraps existing process_sale (renamed to process_sale_core).

CREATE OR REPLACE FUNCTION public.assert_sale_discount_cap(
  p_store_id uuid,
  p_discount numeric,
  p_subtotal numeric
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.member_role;
  v_percent numeric(12, 2);
  v_max numeric(12, 2);
BEGIN
  IF p_discount IS NULL OR p_discount <= 0 THEN
    RETURN;
  END IF;
  IF p_store_id IS NULL THEN
    RAISE EXCEPTION 'store_id_required' USING ERRCODE = '22023';
  END IF;

  v_role := COALESCE(
    public.user_store_role(p_store_id),
    (
      SELECT p.default_role
      FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
    ),
    'cashier'::public.member_role
  );

  v_percent := CASE v_role
    WHEN 'cashier' THEN 5
    WHEN 'manager' THEN 20
    ELSE 100
  END;
  v_max := round(COALESCE(p_subtotal, 0) * v_percent / 100.0, 2);

  IF p_discount > v_max THEN
    RAISE EXCEPTION 'discount_limit_exceeded' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_sale_discount_cap(uuid, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_sale_discount_cap(uuid, numeric, numeric) TO authenticated;

ALTER FUNCTION public.process_sale(jsonb) RENAME TO process_sale_core;

REVOKE ALL ON FUNCTION public.process_sale_core(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_sale_core(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.process_sale_core(jsonb) FROM authenticated;

CREATE OR REPLACE FUNCTION public.process_sale(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid := NULLIF(p_payload->>'store_id', '')::uuid;
  v_discount numeric(12, 2) := COALESCE((p_payload->>'discount')::numeric(12, 2), 0);
  v_gross_subtotal numeric(12, 2) := 0;
  v_item jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb)) AS t(value)
  LOOP
    v_gross_subtotal := v_gross_subtotal + round(
      COALESCE((v_item->>'quantity')::numeric, 0) * COALESCE((v_item->>'unit_price')::numeric, 0),
      2
    );
    v_discount := v_discount + COALESCE((v_item->>'discount')::numeric, 0);
  END LOOP;

  PERFORM public.assert_sale_discount_cap(v_store_id, v_discount, v_gross_subtotal);
  RETURN public.process_sale_core(p_payload);
END;
$$;

REVOKE ALL ON FUNCTION public.process_sale(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_sale(jsonb) TO authenticated;
