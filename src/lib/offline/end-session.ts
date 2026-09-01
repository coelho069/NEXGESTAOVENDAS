import { useSessionStore } from "@/stores/session-store";
import { useSyncStore } from "@/stores/sync-store";

export async function endClientSession(): Promise<void> {
  useSessionStore.getState().endSession();
  useSyncStore.getState().setSessionEnded(true);

  try {
    const { createClient } = await import("@/lib/supabase/client");
    await createClient().auth.signOut();
  } catch {
    // Tests and environments without Supabase env must still end the in-memory session.
  }
}
