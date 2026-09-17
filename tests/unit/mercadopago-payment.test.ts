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
  isMercadoPagoWebhookEventAllowed,
  parseMercadoPagoOrderResponse,
  parseMercadoPagoWebhookNotification,
  reconcileMercadoPagoOrder,
  webhookActionToPaymentState,
  type MercadoPagoOrderSnapshot,
} from "@/lib/domain/mercadopago";
import { verifyMercadoPagoWebhookSignature } from "@/lib/domain/mercadopago-webhook-signature";
import {
  applyMercadoPagoWebhookNotification,
  getMercadoPagoEnv,
  probeMercadoPagoPixHealth,
  resetMercadoPagoHealthCache,
  resetMercadoPagoWebhookReplayCache,
} from "@/lib/server/mercadopago";

function orderSnapshot(overrides: Partial<MercadoPagoOrderSnapshot> = {}): MercadoPagoOrderSnapshot {
  return {
    id: "ORD01TEST123",
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
      clientMutationId: "11111111-1111-4111-8111-111111111111",
    });
    expect(authorized.status).toBe("pending");
    expect(authorized.providerReference).toBe("ORD01TEST123");
    expect(authorized.message).toContain("Venda não confirmada");
  });

  it("maps processed order to captured on reconcile", async () => {
    const adapter = new MercadoPagoPixPaymentAdapter(fakeGateway());
    const reconciled = await adapter.reconcile("10.00", { providerReference: "ORD01TEST123" });
    expect(reconciled.status).toBe("captured");
  });

  it("marks amount mismatch as unknown on reconcile", () => {
    const decision = reconcileMercadoPagoOrder({
      expectedProviderRef: "ORD01TEST123",
      expectedAmount: "10.00",
      snapshot: orderSnapshot({ amount: "99.00", status: "processed", statusDetail: "accredited" }),
    });
    expect(decision.status).toBe("unknown");
    expect(decision.mismatch).toBe(true);
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
      dataId: "ORD01TEST123",
      xRequestId: "req-1",
      ts,
    });
    expect(() =>
      verifyMercadoPagoWebhookSignature({
        xSignature,
        xRequestId: "req-1",
        dataId: "ORD01TEST123",
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
    resetMercadoPagoWebhookReplayCache();
  });

  it("rejects unsigned webhooks with 400", async () => {
    vi.stubEnv("MERCADOPAGO_CHECKOUT_ENABLED", "true");
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "APP_USR_test");
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "mp_webhook_secret_test");

    const { POST } = await import("@/app/api/payments/mercadopago/webhook/route");
    const response = await POST(
      new Request("http://localhost/api/payments/mercadopago/webhook?data.id=ORD01TEST123", {
        method: "POST",
        body: JSON.stringify({
          id: 12345,
          type: "order",
          action: "order.processed",
          data: { id: "ORD01TEST123" },
        }),
      })
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "mercadopago_webhook_unsigned" });
  });

  it("accepts signed webhooks and parses fixtures", async () => {
    vi.stubEnv("MERCADOPAGO_CHECKOUT_ENABLED", "true");
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "APP_USR_test");
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "mp_webhook_secret_test");

    const secret = "mp_webhook_secret_test";
    const ts = "1704908010";
    const xRequestId = "req-fixture-1";
    const dataId = "ORD01TEST123";
    const xSignature = signMercadoPagoWebhook({ secret, dataId, xRequestId, ts });
    const body = {
      id: 12345,
      type: "order",
      action: "order.processed",
      data: { id: dataId },
    };

    const { POST } = await import("@/app/api/payments/mercadopago/webhook/route");
    const response = await POST(
      new Request(`http://localhost/api/payments/mercadopago/webhook?data.id=${dataId}`, {
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
      provider_reference: dataId,
    });
  });
});

describe("Mercado Pago webhook parsing and idempotency", () => {
  afterEach(() => {
    resetMercadoPagoWebhookReplayCache();
  });

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

  it("deduplicates webhook events idempotently", () => {
    const notification = parseMercadoPagoWebhookNotification({
      id: 999,
      type: "order",
      action: "order.processed",
      data: { id: "ORD01TEST123" },
    });
    expect(notification).not.toBeNull();

    const first = applyMercadoPagoWebhookNotification(notification!);
    const second = applyMercadoPagoWebhookNotification(notification!);
    expect(first.replay).not.toBe(true);
    expect(second.replay).toBe(true);
  });
});
