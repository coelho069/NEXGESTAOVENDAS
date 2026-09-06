import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCardPaymentAdapter,
  getCommercialPaymentAdapter,
  getCreditCardPaymentAdapter,
  getDebitCardPaymentAdapter,
  getPaymentAdapter,
  getTefPaymentAdapter,
} from "@/lib/adapters/payment";
import {
  assertCardResultNotFakePaid,
  assertTefResultNotFakePaid,
  buildPaymentContract,
  canCompletePaymentOffline,
  offlinePaymentBlockedMessage,
  paymentNotConfiguredMessage,
  resolveCardExternalRefundOutcome,
  resolveTefExternalRefundOutcome,
  toDbPaymentMethod,
} from "@/lib/domain/payment";
import { resolvePaymentAttempt } from "@/lib/domain/payment-attempt";
import { attachSettingsMeta, defaultStoreSettings } from "@/lib/domain/store-settings";
import {
  getPaymentProviderConfig,
  getPublicPaymentProviderStatus,
} from "@/lib/server/payment-provider";
import { isCardPubliclyConfigured, runCardOperation } from "@/lib/server/card-operations";
import { isTefPubliclyConfigured, runTefOperation } from "@/lib/server/tef-operations";
import { closeSale } from "@/lib/offline/close-sale";
import { createPdvLocalDb, deletePdvLocalDb } from "@/lib/offline/pdv-local-db";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";

const { getAuthedContext, createClient } = vi.hoisted(() => ({
  getAuthedContext: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getAuthedContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/observability/request-context", () => ({
  createRequestObservability: () => ({
    withHeaders: <T>(value: T) => value,
  }),
  observeApiResult: vi.fn(),
}));

import { POST as cardPost } from "@/app/api/payments/card/route";
import { POST as tefPost } from "@/app/api/payments/tef/route";
import { POST as processSalePost } from "@/app/api/sales/process/route";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222201";
const OTHER_STORE = "22222222-2222-4222-8222-222222222202";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444401";
const MUTATION_ID = "99999999-9999-4999-8999-999999999901";
const MUTATION_ID_2 = "99999999-9999-4999-8999-999999999902";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function authContext(role: "cashier" | "manager" | "admin", storeId = STORE_ID, orgId = ORG_ID) {
  return {
    userId: USER_ID,
    role,
    orgId,
    storeId,
    storeName: "Loja Centro",
    stores: [{ id: storeId, name: "Loja Centro", orgId, role }],
  };
}

