import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ProcessSaleInput } from "@/lib/validation/schemas";
import type { Enums } from "@/lib/db/types";

export type PendingMutation = {
  id: string;
  storeId: string;
  payload: ProcessSaleInput;
  syncStatus: Enums<"sync_status">;
  createdAt: string;
  lastError?: string;
};

interface OfflineDB extends DBSchema {
  pending_mutations: {
    key: string;
    value: PendingMutation;
    indexes: { by_sync_status: Enums<"sync_status"> };
  };
}

const DB_NAME = "nexgestaovendas-offline";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore("pending_mutations", { keyPath: "id" });
        store.createIndex("by_sync_status", "syncStatus");
      },
    });
  }
  return dbPromise;
}

export async function enqueueMutation(mutation: PendingMutation): Promise<void> {
  const db = await getDb();
  await db.put("pending_mutations", mutation);
}

export async function listPendingMutations(): Promise<PendingMutation[]> {
  const db = await getDb();
  return db.getAllFromIndex("pending_mutations", "by_sync_status", "pending");
}

export async function updateMutationStatus(
  id: string,
  syncStatus: Enums<"sync_status">,
  lastError?: string
): Promise<void> {
  const db = await getDb();
  const existing = await db.get("pending_mutations", id);
  if (!existing) return;
  await db.put("pending_mutations", { ...existing, syncStatus, lastError });
}

export async function removeMutation(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("pending_mutations", id);
}
