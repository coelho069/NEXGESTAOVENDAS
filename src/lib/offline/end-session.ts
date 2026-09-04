import { useSessionStore } from "@/stores/session-store";
import { useSyncStore } from "@/stores/sync-store";
import { CART_PERSIST_KEY, useCartStore } from "@/stores/cart-store";
import {
  deletePdvLocalDbForUser,
  getPdvLocalDbForUser,
} from "@/lib/offline/pdv-local-db";

function clearPrefixedWebStorage(storage: Storage, prefixes: string[]): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    if (prefixes.some((prefix) => key === prefix || key.startsWith(prefix))) {
      keys.push(key);
    }
  }
  keys.forEach((key) => storage.removeItem(key));
}

export async function clearClientSessionStorage(userId?: string | null): Promise<void> {
  useCartStore.getState().clear();
  if (typeof localStorage !== "undefined") {
    clearPrefixedWebStorage(localStorage, [
      CART_PERSIST_KEY,
      "nex-cash-session:",
      "nex-pdv-cart",
    ]);
  }
  if (typeof sessionStorage !== "undefined") {
    clearPrefixedWebStorage(sessionStorage, ["nex-cash-pending-mutations:"]);
  }

  if (typeof indexedDB === "undefined") return;

  try {
    const db = getPdvLocalDbForUser(userId);
    const [retainedSales, retainedInventory] = await Promise.all([
      db.outbox
        .where("status")
        .anyOf(["pending", "processing", "failed", "conflict"])
        .count(),
      db.inventoryOutbox
        .where("status")
        .anyOf(["pending", "processing", "failed", "conflict"])
        .count(),
    ]);
    const retainedOutbox = retainedSales + retainedInventory;

    if (retainedOutbox === 0) {
      await deletePdvLocalDbForUser(userId);
    } else {
      // Pending/uncertain operations must survive logout, but remain isolated
      // in the user-scoped database and are never exposed to the next session.
      db.close();
    }
  } catch {
    // Storage cleanup must not prevent the auth session from ending.
  }
}

export async function endClientSession(): Promise<void> {
  const userId = useSessionStore.getState().userId;
  await clearClientSessionStorage(userId);
  useSessionStore.getState().endSession();
  useSyncStore.getState().resetForUser();
  useSyncStore.getState().setSessionEnded(true);

  try {
    const { createClient } = await import("@/lib/supabase/client");
    await createClient().auth.signOut();
  } catch {
    // Tests and environments without Supabase env must still end the in-memory session.
  }
}
