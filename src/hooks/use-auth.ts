"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import { useSessionStore } from "@/stores/session-store";
import { clearClientSessionStorage } from "@/lib/offline/end-session";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const applySessionUser = (nextUser: User | null) => {
      const previousUserId = useSessionStore.getState().userId;
      const nextUserId = nextUser?.id ?? null;
      if (previousUserId !== nextUserId || nextUserId === null) {
        void clearClientSessionStorage(previousUserId);
      }
      setUser(nextUser);
      setLoading(false);
      useSessionStore.getState().setUser(nextUserId, nextUser?.email ?? null);
    };

    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      applySessionUser(null);
      return;
    }

    supabase.auth.getUser().then(({ data }) => {
      applySessionUser(data.user ?? null);
    }).catch(() => {
      applySessionUser(null);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      applySessionUser(session?.user ?? null);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  return { user, loading };
}
