import { describe, expect, it } from "vitest";
import { mapProcessSaleRpcError, rpcFailureLogFields } from "@/lib/domain/sale-process-error";

describe("mapProcessSaleRpcError", () => {
  it("maps opaque 22023/23514 tokens to actionable cash errors", () => {
    expect(
      mapProcessSaleRpcError({ code: "22023", message: "insufficient_stock" })
    ).toEqual({ error: "insufficient_stock", status: 422 });
    expect(
      mapProcessSaleRpcError({ code: "22023", message: "price_mismatch" })
    ).toEqual({ error: "price_mismatch", status: 422 });
    expect(
      mapProcessSaleRpcError({
        code: "23514",
        message: "new row violates check constraint",
        details: "inventory_movement_chain_mismatch",
      })
    ).toEqual({ error: "inventory_movement_conflict", status: 422 });
    expect(
      mapProcessSaleRpcError({ code: "23514", message: "cash_sale_missing_payment" })
    ).toEqual({ error: "cash_sale_missing_payment", status: 422 });
    expect(
      mapProcessSaleRpcError({ code: "40901", message: "cash_session_closed" })
    ).toEqual({ error: "cash_session_closed", status: 409 });
  });

  it("keeps unmapped 22023/23514 as sale_processing_failed", () => {
    expect(mapProcessSaleRpcError({ code: "22023", message: "some_new_rpc_guard" })).toEqual({
      error: "sale_processing_failed",
      status: 422,
    });
    expect(mapProcessSaleRpcError({ code: "40001", message: "serialization_failure" })).toBeNull();
  });

  it("exposes rpc code/message/hint without secrets for the journal", () => {
    const fields = rpcFailureLogFields({
      code: "22023",
      message: "insufficient_stock",
      hint: "restock BEV-001 before sale",
      details: "api_key=super-secret-value-should-not-matter",
    });
    expect(fields.rpcCode).toBe("22023");
    expect(fields.rpcMessage).toBe("insufficient_stock");
    expect(fields.rpcHint).toBe("restock BEV-001 before sale");
    expect(fields.rpcDetails).toContain("api_key=");
  });
});
