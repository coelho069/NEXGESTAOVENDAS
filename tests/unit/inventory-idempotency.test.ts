import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthedContext } from "@/lib/auth/session";
import { inventoryImportMutationId } from "@/lib/server/inventory-idempotency";

const { getAuthedContext, createClient } = vi.hoisted(() => ({
  getAuthedContext: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getAuthedContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { POST as adjustInventory } from "@/app/api/inventory/adjust/route";
import {
  POST as importInventory,
} from "@/app/api/inventory/import/route";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "99999999-9999-4999-8999-999999999999";
const STORE_A = "22222222-2222-4222-8222-222222222201";
const STORE_B = "22222222-2222-4222-8222-222222222202";
const PRODUCT_A = "44444444-4444-4444-8444-444444444401";
const MUTATION_A = "99999999-9999-4999-8999-999999999999";
const IMPORT_A = "88888888-8888-4888-8888-888888888888";

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

function request(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function adjustBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    store_id: STORE_A,
    product_id: PRODUCT_A,
    client_mutation_id: MUTATION_A,
    delta: 2,
    reason: "reposição idempotente",
    movement_type: "restock",
    ...overrides,
  };
}

function createProductQuery() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: PRODUCT_A }, error: null }),
  };
  return query;
}

describe("inventory adjustment idempotency boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthedContext.mockResolvedValue(managerContext());
  });

  it("sends the required mutation identity and canonical store to the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        movement_id: "77777777-7777-4777-8777-777777777777",
        client_mutation_id: MUTATION_A,
        replay: false,
      },
      error: null,
    });
    createClient.mockResolvedValue({ rpc });

    const response = await adjustInventory(request("/api/inventory/adjust", adjustBody()));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("adjust_inventory", {
      p_payload: expect.objectContaining({
        store_id: STORE_A,
        client_mutation_id: MUTATION_A,
      }),
    });
  });

  it("accepts a database replay without converting it into an error", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { movement_id: "77777777-7777-4777-8777-777777777777", replay: false },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { movement_id: "77777777-7777-4777-8777-777777777777", replay: true },
        error: null,
      });
    createClient.mockResolvedValue({ rpc });

    const first = await adjustInventory(request("/api/inventory/adjust", adjustBody()));
    const retry = await adjustInventory(request("/api/inventory/adjust", adjustBody()));

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toEqual(
      expect.objectContaining({ movement_id: "77777777-7777-4777-8777-777777777777", replay: true })
    );
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]?.[1]).toEqual(rpc.mock.calls[1]?.[1]);
  });

  it("rejects missing or mismatched client mutation context", async () => {
    createClient.mockResolvedValue({ rpc: vi.fn() });

    const missing = await adjustInventory(
      request("/api/inventory/adjust", adjustBody({ client_mutation_id: undefined }))
    );
    const mismatchedStore = await adjustInventory(
      request("/api/inventory/adjust", adjustBody({ store_id: STORE_B }))
    );

    expect(missing.status).toBe(400);
    expect(mismatchedStore.status).toBe(403);
    expect(getAuthedContext).toHaveBeenLastCalledWith(STORE_B);
  });

  it("does not allow a client org_id to change the authorized operation", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { movement_id: "77777777-7777-4777-8777-777777777777", replay: false },
      error: null,
    });
    createClient.mockResolvedValue({ rpc });

    const response = await adjustInventory(
      request("/api/inventory/adjust", adjustBody({ org_id: ORG_B }))
    );

    expect(response.status).toBe(200);
    expect(rpc.mock.calls[0]?.[1]?.p_payload).not.toHaveProperty("org_id");
    expect(rpc.mock.calls[0]?.[1]?.p_payload.store_id).toBe(STORE_A);
  });

  it("maps a payload mismatch replay to a conflict", async () => {
    createClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "22023", message: "idempotency_payload_mismatch" },
      }),
    });

    const response = await adjustInventory(request("/api/inventory/adjust", adjustBody()));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "idempotency_payload_mismatch" });
  });
});

describe("inventory CSV operation identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthedContext.mockResolvedValue(managerContext());
  });

  it("derives a stable row identity and separates different imports", () => {
    const first = inventoryImportMutationId(STORE_A, IMPORT_A, 2);

    expect(first).toBe(inventoryImportMutationId(STORE_A, IMPORT_A, 2));
    expect(first).not.toBe(inventoryImportMutationId(STORE_A, IMPORT_A, 3));
    expect(first).not.toBe(
      inventoryImportMutationId(STORE_A, "88888888-8888-4888-8888-888888888889", 2)
    );
    expect(first).not.toBe(inventoryImportMutationId(STORE_B, IMPORT_A, 2));
  });

  it("reuses the same row mutation on CSV retry and reports replay", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { movement_id: "77777777-7777-4777-8777-777777777777", replay: false },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { movement_id: "77777777-7777-4777-8777-777777777777", replay: true },
        error: null,
      });
    const query = createProductQuery();
    createClient.mockResolvedValue({ from: vi.fn(() => query), rpc });
    const body = {
      store_id: STORE_A,
      import_id: IMPORT_A,
      csv: "sku,delta,reason,movement_type\nBEV-001,2,compra,restock\n",
    };

    const first = await importInventory(request("/api/inventory/import", body));
    const retry = await importInventory(request("/api/inventory/import", body));

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toEqual(
      expect.objectContaining({ appliedCount: 1, replayedCount: 1, errorCount: 0 })
    );
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]?.[1]).toEqual(rpc.mock.calls[1]?.[1]);
    expect(rpc.mock.calls[0]?.[1]?.p_payload).toEqual(
      expect.objectContaining({
        import_id: IMPORT_A,
        import_row: 2,
        client_mutation_id: inventoryImportMutationId(STORE_A, IMPORT_A, 2),
      })
    );
  });

  it("requires an import identity and keeps store authorization server-side", async () => {
    createClient.mockResolvedValue({ from: vi.fn(), rpc: vi.fn() });

    const missing = await importInventory(
      request("/api/inventory/import", {
        store_id: STORE_A,
        csv: "sku,delta,reason,movement_type\nBEV-001,2,compra,restock\n",
      })
    );
    getAuthedContext.mockResolvedValue(managerContext(STORE_A, ORG_A));
    const mismatchedStore = await importInventory(
      request("/api/inventory/import", {
        store_id: STORE_B,
        import_id: IMPORT_A,
        csv: "sku,delta,reason,movement_type\nBEV-001,2,compra,restock\n",
      })
    );

    expect(missing.status).toBe(400);
    expect(mismatchedStore.status).toBe(403);
  });
});
