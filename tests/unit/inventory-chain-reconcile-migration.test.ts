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

describe("inventory ledger reconcile migration", () => {
  it("adds a catch-up movement without dropping the chain CHECK", () => {
    expect(HELPER).toContain("CREATE OR REPLACE FUNCTION public.reconcile_inventory_movement_chain");
    expect(HELPER).toContain("inventory_ledger_reconcile");
    expect(HELPER).toContain("PERFORM public.reconcile_inventory_movement_chain");
    expect(HELPER).not.toContain("DROP FUNCTION public.assert_inventory_movement_matches_balance");
    expect(HELPER).not.toContain("inventory_movement_chain_mismatch'");
    expect(HELPER).toContain("REVOKE ALL ON FUNCTION public.reconcile_inventory_movement_chain");
  });

  it("does not rewrite cash session RPCs or enable PIX", () => {
    expect(HELPER).not.toContain("CREATE OR REPLACE FUNCTION public.process_sale_with_cash(");
    expect(HELPER).not.toContain("CREATE OR REPLACE FUNCTION public.process_pix_sale(");
    expect(CARD).not.toContain("CREATE OR REPLACE FUNCTION public.process_sale_with_cash(");
    expect(CARD).not.toContain("pix_payment_intents");
    expect(CARD).not.toContain("livemode");
  });

  it("process_card_sale honors customer policy and reconciles before decrement", () => {
    expect(CARD).toContain("RAISE EXCEPTION 'customer_required_on_sale'");
    expect(CARD).toContain("PERFORM public.reconcile_inventory_movement_chain");
    expect(CARD).toContain("customer_id', p_payload->>'customer_id'");
    expect(CARD).toContain("GRANT EXECUTE ON FUNCTION public.process_card_sale(jsonb) TO authenticated");
  });
});
