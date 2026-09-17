import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindMercadoPagoPixAdapter,
  bindStripePixAdapter,
  getPaymentAdapter,
} from "@/lib/adapters/payment";
import {
  MercadoPagoPixPaymentAdapter,
  type MercadoPagoPixGateway,
} from "@/lib/adapters/mercadopago-pix";
import { resolvePaymentAttempt } from "@/lib/domain/payment-attempt";
import {
  isMercadoPagoCheckoutEnabledEnv,
  isMercadoPagoOrderRef,
  isMercadoPagoWebhookEventAllowed,
  parseMercadoPagoOrderResponse,
  parseMercadoPagoWebhookNotification,
  reconcileMercadoPagoOrder,
  webhookActionToPaymentState,
  type MercadoPagoOrderSnapshot,
} from "@/lib/domain/mercadopago";
import { verifyMercadoPagoWebhookSignature } from "@/lib/domain/mercadopago-webhook-signature";
import {
  applyMercadoPagoWebhookEvent,
  executeMercadoPagoPixPayment,
} from "@/lib/server/mercadopago-pix-payment";
import {
  getMercadoPagoEnv,
  probeMercadoPagoPixHealth,
  resetMercadoPagoHealthCache,
  resolveMercadoPagoPixPaymentAdapter,
} from "@/lib/server/mercadopago";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MercadoPagoPixPaymentInput } from "@/lib/validation/schemas";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/server/mercadopago", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/mercadopago")>();
  return {
    ...actual,
    probeMercadoPagoPixHealth: vi.fn(actual.probeMercadoPagoPixHealth),
    resolveMercadoPagoPixPaymentAdapter: vi.fn(actual.resolveMercadoPagoPixPaymentAdapter),
  };
});

const probeMercadoPagoPixHealthMock = vi.mocked(probeMercadoPagoPixHealth);
const resolveMercadoPagoPixPaymentAdapterMock = vi.mocked(resolveMercadoPagoPixPaymentAdapter);

const createAdminClientMock = vi.mocked(createAdminClient);

const STORE = "11111111-1111-4111-8111-111111111111";
const MUTATION = "22222222-2222-4222-8222-222222222222";
const OPERATOR = "33333333-3333-4333-8333-333333333333";
const SALE = "44444444-4444-4444-8444-444444444444";
const MP_ORDER = "ORD01TEST123";

function createInput(): MercadoPagoPixPaymentInput {
  return {
    action: "create",
    store_id: STORE,
    amount: "10.00",
    client_mutation_id: MUTATION,
    discount: "0.00",
    items: [
      {
        product_id: "55555555-5555-4555-8555-555555555555",
        quantity: 1,
        unit_price: "10.00",
        discount: "0.00",
      },
    ],
  };
}

function orderSnapshot(overrides: Partial<MercadoPagoOrderSnapshot> = {}): MercadoPagoOrderSnapshot {
  return {
    id: MP_ORDER,
    status: "action_required",
    statusDetail: "waiting_transfer",
    amount: "10.00",
    currency: "BRL",
    livemode: false,
    received: true,
    qr: {
      data: "00020126580014br.gov.bcb.pix0136test",
    },
    ...overrides,
  };
}

function fakeGateway(overrides: Partial<MercadoPagoPixGateway> = {}): MercadoPagoPixGateway {
  return {
    health: async () => ({ ok: true, testmode: true, message: "ok" }),
    create: async () => orderSnapshot(),
    cancel: async () => orderSnapshot({ status: "canceled", statusDetail: "canceled" }),
    retrieve: async () => orderSnapshot({ status: "processed", statusDetail: "accredited" }),
    ...overrides,
  };
}

function mockAdminRpc(
  impl: (name: string, args?: unknown) => { data: unknown; error: unknown }
) {
  const rpc = vi.fn(async (name: string, args?: unknown) => impl(name, args));
  createAdminClientMock.mockReturnValue({ rpc } as never);
  return rpc;
}

