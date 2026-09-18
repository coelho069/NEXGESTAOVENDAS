import Link from "next/link";
import { Check, MessageCircle } from "lucide-react";
import {
  SUBSCRIPTION_BILLING_INTERVAL_LABELS,
  type SubscriptionBillingInterval,
} from "@/lib/domain/admin-subscriptions";
import type { PublicPlanRecord } from "@/lib/domain/public-plans";
import { getAssinaturasWhatsAppUrl } from "@/lib/assinaturas/whatsapp";
import { formatBRL } from "@/lib/money";
import { SubscribePlanButton } from "@/components/marketing/subscribe-plan-button";

const FAQ_ITEMS = [
  {
    question: "O PDV funciona offline?",
    answer:
      "Sim. O Nex Gestão Vendas é local-first: vendas em dinheiro podem ser registradas offline e sincronizadas quando a conexão voltar.",
  },
  {
    question: "Quais formas de pagamento estão disponíveis?",
    answer:
      "No MVP atual o PDV processa vendas em dinheiro. Cartão, PIX e outros meios serão habilitados conforme a configuração da sua assinatura.",
  },
  {
    question: "Como contrato um plano?",
    answer:
      "Escolha o plano abaixo e fale conosco pelo WhatsApp. Nossa equipe orienta a ativação da sua loja e usuários.",
  },
] as const;

const SOCIAL_PROOF_METRICS = [
  { value: "X", label: "lojas" },
  { value: "Y", label: "vendas/dia" },
  { value: "segundos", label: "sync" },
] as const;

const PROBLEM_SOLUTION_PAIRS = [
  {
    problem: "Caixa lento",
    solution: "Hotkeys de balcão — finalize vendas com F12 sem perder ritmo.",
  },
  {
    problem: "Estoque errado",
    solution: "StockMap em tempo real — saiba o que tem antes de prometer ao cliente.",
  },
  {
    problem: "Histórico perdido",
    solution: "Sync automático — sem F5, sem planilha, sem surpresa no fechamento.",
  },
] as const;

type TierPosition = "entry" | "middle" | "enterprise";

const TIER_DISPLAY_LABELS: Record<TierPosition, string> = {
  entry: "Essencial",
  middle: "Crescimento",
  enterprise: "Escala",
};

const TIER_FEATURES: Record<TierPosition, readonly string[]> = {
  entry: [
    "PDV offline-first com sync automático",
    "Controle de estoque auditado",
    "Cadastro de clientes",
    "1 loja",
  ],
  middle: [
    "Tudo do Essencial",
    "Hotkeys de caixa (F12 finalizar)",
    "StockMap em tempo real",
    "Até 3 lojas",
  ],
  enterprise: [
    "Tudo do Crescimento",
    "Dashboard e relatórios",
    "Importação CSV de estoque",
    "Lojas ilimitadas",
  ],
};

