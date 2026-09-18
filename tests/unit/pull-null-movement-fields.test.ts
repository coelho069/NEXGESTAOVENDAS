import { afterEach, describe, expect, it } from "vitest";
import { pullChanges } from "@/lib/offline/sync-engine";
import { createPdvLocalDb, deletePdvLocalDb } from "@/lib/offline/pdv-local-db";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";

const STORE_ID = "22222222-2222-4222-8222-222222222201";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444401";

const databases: PdvLocalDatabase[] = [];

afterEach(async () => {
  while (databases.length > 0) {
    const db = databases.pop();
    if (!db) continue;
    const name = db.name;
    db.close();
    await deletePdvLocalDb(name);
  }
});

async function openDb(): Promise<PdvLocalDatabase> {
  const db = createPdvLocalDb(`pull-null-${crypto.randomUUID()}`);
  await db.open();
  databases.push(db);
  return db;
}

describe("pullChanges optional movement fields", () => {
  it("applies inventory when movement optional fields are null", async () => {
    const db = await openDb();
    const result = await pullChanges({
      db,
      storeId: STORE_ID,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
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
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
    });

    expect(result).not.toBeNull();
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe("243.000");
  });
});
