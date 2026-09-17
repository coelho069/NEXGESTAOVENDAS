import { describe, expect, it } from "vitest";
import { shouldReloadCatalogOnAuthEvent } from "@/hooks/use-products";

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
