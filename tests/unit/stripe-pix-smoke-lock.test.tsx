import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaymentActions } from "@/components/pdv/sale-summary";
import { StripePixPaymentAdapter, type StripePixGateway } from "@/lib/adapters/stripe-pix";
import { getPaymentAdapter } from "@/lib/adapters/payment";
import {
  fetchPixPaymentSelectable,
  isCheckoutPaymentSelectable,
  isPixPaymentHealthSelectable,
} from "@/lib/adapters/payment-health";
import {
  evaluatePixCheckoutGate,
  isPixCheckoutEnabledEnv,
  pixWebhookObjectMatchesLocalIntent,
  reconcileStripePixPaymentIntent,
} from "@/lib/domain/stripe-pix";
import { executeCardPayment, getCardAdapterHealth } from "@/lib/server/card-payment";
import {
  applyPixStripeWebhookEvent,
  applyStripeWebhookEventBranched,
  executePixPayment,
  getPixAdapterHealth,
  reconcilePixAgainstStripe,
} from "@/lib/server/pix-payment";
import {
  createStripePixGateway,
  probeStripePixHealth,
  resolvePixPaymentAdapter,
} from "@/lib/server/stripe-pix";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PixPaymentInput } from "@/lib/validation/schemas";

vi.mock("@/lib/server/stripe-pix", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/stripe-pix")>();
  return {
    ...actual,
    probeStripePixHealth: vi.fn(),
    resolvePixPaymentAdapter: vi.fn(),
    createStripePixGateway: vi.fn(),
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

const probeStripePixHealthMock = vi.mocked(probeStripePixHealth);
const resolvePixPaymentAdapterMock = vi.mocked(resolvePixPaymentAdapter);
const createStripePixGatewayMock = vi.mocked(createStripePixGateway);
const createAdminClientMock = vi.mocked(createAdminClient);

const STORE = "11111111-1111-4111-8111-111111111111";
const MUTATION = "22222222-2222-4222-8222-222222222222";
const OPERATOR = "33333333-3333-4333-8333-333333333333";
const SALE = "44444444-4444-4444-8444-444444444444";

function createInput(): PixPaymentInput {
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

function snapshot(overrides: Partial<{
  id: string;
  status: string;
  amount: number;
  currency: string;
  livemode: boolean;
  received: boolean;
}> = {}) {
  return {
    id: "pi_pix_123",
    status: "requires_action",
    amount: 1000,
    currency: "brl",
    livemode: false,
    received: true,
    qr: { data: "00020126pix-payload", imageUrlPng: "https://files.stripe.com/qr.png" },
    ...overrides,
  };
}

function fakeGateway(overrides: Partial<StripePixGateway> = {}): StripePixGateway {
  return {
    health: async () => ({ ok: true, testmode: true, message: "ok" }),
    create: async () => snapshot(),
    cancel: async () => snapshot({ status: "canceled" }),
    retrieve: async () => snapshot({ status: "succeeded" }),
    ...overrides,
  };
}

function webhookPixObject(overrides: Record<string, unknown> = {}) {
  return {
    id: "pi_pix_123",
    payment_method_types: ["pix"],
    amount: 1000,
    currency: "brl",
    ...overrides,
  };
}

function mockAdminRpc(
  impl: (name: string, args?: unknown) => { data: unknown; error: unknown },
  localIntent: { data: unknown; error: unknown } = { data: { amount: "10.00", currency: "brl" }, error: null }
) {
  const rpc = vi.fn(async (name: string, args?: unknown) => impl(name, args));
  createAdminClientMock.mockReturnValue({
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => localIntent,
        }),
      }),
    }),
  } as never);
  return rpc;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("PIX smoke lock — flag never defaults true", () => {
  it("enables only the literal string true", () => {
    expect(isPixCheckoutEnabledEnv(undefined)).toBe(false);
    expect(isPixCheckoutEnabledEnv("")).toBe(false);
    expect(isPixCheckoutEnabledEnv("false")).toBe(false);
    expect(isPixCheckoutEnabledEnv("TRUE")).toBe(false);
    expect(isPixCheckoutEnabledEnv("1")).toBe(false);
    expect(isPixCheckoutEnabledEnv("yes")).toBe(false);
    expect(isPixCheckoutEnabledEnv("true")).toBe(true);
  });

  it("does not assign PIX_CHECKOUT_ENABLED=true in env examples or server default", () => {
    const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const uncommented = envExample
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(uncommented).not.toMatch(/PIX_CHECKOUT_ENABLED\s*=\s*true/);
    expect(envExample).toMatch(/# PIX_CHECKOUT_ENABLED=false/);
    expect(envExample).toMatch(/Do not set PIX_CHECKOUT_ENABLED=true/);

    const server = readFileSync(join(process.cwd(), "src/lib/server/pix-payment.ts"), "utf8");
    expect(server).toContain("isPixCheckoutEnabledEnv(process.env.PIX_CHECKOUT_ENABLED)");
    expect(server).not.toMatch(/PIX_CHECKOUT_ENABLED\s*\?\?\s*["']true["']/);
    expect(server).not.toMatch(/PIX_CHECKOUT_ENABLED\s*\|\|\s*["']true["']/);
  });

  it("hard-disables PDV PIX so the placeholder cannot start Stripe or a sale", () => {
    const pdvScreen = readFileSync(join(process.cwd(), "src/components/pdv/pdv-screen.tsx"), "utf8");
    const paymentSheet = readFileSync(join(process.cwd(), "src/components/pdv/payment-sheet.tsx"), "utf8");
    const paymentActions = readFileSync(join(process.cwd(), "src/components/pdv/sale-summary.tsx"), "utf8");

    expect(pdvScreen).not.toContain("usePixPaymentHealth");
    expect(pdvScreen).not.toMatch(/sale\.pay\(\s*["']pix["']\s*\)/);
    expect(pdvScreen).toContain("pixSelectable={false}");
    expect(pdvScreen).not.toMatch(/onPix=\{/);

    expect(paymentSheet).toContain("pixSelectable={false}");
    expect(paymentSheet).not.toMatch(/onPix=\{/);

    expect(paymentActions).toContain('data-testid="checkout-pix"');
    expect(paymentActions).toContain("não configurado");
    expect(paymentActions).not.toMatch(/onClick=\{[^}]*onPix/);
    expect(paymentActions).not.toMatch(/stripe/i);
  });
});

describe("PIX smoke lock — Gate 1 health hold / online only", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    probeStripePixHealthMock.mockReset();
    resolvePixPaymentAdapterMock.mockReset();
  });

  it("holds health and execute when the flag is off", async () => {
    delete process.env.PIX_CHECKOUT_ENABLED;
    const unset = await getPixAdapterHealth();
    expect(unset).toMatchObject({
      configured: false,
      testmode: false,
      reason: "pix_checkout_hold",
    });
    expect(probeStripePixHealthMock).not.toHaveBeenCalled();

    vi.stubEnv("PIX_CHECKOUT_ENABLED", "TRUE");
    const notLiteral = await executePixPayment({} as never, createInput(), OPERATOR);
    expect(notLiteral.status).toBe("not_configured");
    expect(notLiteral.configured).toBe(false);
    expect(probeStripePixHealthMock).not.toHaveBeenCalled();
  });

  it("stays not_configured when flag is on but secrets/health fail", async () => {
    vi.stubEnv("PIX_CHECKOUT_ENABLED", "true");
    probeStripePixHealthMock.mockResolvedValue({
      ok: false,
      configured: false,
      testmode: false,
      message: "Stripe PIX adapter not_configured.",
      reason: "missing_secrets",
    });
    const health = await getPixAdapterHealth();
    expect(health.configured).toBe(false);
    expect(health.testmode).toBe(false);
    expect(probeStripePixHealthMock).toHaveBeenCalledTimes(1);

    const result = await executePixPayment({} as never, createInput(), OPERATOR);
    expect(result).toMatchObject({ status: "not_configured", configured: false });
    expect(result.sale_confirmed).not.toBe(true);
  });

  it("opens PIX only with flag + configured testmode + online", () => {
    expect(
      evaluatePixCheckoutGate({
        flagEnabled: false,
        healthConfigured: true,
        healthTestmode: true,
        online: true,
      })
    ).toEqual({ selectable: false, reason: "hold" });
    expect(
      evaluatePixCheckoutGate({
        flagEnabled: true,
        healthConfigured: false,
        healthTestmode: false,
        online: true,
      })
    ).toEqual({ selectable: false, reason: "not_configured" });
    expect(
      evaluatePixCheckoutGate({
        flagEnabled: true,
        healthConfigured: true,
        healthTestmode: false,
        online: true,
      })
    ).toEqual({ selectable: false, reason: "livemode" });
    expect(
      evaluatePixCheckoutGate({
        flagEnabled: true,
        healthConfigured: true,
        healthTestmode: true,
        online: false,
      })
    ).toEqual({ selectable: false, reason: "offline" });
    expect(
      evaluatePixCheckoutGate({
        flagEnabled: true,
        healthConfigured: true,
        healthTestmode: true,
        online: true,
      })
    ).toEqual({ selectable: true, reason: "ok" });
  });

  it("keeps PIX unselectable offline even when health JSON is configured testmode", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    await expect(
      fetchPixPaymentSelectable(async () =>
        jsonResponse({ configured: true, testmode: true, method: "pix" })
      )
    ).resolves.toBe(false);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    expect(
      isPixPaymentHealthSelectable({
        ok: true,
        status: 200,
        contentType: "application/json",
        body: { configured: true, testmode: true, method: "pix" },
      })
    ).toBe(true);
  });
});

describe("PIX smoke lock — Gate 2 create pending ≠ sale confirmed", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    probeStripePixHealthMock.mockReset();
    resolvePixPaymentAdapterMock.mockReset();
  });

  it("returns pending QR and never calls process_pix_sale", async () => {
    vi.stubEnv("PIX_CHECKOUT_ENABLED", "true");
    probeStripePixHealthMock.mockResolvedValue({
      ok: true,
      configured: true,
      testmode: true,
      message: "Stripe testmode ok",
    });
    resolvePixPaymentAdapterMock.mockResolvedValue(new StripePixPaymentAdapter(fakeGateway()));
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });

    const result = await executePixPayment({ rpc } as never, createInput(), OPERATOR);

    expect(result.status).toBe("pending");
    expect(result.status).not.toBe("captured");
    expect(result.sale_confirmed).toBe(false);
    expect(result.providerReference).toBe("pi_pix_123");
    expect(result.qr?.data).toBe("00020126pix-payload");
    const rpcNames = rpc.mock.calls.map((call) => call[0]);
    expect(rpcNames).toContain("register_pix_payment_intent");
    expect(rpcNames).not.toContain("process_pix_sale");
  });

  it("returns unknown when register_pix_payment_intent fails after Stripe create", async () => {
    vi.stubEnv("PIX_CHECKOUT_ENABLED", "true");
    probeStripePixHealthMock.mockResolvedValue({
      ok: true,
      configured: true,
      testmode: true,
      message: "Stripe testmode ok",
    });
    resolvePixPaymentAdapterMock.mockResolvedValue(new StripePixPaymentAdapter(fakeGateway()));
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "register_failed" } });

    const result = await executePixPayment({ rpc } as never, createInput(), OPERATOR);

    expect(result.status).toBe("unknown");
    expect(result.sale_confirmed).toBe(false);
    expect(result.qr).toBeUndefined();
  });
});

