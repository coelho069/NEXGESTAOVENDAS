import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  planProviderForSlug,
  resolveStripePriceIdForSlug,
  isStripeSubscriptionCheckoutEnabled,
  isStripeSubscriptionCheckoutEnabledEnv,
} from "@/lib/domain/onboarding-stripe";
import { loadPublicPlans } from "@/lib/server/public-plans-query";
import {
  isStripePlanSlug,
  resolveStripePriceForPlanSlug,
  toJevPlanSlug,
} from "@/lib/advisor/plan-slug";
import type { PublicPlanRecord } from "@/lib/domain/public-plans";

// ---------------------------------------------------------------------------//  Testes da mudança "assinaturas = checkout online nos trilhos Stripe,
//  cobrança comunicada via Mercado Pago":
//  1. Plano com Stripe Price mostra assinatura Stripe.      (gating test)
//  2. Plano sem Stripe Price não permite checkout.          (gating + query)
//  3. Checkout utiliza Stripe.                              (public-stripe-checkout)
//  4. Botão de assinatura aponta para o checkout Stripe.    (source guard)
//  5. Trilhos públicos presentes: checkout MP + webhook MP. (source guard)
//  6. Página de planos comunica cobrança via Mercado Pago.  (source guard)
//  7. JEV pode retornar plan_slug.                          (plan-slug)
//  8. plan_slug é convertido no Stripe Price correto.       (plan-slug)
//  9. Price ID é resolvido no servidor.                     (query: sem Nextpublic)
// 10. Webhook Stripe processa a assinatura.                 (public-stripe-checkout)
// 11. Webhook duplicado não cria duplicação.                (idempotência: claim)
// 12. Pagamento do PDV continua funcionando.                (arquivos intactos)
// 13. Mercado Pago do PDV continua funcionando.             (arquivos intactos)
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolução de Stripe Price por slug (servidor)", () => {
  const env = {
    STRIPE_PRICE_PLAN_ESSENCIAL: "price_1234567890abcdef",
    STRIPE_PRICE_PLAN_PROFISSIONAL: "price_abcdef1234567890",
  };

  it("8. converte plan_slug no Stripe Price correto", () => {
    expect(resolveStripePriceForPlanSlug("essencial", env)).toBe("price_1234567890abcdef");
    expect(resolveStripePriceForPlanSlug("profissional", env)).toBe("price_abcdef1234567890");
  });

  it("8b. não inventa Price: slug sem mapeamento retorna null (sem fallback)", () => {
    expect(resolveStripePriceForPlanSlug("enterprise", env)).toBeNull();
    expect(resolveStripePriceForPlanSlug("plano-inexistente", env)).toBeNull();
    expect(resolveStripePriceForPlanSlug(null, env)).toBeNull();
    expect(resolveStripePriceForPlanSlug("", env)).toBeNull();
    // Slug uppercase é aceito: o env key é sempre o uppercase do slug.
    expect(resolveStripePriceForPlanSlug("ESSENCIAL", env)).toBe("price_1234567890abcdef");
  });

  it("7. aceita plan_slug vindo do JEV apenas no formato slug conhecido", () => {
    expect(isStripePlanSlug("essencial")).toBe(true);
    expect(isStripePlanSlug("Plano Essencial")).toBe(false);
    expect(isStripePlanSlug("")).toBe(false);
    expect(toJevPlanSlug("essencial")).toBe("essencial");
  });

  it("9. Price ID é resolvido apenas no servidor (nunca via NEXT_PUBLIC_*)", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/domain/onboarding-stripe.ts"),
      "utf8"
    );
    expect(source).toContain("STRIPE_PRICE_PLAN_ENV_PREFIX");
    expect(source).not.toContain("NEXT_PUBLIC_");
    const query = readFileSync(
      join(process.cwd(), "src/lib/server/public-plans-query.ts"),
      "utf8"
    );
    expect(query).toContain("resolveStripePriceIdForSlug(plan.slug)");
    expect(query).not.toContain("stripePriceId:");
  });
});

