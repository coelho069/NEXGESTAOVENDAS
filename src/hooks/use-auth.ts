"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import { useSessionStore } from "@/stores/session-store";
import { useSyncStore } from "@/stores/sync-store";
import { clearClientSessionStorage } from "@/lib/offline/end-session";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const applySessionUser = async (nextUser: User | null) => {
      const previousUserId = useSessionStore.getState().userId;
      const nextUserId = nextUser?.id ?? null;
      if (previousUserId !== nextUserId || nextUserId === null) {
        await clearClientSessionStorage(previousUserId);
        useSyncStore.getState().resetForUser();
      }
      setUser(nextUser);
      setLoading(false);
      useSessionStore.getState().setUser(nextUserId, nextUser?.email ?? null);
    };

    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      void applySessionUser(null);
      return;
    }

    supabase.auth.getUser().then(({ data }) => {
      void applySessionUser(data.user ?? null);
    }).catch(() => {
      void applySessionUser(null);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySessionUser(session?.user ?? null);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  return { user, loading };
}