describe("PIX smoke lock — Gate 3 webhook confirm / fail / mismatch", () => {
  afterEach(() => {
    createAdminClientMock.mockReset();
    createStripePixGatewayMock.mockReset();
    probeStripePixHealthMock.mockReset();
    resolvePixPaymentAdapterMock.mockReset();
    vi.unstubAllEnvs();
  });

  it("confirms the sale only after succeeded + process_pix_sale", async () => {
    const rpc = mockAdminRpc((name) => {
      if (name === "apply_pix_provider_event") {
        return { data: { store_id: STORE, client_mutation_id: MUTATION, sale_id: null }, error: null };
      }
      if (name === "process_pix_sale") {
        return { data: { sale_id: SALE, status: "confirmed" }, error: null };
      }
      return { data: null, error: null };
    });

    const result = await applyPixStripeWebhookEvent({
      id: "evt_pix_ok",
      type: "payment_intent.succeeded",
      data: { object: webhookPixObject() },
    });

    expect(result.status).toBe("captured");
    expect(result.sale_confirmed).toBe(true);
    expect(result.sale_id).toBe(SALE);
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "apply_pix_provider_event",
      "process_pix_sale",
    ]);
  });

  it("maps payment_failed to unknown and skips process_pix_sale", async () => {
    const rpc = mockAdminRpc(() => ({
      data: { store_id: STORE, client_mutation_id: MUTATION },
      error: null,
    }));

    const result = await applyPixStripeWebhookEvent({
      id: "evt_pix_fail",
      type: "payment_intent.payment_failed",
      data: { object: webhookPixObject() },
    });

    expect(result.status).toBe("unknown");
    expect(result.sale_confirmed).not.toBe(true);
    expect(rpc.mock.calls.map((call) => call[0])).toEqual(["apply_pix_provider_event"]);
  });

  it("keeps succeeded without a matching PIX intent as unknown", async () => {
    const rpc = mockAdminRpc(() => ({ data: { status: "captured" }, error: null }), {
      data: null,
      error: null,
    });

    const result = await applyPixStripeWebhookEvent({
      id: "evt_pix_orphan",
      type: "payment_intent.succeeded",
      data: { object: webhookPixObject({ id: "pi_unknown" }) },
    });

    expect(result.status).toBe("unknown");
    expect(result.sale_confirmed).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps webhook amount mismatch as unknown before process_pix_sale", async () => {
    const rpc = mockAdminRpc(() => ({
      data: { store_id: STORE, client_mutation_id: MUTATION },
      error: null,
    }));

    const result = await applyPixStripeWebhookEvent({
      id: "evt_pix_amount",
      type: "payment_intent.succeeded",
      data: { object: webhookPixObject({ amount: 2500 }) },
    });

    expect(result.status).toBe("unknown");
    expect(result.sale_confirmed).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(
      pixWebhookObjectMatchesLocalIntent({
        object: webhookPixObject({ amount: 2500 }),
        expectedProviderRef: "pi_pix_123",
        localAmount: "10.00",
      })
    ).toBe(false);
  });

  it("asks Stripe to retry when apply_pix_provider_event fails", async () => {
    const rpc = mockAdminRpc(() => ({ data: null, error: { message: "db_down" } }));

    const result = await applyPixStripeWebhookEvent({
      id: "evt_pix_retry",
      type: "payment_intent.succeeded",
      data: { object: webhookPixObject() },
    });

    expect(result.retry).toBe(true);
    expect(result.sale_confirmed).toBe(false);
    expect(rpc.mock.calls.map((call) => call[0])).toEqual(["apply_pix_provider_event"]);
  });

  it("keeps process_pix_sale mismatch as unknown", async () => {
    mockAdminRpc((name) => {
      if (name === "apply_pix_provider_event") {
        return { data: { store_id: STORE, client_mutation_id: MUTATION }, error: null };
      }
      return { data: null, error: { message: "payment_total_mismatch" } };
    });

    const result = await applyPixStripeWebhookEvent({
      id: "evt_pix_mismatch",
      type: "payment_intent.succeeded",
      data: { object: webhookPixObject() },
    });

    expect(result.status).toBe("unknown");
    expect(result.sale_confirmed).toBe(false);
  });

  it("reconciles amount or provider mismatch as unknown, not captured", () => {
    const amount = reconcileStripePixPaymentIntent({
      expectedProviderRef: "pi_pix_123",
      expectedAmount: "10.00",
      snapshot: snapshot({ status: "succeeded", amount: 2500 }),
    });
    expect(amount.status).toBe("unknown");
    expect(amount.mismatch).toBe(true);

    const provider = reconcileStripePixPaymentIntent({
      expectedProviderRef: "pi_pix_123",
      expectedAmount: "10.00",
      snapshot: snapshot({ id: "pi_other", status: "succeeded", amount: 1000 }),
    });
    expect(provider.status).toBe("unknown");
    expect(provider.mismatch).toBe(true);
  });

  it("returns unknown when Stripe retrieve throws during reconcile", async () => {
    probeStripePixHealthMock.mockResolvedValue({
      ok: true,
      configured: true,
      testmode: true,
      message: "ok",
    });
    resolvePixPaymentAdapterMock.mockResolvedValue(
      new StripePixPaymentAdapter(
        fakeGateway({
          retrieve: async () => {
            throw new Error("timeout");
          },
        })
      )
    );
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_pix");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_pix");
    createStripePixGatewayMock.mockReturnValue({
      retrieve: async () => {
        throw new Error("timeout");
      },
    } as never);

    const result = await reconcilePixAgainstStripe({
      supabase: { rpc: vi.fn() } as never,
      storeId: STORE,
      clientMutationId: MUTATION,
      amount: "10.00",
      providerReference: "pi_pix_123",
    });

    expect(result.status).toBe("unknown");
    expect(result.sale_confirmed).toBe(false);
  });
});

