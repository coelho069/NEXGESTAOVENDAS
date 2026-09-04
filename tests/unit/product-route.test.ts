import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthedContext } from "@/lib/auth/session";

const { getAuthedContext, createClient, asCatalogClient } = vi.hoisted(() => ({
  getAuthedContext: vi.fn(),
  createClient: vi.fn(),
  asCatalogClient: vi.fn((client: unknown) => client),
}));

vi.mock("@/lib/auth/session", () => ({ getAuthedContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/db/catalog-rpc", () => ({ asCatalogClient }));

import { POST } from "@/app/api/products/route";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "99999999-9999-4999-8999-999999999999";
const STORE_A = "22222222-2222-4222-8222-222222222201";
const STORE_B = "22222222-2222-4222-8222-222222222202";

function managerContext(storeId = STORE_A, orgId = ORG_A): AuthedContext {
  return {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role: "manager",
    orgId,
    storeId,
    storeName: "Loja",
    stores: [{ id: storeId, name: "Loja", orgId, role: "manager" }],
  };
}

function productBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    store_id: STORE_A,
    sku: "NEW-001",
    name: "Produto novo",
    unit_price: "10.00",
    cost_price: "4.00",
    ...overrides,
  };
}

async function post(body: unknown): Promise<Response> {
  return POST(new Request("http://localhost/api/products", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

describe("POST /api/products store authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthedContext.mockResolvedValue(managerContext());
    createClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: { id: "product-id" }, error: null }),
    });
  });

  it("allows a manager and sends the canonical authorized store to the RPC", async () => {
    const response = await post(productBody());

    expect(response.status).toBe(201);
    expect(getAuthedContext).toHaveBeenCalledWith(STORE_A);
    const client = await createClient.mock.results[0]!.value;
    expect(client.rpc).toHaveBeenCalledWith("create_product", expect.objectContaining({ p_store_id: STORE_A }));
  });

  it.each([
    ["cashier", { ...managerContext(), role: "cashier" as const }],
    ["without membership", { ...managerContext(), role: null, storeId: null, stores: [] }],
    ["inactive store", { ...managerContext(), role: null, storeId: null, stores: [] }],
    ["another organization", { ...managerContext(STORE_B, ORG_B) }],
  ])("returns 403 for %s", async (_label, context) => {
    getAuthedContext.mockResolvedValue(context);

    const response = await post(productBody());

    expect(response.status).toBe(403);
  });

  it("returns 401 when there is no authenticated context", async () => {
    getAuthedContext.mockResolvedValue(null);

    expect((await post(productBody())).status).toBe(401);
  });

  it.each([
    ["missing", { ...productBody(), store_id: undefined }],
    ["invalid", { ...productBody(), store_id: "not-a-uuid" }],
    ["different store", { ...productBody(), store_id: STORE_B }],
  ])("rejects a %s client store selector", async (_label, body) => {
    const response = await post(body);

    expect(response.status).toBe(403);
  });

  it("does not let a client role change authorization", async () => {
    getAuthedContext.mockResolvedValue({ ...managerContext(), role: "cashier" });

    const response = await post(productBody({ role: "admin" }));

    expect(response.status).toBe(403);
  });

  it("maps a duplicate barcode to a predictable conflict", async () => {
    createClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "23505",
          message: 'duplicate key value violates unique constraint "products_org_barcode_key"',
        },
      }),
    });

    const response = await post(productBody({ barcode: "789" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "barcode_conflict" });
  });

  it("keeps a NULL barcode valid", async () => {
    const response = await post(productBody({ barcode: null }));

    expect(response.status).toBe(201);
    const client = await createClient.mock.results[0]!.value;
    expect(client.rpc).toHaveBeenCalledWith(
      "create_product",
      expect.objectContaining({
        p_payload: expect.objectContaining({ barcode: null }),
      })
    );
  });
});
