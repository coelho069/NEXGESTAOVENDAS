import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { backoffBaseSeconds, backoffDelayMs, shouldMarkOutboxFailed } from "@/lib/offline/backoff";
import { closeSale } from "@/lib/offline/close-sale";
import { startHeartbeat } from "@/lib/offline/heartbeat";
import { classifySyncHttpStatus } from "@/lib/offline/http-classify";
import {
  MULTI_TAB_LOCK_HEARTBEAT_MS,
  MULTI_TAB_LOCK_TTL_MS,
  withMultiTabLock,
} from "@/lib/offline/multi-tab-lock";
import { createPdvLocalDb, deletePdvLocalDb, getPdvLocalDb } from "@/lib/offline/pdv-local-db";
import { PDV_LOCAL_DB_NAME } from "@/lib/offline/types";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";
import { IndexedDbQuotaError } from "@/lib/offline/quota";
import { scheduleOutboxRetry } from "@/lib/offline/outbox";
import { assertNoSecrets, stripSecrets } from "@/lib/offline/secrets";
import {
  countUnsyncedCommands,
  listVisibleConflicts,
  pullChanges,
  pushOutboxCommand,
  pushPendingCommands,
  reconcileSale,
  recordConflict,
} from "@/lib/offline/sync-engine";
import { listDueOutboxCommands } from "@/lib/offline/outbox";
import type { CloseSaleInput } from "@/lib/offline/types";
import { CART_PERSIST_KEY, createCartStore, useCartStore } from "@/stores/cart-store";
import { useSessionStore } from "@/stores/session-store";
import { ConflictBanner } from "@/components/pdv/conflict-banner";
import { useCheckout } from "@/hooks/use-checkout";

const STORE_ID = "22222222-2222-4222-8222-222222222201";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444401";
const MUTATION_ID = "99999999-9999-4999-8999-999999999999";
const SECOND_MUTATION_ID = "99999999-9999-4999-8999-999999999998";
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

async function expectLocalTransactionEmpty(db: PdvLocalDatabase): Promise<void> {
  expect(await db.sales.count()).toBe(0);
  expect(await db.saleItems.count()).toBe(0);
  expect(await db.payments.count()).toBe(0);
  expect(await db.outbox.count()).toBe(0);
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
    expect(await db.payments.toCollection().first()).toMatchObject({
      method: "cash",
      amount: "3.50",
      status: "pending",
    });
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

    await expect(
      closeSale(db, {
        ...saleInput(),
        lines: [{ ...sampleLine, quantity: 5 }],
        payments: [{ method: "cash", amount: "17.50" }],
      })
    ).rejects.toThrow(/estoque insuficiente/i);

    expect(await db.sales.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(1);
  });
});

