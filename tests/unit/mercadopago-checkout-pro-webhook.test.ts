import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyMercadoPagoCheckoutProWebhookEvent } from "@/lib/server/mercadopago-checkout-pro-webhook";

const mocks = vi.hoisted(() => ({
  gateway: {
    getPayment: vi.fn(),
    getPreference: vi.fn(),
  },
  createGateway: vi.fn(),
  getEnv: vi.fn(),
  findByPayment: vi.fn(),
  applyPayment: vi.fn(),
  runOnboarding: vi.fn(),
  sendTelegram: vi.fn(),
  getTelegramConfig: vi.fn(),
  admin: {},
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mocks.admin),
}));

vi.mock("@/lib/server/mercadopago", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/mercadopago")>();
  return {
    ...actual,
    getMercadoPagoEnv: mocks.getEnv,
  };
});

vi.mock("@/lib/server/mercadopago-checkout-pro", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/mercadopago-checkout-pro")>();
  return {
    ...actual,
    createMercadoPagoCheckoutProGateway: mocks.createGateway,
    getMercadoPagoEnv: mocks.getEnv,
  };
});

vi.mock("@/lib/server/public-checkout-sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/public-checkout-sessions")>();
  return {
    ...actual,
    findCheckoutSessionByMpPaymentId: mocks.findByPayment,
    applyCheckoutSessionMpPayment: mocks.applyPayment,
  };
});

vi.mock("@/lib/server/visitor-onboarding", () => ({
  runVisitorOnboarding: mocks.runOnboarding,
}));

vi.mock("@/lib/server/telegram-notify", () => ({
  getTelegramNotifyConfig: mocks.getTelegramConfig,
  sendTelegramMessage: mocks.sendTelegram,
}));

const MUTATION = "22222222-2222-4222-8222-222222222222";

function notification(paymentId = "123456789") {
  return {
    id: "evt-1",
    type: "payment",
    action: "payment.updated",
    data: { id: paymentId },
  };
}

function session() {
  return {
    id: "session-1",
    client_mutation_id: MUTATION,
    plan_id: "11111111-1111-4111-8111-111111111111",
    payer_email: "cliente@exemplo.com",
    status: "pending",
    onboarding_status: null,
    onboarding_organization_id: null,
    onboarding_user_id: null,
    onboarding_subscription_id: null,
    onboarding_email_sent_at: null,
    onboarding_completed_at: null,
    onboarding_error: null,
    created_at: "2026-09-28T12:00:00.000Z",
    updated_at: "2026-09-28T12:00:00.000Z",
    mp_preapproval_id: null,
    mp_payment_id: null,
    mp_payment_status: null,
    mp_preference_id: null,
    mp_payment_paid_at: null,
    onboarding_claim_token: null,
    onboarding_claimed_at: null,
    onboarding_attempt_count: 0,
    pix_order_id: null,
    pix_order_amount: null,
    pix_order_status: null,
    pix_paid_at: null,
  };
}

beforeEach(() => {
  mocks.gateway.getPayment.mockReset();
  mocks.gateway.getPreference.mockReset();
  mocks.createGateway.mockReset().mockReturnValue(mocks.gateway);
  mocks.getEnv.mockReset().mockReturnValue({
    configured: true,
    accessToken: "token",
    webhookSecret: "secret",
    timeoutMs: 15000,
  });
  mocks.findByPayment.mockReset().mockResolvedValue(null);
  mocks.applyPayment.mockReset();
  mocks.runOnboarding.mockReset();
  mocks.sendTelegram.mockReset().mockResolvedValue({ ok: true });
  mocks.getTelegramConfig.mockReset().mockReturnValue({
    configured: true,
    botToken: "bot",
    chatId: "chat",
    timeoutMs: 10000,
  });
});

describe("applyMercadoPagoCheckoutProWebhookEvent", () => {
  it("aprova pagamento inédito, persiste sessão e dispara notificações", async () => {
    mocks.gateway.getPayment.mockResolvedValue({
      id: "123456789",
      status: "approved",
      externalReference: MUTATION,
      preferenceId: "pref-1",
      payerEmail: "cliente@exemplo.com",
      transactionAmount: "79.90",
    });
    mocks.gateway.getPreference.mockResolvedValue({
      id: "pref-1",
      externalReference: MUTATION,
      metadata: { plan_slug: "profissional" },
    });
    mocks.applyPayment.mockResolvedValue({
      ok: true,
      replay: false,
      session: session(),
    });
    mocks.runOnboarding.mockResolvedValue({
      status: "completed",
      subscriptionId: "sub-1",
      loginEmail: "cliente@exemplo.com",
      accessEmailSent: true,
      verifiedUserCreated: true,
    });

    const result = await applyMercadoPagoCheckoutProWebhookEvent(notification());

    expect(result.replay).toBe(false);
    expect(result.payment_id).toBe("123456789");
    expect(result.notifications_sent).toBe(true);
    expect(mocks.applyPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        clientMutationId: MUTATION,
        paymentId: "123456789",
        paymentStatus: "approved",
        preferenceId: "pref-1",
      })
    );
    expect(mocks.runOnboarding).toHaveBeenCalledOnce();
    expect(mocks.sendTelegram).toHaveBeenCalledOnce();
    expect(result.access_delivery).toMatchObject({
      login: "cliente@exemplo.com",
      credential: "temp_password",
      access_email_sent: true,
      verified_user_created: true,
    });
  });

  it("ignora pending/rejected sem alterar sessão nem notificar", async () => {
    mocks.gateway.getPayment.mockResolvedValue({
      id: "999",
      status: "pending",
      externalReference: MUTATION,
      preferenceId: null,
      payerEmail: "cliente@exemplo.com",
      transactionAmount: "79.90",
    });

    const result = await applyMercadoPagoCheckoutProWebhookEvent(notification("999"));

    expect(result.ignored).toBe(true);
    expect(result.ignored_reason).toBe("payment_status_pending");
    expect(mocks.applyPayment).not.toHaveBeenCalled();
    expect(mocks.runOnboarding).not.toHaveBeenCalled();
    expect(mocks.sendTelegram).not.toHaveBeenCalled();
  });

  it("ignora payment_id já processado (idempotência)", async () => {
    mocks.findByPayment.mockResolvedValue(session());

    const result = await applyMercadoPagoCheckoutProWebhookEvent(notification("123456789"));

    expect(result.replay).toBe(true);
    expect(result.payment_id).toBe("123456789");
    expect(mocks.gateway.getPayment).not.toHaveBeenCalled();
    expect(mocks.applyPayment).not.toHaveBeenCalled();
    expect(mocks.runOnboarding).not.toHaveBeenCalled();
    expect(mocks.sendTelegram).not.toHaveBeenCalled();
  });
});
