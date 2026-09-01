import Dexie, { type Table } from "dexie";
import type {
  LocalConflict,
  LocalInventoryBalance,
  LocalMeta,
  LocalPayment,
  LocalSale,
  LocalSaleItem,
  OutboxCommand,
} from "@/lib/offline/types";
import { PDV_LOCAL_DB_NAME } from "@/lib/offline/types";

export { PDV_LOCAL_DB_NAME };

export const CLOSE_SALE_TABLES = [
  "sales",
  "saleItems",
  "payments",
  "inventoryBalances",
  "outbox",
] as const;

export class PdvLocalDatabase extends Dexie {
  sales!: Table<LocalSale, string>;
  saleItems!: Table<LocalSaleItem, string>;
  payments!: Table<LocalPayment, string>;
  inventoryBalances!: Table<LocalInventoryBalance, [string, string]>;
  outbox!: Table<OutboxCommand, string>;
  conflicts!: Table<LocalConflict, string>;
  meta!: Table<LocalMeta, string>;

  constructor(name = PDV_LOCAL_DB_NAME) {
    super(name);
    this.version(1).stores({
      sales: "id, storeId, clientMutationId, syncStatus, createdAt",
      saleItems: "id, saleId, productId",
      payments: "id, saleId",
      inventoryBalances: "[storeId+productId], storeId, productId",
      outbox: "clientMutationId, saleId, status, nextAttemptAt, createdAt",
      conflicts: "id, clientMutationId, saleId, createdAt",
      meta: "key",
    });
  }
}

const singletons = new Map<string, PdvLocalDatabase>();

export function createPdvLocalDb(name = PDV_LOCAL_DB_NAME): PdvLocalDatabase {
  return new PdvLocalDatabase(name);
}

export function getPdvLocalDb(name = PDV_LOCAL_DB_NAME): PdvLocalDatabase {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB unavailable");
  }
  const existing = singletons.get(name);
  if (existing) return existing;
  const db = createPdvLocalDb(name);
  singletons.set(name, db);
  return db;
}

export async function deletePdvLocalDb(name = PDV_LOCAL_DB_NAME): Promise<void> {
  const existing = singletons.get(name);
  if (existing) {
    existing.close();
    singletons.delete(name);
  }
  await Dexie.delete(name);
}
