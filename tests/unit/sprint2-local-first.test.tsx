import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { backoffBaseSeconds, backoffDelayMs, shouldMarkOutboxFailed } from "@/lib/offline/backoff";
import { closeSale } from "@/lib/offline/close-sale";
import { startHeartbeat } from "@/lib/offline/heartbeat";
import { classifySyncHttpStatus } from "@/lib/offline/http-classify";
import { createPdvLocalDb, deletePdvLocalDb } from "@/lib/offline/pdv-local-db";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";
import { IndexedDbQuotaError } from "@/lib/offline/quota";
import { scheduleOutboxRetry } from "@/lib/offline/outbox";
import { assertNoSecrets, stripSecrets } from "@/lib/offline/secrets";
import {
  listVisibleConflicts,
  pullChanges,
  pushOutboxCommand,
  pushPendingCommands,
  reconcileSale,
  recordConflict,
} from "@/lib/offline/sync-engine";
import type { CloseSaleInput } from "@/lib/offline/types";
import { CART_PERSIST_KEY, createCartStore } from "@/stores/cart-store";
import { useSessionStore } from "@/stores/session-store";
import { ConflictBanner } from "@/components/pdv/conflict-banner";

const STORE_ID = "22222222-2222-4222-8222-222222222201";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444401";
const MUTATION_ID = "99999999-9999-4999-8999-999999999999";
const SERVER_SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const sampleLine = {
  productId: PRODUCT_ID,
  sku: "BEV-001",
  name: "Agua Mineral 500ml",
  unitPrice: "3.50",
  quantity: 1,
  discount: "0.00",
};

function saleInput(clientMutationId = MUTATION_ID): CloseSaleInput {
  return {
    storeId: STORE_ID,
    clientMutationId,
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

async function seedStock(db: PdvLocalDatabase, quantity = 10): Promise<void> {
  await db.inventoryBalances.put({
    storeId: STORE_ID,
    productId: PRODUCT_ID,
    quantity,
    serverQuantity: quantity,
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
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Dexie pdv_local_v1 closeSale", () => {
  it("fecha venda em uma transação IndexedDB (venda + itens + pagamentos + estoque + outbox)", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db, 10);
    const tx = vi.spyOn(db, "transaction");

    await closeSale(db, saleInput());

    expect(tx).toHaveBeenCalledTimes(1);
    expect(tx.mock.calls[0]?.[0]).toBe("rw");
    expect(await db.sales.count()).toBe(1);
    expect(await db.saleItems.count()).toBe(1);
    expect(await db.payments.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
    const stock = await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]);
    expect(stock?.quantity).toBe(9);
    const command = await db.outbox.get(MUTATION_ID);
    expect(command?.clientMutationId).toBe(MUTATION_ID);
    expect(command?.payload.client_mutation_id).toBe(MUTATION_ID);
  });

  it("não persiste parcial quando o estoque projetado é insuficiente", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db, 1);

    await expect(closeSale(db, { ...saleInput(), lines: [{ ...sampleLine, quantity: 5 }] })).rejects.toThrow(
      /estoque insuficiente/i
    );

    expect(await db.sales.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(1);
  });
});

describe("reload sem duplicar", () => {
  it("reexecutar closeSale com o mesmo clientMutationId não duplica venda nem estoque", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db, 5);

    await closeSale(db, saleInput());
    await closeSale(db, saleInput());
    await closeSale(db, saleInput());

    expect(await db.sales.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(4);
  });
});

describe("retry seguro", () => {
  it("retry atualiza a mesma chave e não recria clientMutationId", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());

    const addSpy = vi.spyOn(db.outbox, "add");
    const retried = await scheduleOutboxRetry(db, MUTATION_ID, "timeout", { random: () => 0.5 });

    expect(addSpy).not.toHaveBeenCalled();
    expect(retried.clientMutationId).toBe(MUTATION_ID);
    expect(retried.payload.client_mutation_id).toBe(MUTATION_ID);
    expect(retried.attemptCount).toBe(1);
    expect(await db.outbox.count()).toBe(1);
  });
});

