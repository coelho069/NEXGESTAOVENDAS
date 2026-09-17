import { beforeEach, describe, expect, it } from "vitest";
import {
  createPdvLocalDb,
  deletePdvLocalDb,
  getPdvLocalDbForUser,
  getPdvLocalDbName,
} from "@/lib/offline/pdv-local-db";
import {
  getSessionPdvLocalDb,
  getSessionPdvLocalDbName,
} from "@/lib/offline/session-pdv-db";
import { useSessionStore } from "@/stores/session-store";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORE_ID = "22222222-2222-4222-8222-222222222201";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333301";

describe("PDV local DB naming contract", () => {
  beforeEach(() => {
    useSessionStore.getState().setUser(USER_ID, "cashier@example.com");
  });

  it("scopes logged-in users to a suffixed Dexie name", () => {
    expect(getPdvLocalDbName(USER_ID)).toBe("pdv_local_v1:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(getPdvLocalDbName(null)).toBe("pdv_local_v1");
    expect(getSessionPdvLocalDbName()).toBe(getPdvLocalDbName(USER_ID));
    expect(getSessionPdvLocalDbName()).not.toBe(getPdvLocalDbName(null));
  });

  it("keeps sync writes and stock reads on the same Dexie database", async () => {
    const dbName = getSessionPdvLocalDbName();
    await deletePdvLocalDb(dbName);

    const syncDb = getSessionPdvLocalDb();
    await syncDb.open();
    await syncDb.inventoryBalances.put({
      storeId: STORE_ID,
      productId: PRODUCT_ID,
      quantity: "252.000",
      serverQuantity: "252.000",
      updatedAt: new Date().toISOString(),
    });

    const stockDb = getPdvLocalDbForUser(USER_ID);
    expect(stockDb.name).toBe(syncDb.name);
    expect(getSessionPdvLocalDb().name).toBe(syncDb.name);

    const row = await stockDb.inventoryBalances.get([STORE_ID, PRODUCT_ID]);
    expect(row?.quantity).toBe("252.000");

    syncDb.close();
    await deletePdvLocalDb(dbName);
  });

  it("does not leak inventory into the anonymous database name", async () => {
    const scopedName = getSessionPdvLocalDbName();
    const anonymousName = getPdvLocalDbName(null);
    await deletePdvLocalDb(scopedName);
    await deletePdvLocalDb(anonymousName);

    const syncDb = getSessionPdvLocalDb();
    await syncDb.open();
    await syncDb.inventoryBalances.put({
      storeId: STORE_ID,
      productId: PRODUCT_ID,
      quantity: "252.000",
      serverQuantity: "252.000",
      updatedAt: new Date().toISOString(),
    });
    syncDb.close();

    const anonymousDb = createPdvLocalDb(anonymousName);
    await anonymousDb.open();
    expect(await anonymousDb.inventoryBalances.count()).toBe(0);
    anonymousDb.close();

    await deletePdvLocalDb(scopedName);
    await deletePdvLocalDb(anonymousName);
  });
});
