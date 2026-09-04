-- Add a monotonic insertion sequence so the movement-chain check remains
-- deterministic even when several movements share transaction_timestamp.

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS movement_seq bigint GENERATED ALWAYS AS IDENTITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_movements_movement_seq
  ON public.inventory_movements (movement_seq);

CREATE OR REPLACE FUNCTION public.assert_inventory_movement_matches_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_quantity numeric(12, 3);
  v_previous_balance numeric(12, 3);
BEGIN
  SELECT ib.quantity
  INTO v_quantity
  FROM public.inventory_balances ib
  WHERE ib.org_id = NEW.org_id
    AND ib.store_id = NEW.store_id
    AND ib.product_id = NEW.product_id;

  IF NOT FOUND
    OR v_quantity IS DISTINCT FROM NEW.balance_after
    OR NEW.balance_after - NEW.quantity_change < 0
  THEN
    RAISE EXCEPTION 'inventory_movement_balance_mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT im.balance_after
  INTO v_previous_balance
  FROM public.inventory_movements im
  WHERE im.org_id = NEW.org_id
    AND im.store_id = NEW.store_id
    AND im.product_id = NEW.product_id
    AND im.id IS DISTINCT FROM NEW.id
  ORDER BY im.movement_seq DESC
  LIMIT 1;

  IF FOUND
    AND v_previous_balance + NEW.quantity_change IS DISTINCT FROM NEW.balance_after
  THEN
    RAISE EXCEPTION 'inventory_movement_chain_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_inventory_movement_matches_balance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_inventory_movement_matches_balance() FROM anon;
REVOKE ALL ON FUNCTION public.assert_inventory_movement_matches_balance() FROM authenticated;
