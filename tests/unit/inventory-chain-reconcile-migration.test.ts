import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HELPER = readFileSync(
  join(process.cwd(), "supabase/migrations/20260909193000_sale_customer_and_inventory_chain.sql"),
  "utf8"
);
const CARD = readFileSync(
  join(process.cwd(), "supabase/migrations/20260909193100_process_card_sale_customer_chain.sql"),
  "utf8"
);
const WALK_IN = readFileSync(
  join(process.cwd(), "supabase/migrations/20260909193200_cash_walk_in_without_customer.sql"),
  "utf8"
);

describe("inventory ledger reconcile migration", () => {
  it("adds a catch-up movement without dropping the chain CHECK", () => {
    expect(HELPER).toContain("CREATE OR REPLACE FUNCTION public.reconcile_inventory_movement_chain");
    expect(HELPER).toContain("inventory_ledger_reconcile");
    expect(HELPER).toContain("BEFORE UPDATE OF quantity ON public.inventory_balances");
    expect(HELPER).not.toContain("DROP FUNCTION public.assert_inventory_movement_matches_balance");
    expect(HELPER).not.toContain("inventory_movement_chain_mismatch'");
    expect(HELPER).toContain("REVOKE ALL ON FUNCTION public.reconcile_inventory_movement_chain");
    expect(HELPER).not.toContain("CREATE OR REPLACE FUNCTION public.process_sale_core");
  });

  it("does not rewrite cash session RPCs or enable PIX", () => {
    expect(HELPER).not.toContain("CREATE OR REPLACE FUNCTION public.process_sale_with_cash(");
    expect(HELPER).not.toContain("CREATE OR REPLACE FUNCTION public.process_pix_sale(");
    expect(CARD).not.toContain("CREATE OR REPLACE FUNCTION public.process_sale_with_cash(");
    expect(CARD).not.toContain("pix_payment_intents");
    expect(CARD).not.toContain("livemode");
  });

  it("process_card_sale allows walk-in and reconciles before decrement", () => {
    expect(CARD).not.toContain("RAISE EXCEPTION 'customer_required_on_sale'");
    expect(CARD).toContain("PERFORM public.reconcile_inventory_movement_chain");
    expect(CARD).toContain("customer_id', p_payload->>'customer_id'");
    expect(CARD).toContain("GRANT EXECUTE ON FUNCTION public.process_card_sale(jsonb) TO authenticated");
  });
});

describe("cash walk-in migration", () => {
  it("relaxes assert_store_sale_settings so missing customer_id is allowed", () => {
    expect(WALK_IN).toContain("CREATE OR REPLACE FUNCTION public.assert_store_sale_settings");
    expect(WALK_IN).toContain("Walk-in: never raise customer_required_on_sale");
    expect(WALK_IN).not.toMatch(/RAISE EXCEPTION 'customer_required_on_sale'/);
    expect(WALK_IN).toContain("to_regclass('public.store_settings')");
    expect(WALK_IN).toContain("require_customer_on_sale = false");
  });
});
