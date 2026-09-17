"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  shouldApplyAuthSessionEvent,
  shouldClearSessionForUserChange,
} from "@/lib/auth/auth-events";
import { createClient } from "@/lib/supabase/client";
import { clearClientSessionStorage } from "@/lib/offline/end-session";
import { useSessionStore } from "@/stores/session-store";
import { useSyncStore } from "@/stores/sync-store";

function sameUserIdentity(left: User | null, right: User | null): boolean {
  return (left?.id ?? null) === (right?.id ?? null) && (left?.email ?? null) === (right?.email ?? null);
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const applySessionUser = async (nextUser: User | null) => {
      const previousUserId = useSessionStore.getState().userId;
      const nextUserId = nextUser?.id ?? null;
      const nextEmail = nextUser?.email ?? null;

      if (shouldClearSessionForUserChange(previousUserId, nextUserId)) {
        await clearClientSessionStorage(previousUserId);
        useSyncStore.getState().resetForUser();
      }

      setUser((current) => (sameUserIdentity(current, nextUser) ? current : nextUser));
      setLoading(false);

      const sessionState = useSessionStore.getState();
      if (sessionState.userId !== nextUserId || sessionState.email !== nextEmail) {
        useSessionStore.getState().setUser(nextUserId, nextEmail);
      }
    };

    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      void applySessionUser(null);
      return;
    }

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (!shouldApplyAuthSessionEvent(event)) {
        return;
      }
      void applySessionUser(session?.user ?? null);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  return { user, loading };
}
