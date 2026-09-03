import { useSessionStore } from "@/stores/session-store";
import { useSyncStore } from "@/stores/sync-store";
import { CART_PERSIST_KEY, useCartStore } from "@/stores/cart-store";
import {
  deletePdvLocalDbForUser,
  getPdvLocalDbForUser,
} from "@/lib/offline/pdv-local-db";

export async function clearClientSessionStorage(userId?: string | null): Promise<void> {
  useCartStore.getState().clear();
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(CART_PERSIST_KEY);
  }

  if (typeof indexedDB === "undefined") return;

  try {
    const db = getPdvLocalDbForUser(userId);
    const retainedOutbox = await db.outbox
      .where("status")
      .anyOf(["pending", "processing", "failed", "conflict"])
      .count();

    if (retainedOutbox === 0) {
      await deletePdvLocalDbForUser(userId);
    } else {
      // Pending/uncertain sales must survive logout, but remain isolated in
      // the user-scoped database and are never exposed to the next session.
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
  useSyncStore.getState().setSessionEnded(true);

  try {
    const { createClient } = await import("@/lib/supabase/client");
    await createClient().auth.signOut();
  } catch {
    // Tests and environments without Supabase env must still end the in-memory session.
  }
}
