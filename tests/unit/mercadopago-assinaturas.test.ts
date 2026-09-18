import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAssinaturasExternalReference,
  isMercadoPagoAssinaturasCheckoutEnabledEnv,
  isMercadoPagoAssinaturasWebhookTypeAllowed,
  mapMercadoPagoPreapprovalStatusToSubscriptionStatus,
  parseMercadoPagoAuthorizedPaymentResponse,
  parseAssinaturasExternalReference,
  parseMercadoPagoAssinaturasWebhookNotification,
  parseMercadoPagoPreapprovalResponse,
} from "@/lib/domain/mercadopago-assinaturas";
import { verifyMercadoPagoWebhookSignature } from "@/lib/domain/mercadopago-webhook-signature";
import {
  getMercadoPagoAssinaturasEnv,
  isMercadoPagoAssinaturasCheckoutEnabled,
  mercadoPagoAssinaturasCheckoutHoldHealth,
  resolveMercadoPagoAssinaturasPayerEmail,
  verifyMercadoPagoAssinaturasWebhookRequest,
} from "@/lib/server/mercadopago-assinaturas";
import { getMercadoPagoAssinaturasCheckoutHealth } from "@/lib/server/mercadopago-assinaturas-checkout";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const MUTATION = "22222222-2222-4222-8222-222222222222";

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

describe("saas plans seed migration", () => {
  it("seeds essencial, profissional, enterprise and deactivates junk rows", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260918120000_saas_plans_seed_mercadopago_assinaturas.sql"),
      "utf8"
    );
    expect(sql).toContain("'essencial'");
    expect(sql).toContain("'profissional'");
    expect(sql).toContain("'enterprise'");
    expect(sql).toContain("99.90");
    expect(sql).toContain("199.90");
    expect(sql).toContain("499.90");
    expect(sql).toContain("ON CONFLICT (slug)");
    expect(sql).toContain("subscription_provider_events");
    expect(sql).toContain("Isolated from PDV MERCADOPAGO_CHECKOUT_ENABLED");
    expect(sql).not.toContain("MERCADOPAGO_ASSINATURAS_CHECKOUT_ENABLED");
  });
});

describe("Mercado Pago Assinaturas flag hold", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires explicit MERCADOPAGO_ASSINATURAS_CHECKOUT_ENABLED=true", () => {
    expect(isMercadoPagoAssinaturasCheckoutEnabledEnv(undefined)).toBe(false);
    expect(isMercadoPagoAssinaturasCheckoutEnabledEnv("false")).toBe(false);
    expect(isMercadoPagoAssinaturasCheckoutEnabledEnv("true")).toBe(true);
  });

  it("returns hold health when flag is off", async () => {
    vi.stubEnv("MERCADOPAGO_ASSINATURAS_CHECKOUT_ENABLED", "false");
    await expect(getMercadoPagoAssinaturasCheckoutHealth()).resolves.toMatchObject({
      configured: false,
      reason: "mercadopago_assinaturas_checkout_hold",
    });
    expect(mercadoPagoAssinaturasCheckoutHoldHealth()).toMatchObject({
      reason: "mercadopago_assinaturas_checkout_hold",
    });
  });

  it("does not reuse PDV MERCADOPAGO_CHECKOUT_ENABLED", () => {
    vi.stubEnv("MERCADOPAGO_CHECKOUT_ENABLED", "true");
    vi.stubEnv("MERCADOPAGO_ASSINATURAS_CHECKOUT_ENABLED", undefined);
    expect(isMercadoPagoAssinaturasCheckoutEnabled()).toBe(false);
  });

  it("uses assinaturas-specific env namespace", () => {
    expect(
      getMercadoPagoAssinaturasEnv({
        MERCADOPAGO_ASSINATURAS_ACCESS_TOKEN: "token",
        MERCADOPAGO_ASSINATURAS_WEBHOOK_SECRET: "secret",
      }).configured
    ).toBe(true);
    expect(
      getMercadoPagoAssinaturasEnv({
        MERCADOPAGO_ACCESS_TOKEN: "pdv-token",
        MERCADOPAGO_WEBHOOK_SECRET: "pdv-secret",
      }).configured
    ).toBe(false);
  });
});