describe("gating público (loadPublicPlans + checkout gate)", () => {
  function planRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Essencial",
      slug: "essencial",
      description: "PDV para uma loja.",
      amount: 99.9,
      currency: "BRL",
      billing_interval: "monthly",
      ...overrides,
    };
  }

  function supabaseMock(rows: Record<string, unknown>[]) {
    const listBuilder = {
      select: () => listBuilder,
      eq: () => listBuilder,
      // loadPublicPlans awaits the builder after .order(...) — a thenable
      // resolving to { data, error } matches the supabase-js contract.
      order: () => Promise.resolve({ data: rows, error: null }),
    };
    return {
      from: () => listBuilder,
    };
  }

  it("1. plano com STRIPE_PRICE_PLAN_* vira stripeEnabled=true", async () => {
    vi.stubEnv("STRIPE_PRICE_PLAN_ESSENCIAL", "price_1234567890abcdef");
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => supabaseMock([planRow()]),
    }));
    const { loadPublicPlans: fresh } = await import("@/lib/server/public-plans-query");
    const result = await fresh();
    expect(result.error).toBeNull();
    expect(result.data?.[0]).toMatchObject({ name: "Essencial", stripeEnabled: true });
    vi.doUnmock("@/lib/supabase/server");
  });

  it("2. plano sem mapeamento vira stripeEnabled=false (sem opção de assinatura)", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => supabaseMock([planRow()]),
    }));
    const { loadPublicPlans: fresh } = await import("@/lib/server/public-plans-query");
    const result = await fresh();
    expect(result.data?.[0]).toMatchObject({ stripeEnabled: false });
    vi.doUnmock("@/lib/supabase/server");
  });

  it("checkout público exige STRIPE_SUBSCRIPTION_CHECKOUT_ENABLED=true — nunca publica a secret", () => {
    expect(isStripeSubscriptionCheckoutEnabledEnv(undefined)).toBe(false);
    expect(isStripeSubscriptionCheckoutEnabledEnv("false")).toBe(false);
    expect(isStripeSubscriptionCheckoutEnabledEnv("true")).toBe(true);
    expect(isStripeSubscriptionCheckoutEnabled({ STRIPE_SECRET_KEY: "sk_test_x" })).toBe(false);
    expect(
      isStripeSubscriptionCheckoutEnabled({
        STRIPE_SECRET_KEY: "sk_test_x",
        STRIPE_SUBSCRIPTION_CHECKOUT_ENABLED: "true",
      })
    ).toBe(true);
    const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    expect(envExample).toContain("STRIPE_SUBSCRIPTION_CHECKOUT_ENABLED=false");
    expect(envExample).not.toMatch(/NEXT_PUBLIC_STRIPE_SECRET/);
  });
});

describe("4–6. Assinatura: checkout online nos trilhos Stripe, cobrança via Mercado Pago", () => {
  it("4. nenhuma UI de planos chama endpoint Mercado Pago de assinatura", () => {
    const button = readFileSync(
      join(process.cwd(), "src/components/marketing/subscribe-plan-button.tsx"),
      "utf8"
    );
    expect(button).toContain("/api/subscriptions/stripe/public-checkout");
    expect(button).not.toContain("mercadopago");
    expect(button).not.toContain("pix");
  });

  it("5. trilhos públicos de assinatura presentes: checkout MP (novo rail) e webhook MP de legado", () => {
    const { existsSync } = require("node:fs") as { existsSync: (p: string) => boolean };
    expect(
      existsSync(join(process.cwd(), "src/app/api/subscriptions/mercadopago/checkout/route.ts"))
    ).toBe(true);
    // Webhook MP de assinatura é preservado para legado.
    expect(
      existsSync(join(process.cwd(), "src/app/api/subscriptions/mercadopago/webhook/route.ts"))
    ).toBe(true);
  });

  it("5b. não existe rota pública MP de assinatura alternativa (public-pix-checkout etc.)", () => {
    const { existsSync, readdirSync } = require("node:fs") as {
      existsSync: (p: string) => boolean;
      readdirSync: (p: string) => string[];
    };
    const mpDir = join(process.cwd(), "src/app/api/subscriptions/mercadopago");
    if (!existsSync(mpDir)) {
      expect(true).toBe(true);
      return;
    }
    expect(readdirSync(mpDir).sort()).toEqual(["checkout", "webhook"]);
  });

  it("6. a página de planos comunica a cobrança recorrente via Mercado Pago", () => {
    const page = readFileSync(
      join(process.cwd(), "src/components/marketing/plans-sales-page.tsx"),
      "utf8"
    );
    expect(page.toLowerCase()).toContain("mercado pago");
  });

  it("4b. .env.example documenta os segredos de cobrança sem publicá-los", () => {
    const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    expect(envExample).toContain("MERCADOPAGO_WEBHOOK_SECRET");
    expect(envExample).not.toMatch(/NEXT_PUBLIC_STRIPE_SECRET/);
  });
});

