import { demoStockForStore, DEMO_PRODUCTS } from "@/lib/domain/catalog";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";
import type { ProductRow } from "@/lib/domain/product";

export function pdvFixturesEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PDV_FIXTURES === "1";
}

export function fixtureProducts(): ProductRow[] {
  return DEMO_PRODUCTS;
}

export async function writeFixtureInventory(db: PdvLocalDatabase, storeId: string): Promise<Record<string, number>> {
  const stock = demoStockForStore(storeId);
  const existing = await db.inventoryBalances.where("storeId").equals(storeId).count();
  if (existing === 0) {
    const now = new Date().toISOString();
    await db.inventoryBalances.bulkPut(
      Object.entries(stock).map(([productId, quantity]) => ({
        storeId,
        productId,
        quantity,
        serverQuantity: quantity,
        updatedAt: now,
      }))
    );
    return stock;
  }

  const rows = await db.inventoryBalances.where("storeId").equals(storeId).toArray();
  return rows.reduce<Record<string, number>>((current, row) => {
    current[row.productId] = row.quantity;
    return current;
  }, {});
}