describe("idempotência 3x", () => {
  it("três entregas do mesmo comando mantêm uma venda e o mesmo clientMutationId", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());

    const fetchFn = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ sale_id: SERVER_SALE_ID, replay: true, status: "confirmed", total: "3.50" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );

    for (let index = 0; index < 3; index += 1) {
      const command = await db.outbox.get(MUTATION_ID);
      expect(command).toBeTruthy();
      await db.outbox.put({
        ...command!,
        status: "pending",
        nextAttemptAt: new Date(0).toISOString(),
      });
      await pushPendingCommands({ db, fetchFn, random: () => 0.5 });
    }

    const bodies = fetchFn.mock.calls.map((call) => {
      const init = call[1] as { body?: string } | undefined;
      return JSON.parse(String(init?.body)).client_mutation_id as string;
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(new Set(bodies)).toEqual(new Set([MUTATION_ID]));
    expect(await db.sales.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
    const sale = await db.sales.where("clientMutationId").equals(MUTATION_ID).first();
    expect(sale?.serverSaleId).toBe(SERVER_SALE_ID);
    expect(sale?.status).toBe("confirmed");
    expect(sale?.syncStatus).toBe("synced");
  });
});

describe("conflito visível", () => {
  it("recordConflict marca 409/422 e o banner fica visível", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());

    await recordConflict(db, {
      clientMutationId: MUTATION_ID,
      httpStatus: 409,
      message: "price mismatch",
    });

    const conflicts = await listVisibleConflicts(db);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.visible).toBe(true);
    expect(conflicts[0]?.httpStatus).toBe(409);
    expect((await db.outbox.get(MUTATION_ID))?.status).toBe("conflict");
    expect((await db.sales.where("clientMutationId").equals(MUTATION_ID).first())?.syncStatus).toBe("conflict");

    render(<ConflictBanner conflicts={conflicts} />);
    expect(screen.getByTestId("sync-conflict")).toHaveTextContent("Conflito de sincronização");
    expect(screen.getByRole("alert")).toHaveTextContent("HTTP 409");
  });

  it("push trata 422 via recordConflict", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());
    const command = await db.outbox.get(MUTATION_ID);

    await pushOutboxCommand(
      {
        db,
        fetchFn: async () =>
          new Response(JSON.stringify({ error: "estoque insuficiente no servidor" }), { status: 422 }),
      },
      command!
    );

    const conflicts = await listVisibleConflicts(db);
    expect(conflicts[0]?.httpStatus).toBe(422);
    expect(conflicts[0]?.visible).toBe(true);
  });
});

describe("quota", () => {
  it("propaga QuotaExceededError e não deixa outbox órfã", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    vi.spyOn(db.sales, "add").mockRejectedValue(new DOMException("The quota has been exceeded.", "QuotaExceededError"));

    await expect(closeSale(db, saleInput())).rejects.toBeInstanceOf(IndexedDbQuotaError);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.sales.count()).toBe(0);
  });
});

describe("persist off e Zustand sem token/PAN/CVV", () => {
  it("não grava o carrinho quando persist está desligado", () => {
    localStorage.clear();
    const store = createCartStore({ persist: false });
    store.getState().setStoreId(STORE_ID);
    store.getState().addLine(sampleLine);
    expect(localStorage.getItem(CART_PERSIST_KEY)).toBeNull();
  });

  it("remove token, PAN e CVV de qualquer estado persistido", () => {
    const stripped = stripSecrets({
      storeId: STORE_ID,
      token: "jwt-secret",
      access_token: "also-secret",
      pan: "4111111111111111",
      cvv: "123",
      lines: [sampleLine],
    });
    expect(stripped).toEqual({ storeId: STORE_ID, lines: [sampleLine] });
    assertNoSecrets(stripped);
    assertNoSecrets(useSessionStore.getState(), "session");
    expect(useSessionStore.getState()).not.toHaveProperty("token");
    expect(useSessionStore.getState()).not.toHaveProperty("pan");
    expect(useSessionStore.getState()).not.toHaveProperty("cvv");
  });
});

