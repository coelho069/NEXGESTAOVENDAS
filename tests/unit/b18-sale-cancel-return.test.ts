import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CASH_SESSION_CLOSED_FOR_REFUND,
  buildReturnableItems,
  canCancelSale,
  canReturnSale,
  computeSaleReturn,
  evaluateCashRefundSession,
  isSaleCancellableStatus,
  isSaleReturnableStatus,
  nextSaleStatusAfterReturn,
} from "@/lib/domain/sale-return";
import { saleCancelInputSchema, saleReturnInputSchema } from "@/lib/validation/schemas";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260905180000_b18_sale_cancel_return.sql"),
  "utf8"
);

const SALE_ITEM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const STORE_ID = "22222222-2222-4222-8222-222222222201";
const SALE_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const TERMINAL_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const MUTATION_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";

function returnableFromSale(quantitySold: string, alreadyReturned = "0.000") {
  return buildReturnableItems(
    [
      {
        sale_item_id: SALE_ITEM_ID,
        product_id: PRODUCT_ID,
        product_sku: "SKU-A",
        product_name: "Produto A",
        quantity: quantitySold,
        unit_price: "20.00",
        discount: "0.00",
        total: "100.00",
      },
    ],
    { [SALE_ITEM_ID]: alreadyReturned }
  );
}

