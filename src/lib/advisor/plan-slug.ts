import { resolveStripePriceIdForSlug } from "@/lib/domain/onboarding-stripe";

// ---------------------------------------------------------------------------
// Ponte JEV → assinatura (Stripe-only).
//
// O JEV é motor de análise (PDV Advisor) e pode apontar um plan_slug como
// resultado da análise. Ele NÃO processa pagamento, NÃO substitui o Stripe e
// NÃO chama Mercado Pago. Esta ponte apenas converte o plan_slug sugerido
// pelo JEV no Stripe Price do servidor:
//
//   JEV → plan_slug → Nex Gestão → STRIPE_PRICE_PLAN_<SLUG> → Stripe Checkout
//
// Sem mapeamento → null: a UI não oferece checkout (nunca há fallback MP).
// ---------------------------------------------------------------------------

const PLAN_SLUG_PATTERN = /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/;

/** Valida um plan_slug no formato do catálogo (lowercase, hífen). */
export function isStripePlanSlug(slug: string | null | undefined): boolean {
  if (!slug) return false;
  return PLAN_SLUG_PATTERN.test(slug.trim());
}

/** Normaliza o plan_slug retornado pelo JEV (trim; case é responsabilidade do env key). */
export function toJevPlanSlug(slug: string): string {
  return slug.trim();
}

/**
 * Resolve o Stripe Price do servidor para um plan_slug vindo do JEV ou do
 * fluxo de assinatura. Nunca expõe o Price id ao frontend antes do checkout:
 * quem consome este valor é a rota server-side de checkout.
 */
export function resolveStripePriceForPlanSlug(
  slug: string | null | undefined,
  envSource: Record<string, string | undefined> = process.env
): string | null {
  if (!isStripePlanSlug(slug)) return null;
  return resolveStripePriceIdForSlug(slug as string, envSource);
}
