import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { pullChanges, runSyncCycle } from "@/lib/offline/sync-engine";
import { deletePdvLocalDb, getPdvLocalDbForUser } from "@/lib/offline/pdv-local-db";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";
import { useSessionStore } from "@/stores/session-store";
import { useProjectedStock } from "@/hooks/use-projected-stock";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORE_ID = "22222222-2222-4222-8222-222222222201";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444401";

const databases: PdvLocalDatabase[] = [];

function serverPullPayload() {
  return {
    serverTime: "2026-09-01T12:00:00.000Z",
    has_more: false,
    inventory: [
      {
        store_id: STORE_ID,
        product_id: PRODUCT_ID,
        quantity: 243,
        updated_at: "2026-09-01T12:00:00.000Z",
      },
    ],
    inventory_movements: [
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        store_id: STORE_ID,
        product_id: PRODUCT_ID,
        client_mutation_id: null,
        terminal_id: null,
        import_id: null,
        import_row: null,
        movement_type: "restock",
        quantity_change: "243.000",
        balance_after: "243.000",
        created_at: "2026-09-01T12:00:00.000Z",
      },
    ],
    sales: [],
  };
}

afterEach(async () => {
  useSessionStore.getState().setUser(null, null);
  while (databases.length > 0) {
    const db = databases.pop();
    if (!db) continue;
    db.close();
    await deletePdvLocalDb(db.name);
  }
  vi.restoreAllMocks();
});

async function openSessionDb(): Promise<PdvLocalDatabase> {
  const db = getPdvLocalDbForUser(USER_ID);
  await db.open();
  databases.push(db);
  return db;
}

describe("PDV clean login stock pull", () => {
  it("runSyncCycle populates session-scoped Dexie inventory from server pull", async () => {
    useSessionStore.getState().setUser(USER_ID, "cashier@example.com");
    const db = await openSessionDb();

    await runSyncCycle({
      db,
      storeId: STORE_ID,
      fetchFn: async () =>
        new Response(JSON.stringify(serverPullPayload()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    const row = await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]);
    expect(row?.quantity).toBe("243.000");
  });

  it("useProjectedStock reflects inventory after pdv:inventory-sync", async () => {
    useSessionStore.getState().setUser(USER_ID, "cashier@example.com");
    const db = await openSessionDb();

    const { result } = renderHook(() => useProjectedStock(STORE_ID));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.balances[PRODUCT_ID]).toBeUndefined();

    await pullChanges({
      db,
      storeId: STORE_ID,
      fetchFn: async () =>
        new Response(JSON.stringify(serverPullPayload()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    window.dispatchEvent(new Event("pdv:inventory-sync"));

    await waitFor(() => {
      expect(result.current.balances[PRODUCT_ID]).toBe(243);
    });
  });
});