describe("B18 migration financial contract (server-side SQL)", () => {
  it("creates sale_returns / sale_return_items with scoped FKs and mutation uniqueness", () => {
    expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS public.sale_returns");
    expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS public.sale_return_items");
    expect(MIGRATION).toContain("CONSTRAINT sale_returns_sale_scope_fk");
    expect(MIGRATION).toContain("CONSTRAINT sale_returns_store_scope_fk");
    expect(MIGRATION).toContain("CREATE UNIQUE INDEX IF NOT EXISTS sale_returns_mutation_key");
    expect(MIGRATION).toContain("ON public.sale_returns (org_id, store_id, client_mutation_id)");
    expect(MIGRATION).toContain("CONSTRAINT sale_return_items_unique_item");
  });

  it("adds refund_cash ledger identity and one cash movement per return", () => {
    expect(MIGRATION).toContain("ADD VALUE IF NOT EXISTS 'refund_cash'");
    expect(MIGRATION).toContain("movement_type = 'refund_cash'");
    expect(MIGRATION).toContain("AND amount < 0");
    expect(MIGRATION).toContain("AND sale_return_id IS NOT NULL");
    expect(MIGRATION).toContain("CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_sale_return_key");
    expect(MIGRATION).toContain("ON public.cash_movements (sale_return_id)");
  });

  it("pins SECURITY DEFINER RPCs with search_path and row locks", () => {
    expect(MIGRATION).toMatch(
      /CREATE OR REPLACE FUNCTION public\.process_sale_return\(p_payload jsonb\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog, public, pg_temp/
    );
    expect(MIGRATION).toMatch(
      /CREATE OR REPLACE FUNCTION public\.cancel_sale\(p_payload jsonb\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog, public, pg_temp/
    );
    expect(MIGRATION).toContain("FOR UPDATE");
    expect(MIGRATION).toContain("FROM public.sales sa");
    expect(MIGRATION).toContain("FROM public.sale_items si");
    expect(MIGRATION).toContain("FROM public.inventory_balances ib");
  });

  it("rejects excess quantity before writing returns and restores inventory via refund movements", () => {
    expect(MIGRATION).toContain("sale_return_quantity_exceeded");
    expect(MIGRATION).toContain("v_qty > (v_sale_item.quantity - v_already_qty)");
    expect(MIGRATION).toContain("movement_type");
    expect(MIGRATION).toContain("'refund'");
    expect(MIGRATION).toContain("v_next_balance := v_balance + v_qty");
    const qtyRaiseAt = MIGRATION.indexOf("sale_return_quantity_exceeded");
    const insertReturnAt = MIGRATION.indexOf("INSERT INTO public.sale_returns");
    const insertMovementAt = MIGRATION.indexOf("INSERT INTO public.inventory_movements");
    expect(qtyRaiseAt).toBeGreaterThan(-1);
    expect(insertReturnAt).toBeGreaterThan(qtyRaiseAt);
    expect(insertMovementAt).toBeGreaterThan(insertReturnAt);
  });

  it("writes cash refund only for cash completed refunds and never fakes card/pix cash-out", () => {
    expect(MIGRATION).toContain("v_payment_refund_status := 'completed'");
    expect(MIGRATION).toContain("v_payment_refund_status := 'pending_external'");
    expect(MIGRATION).toContain("IF v_payment.method = 'cash' AND v_payment_refund_status = 'completed' THEN");
    expect(MIGRATION).toContain("'refund_cash'");
    expect(MIGRATION).toContain("-v_refund_total");
    expect(MIGRATION).toContain("cash_session_required");
    expect(MIGRATION).not.toMatch(
      /method IN \('card', 'pix'[\s\S]{0,200}INSERT INTO public\.cash_movements/
    );
  });

  it("does not rewrite original payment.amount; only marks refunded on full cash close", () => {
    expect(MIGRATION).not.toMatch(/UPDATE public\.payments[\s\S]{0,120}amount\s*=/);
    expect(MIGRATION).toContain("SET status = 'refunded'");
    expect(MIGRATION).toContain("AND status = 'captured'");
    expect(MIGRATION).toContain("IF v_next_status IN ('cancelled', 'refunded') THEN");
  });

  it("keeps fiscal cancel best-effort without asserting confirmed fiscal cancel", () => {
    expect(MIGRATION).toContain("request_fiscal_cancel");
    expect(MIGRATION).toContain("-- Fiscal remains best-effort; commercial return already committed.");
  });

  it("enforces RBAC and org/store from membership, not client-supplied org", () => {
    expect(MIGRATION).toContain("v_role := public.user_store_role(v_store_id)");
    expect(MIGRATION).toContain("v_org_id IS DISTINCT FROM public.current_user_org_id()");
    expect(MIGRATION).toContain("forbidden_sale_return");
    expect(MIGRATION).toContain("IF v_operation = 'cancel' AND v_role = 'cashier' THEN");
    expect(MIGRATION).toContain("forbidden_sale_cancel");
    expect(MIGRATION).toContain("USING ERRCODE = '42501'");
    expect(MIGRATION).not.toMatch(/p_payload->>'org_id'/);
  });

  it("replays identical mutation and conflicts when item payload differs", () => {
    expect(MIGRATION).toContain("'replay', true");
    expect(MIGRATION).toContain("idempotency_payload_mismatch");
    expect(MIGRATION).toContain("FROM public.sale_return_items sri");
    expect(MIGRATION).toContain("FROM jsonb_array_elements(p_payload->'items')");
    expect(MIGRATION).toContain("IS DISTINCT FROM");
  });

  it("writes audit with operation identity, reason, amounts and items", () => {
    expect(MIGRATION).toContain("INSERT INTO public.audit_logs");
    expect(MIGRATION).toContain("'sale.cancelled'");
    expect(MIGRATION).toContain("'sale.returned'");
    expect(MIGRATION).toContain("'client_mutation_id', v_client_mutation_id");
    expect(MIGRATION).toContain("'reason', v_reason");
    expect(MIGRATION).toContain("'refund_total', v_refund_total");
    expect(MIGRATION).toContain("'items', v_items");
  });

  it("enables RLS select-only for authenticated store members", () => {
    expect(MIGRATION).toContain("ALTER TABLE public.sale_returns ENABLE ROW LEVEL SECURITY");
    expect(MIGRATION).toContain("ALTER TABLE public.sale_return_items ENABLE ROW LEVEL SECURITY");
    expect(MIGRATION).toContain("REVOKE ALL ON TABLE public.sale_returns FROM anon, authenticated");
    expect(MIGRATION).toContain("GRANT SELECT ON TABLE public.sale_returns TO authenticated");
    expect(MIGRATION).toContain("user_has_store_access(store_id)");
    expect(MIGRATION).toContain("GRANT EXECUTE ON FUNCTION public.process_sale_return(jsonb) TO authenticated");
  });
});

describe("B18 domain: partial / total / excess return math", () => {
  it("partial return of 2 from 5 leaves 3 returnable and computes proportional refund", () => {
    const items = returnableFromSale("5.000");
    expect(items[0]?.quantity_returnable).toBe("5.000");

    const first = computeSaleReturn({
      items,
      lines: [{ sale_item_id: SALE_ITEM_ID, quantity: "2" }],
      saleSubtotal: "100.00",
      saleHeaderDiscount: "0.00",
      alreadyRefundedTotal: "0.00",
      saleTotal: "100.00",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error);
    expect(first.value.refund_total).toBe("40.00");
    expect(first.value.lines[0]?.quantity).toBe("2.000");

    const after = returnableFromSale("5.000", "2.000");
    expect(after[0]?.quantity_returned).toBe("2.000");
    expect(after[0]?.quantity_returnable).toBe("3.000");
    expect(nextSaleStatusAfterReturn({ operation: "return", remainingReturnableQty: "3.000" })).toBe(
      "partially_refunded"
    );
  });

  it("rejects returning 4 after 2 already returned (would exceed sold qty)", () => {
    const items = returnableFromSale("5.000", "2.000");
    const excess = computeSaleReturn({
      items,
      lines: [{ sale_item_id: SALE_ITEM_ID, quantity: "4" }],
      saleSubtotal: "100.00",
      saleHeaderDiscount: "0.00",
      alreadyRefundedTotal: "40.00",
      saleTotal: "100.00",
    });
    expect(excess.ok).toBe(false);
    if (excess.ok) throw new Error("expected reject");
    expect(excess.error).toMatch(/excede/i);
  });

  it("full return closes sale as refunded with stock delta equal to sold qty", () => {
    const items = returnableFromSale("5.000");
    const full = computeSaleReturn({
      items,
      lines: [{ sale_item_id: SALE_ITEM_ID, quantity: "5" }],
      saleSubtotal: "100.00",
      saleHeaderDiscount: "0.00",
      alreadyRefundedTotal: "0.00",
      saleTotal: "100.00",
    });
    expect(full.ok).toBe(true);
    if (!full.ok) throw new Error(full.error);
    expect(full.value.refund_total).toBe("100.00");
    expect(nextSaleStatusAfterReturn({ operation: "return", remainingReturnableQty: "0.000" })).toBe(
      "refunded"
    );
    expect(nextSaleStatusAfterReturn({ operation: "cancel", remainingReturnableQty: "0.000" })).toBe(
      "cancelled"
    );
  });

  it("cash refund of R$30 from R$100 sale is modeled as negative cash movement amount", () => {
    const items = returnableFromSale("5.000");
    const partial = computeSaleReturn({
      items,
      lines: [{ sale_item_id: SALE_ITEM_ID, quantity: "1.5" }],
      saleSubtotal: "100.00",
      saleHeaderDiscount: "0.00",
      alreadyRefundedTotal: "0.00",
      saleTotal: "100.00",
    });
    expect(partial.ok).toBe(true);
    if (!partial.ok) throw new Error(partial.error);
    expect(partial.value.refund_total).toBe("30.00");
    // Ledger writes -refund_total for refund_cash (asserted in migration contract).
    expect(`-${partial.value.refund_total}`).toBe("-30.00");
  });
});

describe("B18 RBAC + API input contract", () => {
  it("allows cancel only for manager/admin and return for cashier+", () => {
    expect(canCancelSale("cashier")).toBe(false);
    expect(canCancelSale("manager")).toBe(true);
    expect(canCancelSale("admin")).toBe(true);
    expect(canReturnSale("cashier")).toBe(true);
    expect(canReturnSale(null)).toBe(false);
    expect(isSaleCancellableStatus("confirmed")).toBe(true);
    expect(isSaleCancellableStatus("partially_refunded")).toBe(false);
    expect(isSaleReturnableStatus("confirmed")).toBe(true);
    expect(isSaleReturnableStatus("partially_refunded")).toBe(true);
    expect(isSaleReturnableStatus("cancelled")).toBe(false);
  });

  it("validates return payload and does not accept client org_id", () => {
    const parsed = saleReturnInputSchema.safeParse({
      store_id: STORE_ID,
      sale_id: SALE_ID,
      terminal_id: TERMINAL_ID,
      client_mutation_id: MUTATION_ID,
      operation: "return",
      reason: "cliente_desistiu",
      org_id: "11111111-1111-4111-8111-111111111111",
      items: [{ sale_item_id: SALE_ITEM_ID, quantity: "2" }],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("parse failed");
    expect(parsed.data).not.toHaveProperty("org_id");

    const cancel = saleCancelInputSchema.safeParse({
      store_id: STORE_ID,
      sale_id: SALE_ID,
      terminal_id: TERMINAL_ID,
      client_mutation_id: MUTATION_ID,
      reason: "erro_de_venda",
    });
    expect(cancel.success).toBe(true);
  });
});

describe("B18 cash refund must stay on the original open session", () => {
  const originalSession = {
    status: "open",
    terminalId: TERMINAL_ID,
    storeId: STORE_ID,
  };
  const SALE_SESSION = "66666666-6666-4666-8666-666666666666";
  const TODAY_SESSION = "77777777-7777-4777-8777-777777777777";

  it("allows refund_cash only against the same open cash_session_id", () => {
    const allowed = evaluateCashRefundSession({
      paymentMethod: "cash",
      saleCashSessionId: SALE_SESSION,
      requestedCashSessionId: SALE_SESSION,
      originalSession,
      requestTerminalId: TERMINAL_ID,
      requestStoreId: STORE_ID,
    });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) throw new Error(allowed.error);
    expect(allowed.cashSessionId).toBe(SALE_SESSION);
  });

  it("rejects posting refund_cash onto a different open session (today)", () => {
    const rejected = evaluateCashRefundSession({
      paymentMethod: "cash",
      saleCashSessionId: SALE_SESSION,
      requestedCashSessionId: TODAY_SESSION,
      originalSession,
      requestTerminalId: TERMINAL_ID,
      requestStoreId: STORE_ID,
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("expected reject");
    expect(rejected.error).toBe(CASH_SESSION_CLOSED_FOR_REFUND);
  });

  it("rejects cash refund when the original session is closed, missing, or terminal mismatches", () => {
    const closed = evaluateCashRefundSession({
      paymentMethod: "cash",
      saleCashSessionId: SALE_SESSION,
      requestedCashSessionId: SALE_SESSION,
      originalSession: { ...originalSession, status: "closed" },
      requestTerminalId: TERMINAL_ID,
      requestStoreId: STORE_ID,
    });
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.error).toBe(CASH_SESSION_CLOSED_FOR_REFUND);

    const missing = evaluateCashRefundSession({
      paymentMethod: "cash",
      saleCashSessionId: SALE_SESSION,
      requestedCashSessionId: undefined,
      originalSession: null,
      requestTerminalId: TERMINAL_ID,
      requestStoreId: STORE_ID,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe(CASH_SESSION_CLOSED_FOR_REFUND);

    const mismatchedTerminal = evaluateCashRefundSession({
      paymentMethod: "cash",
      saleCashSessionId: SALE_SESSION,
      requestedCashSessionId: SALE_SESSION,
      originalSession,
      requestTerminalId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
      requestStoreId: STORE_ID,
    });
    expect(mismatchedTerminal.ok).toBe(false);
    if (!mismatchedTerminal.ok) {
      expect(mismatchedTerminal.error).toBe(CASH_SESSION_CLOSED_FOR_REFUND);
    }
  });

  it("does not require a cash session for non-cash returns", () => {
    const pix = evaluateCashRefundSession({
      paymentMethod: "pix",
      saleCashSessionId: null,
      requestedCashSessionId: TODAY_SESSION,
      originalSession: null,
      requestTerminalId: TERMINAL_ID,
      requestStoreId: STORE_ID,
    });
    expect(pix.ok).toBe(true);
  });
});