describe("Mercado Pago Assinaturas domain", () => {
  it("parses external reference for org reconciliation", () => {
    const external = buildAssinaturasExternalReference(ORG_ID, MUTATION);
    expect(parseAssinaturasExternalReference(external)).toEqual({
      orgId: ORG_ID,
      clientMutationId: MUTATION,
    });
    expect(parseAssinaturasExternalReference("invalid")).toBeNull();
  });

  it("allowlists subscription webhook types", () => {
    expect(isMercadoPagoAssinaturasWebhookTypeAllowed("subscription_preapproval")).toBe(true);
    expect(isMercadoPagoAssinaturasWebhookTypeAllowed("subscription_authorized_payment")).toBe(true);
    expect(isMercadoPagoAssinaturasWebhookTypeAllowed("order.processed")).toBe(false);
  });

  it("maps preapproval statuses to subscription statuses", () => {
    expect(mapMercadoPagoPreapprovalStatusToSubscriptionStatus("authorized")).toBe("active");
    expect(mapMercadoPagoPreapprovalStatusToSubscriptionStatus("pending")).toBe("trialing");
    expect(mapMercadoPagoPreapprovalStatusToSubscriptionStatus("cancelled")).toBe("canceled");
  });

  it("parses webhook notifications and preapproval responses", () => {
    expect(
      parseMercadoPagoAssinaturasWebhookNotification({
        id: 123,
        type: "subscription_preapproval",
        action: "updated",
        data: { id: "abc" },
      })
    ).toMatchObject({ type: "subscription_preapproval", data: { id: "abc" } });

    expect(
      parseMercadoPagoPreapprovalResponse({
        id: "preapproval-id",
        status: "pending",
        init_point: "https://mp.test/init",
        external_reference: buildAssinaturasExternalReference(ORG_ID, MUTATION),
      })
    ).toMatchObject({
      id: "preapproval-id",
      initPoint: "https://mp.test/init",
    });
  });

  it("parses a Mercado Pago authorized payment back to its preapproval", () => {
    expect(
      parseMercadoPagoAuthorizedPaymentResponse({
        id: "authorized-payment-id",
        preapproval_id: "preapproval-id",
      })
    ).toEqual({
      id: "authorized-payment-id",
      preapprovalId: "preapproval-id",
      status: null,
      paymentStatus: null,
    });
    expect(
      parseMercadoPagoAuthorizedPaymentResponse({
        id: "authorized-payment-id",
        preapproval: { id: "preapproval-id" },
      })
    ).toEqual({
      id: "authorized-payment-id",
      preapprovalId: "preapproval-id",
      status: null,
      paymentStatus: null,
    });
    expect(
      parseMercadoPagoAuthorizedPaymentResponse({
        id: 6114264375,
        preapproval_id: "preapproval-id",
        status: "processed",
        payment: { id: 19951521071, status: "approved" },
      })
    ).toEqual({
      id: "6114264375",
      preapprovalId: "preapproval-id",
      status: "processed",
      paymentStatus: "approved",
    });
  });

  it("resolves assinaturas payer email separately from PDV", () => {
    expect(resolveMercadoPagoAssinaturasPayerEmail({})).toBe("buyer@testuser.com");
    expect(
      resolveMercadoPagoAssinaturasPayerEmail({
        MERCADOPAGO_ASSINATURAS_PAYER_EMAIL: "assinante@test.com",
      })
    ).toBe("assinante@test.com");
  });
});

describe("Mercado Pago Assinaturas webhook signature fail-closed", () => {
  it("rejects unsigned webhook requests", () => {
    expect(() =>
      verifyMercadoPagoAssinaturasWebhookRequest({
        xSignature: null,
        xRequestId: "req-1",
        dataId: "abc",
        secret: "secret",
      })
    ).toThrow("mercadopago_webhook_unsigned");
  });

  it("accepts valid signatures with shared verifier", () => {
    const secret = "webhook-secret";
    const dataId = "ABC123";
    const xRequestId = "req-42";
    const ts = "1700000000";
    const xSignature = signMercadoPagoWebhook({ secret, dataId, xRequestId, ts });
    expect(() =>
      verifyMercadoPagoWebhookSignature({
        xSignature,
        xRequestId,
        dataId,
        secret,
      })
    ).not.toThrow();
  });

  it("rejects invalid signatures", () => {
    expect(() =>
      verifyMercadoPagoWebhookSignature({
        xSignature: "ts=1,v1=deadbeef",
        xRequestId: "req",
        dataId: "id",
        secret: "secret",
      })
    ).toThrow("mercadopago_webhook_invalid_signature");
  });
});
