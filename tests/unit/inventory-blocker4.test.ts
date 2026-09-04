import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addInventoryQuantities,
  toInventoryDelta,
  toInventoryQuantity,
} from "@/lib/domain/quantity";
import { queueInventoryAdjustment } from "@/lib/offline/inventory-adjustment";
import {
  createPdvLocalDb,
  deletePdvLocalDb,
} from "@/lib/offline/pdv-local-db";
import {
  pullChanges,
  pushPendingCommands,
} from "@/lib/offline/sync-engine";
import {
  getTerminalId,
  TERMINAL_ID_STORAGE_KEY,
} from "@/lib/offline/terminal-identity";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";

const STORE_ID = "22222222-2222-4222-8222-222222222201";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444401";
const TERMINAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MUTATION_A = "99999999-9999-4999-8999-999999999991";
const MUTATION_B = "99999999-9999-4999-8999-999999999992";
const MOVEMENT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const MOVEMENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const MOVEMENT_C = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";

const now = new Date(Date.now() + 60_000);

const databases: PdvLocalDatabase[] = [];

afterEach(async () => {
  while (databases.length > 0) {
    const db = databases.pop();
    if (!db) continue;
    const name = db.name;
    db.close();
    await deletePdvLocalDb(name);
  }
  localStorage.clear();
  vi.restoreAllMocks();
});

async function openDb(): Promise<PdvLocalDatabase> {
  const db = createPdvLocalDb(`blocker4-${crypto.randomUUID()}`);
  await db.open();
  databases.push(db);
  await db.inventoryBalances.put({
    storeId: STORE_ID,
    productId: PRODUCT_ID,
    quantity: "0.000",
    serverQuantity: "0.000",
    updatedAt: now.toISOString(),
  });
  return db;
}

function inventoryResponse(input: {
  movementId: string;
  clientMutationId: string;
  delta: string;
  balanceAfter: string;
  createdAt?: string;
  status?: number;
}): Response {
  return new Response(
    JSON.stringify({
      movement_id: input.movementId,
      client_mutation_id: input.clientMutationId,
      terminal_id: TERMINAL_ID,
      product_id: PRODUCT_ID,
      movement_type: "restock",
      created_at: input.createdAt ?? now.toISOString(),
      delta: input.delta,
      balance_after: input.balanceAfter,
      replay: false,
    }),
    { status: input.status ?? 200 }
  );
}

describe("Blocker 4 quantity invariants", () => {
  it("keeps numeric(12,3) quantities canonical without binary float arithmetic", () => {
    expect(toInventoryDelta("0.001")).toBe("0.001");
    expect(toInventoryDelta("0.010")).toBe("0.010");
    expect(toInventoryDelta("0.100")).toBe("0.100");
    expect(toInventoryDelta("1.001")).toBe("1.001");
    expect(toInventoryDelta("10.999")).toBe("10.999");
    expect(toInventoryDelta("999999999.999")).toBe("999999999.999");
    expect(addInventoryQuantities("0.100", "0.200")).toBe("0.300");

    for (const invalid of ["0", "-0", "NaN", "Infinity", "1.0001"]) {
      expect(() => toInventoryDelta(invalid)).toThrow();
    }
    expect(() => toInventoryDelta("1000000000.000")).toThrow();
    expect(() => toInventoryQuantity("-0.001")).toThrow();
  });
});

