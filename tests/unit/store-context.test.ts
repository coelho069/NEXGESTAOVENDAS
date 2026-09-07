import { describe, expect, it } from "vitest";
import {
  buildAuthorizedStores,
  selectAuthorizedStore,
  shouldShowStoreSelect,
  soleAuthorizedStoreId,
  type MembershipContextRow,
  type StoreContextRow,
} from "@/lib/auth/store-context";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "99999999-9999-4999-8999-999999999999";
const STORE_A = "22222222-2222-4222-8222-222222222201";
const STORE_B = "22222222-2222-4222-8222-222222222202";
const STORE_C = "22222222-2222-4222-8222-222222222203";

describe("authorized store context", () => {
  const memberships: MembershipContextRow[] = [
    { org_id: ORG_A, store_id: STORE_A, role: "manager" },
    { org_id: ORG_A, store_id: STORE_B, role: "cashier" },
    { org_id: ORG_B, store_id: STORE_C, role: "admin" },
  ];
  const stores: StoreContextRow[] = [
    { id: STORE_A, org_id: ORG_A, name: "Loja Centro", is_active: true },
    { id: STORE_B, org_id: ORG_A, name: "Loja Shopping", is_active: false },
    { id: STORE_C, org_id: ORG_B, name: "Outra organização", is_active: true },
  ];

  it("joins only active stores with membership in the profile organization", () => {
    expect(buildAuthorizedStores(memberships, stores, ORG_A)).toEqual([
      { id: STORE_A, name: "Loja Centro", orgId: ORG_A, role: "manager" },
    ]);
    expect(buildAuthorizedStores(memberships, stores, ORG_B)).toEqual([
      { id: STORE_C, name: "Outra organização", orgId: ORG_B, role: "admin" },
    ]);
    expect(buildAuthorizedStores(memberships, stores, null)).toEqual([]);
  });

  it("requires an explicit authorized store when more than one is available", () => {
    const authorized = buildAuthorizedStores(
      memberships.map((membership) => ({ ...membership, org_id: ORG_A })).filter((membership) => membership.store_id !== STORE_C),
      stores.map((store) => ({ ...store, org_id: ORG_A, is_active: true })).filter((store) => store.id !== STORE_C),
      ORG_A
    );

    expect(authorized).toHaveLength(2);
    expect(selectAuthorizedStore(authorized)).toBeNull();
    expect(selectAuthorizedStore(authorized, STORE_A)?.role).toBe("manager");
    expect(selectAuthorizedStore(authorized, STORE_C)).toBeNull();
  });

  it("selects the only authorized store without trusting a default role or store id", () => {
    const authorized = buildAuthorizedStores([memberships[0]!], stores, ORG_A);
    expect(selectAuthorizedStore(authorized)).toMatchObject({ id: STORE_A, role: "manager" });
    expect(selectAuthorizedStore([], STORE_A)).toBeNull();
    expect(soleAuthorizedStoreId(authorized)).toBe(STORE_A);
    expect(shouldShowStoreSelect(authorized)).toBe(false);
  });

  it("offers the store picker only when two or more stores are available", () => {
    expect(shouldShowStoreSelect([])).toBe(false);
    expect(soleAuthorizedStoreId([])).toBeNull();
    expect(shouldShowStoreSelect([{ id: STORE_A }])).toBe(false);
    expect(soleAuthorizedStoreId([{ id: STORE_A }])).toBe(STORE_A);
    expect(shouldShowStoreSelect([{ id: STORE_A }, { id: STORE_B }])).toBe(true);
    expect(soleAuthorizedStoreId([{ id: STORE_A }, { id: STORE_B }])).toBeNull();
  });
});
