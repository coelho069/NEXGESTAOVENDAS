"use client";

import { create } from "zustand";

export type SessionState = {
  userId: string | null;
  email: string | null;
  sessionEnded: boolean;
  setUser: (userId: string | null, email: string | null) => void;
  endSession: () => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  userId: null,
  email: null,
  sessionEnded: false,
  setUser: (userId, email) => set({ userId, email, sessionEnded: false }),
  endSession: () => set({ userId: null, email: null, sessionEnded: true }),
}));