describe("Blocker 4 durable inventory outbox", () => {
  it("deduplicates one local mutation and preserves independent decimal operations", async () => {
    const db = await openDb();
    const first = await queueInventoryAdjustment(db, {
      storeId: STORE_ID,
      productId: PRODUCT_ID,
      clientMutationId: MUTATION_A,
      terminalId: TERMINAL_ID,
      delta: "0.100",
      reason: "entrada A",
      movementType: "restock",
    });
    const replay = await queueInventoryAdjustment(db, {
      storeId: STORE_ID,
      productId: PRODUCT_ID,
      clientMutationId: MUTATION_A,
      terminalId: TERMINAL_ID,
      delta: "0.100",
      reason: "entrada A",
      movementType: "restock",
    });
    await queueInventoryAdjustment(db, {
      storeId: STORE_ID,
      productId: PRODUCT_ID,
      clientMutationId: MUTATION_B,
      terminalId: TERMINAL_ID,
      delta: "0.200",
      reason: "entrada B",
      movementType: "restock",
    });

    expect(first).toEqual({
      clientMutationId: MUTATION_A,
      balanceAfter: "0.100",
      duplicate: false,
    });
    expect(replay.duplicate).toBe(true);
    expect(await db.inventoryOutbox.count()).toBe(2);
    expect(
      (await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity
    ).toBe("0.300");
  });

  it("retries a network failure once and records exactly one remote movement", async () => {
    const db = await openDb();
    await queueInventoryAdjustment(db, {
      storeId: STORE_ID,
      productId: PRODUCT_ID,
      clientMutationId: MUTATION_A,
      terminalId: TERMINAL_ID,
      delta: "0.100",
      reason: "entrada retry",
      movementType: "restock",
    });

    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        inventoryResponse({
          movementId: MOVEMENT_A,
          clientMutationId: MUTATION_A,
          delta: "0.100",
          balanceAfter: "0.100",
        })
      );

    await pushPendingCommands({
      db,
      storeId: STORE_ID,
      fetchFn,
      now: () => now,
      random: () => 0,
    });
    const afterFailure = await db.inventoryOutbox.get(MUTATION_A);
    await db.inventoryOutbox.put({
      ...afterFailure!,
      status: "pending",
      nextAttemptAt: new Date(0).toISOString(),
    });

    await pushPendingCommands({
      db,
      storeId: STORE_ID,
      fetchFn,
      now: () => now,
      random: () => 0,
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((await db.inventoryOutbox.get(MUTATION_A))?.status).toBe("synced");
    expect(await db.inventoryMovements.count()).toBe(1);
    expect(
      (await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity
    ).toBe("0.100");
  });

  it("keeps the optimistic balance consistent when the server rejects an adjustment", async () => {
    const db = await openDb();
    await queueInventoryAdjustment(db, {
      storeId: STORE_ID,
      productId: PRODUCT_ID,
      clientMutationId: MUTATION_A,
      terminalId: TERMINAL_ID,
      delta: "0.100",
      reason: "conflito",
      movementType: "restock",
    });

    await pushPendingCommands({
      db,
      storeId: STORE_ID,
      fetchFn: async () =>
        new Response(JSON.stringify({ error: "negative_stock" }), { status: 409 }),
      now: () => now,
    });

    expect((await db.inventoryOutbox.get(MUTATION_A))?.status).toBe("conflict");
    expect(
      (await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity
    ).toBe("0.000");
    expect((await db.conflicts.toArray())[0]).toMatchObject({
      clientMutationId: MUTATION_A,
      entityType: "inventory",
      visible: true,
    });
  });
});

describe("Blocker 4 cursor and terminal identity", () => {
  it("uses one stable terminal identity for the browser lifetime", () => {
    const first = getTerminalId();
    const second = getTerminalId();
    expect(first).toBe(second);
    expect(localStorage.getItem(TERMINAL_ID_STORAGE_KEY)).toBe(first);
  });

  it("pulls every movement across deterministic page size one cursors", async () => {
    const db = await openDb();
    const firstCreatedAt = "2026-09-03T23:30:01.000Z";
    const secondCreatedAt = "2026-09-03T23:30:02.000Z";
    const thirdCreatedAt = "2026-09-03T23:30:03.000Z";
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            serverTime: firstCreatedAt,
            has_more: true,
            next_cursor: {
              since: firstCreatedAt,
              inventory_after_created_at: firstCreatedAt,
              inventory_after_id: MOVEMENT_A,
            },
            inventory: [],
            inventory_movements: [
              {
                id: MOVEMENT_A,
                store_id: STORE_ID,
                product_id: PRODUCT_ID,
                movement_type: "restock",
                quantity_change: "0.001",
                balance_after: "0.001",
                created_at: firstCreatedAt,
              },
            ],
            sales: [],
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            serverTime: thirdCreatedAt,
            has_more: false,
            next_cursor: {
              since: thirdCreatedAt,
              inventory_after_created_at: thirdCreatedAt,
              inventory_after_id: MOVEMENT_C,
            },
            inventory: [],
            inventory_movements: [
              {
                id: MOVEMENT_B,
                store_id: STORE_ID,
                product_id: PRODUCT_ID,
                movement_type: "adjustment",
                quantity_change: "-0.001",
                balance_after: "0.000",
                created_at: secondCreatedAt,
              },
              {
                id: MOVEMENT_C,
                store_id: STORE_ID,
                product_id: PRODUCT_ID,
                movement_type: "restock",
                quantity_change: "0.010",
                balance_after: "0.010",
                created_at: thirdCreatedAt,
              },
            ],
            sales: [],
          })
        )
      );

    const result = await pullChanges({
      db,
      storeId: STORE_ID,
      fetchFn,
    });

    expect(result?.hasMore).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(
      (await db.inventoryMovements.orderBy("createdAt").toArray()).map(
        (movement) => movement.id
      )
    ).toEqual([MOVEMENT_A, MOVEMENT_B, MOVEMENT_C]);
    expect(
      (await db.meta.get(`lastPullAt:${STORE_ID}`))?.value
    ).toContain(thirdCreatedAt);
    const secondRequest = new URL(
      fetchFn.mock.calls[1]?.[0] as string,
      "http://localhost"
    );
    expect(secondRequest.searchParams.get("inventory_after_id")).toBe(MOVEMENT_A);
  });
});
