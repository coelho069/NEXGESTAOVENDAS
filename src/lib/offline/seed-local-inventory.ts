import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";

/** Demo stock seeding is forbidden in production. Inventory comes from sync pull. */
export async function ensureLocalInventory(db: PdvLocalDatabase, storeId: string): Promise<void> {
  void db;
  void storeId;
  return;
}