describe("rollback após falha parcial do fechamento local", () => {
  it("desfaz estoque e venda quando saleItems.add falha", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    const addSpy = vi.spyOn(db.saleItems, "add").mockRejectedValue(new Error("sale item write failed"));

    await expect(closeSale(db, saleInput())).rejects.toThrow("sale item write failed");
    await expectLocalTransactionEmpty(db);
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(10);

    addSpy.mockRestore();
    await closeSale(db, saleInput());
    expect(await db.sales.count()).toBe(1);
    expect(await db.payments.count()).toBe(1);
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(9);
  });

  it("desfaz venda e itens quando payments.add falha", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    const addSpy = vi.spyOn(db.payments, "add").mockRejectedValue(new Error("payment write failed"));

    await expect(closeSale(db, saleInput())).rejects.toThrow("payment write failed");
    await expectLocalTransactionEmpty(db);
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(10);

    addSpy.mockRestore();
    await closeSale(db, saleInput());
    expect(await db.sales.count()).toBe(1);
    expect(await db.payments.count()).toBe(1);
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(9);
  });

  it("desfaz todas as escritas quando outbox.add falha", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    const addSpy = vi.spyOn(db.outbox, "add").mockRejectedValue(new Error("outbox write failed"));

    await expect(closeSale(db, saleInput())).rejects.toThrow("outbox write failed");
    await expectLocalTransactionEmpty(db);
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(10);

    addSpy.mockRestore();
    await closeSale(db, saleInput());
    expect(await db.sales.count()).toBe(1);
    expect(await db.payments.count()).toBe(1);
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(9);
  });

  it("desfaz a primeira baixa quando a segunda baixa de estoque falha", async () => {
    const secondProductId = "44444444-4444-4444-8444-444444444402";
    const db = await openDb();
    dbs.push(db);
    await seedStock(db, 10);
    await db.inventoryBalances.put({
      storeId: STORE_ID,
      productId: secondProductId,
      quantity: 10,
      serverQuantity: 10,
      updatedAt: new Date().toISOString(),
    });
    const originalPut = db.inventoryBalances.put.bind(db.inventoryBalances);
    let calls = 0;
    const putSpy = vi.spyOn(db.inventoryBalances, "put").mockImplementation((value) => {
      calls += 1;
      if (calls === 2) throw new Error("second stock write failed");
      return originalPut(value);
    });
    const input = {
      ...saleInput(),
      lines: [
        sampleLine,
        { ...sampleLine, productId: secondProductId, sku: "BEV-002", name: "Refrigerante Lata 350ml", unitPrice: "5.00" },
      ],
      payments: [{ method: "cash" as const, amount: "8.50" }],
    };

    await expect(closeSale(db, input)).rejects.toThrow("second stock write failed");
    await expectLocalTransactionEmpty(db);
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(10);
    expect((await db.inventoryBalances.get([STORE_ID, secondProductId]))?.quantity).toBe(10);

    putSpy.mockRestore();
    await closeSale(db, input);
    expect(await db.sales.count()).toBe(1);
    expect(await db.saleItems.count()).toBe(2);
    expect(await db.payments.count()).toBe(1);
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(9);
    expect((await db.inventoryBalances.get([STORE_ID, secondProductId]))?.quantity).toBe(9);
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

  it("duas chamadas concorrentes com o mesmo clientMutationId fazem uma única baixa", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db, 5);

    const results = await Promise.all([closeSale(db, saleInput()), closeSale(db, saleInput())]);

    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
    expect(await db.sales.count()).toBe(1);
    expect(await db.saleItems.count()).toBe(1);
    expect(await db.payments.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(4);
  });

  it("duas vendas concorrentes com estoque unitário não deixam saldo negativo", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db, 1);

    const results = await Promise.allSettled([
      closeSale(db, saleInput(MUTATION_ID)),
      closeSale(db, saleInput(SECOND_MUTATION_ID)),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await db.sales.count()).toBe(1);
    expect(await db.payments.count()).toBe(1);
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(0);
  });

  it("rejeita payload local adulterado antes de qualquer escrita", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db, 10);

    await expect(
      closeSale(db, {
        ...saleInput(),
        lines: [{ ...sampleLine, discount: "10.00" }],
      })
    ).rejects.toThrow(/desconto do item/i);

    await expect(
      closeSale(db, {
        ...saleInput(),
        lines: [sampleLine, { ...sampleLine }],
      })
    ).rejects.toThrow(/duplicado/i);

    await expect(
      closeSale(db, {
        ...saleInput(),
        lines: [{ ...sampleLine, quantity: 1.2345 }],
      })
    ).rejects.toThrow(/quantidade inválida|payload de venda inválido/i);

    expect(await db.sales.count()).toBe(0);
    expect(await db.saleItems.count()).toBe(0);
    expect(await db.payments.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(10);
  });

  it("rejeita reutilização do mutation ID em outra loja ou com pagamento divergente", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db, 5);
    await closeSale(db, saleInput());

    await expect(
      closeSale(db, { ...saleInput(), storeId: "22222222-2222-4222-8222-222222222202" })
    ).rejects.toThrow(/já utilizado/i);
    await expect(
      closeSale(db, { ...saleInput(), payments: [{ method: "cash", amount: "4.50" }] })
    ).rejects.toThrow(/Pagamento deve corresponder/i);
    await expect(
      closeSale(db, {
        ...saleInput(),
        lines: [{ ...sampleLine, unitPrice: "4.00" }],
        payments: [{ method: "cash", amount: "4.00" }],
      })
    ).rejects.toThrow(/já utilizado/i);

    expect(await db.sales.count()).toBe(1);
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(4);
  });
});