describe("B23 commercial method mapping", () => {
  it("maps credit/debit/tef onto existing Postgres enums", () => {
    expect(toDbPaymentMethod("credit_card")).toBe("card");
    expect(toDbPaymentMethod("debit_card")).toBe("card");
    expect(toDbPaymentMethod("tef")).toBe("other");
    expect(toDbPaymentMethod("pix")).toBe("pix");
    expect(toDbPaymentMethod("cash")).toBe("cash");
  });

  it("builds PaymentContract without inventing captured card/tef state", () => {
    const contract = buildPaymentContract({
      paymentId: "p1",
      saleId: "s1",
      method: "credit_card",
      amount: "10.00",
      status: "pending",
      provider: "not_configured",
      idempotencyKey: MUTATION_ID,
      adapterStatus: "not_configured",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(contract.status).toBe("pending");
    expect(contract.adapterStatus).toBe("not_configured");
  });

  it("blocks credit/debit/tef offline", () => {
    expect(canCompletePaymentOffline("cash")).toBe(true);
    expect(canCompletePaymentOffline("credit_card")).toBe(false);
    expect(canCompletePaymentOffline("debit_card")).toBe(false);
    expect(canCompletePaymentOffline("tef")).toBe(false);
    expect(offlinePaymentBlockedMessage("credit_card")).toMatch(/offline/i);
    expect(offlinePaymentBlockedMessage("debit_card")).toMatch(/offline/i);
    expect(offlinePaymentBlockedMessage("tef")).toMatch(/offline|TEF/i);
  });
});

describe("B23 credit/debit adapters not_configured", () => {
  it.each(["credit_card", "debit_card"] as const)(
    "%s never returns paid/captured for authorize/capture/cancel/refund",
    (kind) => {
      const adapter = getCardPaymentAdapter(kind);
      const authorize = adapter.authorizeCard({
        storeId: STORE_ID,
        amount: "10.00",
        clientMutationId: MUTATION_ID,
        kind,
      });
      expect(authorize.status).toBe("not_configured");
      expect(authorize.status).not.toBe("paid");
      expect(adapter.captureCard("ref-1").status).toBe("not_configured");
      expect(adapter.cancelCard("ref-1").status).toBe("not_configured");
      expect(adapter.refundCard("ref-1").status).toBe("not_configured");
      expect(adapter.authorize("10.00").status).toBe("not_configured");
      expect(adapter.capture("10.00").status).toBe("not_configured");
      expect(resolvePaymentAttempt(adapter.process("10.00")).kind).toBe("keep_draft");
      expect(() => assertCardResultNotFakePaid("not_configured")).not.toThrow();
      expect(() => assertCardResultNotFakePaid("paid")).toThrow(/card_illegal_paid_status/);
      expect(() => assertCardResultNotFakePaid("captured")).toThrow(/card_illegal_paid_status/);
    }
  );

  it("server card operations stay not_configured across authorize/capture/cancel/refund", () => {
    expect(isCardPubliclyConfigured("credit_card")).toBe(false);
    expect(isCardPubliclyConfigured("debit_card")).toBe(false);
    expect(
      runCardOperation("authorize", {
        intent: {
          storeId: STORE_ID,
          amount: "10.00",
          clientMutationId: MUTATION_ID,
          kind: "credit_card",
        },
      }).status
    ).toBe("not_configured");
    expect(
      runCardOperation("capture", {
        cardKind: "debit_card",
        externalReference: "ref-1",
      }).status
    ).toBe("not_configured");
    expect(
      runCardOperation("cancel", { cardKind: "credit_card", externalReference: "ref-1" }).status
    ).toBe("not_configured");
    expect(
      runCardOperation("refund", { cardKind: "debit_card", externalReference: "ref-1" }).status
    ).toBe("not_configured");
    expect(resolveCardExternalRefundOutcome("credit_card")).toMatchObject({
      status: "not_configured",
      paymentRefundStatus: "pending_external",
    });
  });

  it("commercial adapters resolve credit/debit distinctly but both map to card", () => {
    expect(getCreditCardPaymentAdapter().kind).toBe("credit_card");
    expect(getDebitCardPaymentAdapter().kind).toBe("debit_card");
    expect(getCommercialPaymentAdapter("credit_card").method).toBe("card");
    expect(getCommercialPaymentAdapter("debit_card").method).toBe("card");
    expect(getPaymentAdapter("card").process("1.00").status).toBe("not_configured");
    expect(paymentNotConfiguredMessage("credit_card")).toMatch(/crédito/i);
    expect(paymentNotConfiguredMessage("debit_card")).toMatch(/débito/i);
  });
});

describe("B23 TEF adapter not_configured", () => {
  it("never returns paid/captured for start/status/confirm/cancel", () => {
    const tef = getTefPaymentAdapter();
    const start = tef.startTransaction({
      storeId: STORE_ID,
      amount: "10.00",
      clientMutationId: MUTATION_ID,
      terminalId: "term-1",
    });
    expect(start.status).toBe("not_configured");
    expect(start.method).toBe("tef");
    expect(tef.getStatus("tx-1").status).toBe("not_configured");
    expect(tef.confirm("tx-1").status).toBe("not_configured");
    expect(tef.cancelTransaction("tx-1").status).toBe("not_configured");
    expect(resolvePaymentAttempt(tef.process("10.00")).kind).toBe("keep_draft");
    expect(() => assertTefResultNotFakePaid("paid")).toThrow(/tef_illegal_paid_status/);
  });

  it("server TEF operations stay not_configured across start/status/confirm/cancel", () => {
    expect(isTefPubliclyConfigured()).toBe(false);
    expect(
      runTefOperation("start", {
        intent: {
          storeId: STORE_ID,
          amount: "10.00",
          clientMutationId: MUTATION_ID,
          terminalId: "term-1",
        },
      }).status
    ).toBe("not_configured");
    expect(runTefOperation("status", { externalTransactionId: "tx-1" }).status).toBe(
      "not_configured"
    );
    expect(runTefOperation("confirm", { externalTransactionId: "tx-1" }).status).toBe(
      "not_configured"
    );
    expect(runTefOperation("cancel", { externalTransactionId: "tx-1" }).status).toBe(
      "not_configured"
    );
    expect(resolveTefExternalRefundOutcome()).toMatchObject({
      status: "not_configured",
      paymentRefundStatus: "pending_external",
    });
  });
});

describe("B23 payment provider secrets", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps card/tef not_configured publicly even with env credentials", () => {
    vi.stubEnv("PAYMENT_PROVIDER", "acme-card");
    vi.stubEnv("PAYMENT_PROVIDER_URL", "https://card.example/api");
    vi.stubEnv("PAYMENT_PROVIDER_API_KEY", "super-secret-key");
    expect(getPaymentProviderConfig().configured).toBe(true);
    const publicStatus = getPublicPaymentProviderStatus();
    expect(publicStatus.methods.credit_card).toBe("not_configured");
    expect(publicStatus.methods.debit_card).toBe("not_configured");
    expect(publicStatus.methods.tef).toBe("not_configured");
    expect(JSON.stringify(publicStatus)).not.toContain("super-secret-key");
    expect(JSON.stringify(publicStatus)).not.toContain("card.example");
  });
});