describe("PIX smoke lock — Gate 4 cash + card regression", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    createAdminClientMock.mockReset();
  });

  it("keeps cash configured and card hold independent of PIX flag", async () => {
    delete process.env.PIX_CHECKOUT_ENABLED;
    delete process.env.CARD_CHECKOUT_ENABLED;

    expect(getPaymentAdapter("cash").process("10.00").status).toBe("configured");
    await expect(isCheckoutPaymentSelectable("cash")).resolves.toBe(true);

    const cardHealth = await getCardAdapterHealth();
    expect(cardHealth.reason).toBe("card_checkout_hold");
    expect(cardHealth.configured).toBe(false);

    const pixHealth = await getPixAdapterHealth();
    expect(pixHealth.reason).toBe("pix_checkout_hold");

    const cardExec = await executeCardPayment(
      {} as never,
      {
        action: "capture",
        store_id: STORE,
        amount: "10.00",
        client_mutation_id: MUTATION,
        provider_reference: "pi_card_hold",
        discount: "0.00",
      },
      OPERATOR
    );
    expect(cardExec.status).toBe("not_configured");
  });

  it("keeps cash and card buttons usable while PIX stays disabled", () => {
    const onCard = vi.fn();
    const onPix = vi.fn();
    const onCash = vi.fn();
    render(
      <PaymentActions
        disabled={false}
        cardSelectable={true}
        pixSelectable={false}
        onCash={onCash}
        onCard={onCard}
        onPix={onPix}
      />
    );

    expect(screen.getByTestId("checkout-cash")).toBeEnabled();
    expect(screen.getByTestId("checkout-card")).toBeEnabled();
    expect(screen.getByTestId("checkout-pix")).toBeDisabled();
    expect(screen.getByTestId("checkout-pix")).toHaveTextContent("não configurado");
    expect(screen.getByTestId("checkout-pix")).toHaveAttribute("aria-label", "PIX — não configurado");
    screen.getByTestId("checkout-pix").click();
    expect(onPix).not.toHaveBeenCalled();
  });

  it("routes card PaymentIntents to card RPCs, not process_pix_sale", async () => {
    const rpc = mockAdminRpc(() => ({ data: {}, error: null }), { data: null, error: null });

    await applyStripeWebhookEventBranched({
      id: "evt_card_ok",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_card_1", payment_method_types: ["card"] } },
    });

    const names = rpc.mock.calls.map((call) => call[0]);
    expect(names).toContain("apply_card_provider_event");
    expect(names).not.toContain("apply_pix_provider_event");
    expect(names).not.toContain("process_pix_sale");
  });
});