describe("checkout protegido contra clique duplo", () => {
  it("mantém uma única venda, pagamento e baixa local", async () => {
    await deletePdvLocalDb(PDV_LOCAL_DB_NAME);
    const db = getPdvLocalDb();
    await db.open();
    dbs.push(db);
    await seedStock(db, 5);

    const cart = useCartStore.getState();
    cart.setStoreId(STORE_ID);
    cart.setLines([sampleLine]);
    cart.setDiscount("0.00");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    const { result } = renderHook(() => useCheckout());
    const firstCheckout = result.current.checkoutCash();

    await expect(result.current.checkoutCash()).rejects.toThrow(/já em andamento/i);
    await firstCheckout;

    expect(await db.sales.count()).toBe(1);
    expect(await db.payments.count()).toBe(1);
    expect((await db.payments.toCollection().first())?.amount).toBe("3.50");
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(4);
  });

  it("recusa checkout quando outra aba mantém o lock compartilhado", async () => {
    await deletePdvLocalDb(PDV_LOCAL_DB_NAME);
    const db = getPdvLocalDb();
    await db.open();
    dbs.push(db);
    await seedStock(db, 5);

    const cart = useCartStore.getState();
    cart.setStoreId(STORE_ID);
    cart.setLines([sampleLine]);
    cart.setDiscount("0.00");
    localStorage.setItem(`lock:nex-pdv-checkout:${STORE_ID}`, String(Date.now()));

    const { result } = renderHook(() => useCheckout());
    await expect(result.current.checkoutCash()).rejects.toThrow(/outra aba/i);
    expect(await db.sales.count()).toBe(0);
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(5);
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

  it("aguarda o backoff e depois reconcilia o mesmo comando", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());

    let now = new Date("2026-09-01T00:00:00.000Z");
    let attempts = 0;
    const command = await db.outbox.get(MUTATION_ID);
    await db.outbox.put({
      ...command!,
      nextAttemptAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    const fetchFn = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: "temporarily unavailable" }), { status: 503 });
      }
      return new Response(
        JSON.stringify({ sale_id: SERVER_SALE_ID, status: "confirmed", total: "3.50" }),
        { status: 200 }
      );
    });
    const deps = {
      db,
      fetchFn,
      now: () => now,
      random: () => 1,
    };

    await pushPendingCommands(deps);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((await db.outbox.get(MUTATION_ID))?.status).toBe("pending");
    expect((await db.outbox.get(MUTATION_ID))?.nextAttemptAt).toBe("2026-09-01T00:00:01.000Z");

    now = new Date("2026-09-01T00:00:00.500Z");
    await pushPendingCommands(deps);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    now = new Date("2026-09-01T00:00:01.000Z");
    await pushPendingCommands(deps);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((await db.outbox.get(MUTATION_ID))?.status).toBe("synced");
    expect((await db.sales.where("clientMutationId").equals(MUTATION_ID).first())?.syncStatus).toBe("synced");
    expect(await db.payments.count()).toBe(1);
  });

  it("trata timeout depois do processamento remoto como replay seguro", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());

    const requestBodies: string[] = [];
    let attempts = 0;
    let serverCommitted = false;
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(String(init?.body));
      attempts += 1;
      if (attempts === 1) {
        serverCommitted = true;
        const signal = init?.signal;
        await new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new DOMException("The operation was aborted", "AbortError"));
          if (signal?.aborted) {
            abort();
          } else {
            signal?.addEventListener("abort", abort, { once: true });
          }
        });
      }
      return new Response(
        JSON.stringify({ sale_id: SERVER_SALE_ID, replay: true, status: "confirmed", total: "3.50" }),
        { status: 200 }
      );
    });
    const command = await db.outbox.get(MUTATION_ID);
    await db.outbox.put({
      ...command!,
      nextAttemptAt: new Date(0).toISOString(),
    });

    await pushPendingCommands({
      db,
      fetchFn,
      random: () => 1,
      requestTimeoutMs: 10,
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    });
    expect(serverCommitted).toBe(true);

    const retry = await db.outbox.get(MUTATION_ID);
    await db.outbox.put({
      ...retry!,
      status: "pending",
      nextAttemptAt: new Date(0).toISOString(),
    });
    await pushPendingCommands({
      db,
      fetchFn,
      random: () => 1,
      requestTimeoutMs: 10,
      now: () => new Date("2026-09-01T00:00:01.000Z"),
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(requestBodies.map((body) => JSON.parse(body).client_mutation_id)).toEqual([
      MUTATION_ID,
      MUTATION_ID,
    ]);
    expect(await db.sales.count()).toBe(1);
    expect(await db.payments.count()).toBe(1);
    expect((await db.outbox.get(MUTATION_ID))?.status).toBe("synced");
  });
});

