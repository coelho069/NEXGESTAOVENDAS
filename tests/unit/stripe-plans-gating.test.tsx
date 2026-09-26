import { afterEach, describe, expect, it } from "vitest";
import {
  isStripeSubscriptionCheckoutEnabled,
  isStripeSubscriptionCheckoutEnabledEnv,
  planProviderForSlug,
  resolveStripePriceIdForSlug,
} from "@/lib/domain/onboarding-stripe";
import { PlansSalesPage } from "@/components/marketing/plans-sales-page";
import { render, screen } from "@testing-library/react";
import type { PublicPlanRecord } from "@/lib/domain/public-plans";

function plan(overrides: Partial<PublicPlanRecord> = {}): PublicPlanRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Essencial",
    description: "PDV para uma loja.",
    amount: "99.90",
    currency: "BRL",
    billingInterval: "monthly",
    stripeEnabled: false,
    ...overrides,
  };
}

describe("Stripe subscription checkout flag (domain)", () => {
  it("requires explicit STRIPE_SUBSCRIPTION_CHECKOUT_ENABLED=true", () => {
    expect(isStripeSubscriptionCheckoutEnabledEnv(undefined)).toBe(false);
    expect(isStripeSubscriptionCheckoutEnabledEnv("false")).toBe(false);
    expect(isStripeSubscriptionCheckoutEnabledEnv("TRUE")).toBe(false);
    expect(isStripeSubscriptionCheckoutEnabledEnv("true")).toBe(true);
  });

  it("does not infer enablement from STRIPE_SECRET_KEY alone", () => {
    expect(
      isStripeSubscriptionCheckoutEnabled({
        STRIPE_SECRET_KEY: "sk_test_abc123",
      })
    ).toBe(false);
    expect(
      isStripeSubscriptionCheckoutEnabled({
        STRIPE_SECRET_KEY: "sk_test_abc123",
        STRIPE_SUBSCRIPTION_CHECKOUT_ENABLED: "true",
      })
    ).toBe(true);
  });
});

describe("Stripe plan mapping (domain)", () => {
  const env = { STRIPE_PRICE_PLAN_PIX: "price_1234567890abcdef", STRIPE_PRICE_PLAN_ESSENCIAL: "not-a-price" };

  it("maps a slug only when a valid STRIPE_PRICE_PLAN_* env exists", () => {
    expect(resolveStripePriceIdForSlug("pix", env)).toBe("price_1234567890abcdef");
    expect(planProviderForSlug("pix", env)).toBe("stripe");
  });

  it("never maps invalid or missing values (no fallback)", () => {
    expect(resolveStripePriceIdForSlug("essencial", env)).toBeNull();
    expect(planProviderForSlug("essencial", env)).toBeNull();
    expect(planProviderForSlug("inexistente", env)).toBeNull();
    expect(planProviderForSlug(null, env)).toBeNull();
    expect(planProviderForSlug(undefined, env)).toBeNull();
    expect(planProviderForSlug("", env)).toBeNull();
  });

  it("treats slug case and separators via env key", () => {
    expect(resolveStripePriceIdForSlug("PIX", env)).toBe("price_1234567890abcdef");
  });
});

describe("PlansSalesPage stripe-only subscription gating", () => {
  afterEach(() => {
    // The repo has no global testing-library cleanup; without it the rendered
    // DOM accumulates across tests and role queries leak between cases.
    document.body.textContent = "";
  });

  function renderPage(plans: PublicPlanRecord[]) {
    render(
      <PlansSalesPage
        plans={plans}
        loadError={null}
        isAuthenticated={false}
        checkoutEnabled={true}
      />
    );
  }

  it("stripe plan shows the Stripe subscription option", () => {
    renderPage([plan({ stripeEnabled: true })]);
    expect(screen.getByRole("button", { name: /Assinar com Stripe/ })).toBeDefined();
  });

  it("mercado pago plan (stripeEnabled=false) shows no Stripe option and no subscription button", () => {
    renderPage([plan({ stripeEnabled: false })]);
    expect(screen.queryByRole("button", { name: /Stripe/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Começar agora/ })).toBeNull();
    expect(screen.getByText(/Indisponível para assinatura/)).toBeDefined();
  });

  it("plan without provider (stripeEnabled falsy/undefined) shows no Stripe option", () => {
    renderPage([plan({ stripeEnabled: undefined as unknown as boolean })]);
    expect(screen.queryByRole("button", { name: /Stripe/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Começar agora/ })).toBeNull();
  });

  it("Mercado Pago is announced as the billing provider on the plans page", () => {
    renderPage([plan({ stripeEnabled: true })]);
    expect(screen.getAllByText(/cobrança recorrente via Mercado Pago/i).length).toBeGreaterThan(0);
  });

  it("subscription disabled gate hides actionable buttons on all plans", () => {
    render(
      <PlansSalesPage
        plans={[plan({ stripeEnabled: true }), plan({ stripeEnabled: false })]}
        loadError={null}
        isAuthenticated={false}
        checkoutEnabled={false}
      />
    );
    document.body.textContent = ""; // cleanup within the test
    render(
      <PlansSalesPage
        plans={[plan({ stripeEnabled: true }), plan({ stripeEnabled: false })]}
        loadError={null}
        isAuthenticated={false}
        checkoutEnabled={false}
      />
    );
    expect(screen.queryByRole("button", { name: /Assinar com Stripe/ })).toBeNull();
    expect(screen.queryByText(/Indisponível para assinatura/)).toBeNull();
    expect(screen.getAllByText("Em breve").length).toBeGreaterThan(0);
  });
});