const THIN_DESCRIPTION_MAX_LENGTH = 40;

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
): { position: TierPosition | null; displayLabel: string; isPopular: boolean } {
  if (total === 1) {
    return { position: "entry", displayLabel: TIER_DISPLAY_LABELS.entry, isPopular: false };
  }
  if (total === 2) {
    if (index === 0) {
      return { position: "entry", displayLabel: TIER_DISPLAY_LABELS.entry, isPopular: false };
    }
    return { position: "enterprise", displayLabel: TIER_DISPLAY_LABELS.enterprise, isPopular: false };
  }
  if (index === 0) {
    return { position: "entry", displayLabel: TIER_DISPLAY_LABELS.entry, isPopular: false };
  }
  if (index === total - 1) {
    return { position: "enterprise", displayLabel: TIER_DISPLAY_LABELS.enterprise, isPopular: false };
  }
  if (index === Math.floor(total / 2)) {
    return { position: "middle", displayLabel: TIER_DISPLAY_LABELS.middle, isPopular: true };
  }
  return { position: null, displayLabel: "", isPopular: false };
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
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 ${className}`.trim()}
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
        <li key={feature} className="flex items-start gap-2 text-sm leading-relaxed text-slate-600">
          <Check size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
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
  const displayName = tierMeta.displayLabel || plan.name;
  const planWhatsAppUrl = getAssinaturasWhatsAppUrl(displayName);
  const showTierFeatures = tierMeta.position !== null && isThinDescription(plan.description);

  return (
    <article
      className={`relative flex h-full flex-col rounded-2xl border bg-white p-6 shadow-sm ${
        tierMeta.isPopular
          ? "z-10 scale-[1.03] border-emerald-500 shadow-md ring-1 ring-emerald-500/30"
          : "border-slate-200"
      }`}
    >
      {tierMeta.isPopular ? (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
          Mais Popular
        </span>
      ) : null}
      <h3 className="text-xl font-bold text-slate-900">{displayName}</h3>
      <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-700">
        {formatPlanPrice(plan.amount, plan.billingInterval)}
      </p>
      {showTierFeatures && tierMeta.position ? (
        <FeatureList features={TIER_FEATURES[tierMeta.position]} />
      ) : plan.description ? (
        <p className="mt-4 flex-1 text-sm leading-relaxed text-slate-600">{plan.description}</p>
      ) : (
        <p className="mt-4 flex-1 text-sm text-slate-400">Plano PDV Nex Gestão Vendas.</p>
      )}
      <div className="mt-6 flex flex-col gap-3">
        <SubscribePlanButton
          planId={plan.id}
          planLabel={displayName}
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
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-12 bg-[var(--background)] p-6 pb-16 text-slate-900">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Nex Gestão Vendas</p>
        <nav className="flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Entrar
          </Link>
          <Link
            href={pdvHref}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              isAuthenticated
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
            }`}
          >
            Abrir PDV
          </Link>
        </nav>
      </header>

      <section className="flex flex-col gap-6">
        <div>
          <h1 className="text-balance text-4xl font-bold tracking-tight text-slate-900">
            Pare de perder venda no caixa.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-600">
            PDV offline-first, estoque e clientes num só lugar — do celular à loja.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {whatsAppConfigured && heroWhatsAppUrl ? (
            <WhatsAppCta href={heroWhatsAppUrl} label="Falar no WhatsApp" />
          ) : (
            <span
              aria-disabled="true"
              className="inline-flex cursor-not-allowed items-center rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-400"
            >
              Em breve
            </span>
          )}
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Entrar
          </Link>
        </div>
      </section>

      <section
        aria-label="Prova social"
        className="grid gap-4 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-5 sm:grid-cols-3"
      >
        {SOCIAL_PROOF_METRICS.map((metric, index) => (
          <div
            key={metric.label}
            className={`text-center ${index > 0 ? "sm:border-l sm:border-slate-200 sm:pl-4" : ""}`}
          >
            <p className="text-2xl font-bold tabular-nums text-slate-900">{metric.value}</p>
            <p className="mt-1 text-sm text-slate-500">{metric.label}</p>
          </div>
        ))}
        <p className="col-span-full text-center text-xs text-slate-400">
          Métricas ilustrativas — placeholders até dados reais de operação.
        </p>
      </section>

      <section aria-labelledby="problem-solution-heading" className="flex flex-col gap-6">
        <div>
          <h2 id="problem-solution-heading" className="text-2xl font-bold text-slate-900">
            Do problema à solução
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            O que trava o caixa hoje — e como o Nex resolve na prática.
          </p>
        </div>
        <ul className="grid gap-4 md:grid-cols-3">
          {PROBLEM_SOLUTION_PAIRS.map((pair) => (
            <li
              key={pair.problem}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <p className="text-sm font-semibold uppercase tracking-wide text-rose-600">
                {pair.problem}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-slate-700">{pair.solution}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="plans-heading" className="flex flex-col gap-6">
        <div>
          <h2 id="plans-heading" className="text-2xl font-bold text-slate-900">
            Planos disponíveis
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Valores em reais (BRL). Entre em contato para ativar sua assinatura.
          </p>
        </div>

        {loadError ? (
          <div
            role="alert"
            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
          >
            Não foi possível carregar os planos no momento. Tente novamente em instantes.
          </div>
        ) : sortedPlans.length === 0 ? (
          <div
            role="status"
            className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-10 text-center"
          >
            <p className="font-semibold text-slate-900">Nenhum plano disponível no momento</p>
            <p className="mt-2 text-sm text-slate-600">
              Novos planos serão publicados em breve. Use o WhatsApp ou entre em contato para saber mais.
            </p>
          </div>
        ) : (
          <>
            <ul className="grid items-center gap-6 md:grid-cols-2 lg:grid-cols-3">
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
            <p className="text-center text-sm font-medium text-slate-600">
              {checkoutEnabled
                ? "Assine online com Mercado Pago ou fale conosco pelo WhatsApp."
                : "Fale no WhatsApp — checkout online em breve."}
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="faq-heading" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 id="faq-heading" className="text-xl font-bold text-slate-900">
          Perguntas frequentes
        </h2>
        <dl className="mt-6 space-y-6">
          {FAQ_ITEMS.map((item) => (
            <div key={item.question}>
              <dt className="font-semibold text-slate-900">{item.question}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-slate-600">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