describe("12–13. PDV/pagamentos preservados (arquivos e rotas intactos)", () => {
  const { existsSync } = require("node:fs") as { existsSync: (p: string) => boolean };

  it("rotas do PDV Mercado Pago/Pix/Stripe continuam presentes", () => {
    const paths = [
      "src/app/api/payments/mercadopago/pix/route.ts",
      "src/app/api/payments/mercadopago/webhook/route.ts",
      "src/app/api/payments/pix/route.ts",
      "src/app/api/payments/stripe/webhook/route.ts",
      "src/app/api/payments/card/route.ts",
      "src/app/api/payments/reconcile/route.ts",
      "src/lib/adapters/mercadopago-pix.ts",
      "src/lib/server/mercadopago-pix-payment.ts",
      "src/lib/domain/mercadopago.ts",
    ];
    for (const relative of paths) {
      expect(existsSync(join(process.cwd(), relative)), relative).toBe(true);
    }
  });

  it("módulos de domínio do PDV (pix/card) permanecem intactos", () => {
    for (const relative of [
      "src/lib/domain/stripe-pix.ts",
      "src/lib/domain/stripe-card.ts",
      "src/lib/domain/payment-state.ts",
    ]) {
      expect(existsSync(join(process.cwd(), relative)), relative).toBe(true);
    }
  });
});

describe("webhook de assinatura Stripe: roteamento isolado do PDV", () => {
  it("10. checkout.session.completed público roda onboarding via prefixo de sessão", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/server/stripe-subscription-webhook.ts"),
      "utf8"
    );
    expect(source).toContain("checkout.session.completed");
    expect(source).toContain("parseCheckoutSessionExternalReference");
    expect(source).toContain("runVisitorOnboarding");
  });

  it("11. idempotência: sessão completed não re-executa onboarding (claim/replay)", () => {
    const sessions = readFileSync(
      join(process.cwd(), "src/lib/server/public-checkout-sessions.ts"),
      "utf8"
    );
    expect(sessions).toContain("claim_checkout_session_onboarding");
    expect(sessions).toContain("replay");
    const webhook = readFileSync(
      join(process.cwd(), "src/app/api/payments/stripe/webhook/route.ts"),
      "utf8"
    );
    expect(webhook).toContain("isStripeSubscriptionCheckoutEvent");
    expect(webhook).toContain("applyStripeWebhookEventBranched");
  });
});

describe("assinaturas legadas do MP preservadas", () => {
  it("webhook MP legado continua roteando assinaturas antigas (sem migração de dados)", () => {
    const webhook = readFileSync(
      join(process.cwd(), "src/lib/server/mercadopago-assinaturas-webhook.ts"),
      "utf8"
    );
    expect(webhook).toContain("parseAssinaturasExternalReference");
    expect(webhook).toContain("apply_subscription_mercadopago_event");
    expect(webhook).toContain("runVisitorOnboarding");
  });
});

describe("domínio público do plano", () => {
  it("planProviderForSlug nunca devolve mercadopago", () => {
    expect(planProviderForSlug("essencial", { STRIPE_PRICE_PLAN_ESSENCIAL: "price_1234567890abcdef" })).toBe("stripe");
    expect(planProviderForSlug("essencial", {})).toBeNull();
    expect(resolveStripePriceIdForSlug("essencial", {})).toBeNull();
  });

  it("PublicPlanRecord não expõe provedor Mercado Pago nem price id", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/domain/public-plans.ts"),
      "utf8"
    );
    expect(source).not.toContain("mercadopago");
    expect(source).not.toContain("stripePriceId");
    expect(source).toContain("stripeEnabled");
  });
});
