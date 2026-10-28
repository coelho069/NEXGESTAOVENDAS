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

type ServerSessionUser = { id: string; email: string | null };

async function fetchServerSessionUser(): Promise<ServerSessionUser | null> {
  try {
    const response = await fetch("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as {
      authenticated?: unknown;
      user?: { id?: unknown; email?: unknown } | null;
    };
    if (body.authenticated !== true || typeof body.user?.id !== "string") {
      return null;
    }
    return {
      id: body.user.id,
      email: typeof body.user.email === "string" ? body.user.email : null,
    };
  } catch {
    return null;
  }
}

export function useAuth() {
  // Fica null quando só o servidor conhece a sessão (cookies httpOnly): o session-store recebe o userId, mas o User do Supabase não é montado aqui.
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let applyVersion = 0;

    const applySessionUser = async (nextUser: User | null, explicitLogout: boolean) => {
      const version = ++applyVersion;
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

      if (nextUser === null && !explicitLogout) {
        void restoreServerSessionUser(version);
      }
    };

    // Cookies de sessão são httpOnly: o cliente não os lê, então pergunta ao servidor.
    const restoreServerSessionUser = async (version: number) => {
      const serverUser = await fetchServerSessionUser();
      if (!serverUser || version !== applyVersion) {
        return;
      }
      const current = useSessionStore.getState();
      if (current.userId !== null || current.sessionEnded) {
        return;
      }
      useSessionStore.getState().setUser(serverUser.id, serverUser.email);
    };

    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      void applySessionUser(null, false);
      return;
    }

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (!shouldApplyAuthSessionEvent(event)) {
        return;
      }
      void applySessionUser(session?.user ?? null, event === "SIGNED_OUT");
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  return { user, loading };
}
