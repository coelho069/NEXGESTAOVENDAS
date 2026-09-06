import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPaymentAdapter, getPixPaymentAdapter } from "@/lib/adapters/payment";
import {
  assertPixResultNotFakePaid,
  buildPaymentContract,
  canCompletePaymentOffline,
  offlinePaymentBlockedMessage,
  paymentNotConfiguredMessage,
  resolvePixExternalRefundOutcome,
  toDbPaymentMethod,
  toPersistedPaymentStatus,
  toLifecyclePaymentStatus,
} from "@/lib/domain/payment";
import { resolvePaymentAttempt } from "@/lib/domain/payment-attempt";
import {
  canTransitionPayment,
  isPaymentPaid,
  isPaymentTerminal,
  paymentStatusForExpiredCharge,
  PIX_EXPIRED_FAILURE_CODE,
} from "@/lib/domain/payment-state";
import { attachSettingsMeta, defaultStoreSettings } from "@/lib/domain/store-settings";
import {
  getPaymentProviderConfig,
  getPublicPaymentProviderStatus,
} from "@/lib/server/payment-provider";
import { isPixPubliclyConfigured, runPixOperation } from "@/lib/server/pix-operations";
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

import { POST as pixChargePost } from "@/app/api/payments/pix/charge/route";
import { POST as pixRefundPost } from "@/app/api/payments/pix/refund/route";
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

function chargeBody(overrides?: Partial<{ store_id: string; amount: string; client_mutation_id: string }>) {
  return {
    store_id: STORE_ID,
    amount: "10.00",
    client_mutation_id: MUTATION_ID,
    ...overrides,
  };
}

