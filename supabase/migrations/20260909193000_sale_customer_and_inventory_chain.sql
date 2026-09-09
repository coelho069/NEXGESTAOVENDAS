-- Inventory ledger catch-up without weakening the movement-chain CHECK.
-- BEV-001 Centro drift: stock 226 vs last movement 176 after a balance-only restock.
-- Sale writers update quantity first, then insert the movement. If the last
-- movement.balance_after disagrees with current stock, the trigger raises
-- inventory_movement_chain_mismatch. Reconcile inserts an append-only
-- adjustment so previous + delta = current qty, then the sale movement holds.

CREATE OR REPLACE FUNCTION public.reconcile_inventory_movement_chain(
  p_org_id uuid,
  p_store_id uuid,
  p_product_id uuid,
  p_actor uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_quantity numeric(12, 3);
  v_previous_balance numeric(12, 3);
  v_delta numeric(12, 3);
  v_actor uuid;
BEGIN
  IF p_org_id IS NULL OR p_store_id IS NULL OR p_product_id IS NULL THEN
    RETURN;
  END IF;

  SELECT ib.quantity
  INTO v_quantity
  FROM public.inventory_balances ib
  WHERE ib.org_id = p_org_id
    AND ib.store_id = p_store_id
    AND ib.product_id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT im.balance_after, im.created_by
  INTO v_previous_balance, v_actor
  FROM public.inventory_movements im
  WHERE im.org_id = p_org_id
    AND im.store_id = p_store_id
    AND im.product_id = p_product_id
  ORDER BY im.movement_seq DESC
  LIMIT 1;

  IF NOT FOUND OR v_previous_balance IS NOT DISTINCT FROM v_quantity THEN
    RETURN;
  END IF;

  v_delta := v_quantity - v_previous_balance;
  v_actor := COALESCE(p_actor, v_actor);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'inventory_ledger_actor_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.inventory_movements (
    org_id,
    store_id,
    product_id,
    movement_type,
    quantity_change,
    balance_after,
    created_by,
    reason,
    actor_role
  )
  VALUES (
    p_org_id,
    p_store_id,
    p_product_id,
    'adjustment',
    v_delta,
    v_quantity,
    v_actor,
    'inventory_ledger_reconcile',
    'admin'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_inventory_movement_chain(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_inventory_movement_chain(uuid, uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.reconcile_inventory_movement_chain(uuid, uuid, uuid, uuid) FROM authenticated;

-- Heal existing drift before sale writers run. Does not change quantities.
DO $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT
      ib.org_id,
      ib.store_id,
      ib.product_id,
      COALESCE(
        (
          SELECT im.created_by
          FROM public.inventory_movements im
          WHERE im.org_id = ib.org_id
            AND im.store_id = ib.store_id
            AND im.product_id = ib.product_id
          ORDER BY im.movement_seq DESC
          LIMIT 1
        ),
        (
          SELECT sm.user_id
          FROM public.store_members sm
          WHERE sm.store_id = ib.store_id
            AND sm.role = 'admin'
          LIMIT 1
        )
      ) AS actor
    FROM public.inventory_balances ib
  LOOP
    IF v_row.actor IS NOT NULL THEN
      PERFORM public.reconcile_inventory_movement_chain(
        v_row.org_id,
        v_row.store_id,
        v_row.product_id,
        v_row.actor
      );
    END IF;
  END LOOP;
END;
$$;

-- Any quantity change (process_sale_core, process_card_sale, adjust_inventory)
-- heals ledger drift first so the chain CHECK still holds. Does not rewrite
-- process_sale_core (prod/local bodies have diverged; sale_items must stay).
CREATE OR REPLACE FUNCTION public.reconcile_inventory_balance_before_quantity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
    PERFORM public.reconcile_inventory_movement_chain(
      NEW.org_id,
      NEW.store_id,
      NEW.product_id,
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_inventory_balance_before_quantity_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_inventory_balance_before_quantity_change() FROM anon;
REVOKE ALL ON FUNCTION public.reconcile_inventory_balance_before_quantity_change() FROM authenticated;

DROP TRIGGER IF EXISTS reconcile_inventory_balance_before_quantity_change
  ON public.inventory_balances;
CREATE TRIGGER reconcile_inventory_balance_before_quantity_change
  BEFORE UPDATE OF quantity ON public.inventory_balances
  FOR EACH ROW
  EXECUTE FUNCTION public.reconcile_inventory_balance_before_quantity_change();
