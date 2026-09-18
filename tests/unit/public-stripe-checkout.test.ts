import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeMercadoPagoIndependentStripeCheckout } from "@/lib/server/public-stripe-checkout";
import { createAdminClient } from "@/lib/supabase/admin";

const mocks = vi.hoisted(() => ({
  admin: { from: vi.fn() },
  createSession: vi.fn(),
  sessionsCreate: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mocks.admin),
}));

vi.mock("@/lib/server/public-checkout-sessions", () => ({
  createPublicCheckoutSession: mocks.createSession,
}));

vi.mock("stripe", () => {
  class Stripe {
    checkout = { sessions: { create: mocks.sessionsCreate } };
    constructor(_secretKey: string, _config?: Record<string, unknown>) {}
  }
  return { default: Stripe };
});

import { applyStripeSubscriptionWebhookEvent, isStripeSubscriptionCheckoutEvent } from "@/lib/server/stripe-subscription-webhook";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const MUTATION = "22222222-2222-4222-8222-222222222222";

function planBuilder(plan: Record<string, unknown> | null) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: vi.fn().mockResolvedValue({ data: plan, error: null }),
  };
  return builder;
}

const STRIPE_PLAN = {
  id: PLAN_ID,
  slug: "pix",
  name: "Plano Pix",
  amount: 79.9,
  currency: "BRL",
  billing_interval: "monthly",
  is_active: true,
};

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_abc123",
  STRIPE_WEBHOOK_SECRET: "whsec_abc123",
  STRIPE_PRICE_PLAN_PIX: "price_1234567890abcdef",
  APP_ORIGIN: "https://nex.example.com",
};

beforeEach(() => {
  mocks.sessionsCreate.mockReset().mockResolvedValue({
    id: "cs_test_123",
    url: "https://checkout.stripe.com/c/pay/cs_test_123",
  });
  mocks.createSession.mockReset().mockResolvedValue({
    ok: true,
    sessionId: "session-123",
    clientMutationId: MUTATION,
    replayed: false,
  });
  mocks.admin.from.mockReset().mockReturnValue(planBuilder(STRIPE_PLAN));
  vi.mocked(createAdminClient).mockClear();
});

describe("public Stripe checkout", () => {
  it("creates a subscription Checkout Session for mapped plans", async () => {
    const result = await executeMercadoPagoIndependentStripeCheckout({
      planId: PLAN_ID,
      payerEmail: "cliente@exemplo.com",
      clientMutationId: MUTATION,
      envSource: STRIPE_ENV,
    });

    expect(result).toMatchObject({
      ok: true,
      client_mutation_id: MUTATION,
      checkout_session_id: "cs_test_123",
      checkout_url: "https://checkout.stripe.com/c/pay/cs_test_123",
    });
    expect(mocks.sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer_email: "cliente@exemplo.com",
        line_items: [{ price: "price_1234567890abcdef", quantity: 1 }],
        client_reference_id: `nex:checkout:session:${MUTATION}`,
      }),
      expect.objectContaining({ idempotencyKey: `nex-stripe-checkout:${MUTATION}` })
    );
  });

  it("refuses plans without a stripe mapping (no fallback)", async () => {
    mocks.admin.from.mockReturnValue(planBuilder({ ...STRIPE_PLAN, slug: "profissional" }));

    const result = await executeMercadoPagoIndependentStripeCheckout({
      planId: PLAN_ID,
      payerEmail: "cliente@exemplo.com",
      clientMutationId: MUTATION,
      envSource: STRIPE_ENV,
    });

    expect(result).toEqual({ ok: false, error: "plan_not_stripe", status: 400 });
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("is unavailable without stripe secrets", async () => {
    const result = await executeMercadoPagoIndependentStripeCheckout({
      planId: PLAN_ID,
      payerEmail: "cliente@exemplo.com",
      clientMutationId: MUTATION,
      envSource: {},
    });

    expect(result).toEqual({ ok: false, error: "stripe_not_configured", status: 503 });
  });
});

describe("stripe subscription webhook branch", () => {
  it("detects only public checkout sessions", () => {
    expect(
      isStripeSubscriptionCheckoutEvent({
        type: "checkout.session.completed",
        data: { object: { client_reference_id: `nex:checkout:session:${MUTATION}` } },
      })
    ).toBe(true);
    expect(
      isStripeSubscriptionCheckoutEvent({
        type: "checkout.session.completed",
        data: { object: { client_reference_id: "pdv-thing" } },
      })
    ).toBe(false);
    expect(
      isStripeSubscriptionCheckoutEvent({
        type: "payment_intent.succeeded",
        data: { object: {} },
      })
    ).toBe(false);
  });

  it("refuses unpaid sessions", async () => {
    const result = await applyStripeSubscriptionWebhookEvent({
      event: {
        id: "evt-0",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_0",
            client_reference_id: `nex:checkout:session:${MUTATION}`,
            payment_status: "unpaid",
          },
        },
      },
      admin: {} as never,
    });

    expect(result).toMatchObject({ handled: true, ignored: true, ignored_reason: "stripe_session_not_paid" });
  });
});