describe("B22 payment method contract", () => {
  it("maps commercial kinds onto DB payment_method without inventing enums", () => {
    expect(toDbPaymentMethod("cash")).toBe("cash");
    expect(toDbPaymentMethod("pix")).toBe("pix");
    expect(toDbPaymentMethod("credit_card")).toBe("card");
    expect(toDbPaymentMethod("debit_card")).toBe("card");
    expect(toDbPaymentMethod("tef")).toBe("other");
  });

  it("maps lifecycle paid/expired onto persisted statuses", () => {
    expect(toPersistedPaymentStatus("paid")).toBe("captured");
    expect(toPersistedPaymentStatus("expired")).toBe("failed");
    expect(toPersistedPaymentStatus("pending")).toBe("pending");
    expect(toPersistedPaymentStatus("failed")).toBe("failed");
    expect(toPersistedPaymentStatus("cancelled")).toBe("cancelled");
    expect(toPersistedPaymentStatus("refunded")).toBe("refunded");
    expect(toLifecyclePaymentStatus("captured")).toBe("paid");
    expect(isPaymentPaid("captured")).toBe(true);
    expect(isPaymentPaid("pending")).toBe(false);
    expect(paymentStatusForExpiredCharge()).toBe("failed");
    expect(PIX_EXPIRED_FAILURE_CODE).toBe("expired");
  });

  it("keeps PIX lifecycle transitions coherent with persisted states", () => {
    expect(canTransitionPayment("pending", "authorized")).toBe(true);
    expect(canTransitionPayment("pending", "captured")).toBe(true);
    expect(canTransitionPayment("pending", "failed")).toBe(true);
    expect(canTransitionPayment("pending", "cancelled")).toBe(true);
    expect(canTransitionPayment("captured", "refunded")).toBe(true);
    expect(canTransitionPayment("failed", "captured")).toBe(false);
    expect(isPaymentTerminal("failed")).toBe(true);
    expect(isPaymentTerminal("cancelled")).toBe(true);
    expect(isPaymentTerminal("refunded")).toBe(true);
    expect(isPaymentTerminal("pending")).toBe(false);
  });

  it("builds PaymentContract without inventing paid provider state", () => {
    const contract = buildPaymentContract({
      paymentId: "p1",
      saleId: "s1",
      method: "pix",
      amount: "10.00",
      status: "pending",
      provider: "not_configured",
      externalReference: null,
      idempotencyKey: MUTATION_ID,
      adapterStatus: "not_configured",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(contract.status).toBe("pending");
    expect(contract.adapterStatus).toBe("not_configured");
    expect(contract.provider).toBe("not_configured");
    expect(contract.idempotencyKey).toBe(MUTATION_ID);
  });

  it("blocks electronic methods offline", () => {
    expect(canCompletePaymentOffline("cash")).toBe(true);
    expect(canCompletePaymentOffline("pix")).toBe(false);
    expect(offlinePaymentBlockedMessage("pix")).toMatch(/offline/i);
  });
});

describe("B22 PIX adapter not_configured", () => {
  it("never returns paid/captured for create/consult/cancel/refund", () => {
    const pix = getPixPaymentAdapter();
    const charge = pix.createCharge({
      storeId: STORE_ID,
      amount: "10.00",
      clientMutationId: MUTATION_ID,
    });
    expect(charge.status).toBe("not_configured");
    expect(charge.status).not.toBe("paid");
    expect(pix.consultStatus("ref-1").status).toBe("not_configured");
    expect(pix.cancelCharge("ref-1").status).toBe("not_configured");
    expect(pix.refundCharge("ref-1").status).toBe("not_configured");
    expect(pix.capture("10.00").status).toBe("not_configured");
    expect(pix.authorize("10.00").status).toBe("not_configured");
    expect(resolvePaymentAttempt(pix.process("10.00")).kind).toBe("keep_draft");
    expect(() => assertPixResultNotFakePaid("not_configured")).not.toThrow();
    expect(() => assertPixResultNotFakePaid("paid")).toThrow(/pix_illegal_paid_status/);
    expect(() => assertPixResultNotFakePaid("captured")).toThrow(/pix_illegal_paid_status/);
  });

  it("server pix operations stay not_configured across create/consult/cancel/refund", () => {
    expect(isPixPubliclyConfigured()).toBe(false);
    expect(
      runPixOperation("create_charge", {
        intent: { storeId: STORE_ID, amount: "10.00", clientMutationId: MUTATION_ID },
      }).status
    ).toBe("not_configured");
    expect(runPixOperation("consult", { externalReference: "ref-1" }).status).toBe("not_configured");
    expect(runPixOperation("cancel", { externalReference: "ref-1" }).status).toBe("not_configured");
    expect(runPixOperation("refund", { externalReference: "ref-1" }).status).toBe("not_configured");
    expect(resolvePixExternalRefundOutcome()).toMatchObject({
      status: "not_configured",
      paymentRefundStatus: "pending_external",
    });
  });

  it("keeps card/tef paths on not_configured adapters", () => {
    expect(getPaymentAdapter("card").process("1.00").status).toBe("not_configured");
    expect(getPaymentAdapter("other").process("1.00").status).toBe("not_configured");
    expect(paymentNotConfiguredMessage("pix")).toMatch(/PIX/i);
  });
});

describe("B22 payment provider config secrets", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stays not_configured without credentials and never exposes secrets publicly", () => {
    vi.stubEnv("PAYMENT_PROVIDER", "");
    vi.stubEnv("PAYMENT_PROVIDER_URL", "");
    vi.stubEnv("PAYMENT_PROVIDER_API_KEY", "");
    expect(getPaymentProviderConfig().configured).toBe(false);
    const publicStatus = getPublicPaymentProviderStatus();
    expect(publicStatus.status).toBe("not_configured");
    expect(JSON.stringify(publicStatus)).not.toMatch(/api[_-]?key/i);
    expect(publicStatus).not.toHaveProperty("apiKey");
    expect(publicStatus).not.toHaveProperty("url");
  });

  it("does not advertise PIX ready even when env credentials exist (no live adapter yet)", () => {
    vi.stubEnv("PAYMENT_PROVIDER", "acme-pix");
    vi.stubEnv("PAYMENT_PROVIDER_URL", "https://pix.example/api");
    vi.stubEnv("PAYMENT_PROVIDER_API_KEY", "super-secret-key");
    expect(getPaymentProviderConfig().configured).toBe(true);
    const publicStatus = getPublicPaymentProviderStatus();
    expect(publicStatus.methods.pix).toBe("not_configured");
    expect(JSON.stringify(publicStatus)).not.toContain("super-secret-key");
    expect(JSON.stringify(publicStatus)).not.toContain("pix.example");
  });
});

describe("B22 settings integration projection", () => {
  it("exposes PIX provider block without secrets", () => {
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
    expect(payload.integrations.pix.status).toBe("not_configured");
    expect(payload.integrations.payments.pix).toBe("not_configured");
    expect(JSON.stringify(payload.integrations)).not.toMatch(/api[_-]?key/i);
  });
});

