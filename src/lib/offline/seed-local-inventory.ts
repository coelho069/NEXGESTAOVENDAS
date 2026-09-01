import { demoStockForStore } from "@/lib/domain/catalog";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";

export async function ensureLocalInventory(db: PdvLocalDatabase, storeId: string): Promise<void> {
  const existing = await db.inventoryBalances.where("storeId").equals(storeId).count();
  if (existing > 0) return;

  const now = new Date().toISOString();
  const stock = demoStockForStore(storeId);
  await db.inventoryBalances.bulkPut(
    Object.entries(stock).map(([productId, quantity]) => ({
      storeId,
      productId,
      quantity,
      serverQuantity: quantity,
      updatedAt: now,
    }))
  );
}