import Link from "next/link";
import { Check, MessageCircle, Minus } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import {
  BENEFITS,
  COMPARISON_CRITERIA,
  DEMO_MOCKS,
  FAQ_ITEMS,
  FEATURES,
  HERO,
  HOW_IT_WORKS_STEPS,
  NAV_LINKS,
  PROBLEM_INTRO,
  PROBLEM_ITEMS,
  SOLUTION_INTRO,
  TIER_COMPARISON,
  TIER_FALLBACK_FEATURES,
} from "@/components/marketing/marketing-content";
import { MarketingDemoMock, MarketingHeroVisual } from "@/components/marketing/marketing-visual-mocks";
import { SubscribePlanButton } from "@/components/marketing/subscribe-plan-button";
import {
  SUBSCRIPTION_BILLING_INTERVAL_LABELS,
  type SubscriptionBillingInterval,
} from "@/lib/domain/admin-subscriptions";
import type { PublicPlanRecord } from "@/lib/domain/public-plans";
import { getAssinaturasWhatsAppUrl } from "@/lib/assinaturas/whatsapp";
import { formatBRL } from "@/lib/money";

const THIN_DESCRIPTION_MAX_LENGTH = 40;

type TierPosition = "entry" | "middle" | "enterprise";

function parsePlanAmount(amount: string): number {
  const normalized = amount.replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortPlansByPrice(plans: PublicPlanRecord[]): PublicPlanRecord[] {
  return [...plans].sort((left, right) => parsePlanAmount(left.amount) - parsePlanAmount(right.amount));
}

function resolveTierMeta(
  index: number,
  total: number
): { position: TierPosition | null; isPopular: boolean } {
  if (total === 1) {
    return { position: "entry", isPopular: false };
  }
  if (total === 2) {
    return index === 0
      ? { position: "entry", isPopular: false }
      : { position: "enterprise", isPopular: false };
  }
  if (index === 0) {
    return { position: "entry", isPopular: false };
  }
  if (index === total - 1) {
    return { position: "enterprise", isPopular: false };
  }
  if (index === Math.floor(total / 2)) {
    return { position: "middle", isPopular: true };
  }
  return { position: null, isPopular: false };
}

function isThinDescription(description: string): boolean {
  const trimmed = description.trim();
  return trimmed.length === 0 || trimmed.length <= THIN_DESCRIPTION_MAX_LENGTH;
}

function formatPlanPrice(amount: string, interval: SubscriptionBillingInterval): string {
  const period = SUBSCRIPTION_BILLING_INTERVAL_LABELS[interval].toLowerCase();
  return `${formatBRL(amount)} / ${period}`;
}

function WhatsAppCta({
  href,
  label,
  className = "",
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--success)] px-4 py-2.5 text-sm font-semibold text-[var(--success-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 ${className}`.trim()}
    >
      <MessageCircle size={18} aria-hidden="true" />
      {label}
    </a>
  );
}

function FeatureList({ features }: { features: readonly string[] }) {
  return (
    <ul className="mt-4 flex-1 space-y-2">
      {features.map((feature) => (
        <li key={feature} className="flex items-start gap-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
          <Check size={16} className="mt-0.5 shrink-0 text-[var(--success)]" aria-hidden="true" />
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  );
}

function PlanCard({
  plan,
  tierMeta,
  whatsAppConfigured,
  checkoutEnabled,
  isAuthenticated,
}: {
  plan: PublicPlanRecord;
  tierMeta: ReturnType<typeof resolveTierMeta>;
  whatsAppConfigured: boolean;
  checkoutEnabled: boolean;
  isAuthenticated: boolean;
}) {
  const planWhatsAppUrl = getAssinaturasWhatsAppUrl(plan.name);
  const showTierFeatures = tierMeta.position !== null && isThinDescription(plan.description);

  return (
    <article
      className={`relative flex h-full flex-col rounded-[var(--radius-card)] border bg-[var(--card)] p-6 shadow-sm ${
        tierMeta.isPopular
          ? "z-10 scale-[1.02] border-[var(--primary)] shadow-md ring-1 ring-[var(--primary)]/30 md:scale-[1.03]"
          : "border-[var(--border)]"
      }`}
    >
      {tierMeta.isPopular ? (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[var(--primary)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--primary-foreground)]">
          Mais Popular
        </span>
      ) : null}
      <h3 className="text-xl font-bold text-[var(--foreground)]">{plan.name}</h3>
      <p className="mt-2 text-2xl font-bold tabular-nums text-[var(--primary)]">
        {formatPlanPrice(plan.amount, plan.billingInterval)}
      </p>
      {showTierFeatures && tierMeta.position ? (
        <FeatureList features={TIER_FALLBACK_FEATURES[tierMeta.position]} />
      ) : plan.description ? (
        <p className="mt-4 flex-1 text-sm leading-relaxed text-[var(--muted-foreground)]">{plan.description}</p>
      ) : (
        <p className="mt-4 flex-1 text-sm text-[var(--muted-foreground)]">Plano PDV Nex Gestão Vendas.</p>
      )}
      <div className="mt-6 flex flex-col gap-3">
        <SubscribePlanButton
          planId={plan.id}
          planLabel={plan.name}
          checkoutEnabled={checkoutEnabled}
          isAuthenticated={isAuthenticated}
        />
        {whatsAppConfigured && planWhatsAppUrl ? (
          <WhatsAppCta href={planWhatsAppUrl} label="Contratar via WhatsApp" className="w-full" />
        ) : null}
      </div>
    </article>
  );
}

function ComparisonCell({ included }: { included: boolean }) {
  if (included) {
    return (
      <span className="inline-flex items-center justify-center text-[var(--success)]" aria-label="Incluído">
        <Check size={18} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center text-[var(--muted-foreground)]" aria-label="Não incluído">
      <Minus size={18} aria-hidden="true" />
    </span>
  );
}

function PlansComparisonTable({ sortedPlans }: { sortedPlans: PublicPlanRecord[] }) {
  if (sortedPlans.length < 2) {
    return null;
  }

  const tierColumns = sortedPlans.map((plan, index) => ({
    plan,
    meta: resolveTierMeta(index, sortedPlans.length),
  }));

  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)]">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">Comparação de planos Nex Gestão Vendas</caption>
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th scope="col" className="px-4 py-3 font-semibold text-[var(--foreground)]">
              Recurso
            </th>
            {tierColumns.map(({ plan }) => (
              <th key={plan.id} scope="col" className="px-4 py-3 text-center font-semibold text-[var(--foreground)]">
                {plan.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARISON_CRITERIA.map((criterion) => (
            <tr key={criterion.key} className="border-b border-[var(--border)] last:border-b-0">
              <th scope="row" className="px-4 py-3 font-medium text-[var(--muted-foreground)]">
                {criterion.label}
              </th>
              {tierColumns.map(({ plan, meta }) => (
                <td key={`${plan.id}-${criterion.key}`} className="px-4 py-3 text-center">
                  <ComparisonCell
                    included={meta.position ? TIER_COMPARISON[meta.position][criterion.key] : false}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted-foreground)]">
        Comparação qualitativa com base nos planos publicados. Detalhes contratuais podem variar.
      </p>
    </div>
  );
}

function MarketingFooter({ isAuthenticated, pdvHref }: { isAuthenticated: boolean; pdvHref: string }) {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--card)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--foreground)]">Nex Gestão Vendas</p>
            <p className="mt-2 max-w-sm text-sm text-[var(--muted-foreground)]">
              Sistema de gestão, vendas e estoque para varejo brasileiro.
            </p>
          </div>
          <nav aria-label="Rodapé" className="flex flex-wrap gap-x-6 gap-y-2">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                {link.label}
              </a>
            ))}
            {isAuthenticated ? (
              <Link href={pdvHref} className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                Abrir PDV
              </Link>
            ) : (
              <Link href="/login" className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                Entrar
              </Link>
            )}
          </nav>
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">
          © {new Date().getFullYear()} Nex Gestão Vendas. Todos os direitos reservados.
        </p>
      </div>
    </footer>
  );
}

export function PlansSalesPage({
  plans,
  loadError,
  isAuthenticated,
  checkoutEnabled = false,
  pdvHref = "/pdv",
}: {
  plans: PublicPlanRecord[];
  loadError: string | null;
  isAuthenticated: boolean;
  checkoutEnabled?: boolean;
  pdvHref?: string;
}) {
  const heroWhatsAppUrl = getAssinaturasWhatsAppUrl();
  const whatsAppConfigured = heroWhatsAppUrl !== null;
  const sortedPlans = sortPlansByPrice(plans);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <MarketingHeader isAuthenticated={isAuthenticated} pdvHref={pdvHref} />

      <main>
        <section id="inicio" className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-12">
            <div>
              <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl lg:text-[2.5rem] lg:leading-tight">
                {HERO.title}
              </h1>
              <p className="mt-4 max-w-xl text-lg text-[var(--muted-foreground)]">{HERO.subtitle}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="#planos"
                  className="inline-flex items-center justify-center rounded-[var(--radius)] bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2"
                >
                  Começar agora
                </a>
                <a
                  href="#recursos"
                  className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2"
                >
                  Conhecer recursos
                </a>
              </div>
              {whatsAppConfigured && heroWhatsAppUrl ? (
                <p className="mt-4 text-sm text-[var(--muted-foreground)]">
                  Prefere falar com alguém?{" "}
                  <a href={heroWhatsAppUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--success)] hover:underline">
                    WhatsApp
                  </a>
                </p>
              ) : null}
            </div>
            <MarketingHeroVisual />
          </div>
        </section>

        <section aria-labelledby="problem-heading" className="border-y border-[var(--border)] bg-[var(--card)]">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
            <div className="max-w-2xl">
              <h2 id="problem-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
                {PROBLEM_INTRO.title}
              </h2>
              <p className="mt-3 text-[var(--muted-foreground)]">{PROBLEM_INTRO.subtitle}</p>
            </div>
            <ul className="mt-8 grid gap-4 md:grid-cols-3">
              {PROBLEM_ITEMS.map((item) => (
                <li
                  key={item.problem}
                  className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--background)] p-5"
                >
                  <p className="text-sm font-semibold text-[var(--destructive)]">{item.problem}</p>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">{item.detail}</p>
                </li>
              ))}
            </ul>
            <div className="mt-10 rounded-[var(--radius-card)] border border-[var(--primary)]/20 bg-[var(--primary)]/5 p-6">
              <h3 className="text-lg font-semibold text-[var(--foreground)]">{SOLUTION_INTRO.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">{SOLUTION_INTRO.subtitle}</p>
            </div>
          </div>
        </section>

        <section id="recursos" aria-labelledby="features-heading" className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="max-w-2xl">
            <h2 id="features-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Recursos pensados para o varejo
            </h2>
            <p className="mt-3 text-[var(--muted-foreground)]">
              Funcionalidades reais do Nex Gestão Vendas — sem promessas vazias.
            </p>
          </div>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <li
                key={feature.title}
                className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm"
              >
                <h3 className="font-semibold text-[var(--foreground)]">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">{feature.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="how-it-works-heading" className="border-y border-[var(--border)] bg-[var(--card)]">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
            <h2 id="how-it-works-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Como funciona
            </h2>
            <p className="mt-3 max-w-2xl text-[var(--muted-foreground)]">
              Três passos para colocar vendas, estoque e resultados na mesma plataforma.
            </p>
            <ol className="mt-8 grid gap-6 md:grid-cols-3">
              {HOW_IT_WORKS_STEPS.map((step) => (
                <li key={step.step} className="relative rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--background)] p-5">
                  <span className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--primary)] text-sm font-bold text-[var(--primary-foreground)]">
                    {step.step}
                  </span>
                  <h3 className="mt-4 font-semibold text-[var(--foreground)]">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">{step.description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="beneficios" aria-labelledby="benefits-heading" className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 id="benefits-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
            Benefícios para sua operação
          </h2>
          <p className="mt-3 max-w-2xl text-[var(--muted-foreground)]">
            Ganhos práticos no dia a dia — sem promessas financeiras exageradas.
          </p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {BENEFITS.map((benefit) => (
              <li
                key={benefit.title}
                className="flex gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5"
              >
                <Check size={20} className="mt-0.5 shrink-0 text-[var(--success)]" aria-hidden="true" />
                <div>
                  <h3 className="font-semibold text-[var(--foreground)]">{benefit.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--muted-foreground)]">{benefit.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="demo-heading" className="border-y border-[var(--border)] bg-[var(--card)]">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
            <h2 id="demo-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Veja o sistema em ação
            </h2>
            <p className="mt-3 max-w-2xl text-[var(--muted-foreground)]">
              Representações visuais das áreas principais — baseadas nos módulos reais do produto.
            </p>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {DEMO_MOCKS.map((mock) => (
                <li key={mock.id}>
                  <MarketingDemoMock variant={mock.id} title={mock.title} />
                  <p className="mt-2 text-center text-sm font-medium text-[var(--foreground)]">{mock.title}</p>
                  <p className="text-center text-xs text-[var(--muted-foreground)]">{mock.caption}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="planos" aria-labelledby="plans-heading" className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="max-w-2xl">
            <h2 id="plans-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Escolha o plano ideal para sua loja
            </h2>
            <p className="mt-3 text-[var(--muted-foreground)]">
              Valores em reais (BRL). Assine online quando disponível ou fale conosco pelo WhatsApp.
            </p>
          </div>

          {loadError ? (
            <div
              role="alert"
              className="mt-8 rounded-[var(--radius-card)] border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 px-4 py-3 text-sm text-[var(--destructive)]"
            >
              Não foi possível carregar os planos no momento. Tente novamente em instantes.
            </div>
          ) : sortedPlans.length === 0 ? (
            <div
              role="status"
              className="mt-8 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] px-6 py-10 text-center"
            >
              <p className="font-semibold text-[var(--foreground)]">Nenhum plano disponível no momento</p>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                Novos planos serão publicados em breve. Use o WhatsApp ou entre em contato para saber mais.
              </p>
            </div>
          ) : (
            <>
              <ul className="mt-8 grid items-center gap-6 md:grid-cols-2 lg:grid-cols-3">
                {sortedPlans.map((plan, index) => (
                  <li key={plan.id} className="h-full">
                    <PlanCard
                      plan={plan}
                      tierMeta={resolveTierMeta(index, sortedPlans.length)}
                      whatsAppConfigured={whatsAppConfigured}
                      checkoutEnabled={checkoutEnabled}
                      isAuthenticated={isAuthenticated}
                    />
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-center text-sm font-medium text-[var(--muted-foreground)]">
                {checkoutEnabled
                  ? "Assine online com Mercado Pago ou fale conosco pelo WhatsApp."
                  : whatsAppConfigured
                    ? "Fale no WhatsApp — checkout online em breve."
                    : "Checkout online em breve."}
              </p>
              <div className="mt-10">
                <h3 className="text-lg font-semibold text-[var(--foreground)]">Comparação de planos</h3>
                <div className="mt-4">
                  <PlansComparisonTable sortedPlans={sortedPlans} />
                </div>
              </div>
            </>
          )}
        </section>

        <section id="faq" aria-labelledby="faq-heading" className="border-t border-[var(--border)] bg-[var(--card)]">
          <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
            <h2 id="faq-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Perguntas frequentes
            </h2>
            <dl className="mt-8 space-y-6">
              {FAQ_ITEMS.map((item) => (
                <div key={item.question} className="border-b border-[var(--border)] pb-6 last:border-b-0">
                  <dt className="font-semibold text-[var(--foreground)]">{item.question}</dt>
                  <dd className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">{item.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="final-cta-heading" className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--card)] px-6 py-10 text-center shadow-sm sm:px-10">
            <h2 id="final-cta-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Pronto para organizar vendas e estoque?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-[var(--muted-foreground)]">
              Escolha um plano e comece a operar com PDV, inventário auditado e dashboard integrados.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href="#planos"
                className="inline-flex items-center justify-center rounded-[var(--radius)] bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2"
              >
                Começar agora
              </a>
              {isAuthenticated ? (
                <Link
                  href={pdvHref}
                  className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--background)]"
                >
                  Abrir PDV
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--background)]"
                >
                  Entrar
                </Link>
              )}
              {whatsAppConfigured && heroWhatsAppUrl ? (
                <WhatsAppCta href={heroWhatsAppUrl} label="Falar no WhatsApp" />
              ) : null}
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter isAuthenticated={isAuthenticated} pdvHref={pdvHref} />
    </div>
  );
}