describe("idempotência 3x", () => {
  it("três entregas do mesmo comando mantêm uma venda e o mesmo clientMutationId", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());

    const requestBodies: string[] = [];
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(String(init?.body));
      return new Response(
        JSON.stringify({ sale_id: SERVER_SALE_ID, replay: true, status: "confirmed", total: "3.50" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    });

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

    const bodies = requestBodies.map((body) => JSON.parse(body).client_mutation_id as string);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(new Set(bodies)).toEqual(new Set([MUTATION_ID]));
    expect(await db.sales.count()).toBe(1);
    expect(await db.payments.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
    const sale = await db.sales.where("clientMutationId").equals(MUTATION_ID).first();
    expect(sale?.serverSaleId).toBe(SERVER_SALE_ID);
    expect(sale?.status).toBe("confirmed");
    expect(sale?.syncStatus).toBe("synced");
  });
});

describe("estado estrito do outbox", () => {
  it("não reenvia comando stale quando o registro já está sincronizado", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());
    const command = await db.outbox.get(MUTATION_ID);
    await db.outbox.put({
      ...command!,
      status: "synced",
      updatedAt: new Date().toISOString(),
    });

    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ sale_id: SERVER_SALE_ID }), { status: 200 }));
    await pushOutboxCommand({ db, fetchFn }, command!);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(await countUnsyncedCommands(db)).toBe(0);
  });

  it("não aplica resposta quando o outbox deixou de estar processing", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());
    const command = await db.outbox.get(MUTATION_ID);

    const fetchFn = vi.fn(async () => {
      const current = await db.outbox.get(MUTATION_ID);
      await db.outbox.put({
        ...current!,
        status: "conflict",
        updatedAt: new Date().toISOString(),
      });
      return new Response(JSON.stringify({ sale_id: SERVER_SALE_ID, status: "confirmed" }), { status: 200 });
    });
    await pushOutboxCommand({ db, fetchFn }, command!);

    const sale = await db.sales.where("clientMutationId").equals(MUTATION_ID).first();
    expect(sale?.syncStatus).toBe("pending");
    expect((await db.outbox.get(MUTATION_ID))?.status).toBe("conflict");
  });

  it("reivindicação compare-and-set impede duas abas de enviarem o mesmo comando", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());
    const command = await db.outbox.get(MUTATION_ID);
    let releaseRequest!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      releaseRequest = resolve;
    });
    const fetchFn = vi.fn(async () => response);

    const first = pushOutboxCommand({ db, fetchFn }, command!);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    await pushOutboxCommand({ db, fetchFn }, command!);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    releaseRequest(
      new Response(JSON.stringify({ sale_id: SERVER_SALE_ID, status: "confirmed", total: "3.50" }), {
        status: 200,
      })
    );
    await first;
    expect((await db.outbox.get(MUTATION_ID))?.status).toBe("synced");
    expect((await db.sales.where("clientMutationId").equals(MUTATION_ID).first())?.syncStatus).toBe("synced");
  });

  it("lista somente comandos pending, nunca processing ou estados terminais", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());
    const command = await db.outbox.get(MUTATION_ID);
    await db.outbox.put({
      ...command!,
      status: "processing",
      nextAttemptAt: new Date(0).toISOString(),
    });

    expect(await listDueOutboxCommands(db, new Date())).toHaveLength(0);
    expect(await countUnsyncedCommands(db)).toBe(1);
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

  it("ignora resposta de conflito de uma lease antiga do outbox", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());
    const command = await db.outbox.get(MUTATION_ID);

    await pushOutboxCommand(
      {
        db,
        fetchFn: async () =>
          ({
            status: 422,
            json: async () => {
              const current = await db.outbox.get(MUTATION_ID);
              await db.outbox.put({
                ...current!,
                status: "processing",
                updatedAt: "2026-09-02T19:30:00.000Z",
              });
              return { error: "stale conflict" };
            },
          }) as Response,
      },
      command!
    );

    expect((await db.outbox.get(MUTATION_ID))?.status).toBe("processing");
    expect((await db.sales.where("clientMutationId").equals(MUTATION_ID).first())?.syncStatus).toBe("pending");
    expect(await listVisibleConflicts(db)).toHaveLength(0);
  });

  it("push trata 403 de desconto como conflito e restaura estoque local", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());
    const command = await db.outbox.get(MUTATION_ID);

    await pushOutboxCommand(
      {
        db,
        fetchFn: async () =>
          new Response(JSON.stringify({ error: "discount_limit_exceeded" }), { status: 403 }),
      },
      command!
    );

    const conflicts = await listVisibleConflicts(db);
    expect(conflicts[0]?.httpStatus).toBe(403);
    expect((await db.outbox.get(MUTATION_ID))?.status).toBe("conflict");
    expect((await db.sales.where("clientMutationId").equals(MUTATION_ID).first())?.syncStatus).toBe("conflict");
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(10);
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
  it("classifica 408/429/5xx como transitório, 401 encerra sessão, 403/409/422 conflito", () => {
    expect(classifySyncHttpStatus(200)).toBe("success");
    expect(classifySyncHttpStatus(408)).toBe("transient");
    expect(classifySyncHttpStatus(429)).toBe("transient");
    expect(classifySyncHttpStatus(500)).toBe("transient");
    expect(classifySyncHttpStatus(503)).toBe("transient");
    expect(classifySyncHttpStatus(401)).toBe("end_session");
    expect(classifySyncHttpStatus(403)).toBe("conflict");
    expect(classifySyncHttpStatus(409)).toBe("conflict");
    expect(classifySyncHttpStatus(422)).toBe("conflict");
  });

  it("usa backoff 1,2,4,8,16s com teto 60s e preserva resultado incerto após 10 falhas", async () => {
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

    const uncertain = await db.outbox.get(MUTATION_ID);
    expect(uncertain?.status).toBe("conflict");
    expect(uncertain?.attemptCount).toBe(10);
    expect(uncertain?.clientMutationId).toBe(MUTATION_ID);
    expect(uncertain?.outcomeUnknown).toBe(true);
    expect(await db.outbox.count()).toBe(1);
    expect((await db.sales.where("clientMutationId").equals(MUTATION_ID).first())?.syncStatus).toBe("conflict");
    expect((await db.payments.toCollection().first())?.status).toBe("pending");
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(9);
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

  it("falha HTTP fatal libera a reserva local e fecha a venda como failed", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());
    const command = await db.outbox.get(MUTATION_ID);

    await pushOutboxCommand(
      {
        db,
        fetchFn: async () => new Response(JSON.stringify({ error: "invalid request" }), { status: 400 }),
      },
      command!
    );

    expect((await db.outbox.get(MUTATION_ID))?.status).toBe("failed");
    expect((await db.sales.where("clientMutationId").equals(MUTATION_ID).first())?.syncStatus).toBe("failed");
    expect((await db.payments.toCollection().first())?.status).toBe("failed");
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(10);
  });

  it("não divide estado quando a reconciliação de falha terminal também falha", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());
    const command = await db.outbox.get(MUTATION_ID);
    const salePutSpy = vi.spyOn(db.sales, "put").mockRejectedValue(new Error("local sale update failed"));

    await expect(
      pushOutboxCommand(
        {
          db,
          fetchFn: async () => new Response(JSON.stringify({ error: "invalid request" }), { status: 400 }),
        },
        command!
      )
    ).rejects.toThrow("local sale update failed");

    salePutSpy.mockRestore();
    expect((await db.outbox.get(MUTATION_ID))?.status).toBe("processing");
    expect((await db.sales.where("clientMutationId").equals(MUTATION_ID).first())?.syncStatus).toBe("pending");
    expect((await db.payments.toCollection().first())?.status).toBe("pending");
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(9);
  });

  it("não aceita sale_id inválido em uma resposta 2xx", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());
    const command = await db.outbox.get(MUTATION_ID);

    await pushOutboxCommand(
      {
        db,
        fetchFn: async () => new Response(JSON.stringify({ sale_id: "not-a-uuid" }), { status: 200 }),
        random: () => 1,
      },
      command!
    );

    const retry = await db.outbox.get(MUTATION_ID);
    expect(retry?.status).toBe("pending");
    expect(retry?.attemptCount).toBe(1);
    expect(retry?.lastError).toBe("invalid sale_id");
    expect((await db.sales.where("clientMutationId").equals(MUTATION_ID).first())?.syncStatus).toBe("pending");
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(9);
  });

  it("esgotar retries por resposta sem sale_id preserva a reserva até reconciliação", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());

    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ status: "confirmed" }), { status: 200 }));
    for (let index = 0; index < 10; index += 1) {
      const command = await db.outbox.get(MUTATION_ID);
      await db.outbox.put({
        ...command!,
        status: "pending",
        nextAttemptAt: new Date(0).toISOString(),
      });
      await pushPendingCommands({ db, fetchFn, random: () => 0.5 });
    }

    expect(fetchFn).toHaveBeenCalledTimes(10);
    expect((await db.outbox.get(MUTATION_ID))?.status).toBe("conflict");
    expect((await db.outbox.get(MUTATION_ID))?.outcomeUnknown).toBe(true);
    expect((await db.sales.where("clientMutationId").equals(MUTATION_ID).first())?.syncStatus).toBe("conflict");
    expect((await db.payments.toCollection().first())?.status).toBe("pending");
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(9);

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
                quantity: 9,
                updated_at: "2026-09-01T12:00:00.000Z",
              },
            ],
            sales: [
              {
                id: SERVER_SALE_ID,
                client_mutation_id: MUTATION_ID,
                status: "confirmed",
                sync_status: "synced",
                total: "3.50",
                updated_at: "2026-09-01T12:00:00.000Z",
              },
            ],
          }),
          { status: 200 }
        ),
    });

    expect((await db.outbox.get(MUTATION_ID))?.status).toBe("synced");
    expect((await db.sales.where("clientMutationId").equals(MUTATION_ID).first())?.syncStatus).toBe("synced");
    expect((await db.payments.toCollection().first())?.status).toBe("captured");
    expect(await listVisibleConflicts(db)).toHaveLength(0);
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(9);
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

  it("mantém venda sincronizada como reserva até o pull confirmar o estoque", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db, 10);
    await closeSale(db, saleInput());
    await reconcileSale(db, MUTATION_ID, { sale_id: SERVER_SALE_ID, status: "confirmed" });

    await closeSale(db, saleInput(SECOND_MUTATION_ID));
    await recordConflict(db, {
      clientMutationId: SECOND_MUTATION_ID,
      httpStatus: 409,
      message: "conflict",
    });

    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(9);
  });

  it("não desconta duas vezes uma venda já refletida no estoque remoto", async () => {
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
                quantity: 9,
                updated_at: "2026-09-01T12:00:00.000Z",
              },
            ],
            sales: [
              {
                id: SERVER_SALE_ID,
                client_mutation_id: MUTATION_ID,
                status: "confirmed",
                sync_status: "synced",
                total: "3.50",
                updated_at: "2026-09-01T12:00:00.000Z",
              },
            ],
          }),
          { status: 200 }
        ),
    });

    const sale = await db.sales.where("clientMutationId").equals(MUTATION_ID).first();
    const stock = await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]);
    expect(sale?.stockReconciled).toBe(true);
    expect(stock?.serverQuantity).toBe(9);
    expect(stock?.quantity).toBe(9);
  });

  it("normaliza total numérico recebido do servidor para BRL", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db);
    await closeSale(db, saleInput());
    const command = await db.outbox.get(MUTATION_ID);

    await pushOutboxCommand(
      {
        db,
        fetchFn: async () => new Response(JSON.stringify({ sale_id: SERVER_SALE_ID, total: 3.5 }), { status: 200 }),
      },
      command!
    );

    expect((await db.sales.where("clientMutationId").equals(MUTATION_ID).first())?.total).toBe("3.50");
  });

  it("não avança o cursor quando a resposta de pull contém quantidade inválida", async () => {
    const db = await openDb();
    dbs.push(db);
    await seedStock(db, 10);

    const payload = await pullChanges({
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
                quantity: "NaN",
                updated_at: "2026-09-01T12:00:00.000Z",
              },
            ],
            sales: [],
          }),
          { status: 200 }
        ),
    });

    expect(payload).toBeNull();
    expect(await db.meta.get(`lastPullAt:${STORE_ID}`)).toBeUndefined();
    expect((await db.inventoryBalances.get([STORE_ID, PRODUCT_ID]))?.quantity).toBe(10);
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
    expect(lockSrc).not.toMatch(/startHeartbeat/);

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

