import { describe, expect, it } from "vitest";
import { canEditProducts, canManageInventory, canSeeCostPrice, canUsePdv, isOperationalRole } from "@/lib/domain/rbac";

describe("PDV access by member role", () => {
  it("lets the client role sell and operate the cash register", () => {
    expect(canUsePdv("client")).toBe(true);
    expect(isOperationalRole("client")).toBe(false);
  });

  it("keeps cashier, manager and admin on the PDV", () => {
    expect(canUsePdv("cashier")).toBe(true);
    expect(canUsePdv("manager")).toBe(true);
    expect(canUsePdv("admin")).toBe(true);
  });

  it("rejects a missing role", () => {
    expect(canUsePdv(null)).toBe(false);
    expect(canUsePdv(undefined)).toBe(false);
  });

  it("lets the client register products without inventory or cost", () => {
    expect(canEditProducts("client")).toBe(true);
    expect(canManageInventory("client")).toBe(false);
    expect(canSeeCostPrice("client")).toBe(false);
    expect(canEditProducts("cashier")).toBe(false);
  });
});
