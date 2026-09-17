import { describe, expect, it } from "vitest";
import {
  shouldApplyAuthSessionEvent,
  shouldClearSessionForUserChange,
  shouldReloadCatalogOnAuthEvent,
} from "@/lib/auth/auth-events";

describe("shouldReloadCatalogOnAuthEvent", () => {
  it("reloads catalog only on sign-in and sign-out", () => {
    expect(shouldReloadCatalogOnAuthEvent("SIGNED_IN")).toBe(true);
    expect(shouldReloadCatalogOnAuthEvent("SIGNED_OUT")).toBe(true);
  });

  it("does not reload on token refresh or initial session", () => {
    expect(shouldReloadCatalogOnAuthEvent("TOKEN_REFRESHED")).toBe(false);
    expect(shouldReloadCatalogOnAuthEvent("INITIAL_SESSION")).toBe(false);
  });

  it("does not reload on other auth lifecycle events", () => {
    expect(shouldReloadCatalogOnAuthEvent("USER_UPDATED")).toBe(false);
    expect(shouldReloadCatalogOnAuthEvent("PASSWORD_RECOVERY")).toBe(false);
    expect(shouldReloadCatalogOnAuthEvent("MFA_CHALLENGE_VERIFIED")).toBe(false);
  });
});

describe("shouldApplyAuthSessionEvent", () => {
  it("applies session updates for hydration and sign-in/out", () => {
    expect(shouldApplyAuthSessionEvent("INITIAL_SESSION")).toBe(true);
    expect(shouldApplyAuthSessionEvent("SIGNED_IN")).toBe(true);
    expect(shouldApplyAuthSessionEvent("SIGNED_OUT")).toBe(true);
    expect(shouldApplyAuthSessionEvent("USER_UPDATED")).toBe(true);
  });

  it("ignores token refresh and recovery events", () => {
    expect(shouldApplyAuthSessionEvent("TOKEN_REFRESHED")).toBe(false);
    expect(shouldApplyAuthSessionEvent("PASSWORD_RECOVERY")).toBe(false);
    expect(shouldApplyAuthSessionEvent("MFA_CHALLENGE_VERIFIED")).toBe(false);
  });
});

describe("shouldClearSessionForUserChange", () => {
  it("does not clear storage on initial hydration", () => {
    expect(shouldClearSessionForUserChange(null, "user-1")).toBe(false);
  });

  it("clears storage on sign-out and user switch", () => {
    expect(shouldClearSessionForUserChange("user-1", null)).toBe(true);
    expect(shouldClearSessionForUserChange("user-1", "user-2")).toBe(true);
  });

  it("does not clear storage when the same user is re-applied", () => {
    expect(shouldClearSessionForUserChange("user-1", "user-1")).toBe(false);
    expect(shouldClearSessionForUserChange(null, null)).toBe(false);
  });
});
