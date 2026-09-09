import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthedContext } from "@/lib/auth/session";

const { getAuthedContext, createClient, observeApiResult } = vi.hoisted(() => ({
  getAuthedContext: vi.fn(),
  createClient: vi.fn(),
  observeApiResult: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getAuthedContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/server/fiscal-operation", () => ({
  requestFiscalIssueAfterCommit: vi.fn().mockResolvedValue({ data: { status: "pending" } }),
}));
vi.mock("@/lib/server/store-sale-policy", () => ({
  loadStoreSalePolicy: vi.fn().mockResolvedValue({
    requireCustomerOnSale: false,
    requireCustomerDocument: false,
    requireOpenCashSession: false,
  }),
}));
vi.mock("@/lib/observability/request-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/observability/request-context")>();
  return {
    ...actual,
    observeApiResult,
  };
});

import { POST } from "@/app/api/sales/process/route";
import { loadStoreSalePolicy } from "@/lib/server/store-sale-policy";

const loadStoreSalePolicyMock = vi.mocked(loadStoreSalePolicy);

const STORE_ID = "22222222-2222-4222-8222-222222222201";
const SESSION_ID = "66666666-6666-4666-8666-666666666666";
const TERMINAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MUTATION_ID = "99999999-9999-4999-8999-999999999901";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444401";

function managerContext(): AuthedContext {
  return {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role: "manager",
    orgId: "11111111-1111-4111-8111-111111111111",
    storeId: STORE_ID,
    storeName: "Loja Centro",
    stores: [
      {
        id: STORE_ID,
        name: "Loja Centro",
        orgId: "11111111-1111-4111-8111-111111111111",
        role: "manager",
      },
    ],
  };
}

function salePayload() {
  return {
    store_id: STORE_ID,
    client_mutation_id: MUTATION_ID,
    cash_session_id: SESSION_ID,
    terminal_id: TERMINAL_ID,
    discount: "0.00",
    items: [
      {
        product_id: PRODUCT_ID,
        quantity: 1,
        unit_price: "3.50",
        discount: "0.00",
      },
    ],
    payments: [{ method: "cash", amount: "3.50" }],
  };
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/sales/process", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/sales/process cash RPC failures", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getAuthedContext.mockResolvedValue(managerContext());
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc,
    });
  });

  it("maps 22023 insufficient_stock and journals rpc code/message", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "22023",
        message: "insufficient_stock",
        hint: "quantity available is 0",
      },
    });

    const response = await POST(request(salePayload()));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "insufficient_stock" });
    expect(observeApiResult).toHaveBeenCalledWith(
      expect.anything(),
      "client_error",
      expect.objectContaining({
        error: "insufficient_stock",
        rpcCode: "22023",
        rpcMessage: "insufficient_stock",
        rpcHint: "quantity available is 0",
        rpc: "process_sale_with_cash",
      })
    );
  });

  it("maps customer_required_on_sale instead of opaque sale_processing_failed", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "customer_required_on_sale" },
    });

    const response = await POST(request(salePayload()));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "customer_required_on_sale" });
    expect(observeApiResult).toHaveBeenCalledWith(
      expect.anything(),
      "client_error",
      expect.objectContaining({
        error: "customer_required_on_sale",
        rpcCode: "22023",
        rpcMessage: "customer_required_on_sale",
      })
    );
  });

  it("rejects cash checkout before RPC when store policy requires a customer", async () => {
    loadStoreSalePolicyMock.mockResolvedValueOnce({
      requireCustomerOnSale: true,
      requireCustomerDocument: false,
      requireOpenCashSession: false,
    });

    const response = await POST(request(salePayload()));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "customer_required_on_sale" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces unmapped 22023 as the RPC token, never sale_processing_failed", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "unmapped_guardrail", details: "check failed" },
    });

    const response = await POST(request(salePayload()));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "unmapped_guardrail" });
    expect(observeApiResult).toHaveBeenCalledWith(
      expect.anything(),
      "client_error",
      expect.objectContaining({
        error: "unmapped_guardrail",
        rpcCode: "22023",
        rpcMessage: "unmapped_guardrail",
        rpcDetails: "check failed",
      })
    );
  });

  it("maps 23514 session-scope CHECK to cash_session_conflict and journals RPC detail", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23514",
        message: "payment_cash_session_scope_mismatch",
        hint: "sale and payment cash_session_id must match",
      },
    });

    const response = await POST(request(salePayload()));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "cash_session_conflict" });
    expect(observeApiResult).toHaveBeenCalledWith(
      expect.anything(),
      "client_error",
      expect.objectContaining({
        error: "cash_session_conflict",
        rpcCode: "23514",
        rpcMessage: "payment_cash_session_scope_mismatch",
      })
    );
  });

  it("journals 503 RPC failures with code/message", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "40001", message: "could not serialize access due to concurrent update" },
    });

    const response = await POST(request(salePayload()));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "sale_processing_unavailable" });
    expect(observeApiResult).toHaveBeenCalledWith(
      expect.anything(),
      "server_error",
      expect.objectContaining({
        error: "sale_processing_unavailable",
        rpcCode: "40001",
        rpcMessage: "could not serialize access due to concurrent update",
      })
    );
  });
});
