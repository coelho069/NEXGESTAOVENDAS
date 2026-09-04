import {
  DEMO_PRODUCTS,
  DEMO_STORE_CENTRO,
  DEMO_STORE_SHOPPING,
  demoStockForStore,
} from "@/lib/domain/catalog";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";
import type { ProductRow } from "@/lib/domain/product";
import type { StoreOption } from "@/lib/auth/store-context";
import { inventoryQuantityToNumber, toInventoryQuantity } from "@/lib/domain/quantity";

export function pdvFixturesEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_PDV_FIXTURES === "1";
}

export function fixtureProducts(): ProductRow[] {
  return DEMO_PRODUCTS;
}

export function fixtureStoreOptions(): StoreOption[] {
  return [
    { id: DEMO_STORE_CENTRO, name: "Loja Centro" },
    { id: DEMO_STORE_SHOPPING, name: "Loja Shopping" },
  ];
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
        quantity: toInventoryQuantity(quantity),
        serverQuantity: toInventoryQuantity(quantity),
        updatedAt: now,
      }))
    );
    return stock;
  }

  const rows = await db.inventoryBalances.where("storeId").equals(storeId).toArray();
  return rows.reduce<Record<string, number>>((current, row) => {
    current[row.productId] = inventoryQuantityToNumber(row.quantity);
    return current;
  }, {});
}