function signMercadoPagoWebhook(input: {
  secret: string;
  dataId: string;
  xRequestId: string;
  ts: string;
}): string {
  const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.xRequestId};ts:${input.ts};`;
  const v1 = createHmac("sha256", input.secret).update(manifest).digest("hex");
  return `ts=${input.ts},v1=${v1}`;
}

describe("Mercado Pago checkout flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetMercadoPagoHealthCache();
  });

  it("keeps flag off by default and strict opt-in only", () => {
    expect(isMercadoPagoCheckoutEnabledEnv(undefined)).toBe(false);
    expect(isMercadoPagoCheckoutEnabledEnv("false")).toBe(false);
    expect(isMercadoPagoCheckoutEnabledEnv("TRUE")).toBe(false);
    expect(isMercadoPagoCheckoutEnabledEnv("true")).toBe(true);
  });

  it("returns not_configured when flag is off", async () => {
    vi.stubEnv("MERCADOPAGO_CHECKOUT_ENABLED", "false");
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "APP_USR_test");
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "mp_whsec_test");

    const health = await probeMercadoPagoPixHealth(true);
    expect(health.configured).toBe(false);
    expect(health.reason).toBe("mercadopago_checkout_hold");

    const adapter = getPaymentAdapter("pix");
    expect(adapter.authorize("10.00")).toMatchObject({ status: "not_configured" });
    expect(resolvePaymentAttempt(adapter.process("10.00")).kind).toBe("keep_draft");
  });

  it("returns not_configured when secrets are missing even if flag is on", async () => {
    vi.stubEnv("MERCADOPAGO_CHECKOUT_ENABLED", "true");
    const env = getMercadoPagoEnv({});
    expect(env.configured).toBe(false);
    if (!env.configured) {
      expect(env.reason).toBe("mercadopago_access_token_missing");
    }
  });
});

describe("Mercado Pago PIX adapter", () => {
  afterEach(() => {
    bindMercadoPagoPixAdapter(null);
    bindStripePixAdapter(null);
  });

  it("prefers Mercado Pago PIX adapter over Stripe when both are bound", async () => {
    bindStripePixAdapter({
      method: "pix",
      process: () => ({ status: "configured", message: "stripe" }),
      authorize: () => ({ status: "not_configured", message: "stripe" }),
      capture: () => ({ status: "not_configured", message: "stripe" }),
      cancel: () => ({ status: "not_configured", message: "stripe" }),
      reconcile: () => ({ status: "not_configured", message: "stripe" }),
    });
    const mpAdapter = new MercadoPagoPixPaymentAdapter(fakeGateway());
    bindMercadoPagoPixAdapter(mpAdapter);

    const authorized = await getPaymentAdapter("pix").authorize("10.00", {
      clientMutationId: MUTATION,
    });
    expect(authorized.status).toBe("pending");
    expect(authorized.providerReference).toBe(MP_ORDER);
    expect(authorized.message).toContain("Venda não confirmada");
  });

  it("maps processed order to captured on reconcile", async () => {
    const adapter = new MercadoPagoPixPaymentAdapter(fakeGateway());
    const reconciled = await adapter.reconcile("10.00", { providerReference: MP_ORDER });
    expect(reconciled.status).toBe("captured");
  });

  it("marks amount mismatch as unknown on reconcile", () => {
    const decision = reconcileMercadoPagoOrder({
      expectedProviderRef: MP_ORDER,
      expectedAmount: "10.00",
      snapshot: orderSnapshot({ amount: "99.00", status: "processed", statusDetail: "accredited" }),
    });
    expect(decision.status).toBe("unknown");
    expect(decision.mismatch).toBe(true);
  });

  it("recognizes Mercado Pago order refs", () => {
    expect(isMercadoPagoOrderRef(MP_ORDER)).toBe(true);
    expect(isMercadoPagoOrderRef("pi_test_123")).toBe(false);
  });
});

describe("Mercado Pago authorize persists provider_ref", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    bindMercadoPagoPixAdapter(null);
    probeMercadoPagoPixHealthMock.mockReset();
    resolveMercadoPagoPixPaymentAdapterMock.mockReset();
  });

  it("registers pix_payment_intent and never calls process_pix_sale on create", async () => {
    vi.stubEnv("MERCADOPAGO_CHECKOUT_ENABLED", "true");
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "APP_USR_test");
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "mp_whsec_test");
    const adapter = new MercadoPagoPixPaymentAdapter(fakeGateway());
    bindMercadoPagoPixAdapter(adapter);
    probeMercadoPagoPixHealthMock.mockResolvedValue({
      ok: true,
      configured: true,
      testmode: true,
      message: "ok",
    });
    resolveMercadoPagoPixPaymentAdapterMock.mockResolvedValue(adapter);

    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    const result = await executeMercadoPagoPixPayment({ rpc } as never, createInput(), OPERATOR);

    expect(result.status).toBe("pending");
    expect(result.sale_confirmed).toBe(false);
    expect(result.providerReference).toBe(MP_ORDER);
    const rpcNames = rpc.mock.calls.map((call) => call[0]);
    expect(rpcNames).toContain("register_pix_payment_intent");
    expect(rpcNames).not.toContain("process_pix_sale");
  });
});

describe("Mercado Pago webhook signature fail-closed", () => {
  const secret = "mp_webhook_secret_test";

  it("rejects unsigned webhooks", () => {
    expect(() =>
      verifyMercadoPagoWebhookSignature({
        xSignature: null,
        xRequestId: "req-1",
        dataId: "ord01test123",
        secret,
      })
    ).toThrow("mercadopago_webhook_unsigned");
  });

  it("rejects invalid signatures", () => {
    expect(() =>
      verifyMercadoPagoWebhookSignature({
        xSignature: "ts=1704908010,v1=deadbeef",
        xRequestId: "req-1",
        dataId: "ord01test123",
        secret,
      })
    ).toThrow("mercadopago_webhook_invalid_signature");
  });

  it("accepts valid signatures", () => {
    const ts = "1704908010";
    const xSignature = signMercadoPagoWebhook({
      secret,
      dataId: MP_ORDER,
      xRequestId: "req-1",
      ts,
    });
    expect(() =>
      verifyMercadoPagoWebhookSignature({
        xSignature,
        xRequestId: "req-1",
        dataId: MP_ORDER,
        secret,
      })
    ).not.toThrow();
  });
});

describe("Mercado Pago webhook route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    resetMercadoPagoHealthCache();
    createAdminClientMock.mockReset();
  });

  it("rejects unsigned webhooks with 400", async () => {
    vi.stubEnv("MERCADOPAGO_CHECKOUT_ENABLED", "true");
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "APP_USR_test");
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "mp_webhook_secret_test");

    const { POST } = await import("@/app/api/payments/mercadopago/webhook/route");
    const response = await POST(
      new Request(`http://localhost/api/payments/mercadopago/webhook?data.id=${MP_ORDER}`, {
        method: "POST",
        body: JSON.stringify({
          id: 12345,
          type: "order",
          action: "order.processed",
          data: { id: MP_ORDER },
        }),
      })
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "mercadopago_webhook_unsigned" });
  });

  it("accepts signed webhooks and confirms sale via durable RPCs", async () => {
    vi.stubEnv("MERCADOPAGO_CHECKOUT_ENABLED", "true");
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "APP_USR_test");
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "mp_webhook_secret_test");

    const rpc = mockAdminRpc((name) => {
      if (name === "apply_pix_provider_event") {
        return { data: { store_id: STORE, client_mutation_id: MUTATION, sale_id: null }, error: null };
      }
      if (name === "process_pix_sale") {
        return { data: { sale_id: SALE, status: "confirmed" }, error: null };
      }
      return { data: null, error: null };
    });

    const secret = "mp_webhook_secret_test";
    const ts = "1704908010";
    const xRequestId = "req-fixture-1";
    const xSignature = signMercadoPagoWebhook({ secret, dataId: MP_ORDER, xRequestId, ts });
    const body = {
      id: 12345,
      type: "order",
      action: "order.processed",
      data: { id: MP_ORDER },
    };

    const { POST } = await import("@/app/api/payments/mercadopago/webhook/route");
    const response = await POST(
      new Request(`http://localhost/api/payments/mercadopago/webhook?data.id=${MP_ORDER}`, {
        method: "POST",
        headers: {
          "x-signature": xSignature,
          "x-request-id": xRequestId,
        },
        body: JSON.stringify(body),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      action: "order.processed",
      status: "captured",
      sale_confirmed: true,
      sale_id: SALE,
    });
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "apply_pix_provider_event",
      "process_pix_sale",
    ]);
  });
});

