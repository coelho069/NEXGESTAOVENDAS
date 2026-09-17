import { afterEach, describe, expect, it, vi } from "vitest";
import { closeSale } from "@/lib/offline/close-sale";
import { createPdvLocalDb, deletePdvLocalDb, type PdvLocalDatabase } from "@/lib/offline/pdv-local-db";
import type { CloseSaleInput } from "@/lib/offline/types";
import {
  parseProcessSalePushSuccess,
  pushOutboxCommand,
  syncOutboxMutation,
} from "@/lib/offline/sync-engine";

const STORE_ID = "22222222-2222-4222-8222-222222222201";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444401";
const MUTATION_ID = "600b72ab-9999-4999-8999-999999999901";
const SERVER_SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const sampleLine = {
  productId: PRODUCT_ID,
  sku: "BEV-001",
  name: "Agua Mineral 500ml",
  unitPrice: "3.50",
  quantity: 1,
  discount: "0.00",
};

function saleInput(): CloseSaleInput {
  return {
    storeId: STORE_ID,
    clientMutationId: MUTATION_ID,
    lines: [sampleLine],
    discount: "0.00",
    payments: [{ method: "cash", amount: "3.50" }],
  };
}

async function openDb(): Promise<PdvLocalDatabase> {
  const db = createPdvLocalDb(`pdv_local_v1_${crypto.randomUUID()}`);
  await db.open();
  return db;
}

async function seedStock(db: PdvLocalDatabase): Promise<void> {
  await db.inventoryBalances.put({
    storeId: STORE_ID,
    productId: PRODUCT_ID,
    quantity: "10.000",
    serverQuantity: "10.000",
    updatedAt: new Date().toISOString(),
  });
}

const dbs: PdvLocalDatabase[] = [];

afterEach(async () => {
  while (dbs.length > 0) {
    const db = dbs.pop();
    if (!db) continue;
    const name = db.name;
    db.close();
    await deletePdvLocalDb(name);
  }
});

describe("parseProcessSalePushSuccess", () => {
  it("accepts confirmed sales when stock_reconciled is omitted", () => {
    expect(
      parseProcessSalePushSuccess(
        {
          sale_id: SERVER_SALE_ID,
          client_mutation_id: MUTATION_ID,
          status: "confirmed",
          total: "3.50",
        },
        MUTATION_ID
      )
    ).toEqual({
      ok: true,
      saleId: SERVER_SALE_ID,
      replay: false,
      total: "3.50",
      stockReconciled: true,
      fiscalStatus: undefined,
    });
  });

  it("accepts replay responses without explicit replay flag", () => {
    expect(
      parseProcessSalePushSuccess(
        {
          sale_id: SERVER_SALE_ID,
          client_mutation_id: MUTATION_ID,
          status: "confirmed",
        },
        MUTATION_ID
      ).ok
    ).toBe(true);
  });

  it("rejects explicit stock_reconciled=false", () => {
    expect(
      parseProcessSalePushSuccess(
        {
          sale_id: SERVER_SALE_ID,
          client_mutation_id: MUTATION_ID,
          status: "confirmed",
          stock_reconciled: false,
        },
        MUTATION_ID
      )
    ).toEqual({ ok: false, error: "invalid process_sale response" });
  });
});

describe("cash checkout sync regression (#30)", () => {
  it("confirms local sale after api_ok when stock_reconciled is missing", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());

    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          sale_id: SERVER_SALE_ID,
          client_mutation_id: MUTATION_ID,
          status: "confirmed",
          total: "3.50",
        }),
        { status: 200 }
      )
    );

    const command = await db.outbox.get(MUTATION_ID);
    await pushOutboxCommand({ db, fetchFn }, command!);

    const sale = await db.sales.where("clientMutationId").equals(MUTATION_ID).first();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sale?.status).toBe("confirmed");
    expect(sale?.syncStatus).toBe("synced");
    expect(sale?.serverSaleId).toBe(SERVER_SALE_ID);
    expect((await db.outbox.get(MUTATION_ID))?.status).toBe("synced");
    expect((await db.payments.toCollection().first())?.status).toBe("captured");
  });

  it("syncOutboxMutation flips pending_sync to confirmed for the checkout mutation", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());

    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          sale_id: SERVER_SALE_ID,
          client_mutation_id: MUTATION_ID,
          replay: false,
          status: "confirmed",
          total: "3.50",
        }),
        { status: 200 }
      )
    );

    const synced = await syncOutboxMutation({ db, fetchFn, storeId: STORE_ID }, MUTATION_ID);

    expect(synced).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((await db.sales.where("clientMutationId").equals(MUTATION_ID).first())?.status).toBe(
      "confirmed"
    );
  });
});