describe("lease do lock multi-tab", () => {
  it("respeita escopos diferentes e recupera lease expirado", async () => {
    const scopeA = `test-scope-a-${crypto.randomUUID()}`;
    const scopeB = `test-scope-b-${crypto.randomUUID()}`;
    localStorage.setItem(
      `lock:${scopeA}`,
      JSON.stringify({ owner: "crashed-tab", expiresAt: Date.now() - 1 })
    );

    const first = await withMultiTabLock(async () => "first", {
      lockName: scopeA,
      ttlMs: MULTI_TAB_LOCK_TTL_MS,
      heartbeatMs: MULTI_TAB_LOCK_HEARTBEAT_MS,
    });
    const second = await withMultiTabLock(async () => "second", { lockName: scopeB });

    expect(first).toEqual({ acquired: true, value: "first" });
    expect(second).toEqual({ acquired: true, value: "second" });
  });

  it("renova o lease durante a região crítica e libera apenas o próprio owner", async () => {
    const scope = `test-heartbeat-${crypto.randomUUID()}`;
    let release!: () => void;
    const first = withMultiTabLock(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve("done");
        }),
      { lockName: scope, ttlMs: 30, heartbeatMs: 5 }
    );

    await new Promise((resolve) => setTimeout(resolve, 45));
    const concurrent = await withMultiTabLock(async () => "second", {
      lockName: scope,
      ttlMs: 30,
      heartbeatMs: 5,
    });
    expect(concurrent).toEqual({ acquired: false, reason: "busy" });

    release();
    expect(await first).toEqual({ acquired: true, value: "done" });
    expect(localStorage.getItem(`lock:${scope}`)).toBeNull();
  });
});