describe("B23 settings integration projection", () => {
  it("exposes credit/debit/tef blocks without secrets", () => {
    const payload = attachSettingsMeta({
      settings: defaultStoreSettings(STORE_ID, ORG_ID),
      store: { id: STORE_ID, name: "Loja Centro", code: "CENTRO", is_active: true },
      organization: {
        id: ORG_ID,
        name: "Nex Demo",
        currency: "BRL",
        timezone: "America/Sao_Paulo",
      },
      can_edit: true,
      role: "manager",
    });
    expect(payload.integrations.credit_card.status).toBe("not_configured");
    expect(payload.integrations.debit_card.status).toBe("not_configured");
    expect(payload.integrations.tef).toBe("not_configured");
    expect(payload.integrations.tef_detail.status).toBe("not_configured");
    expect(payload.integrations.payments.card).toBe("not_configured");
    expect(JSON.stringify(payload.integrations)).not.toMatch(/api[_-]?key/i);
  });
});

describe("B23 card/TEF APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthedContext.mockResolvedValue(authContext("cashier"));
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc: vi.fn(),
    });
  });

  it("rejects unauthenticated card authorize", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      rpc: vi.fn(),
    });
    const response = await cardPost(
      new Request("http://localhost/api/payments/card", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "authorize",
          kind: "credit_card",
          store_id: STORE_ID,
          amount: "10.00",
          client_mutation_id: MUTATION_ID,
        }),
      })
    );
    expect(response.status).toBe(401);
  });

  it("rejects cross-store card authorize", async () => {
    getAuthedContext.mockResolvedValue(null);
    const response = await cardPost(
      new Request("http://localhost/api/payments/card", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "authorize",
          kind: "debit_card",
          store_id: OTHER_STORE,
          amount: "10.00",
          client_mutation_id: MUTATION_ID,
        }),
      })
    );
    expect(response.status).toBe(403);
  });

  it.each(["cashier", "manager", "admin"] as const)(
    "role %s can attempt card authorize but receives not_configured",
    async (role) => {
      getAuthedContext.mockResolvedValue(authContext(role));
      const response = await cardPost(
        new Request("http://localhost/api/payments/card", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            operation: "authorize",
            kind: "credit_card",
            store_id: STORE_ID,
            amount: "10.00",
            client_mutation_id: MUTATION_ID,
            status: "captured",
            provider: "evil",
            authorization_code: "FAKE",
          }),
        })
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error).toBe("payment_method_not_configured");
      expect(body.adapter_status).toBe("not_configured");
      expect(body.status).not.toBe("captured");
      expect(body.status).not.toBe("paid");
    }
  );

  it("card capture/cancel/refund stay not_configured; refund rejects cashier", async () => {
    getAuthedContext.mockResolvedValue(authContext("manager"));
    for (const operation of ["capture", "cancel", "refund"] as const) {
      const response = await cardPost(
        new Request("http://localhost/api/payments/card", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            operation,
            kind: "debit_card",
            store_id: STORE_ID,
            client_mutation_id: MUTATION_ID,
            external_reference: "ref-1",
          }),
        })
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.adapter_status).toBe("not_configured");
      if (operation === "refund") {
        expect(body.payment_refund_status).toBe("pending_external");
      }
    }

    getAuthedContext.mockResolvedValue(authContext("cashier"));
    const cashierRefund = await cardPost(
      new Request("http://localhost/api/payments/card", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "refund",
          kind: "credit_card",
          store_id: STORE_ID,
          client_mutation_id: MUTATION_ID,
          external_reference: "ref-1",
        }),
      })
    );
    expect(cashierRefund.status).toBe(403);
  });

  it("idempotent and concurrent card authorizes stay not_configured", async () => {
    const bodies = [MUTATION_ID, MUTATION_ID, MUTATION_ID_2];
    const responses = await Promise.all(
      bodies.map((client_mutation_id) =>
        cardPost(
          new Request("http://localhost/api/payments/card", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              operation: "authorize",
              kind: "credit_card",
              store_id: STORE_ID,
              amount: "10.00",
              client_mutation_id,
            }),
          })
        )
      )
    );
    for (const response of responses) {
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error).toBe("payment_method_not_configured");
      expect(body.status).not.toBe("paid");
    }
  });

  it("TEF start/status/confirm/cancel stay not_configured; cancel rejects cashier", async () => {
    getAuthedContext.mockResolvedValue(authContext("manager"));
    const start = await tefPost(
      new Request("http://localhost/api/payments/tef", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "start",
          store_id: STORE_ID,
          amount: "10.00",
          client_mutation_id: MUTATION_ID,
          terminal_id: "term-1",
          status: "approved",
          nsu: "999",
          authorization_code: "FAKE",
        }),
      })
    );
    expect(start.status).toBe(422);
    await expect(start.json()).resolves.toMatchObject({
      error: "payment_method_not_configured",
      adapter_status: "not_configured",
      method: "tef",
    });

    for (const operation of ["status", "confirm", "cancel"] as const) {
      const response = await tefPost(
        new Request("http://localhost/api/payments/tef", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            operation,
            store_id: STORE_ID,
            client_mutation_id: MUTATION_ID,
            external_transaction_id: "tx-1",
          }),
        })
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.adapter_status).toBe("not_configured");
      if (operation === "cancel") {
        expect(body.payment_refund_status).toBe("pending_external");
      }
    }

    getAuthedContext.mockResolvedValue(authContext("cashier"));
    const cashierCancel = await tefPost(
      new Request("http://localhost/api/payments/tef", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "cancel",
          store_id: STORE_ID,
          client_mutation_id: MUTATION_ID,
          external_transaction_id: "tx-1",
        }),
      })
    );
    expect(cashierCancel.status).toBe(403);
  });

  it("rejects cross-org TEF start", async () => {
    getAuthedContext.mockResolvedValue(null);
    const response = await tefPost(
      new Request("http://localhost/api/payments/tef", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "start",
          store_id: OTHER_STORE,
          amount: "10.00",
          client_mutation_id: MUTATION_ID,
        }),
      })
    );
    expect(response.status).toBe(403);
  });

  it("process_sale rejects card and other/TEF payloads server-side", async () => {
    getAuthedContext.mockResolvedValue(authContext("manager"));
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: vi.fn(),
    });

    for (const method of ["card", "other"] as const) {
      const response = await processSalePost(
        new Request("http://localhost/api/sales/process", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            store_id: STORE_ID,
            client_mutation_id: MUTATION_ID,
            items: [
              { product_id: PRODUCT_ID, quantity: 1, unit_price: "3.50", discount: "0.00" },
            ],
            payments: [{ method, amount: "3.50" }],
            discount: "0.00",
          }),
        })
      );
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        error: "payment_method_not_configured",
        adapter_status: "not_configured",
        method,
      });
    }
  });
});

describe("B23 offline closeSale rejects card/TEF enqueue", () => {
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

  it.each([
    { method: "card" as const, label: /Cartão/i },
    { method: "other" as const, label: /TEF/i },
  ])("does not write sale/outbox for $method", async ({ method, label }) => {
    const db = createPdvLocalDb(`b23-${method}-${Math.random().toString(16).slice(2)}`);
    await db.open();
    dbs.push(db);
    await db.inventoryBalances.put({
      storeId: STORE_ID,
      productId: PRODUCT_ID,
      quantity: "10.000",
      serverQuantity: "10.000",
      updatedAt: new Date().toISOString(),
    });

    await expect(
      closeSale(db, {
        storeId: STORE_ID,
        clientMutationId: MUTATION_ID,
        lines: [
          {
            productId: PRODUCT_ID,
            sku: "BEV-001",
            name: "Água",
            unitPrice: "3.50",
            quantity: 1,
            discount: "0.00",
          },
        ],
        discount: "0.00",
        payments: [{ method, amount: "3.50" }],
      })
    ).rejects.toThrow(label);

    expect(await db.sales.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});