describe("HTTP classify, 401 e backoff", () => {
  it("classifica 408/429/5xx como transitório, 401 encerra sessão, 409/422 conflito", () => {
    expect(classifySyncHttpStatus(200)).toBe("success");
    expect(classifySyncHttpStatus(408)).toBe("transient");
    expect(classifySyncHttpStatus(429)).toBe("transient");
    expect(classifySyncHttpStatus(500)).toBe("transient");
    expect(classifySyncHttpStatus(503)).toBe("transient");
    expect(classifySyncHttpStatus(401)).toBe("end_session");
    expect(classifySyncHttpStatus(409)).toBe("conflict");
    expect(classifySyncHttpStatus(422)).toBe("conflict");
  });

  it("usa backoff 1,2,4,8,16s com teto 60s, jitter e 10 falhas → failed", async () => {
    expect([0, 1, 2, 3, 4].map(backoffBaseSeconds)).toEqual([1, 2, 4, 8, 16]);
    expect(backoffBaseSeconds(6)).toBe(60);
    expect(backoffDelayMs(0, () => 1)).toBe(1000);
    expect(backoffDelayMs(0, () => 0)).toBe(500);
    expect(backoffDelayMs(10, () => 1)).toBe(60_000);
    expect(shouldMarkOutboxFailed(9)).toBe(false);
    expect(shouldMarkOutboxFailed(10)).toBe(true);

    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());

    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 })
    );

    for (let index = 0; index < 10; index += 1) {
      const command = await db.outbox.get(MUTATION_ID);
      await db.outbox.put({
        ...command!,
        status: "pending",
        nextAttemptAt: new Date(0).toISOString(),
      });
      await pushPendingCommands({ db, fetchFn, random: () => 0.5 });
    }

    const failed = await db.outbox.get(MUTATION_ID);
    expect(failed?.status).toBe("failed");
    expect(failed?.attemptCount).toBe(10);
    expect(failed?.clientMutationId).toBe(MUTATION_ID);
    expect(await db.outbox.count()).toBe(1);
  });

  it("401 chama onEndSession e não recria a chave do outbox", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());
    const onEndSession = vi.fn();
    const command = await db.outbox.get(MUTATION_ID);

    await pushOutboxCommand(
      {
        db,
        fetchFn: async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
        onEndSession,
      },
      command!
    );

    expect(onEndSession).toHaveBeenCalledTimes(1);
    const pending = await db.outbox.get(MUTATION_ID);
    expect(pending?.status).toBe("pending");
    expect(pending?.clientMutationId).toBe(MUTATION_ID);
    expect(await db.outbox.count()).toBe(1);
  });
});

describe("reconcileSale e pullChanges", () => {
  it("reconcileSale confirma venda aceita pelo servidor", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());

    const confirmed = await reconcileSale(db, MUTATION_ID, { sale_id: SERVER_SALE_ID, status: "confirmed" });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.syncStatus).toBe("synced");
    expect(confirmed.serverSaleId).toBe(SERVER_SALE_ID);
    expect((await db.outbox.get(MUTATION_ID))?.status).toBe("synced");
  });

  it("pullChanges aplica estoque do servidor descontando reservas locais", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db, 10);
    await closeSale(db, saleInput());

    await pullChanges({
      db,
      storeId: STORE_ID,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            serverTime: "2026-09-01T12:00:00.000Z",
            inventory: [
              {
                store_id: STORE_ID,
                product_id: PRODUCT_ID,
                quantity: 20,
                updated_at: "2026-09-01T12:00:00.000Z",
              },
            ],
            sales: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
    });

    const stock = await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]);
    expect(stock?.serverQuantity).toBe(20);
    expect(stock?.quantity).toBe(19);
  });
});

describe("heartbeat separado de multiTabLock", () => {
  it("módulos não se importam e o heartbeat não adquire lock", async () => {
    const root = path.join(process.cwd(), "src/lib/offline");
    const heartbeatSrc = readFileSync(path.join(root, "heartbeat.ts"), "utf8");
    const lockSrc = readFileSync(path.join(root, "multi-tab-lock.ts"), "utf8");
    expect(heartbeatSrc).not.toMatch(/multi-tab-lock|withMultiTabLock|MULTI_TAB_LOCK/);
    expect(lockSrc).not.toMatch(/heartbeat|startHeartbeat/);

    const lock = await import("@/lib/offline/multi-tab-lock");
    const spy = vi.spyOn(lock, "withMultiTabLock");
    const stop = startHeartbeat({
      intervalMs: 60_000,
      onBeat: () => undefined,
    });
    stop();
    expect(spy).not.toHaveBeenCalled();
  });
});
