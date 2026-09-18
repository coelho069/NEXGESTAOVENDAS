import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyMercadoPagoAssinaturasWebhookEvent } from "@/lib/server/mercadopago-assinaturas-webhook";
import { createAdminClient } from "@/lib/supabase/admin";

const mocks = vi.hoisted(() => ({
  gateway: {
    getPreapproval: vi.fn(),
    getAuthorizedPayment: vi.fn(),
  },
  createGateway: vi.fn(),
  getEnv: vi.fn(),
  resolveSession: vi.fn(),
  runOnboarding: vi.fn(),
  admin: {},
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mocks.admin),
}));

vi.mock("@/lib/server/mercadopago-assinaturas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/mercadopago-assinaturas")>();
  return {
    ...actual,
    createMercadoPagoAssinaturasGateway: mocks.createGateway,
    getMercadoPagoAssinaturasEnv: mocks.getEnv,
  };
});

vi.mock("@/lib/server/public-checkout-sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/public-checkout-sessions")>();
  return { ...actual, resolvePublicCheckoutSession: mocks.resolveSession };
});

vi.mock("@/lib/server/visitor-onboarding", () => ({
  runVisitorOnboarding: mocks.runOnboarding,
}));

const MUTATION = "22222222-2222-4222-8222-222222222222";

function preapproval(status = "authorized") {
  return {
    id: "preapproval-123",
    status,
    reason: "Profissional",
    initPoint: null,
    sandboxInitPoint: null,
    externalReference: null,
    payerEmail: "cliente@exemplo.com",
    preapprovalPlanId: "mp-plan-123",
  };
}

function publicSession() {
  return {
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
    id: "session-123",
    created_at: "2026-09-18T12:00:00.000Z",
    updated_at: "2026-09-18T12:00:00.000Z",
    mp_preapproval_id: null,
    onboarding_claim_token: null,
    onboarding_claimed_at: null,
    onboarding_attempt_count: 0,
  };
}

beforeEach(() => {
  mocks.gateway.getPreapproval.mockReset();
  mocks.gateway.getAuthorizedPayment.mockReset();
  mocks.createGateway.mockReset().mockReturnValue(mocks.gateway);
  mocks.getEnv.mockReset().mockReturnValue({
    configured: true,
    accessToken: "access-token",
    webhookSecret: "webhook-secret",
    timeoutMs: 1_000,
  });
  mocks.resolveSession.mockReset();
  mocks.runOnboarding.mockReset();
  vi.mocked(createAdminClient).mockClear();
  mocks.resolveSession.mockResolvedValue({
    ok: true,
    session: publicSession(),
    matchedBy: "plan_email",
  });
  mocks.runOnboarding.mockResolvedValue({
    status: "completed",
    organizationId: "org-123",
    userId: "user-123",
    subscriptionId: "subscription-123",
  });
});
describe("Mercado Pago Assinaturas webhook", () => {
  it("re-fetches the preapproval and starts public onboarding only when authorized", async () => {
    mocks.gateway.getPreapproval.mockResolvedValue(preapproval());

    const result = await applyMercadoPagoAssinaturasWebhookEvent(
      {
        id: "event-1",
        type: "subscription_preapproval",
        action: "updated",
        data: { id: "preapproval-123" },
      },
      { correlationId: "corr-1" }
    );

    expect(mocks.gateway.getPreapproval).toHaveBeenCalledWith("preapproval-123");
    expect(mocks.resolveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        preapprovalId: "preapproval-123",
        preapprovalPlanId: "mp-plan-123",
        payerEmail: "cliente@exemplo.com",
        correlationId: "corr-1",
      })
    );
    expect(mocks.runOnboarding).toHaveBeenCalledWith({
      clientMutationId: MUTATION,
      providerRef: "preapproval-123",
      correlationId: "corr-1",
    });
    expect(result).toMatchObject({
      replay: false,
      event_id: "event-1",
      subscription_id: "subscription-123",
      status: "active",
    });
  });

  it("resolves subscription_authorized_payment through authorized_payments first", async () => {
    mocks.gateway.getAuthorizedPayment.mockResolvedValue({
      id: "authorized-payment-123",
      preapprovalId: "preapproval-123",
      status: "processed",
      paymentStatus: "approved",
    });
    mocks.gateway.getPreapproval.mockResolvedValue(preapproval());

    await applyMercadoPagoAssinaturasWebhookEvent({
      id: "event-authorized-payment",
      type: "subscription_authorized_payment",
      action: "created",
      data: { id: "authorized-payment-123" },
    });

    expect(mocks.gateway.getAuthorizedPayment).toHaveBeenCalledWith(
      "authorized-payment-123"
    );
    expect(mocks.gateway.getPreapproval).toHaveBeenCalledWith("preapproval-123");
    expect(mocks.gateway.getPreapproval).not.toHaveBeenCalledWith(
      "authorized-payment-123"
    );
  });

  it("does not onboard a preapproval that is not currently authorized", async () => {
    mocks.gateway.getPreapproval.mockResolvedValue(preapproval("pending"));

    const result = await applyMercadoPagoAssinaturasWebhookEvent({
      id: "event-pending",
      type: "subscription_preapproval",
      action: "created",
      data: { id: "preapproval-123" },
    });

    expect(result).toMatchObject({
      ignored: true,
      ignored_reason: "preapproval_not_authorized",
    });
    expect(mocks.resolveSession).not.toHaveBeenCalled();
    expect(mocks.runOnboarding).not.toHaveBeenCalled();
  });

  it("does not guess when session resolution is ambiguous", async () => {
    mocks.gateway.getPreapproval.mockResolvedValue(preapproval());
    mocks.resolveSession.mockResolvedValue({
      ok: false,
      reason: "ambiguous",
      error: "checkout_session_ambiguous",
    });

    const result = await applyMercadoPagoAssinaturasWebhookEvent({
      id: "event-ambiguous",
      type: "subscription_preapproval",
      action: "updated",
      data: { id: "preapproval-123" },
    });

    expect(result).toMatchObject({
      ignored: true,
      ignored_reason: "checkout_session_ambiguous",
    });
    expect(mocks.runOnboarding).not.toHaveBeenCalled();
  });

  it("treats a completed onboarding as a replay", async () => {
    mocks.gateway.getPreapproval.mockResolvedValue(preapproval());
    mocks.runOnboarding.mockResolvedValue({
      status: "replayed",
      organizationId: "org-123",
      userId: "user-123",
      subscriptionId: "subscription-123",
    });

    const result = await applyMercadoPagoAssinaturasWebhookEvent({
      id: "event-duplicate",
      type: "subscription_preapproval",
      action: "updated",
      data: { id: "preapproval-123" },
    });

    expect(result).toMatchObject({
      replay: true,
      status: "active",
      subscription_id: "subscription-123",
    });
  });
});