describe("Mercado Pago webhook durable idempotency", () => {
  afterEach(() => {
    createAdminClientMock.mockReset();
  });

  it("confirms sale only after order.processed + process_pix_sale", async () => {
    const rpc = mockAdminRpc((name) => {
      if (name === "apply_pix_provider_event") {
        return { data: { store_id: STORE, client_mutation_id: MUTATION, sale_id: null }, error: null };
      }
      if (name === "process_pix_sale") {
        return { data: { sale_id: SALE, status: "confirmed" }, error: null };
      }
      return { data: null, error: null };
    });

    const notification = parseMercadoPagoWebhookNotification({
      id: 999,
      type: "order",
      action: "order.processed",
      data: { id: MP_ORDER },
    });
    expect(notification).not.toBeNull();

    const result = await applyMercadoPagoWebhookEvent(notification!);
    expect(result.status).toBe("captured");
    expect(result.sale_confirmed).toBe(true);
    expect(result.sale_id).toBe(SALE);
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "apply_pix_provider_event",
      "process_pix_sale",
    ]);
  });

  it("returns replay from DB without double process_pix_sale", async () => {
    const rpc = mockAdminRpc((name) => {
      if (name === "apply_pix_provider_event") {
        return {
          data: {
            store_id: STORE,
            client_mutation_id: MUTATION,
            sale_id: SALE,
            replay: true,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const notification = parseMercadoPagoWebhookNotification({
      id: 1000,
      type: "order",
      action: "order.processed",
      data: { id: MP_ORDER },
    })!;

    const result = await applyMercadoPagoWebhookEvent(notification);
    expect(result.replay).toBe(true);
    expect(result.sale_confirmed).toBe(true);
    expect(rpc.mock.calls.map((call) => call[0])).toEqual(["apply_pix_provider_event"]);
  });

  it("skips process_pix_sale when intent is unmatched", async () => {
    mockAdminRpc(() => ({ data: { status: "captured" }, error: null }));

    const result = await applyMercadoPagoWebhookEvent({
      id: 1001,
      type: "order",
      action: "order.processed",
      data: { id: MP_ORDER },
    });

    expect(result.status).toBe("unknown");
    expect(result.sale_confirmed).toBe(false);
  });
});

describe("Mercado Pago webhook parsing fixtures", () => {
  it("allowlists order webhook actions", () => {
    expect(isMercadoPagoWebhookEventAllowed("order.processed")).toBe(true);
    expect(isMercadoPagoWebhookEventAllowed("payment.created")).toBe(false);
    expect(webhookActionToPaymentState("order.processed")).toBe("captured");
    expect(webhookActionToPaymentState("order.action_required")).toBe("pending");
  });

  it("parses order response fixtures", () => {
    const snapshot = parseMercadoPagoOrderResponse({
      id: "ORD01HRYFWNYRE1MR1E60MW3X0T2P",
      status: "action_required",
      status_detail: "waiting_transfer",
      total_amount: "50.00",
      transactions: {
        payments: [
          {
            id: "PAY01HRYFXQ53Q3JPEC48MYWMR0TE",
            payment_method: {
              id: "pix",
              qr_code: "00020126580014br.gov.bcb.pix0136test",
              qr_code_base64: "abc123",
              ticket_url: "https://www.mercadopago.com.br/sandbox/payments/ticket",
            },
          },
        ],
      },
    });
    expect(snapshot?.id).toBe("ORD01HRYFWNYRE1MR1E60MW3X0T2P");
    expect(snapshot?.qr?.data).toContain("000201");
    expect(snapshot?.amount).toBe("50.00");
  });
});