describe("B22 PIX charge API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthedContext.mockResolvedValue(authContext("cashier"));
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc: vi.fn(),
    });
  });

  it("rejects unauthenticated charge", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      rpc: vi.fn(),
    });
    const response = await pixChargePost(
      new Request("http://localhost/api/payments/pix/charge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(chargeBody()),
      })
    );
    expect(response.status).toBe(401);
  });

  it("rejects cross-store charge", async () => {
    getAuthedContext.mockResolvedValue(null);
    const response = await pixChargePost(
      new Request("http://localhost/api/payments/pix/charge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(chargeBody({ store_id: OTHER_STORE })),
      })
    );
    expect(response.status).toBe(403);
  });

  it("rejects cross-org membership (auth context null for foreign org store)", async () => {
    getAuthedContext.mockResolvedValue(null);
    const response = await pixChargePost(
      new Request("http://localhost/api/payments/pix/charge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(chargeBody({ store_id: OTHER_STORE })),
      })
    );
    expect(response.status).toBe(403);
  });

  it.each(["cashier", "manager", "admin"] as const)(
    "role %s can attempt charge but receives not_configured (never paid)",
    async (role) => {
      getAuthedContext.mockResolvedValue(authContext(role));
      const response = await pixChargePost(
        new Request("http://localhost/api/payments/pix/charge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(chargeBody()),
        })
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error).toBe("payment_method_not_configured");
      expect(body.adapter_status).toBe("not_configured");
      expect(body).not.toMatchObject({ status: "paid" });
    }
  );

  it("idempotent retries with same mutation id stay not_configured without inventing paid", async () => {
    const requestOnce = () =>
      pixChargePost(
        new Request("http://localhost/api/payments/pix/charge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(chargeBody()),
        })
      );
    const first = await requestOnce();
    const second = await requestOnce();
    expect(first.status).toBe(422);
    expect(second.status).toBe(422);
    const [a, b] = await Promise.all([first.json(), second.json()]);
    expect(a).toMatchObject({ error: "payment_method_not_configured", adapter_status: "not_configured" });
    expect(b).toMatchObject({ error: "payment_method_not_configured", adapter_status: "not_configured" });
  });

  it("concurrent duplicate charges both reject without paid outcome", async () => {
    const bodies = [MUTATION_ID, MUTATION_ID, MUTATION_ID_2];
    const responses = await Promise.all(
      bodies.map((client_mutation_id) =>
        pixChargePost(
          new Request("http://localhost/api/payments/pix/charge", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(chargeBody({ client_mutation_id })),
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

  it("process_sale still rejects PIX payloads server-side", async () => {
    getAuthedContext.mockResolvedValue(authContext("manager"));
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: vi.fn(),
    });
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
          payments: [{ method: "pix", amount: "3.50" }],
          discount: "0.00",
        }),
      })
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: "payment_method_not_configured",
      adapter_status: "not_configured",
      method: "pix",
    });
  });

  it("PIX refund API returns not_configured + pending_external for manager", async () => {
    getAuthedContext.mockResolvedValue(authContext("manager"));
    const response = await pixRefundPost(
      new Request("http://localhost/api/payments/pix/refund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          store_id: STORE_ID,
          external_reference: "pix-ref-1",
          client_mutation_id: MUTATION_ID,
        }),
      })
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: "payment_method_not_configured",
      adapter_status: "not_configured",
      payment_refund_status: "pending_external",
    });
  });

  it("PIX refund API rejects cashier", async () => {
    getAuthedContext.mockResolvedValue(authContext("cashier"));
    const response = await pixRefundPost(
      new Request("http://localhost/api/payments/pix/refund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          store_id: STORE_ID,
          external_reference: "pix-ref-1",
          client_mutation_id: MUTATION_ID,
        }),
      })
    );
    expect(response.status).toBe(403);
  });
});

describe("B22 offline closeSale rejects PIX enqueue", () => {
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

  it("does not write sale/outbox for PIX", async () => {
    const db = createPdvLocalDb(`b22-pix-${Math.random().toString(16).slice(2)}`);
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
        payments: [{ method: "pix", amount: "3.50" }],
      })
    ).rejects.toThrow(/PIX/i);

    expect(await db.sales.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});
