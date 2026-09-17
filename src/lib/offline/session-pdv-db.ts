"use client";

import {
  getPdvLocalDbForUser,
  getPdvLocalDbName,
  type PdvLocalDatabase,
} from "@/lib/offline/pdv-local-db";
import { useSessionStore } from "@/stores/session-store";

/** Single source of truth for the logged-in user's local Dexie scope. */
export function getSessionUserId(): string | null {
  return useSessionStore.getState().userId;
}

export function getSessionPdvLocalDbName(): string {
  return getPdvLocalDbName(getSessionUserId());
}

export function getSessionPdvLocalDb(): PdvLocalDatabase {
  return getPdvLocalDbForUser(getSessionUserId());
}
