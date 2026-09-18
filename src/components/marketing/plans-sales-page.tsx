import React from "react";
import Link from "next/link";
import {
  Check,
  MessageCircle,
  ArrowRight,
  Store,
  BarChart3,
  ClipboardList,
  Zap,
  Grid3X3,
} from "lucide-react";
import {
  SUBSCRIPTION_BILLING_INTERVAL_LABELS,
  type SubscriptionBillingInterval,
} from "@/lib/domain/admin-subscriptions";
import type { PublicPlanRecord } from "@/lib/domain/public-plans";
import { getAssinaturasWhatsAppUrl } from "@/lib/assinaturas/whatsapp";
import { formatBRL } from "@/lib/money";
import { SubscribePlanButton } from "@/components/marketing/subscribe-plan-button";

// ---------------------------------------------------------------------------
// Dados comerciais reais — espelhados do seed SQL e do negócio, não inventados
// ---------------------------------------------------------------------------

/** Limites por tier — derivados do seed SQL e TIER_FEATURES existentes. */
const TIER_LIMITS: Record<string, { label: string; value: string; icon: typeof Store }> = {
  Essencial: { label: "Lojas", value: "1", icon: Store },
  Profissional: { label: "Lojas", value: "Até 3", icon: Store },
  Enterprise: { label: "Lojas", value: "Ilimitadas", icon: Store },
};

/** Benefícios por tier — espelha TIER_FEATURES existente, sem inventar. */
const TIER_FEATURES: Record<string, readonly string[]> = {
  Essencial: [
    "PDV offline-first com sync automático",
    "Controle de estoque auditado",
    "Cadastro de clientes",
    "1 loja",
  ],
  Profissional: [
    "Tudo do Essencial",
    "Hotkeys de caixa (F12 finalizar)",
    "StockMap em tempo real",
    "Até 3 lojas",
  ],
  Enterprise: [
    "Tudo do Profissional",
    "Dashboard e relatórios",
    "Importação CSV de estoque",
    "Lojas ilimitadas",
  ],
};

const ORDERED_PLAN_NAMES = ["Essencial", "Profissional", "Enterprise"] as const;
type PlanName = (typeof ORDERED_PLAN_NAMES)[number];

const PLAN_DISPLAY_ORDER: Record<string, number> = {
  Essencial: 0,
  Profissional: 1,
  Enterprise: 2,
};

// ---------------------------------------------------------------------------
// FAQ — perguntas e respostas baseadas no que realmente existe no sistema
// ---------------------------------------------------------------------------

const FAQ_ITEMS = [
  {
    question: "Qual a diferença entre os planos?",
    answer:
      "A diferença principal está no número de lojas e nos recursos avançados. O Essencial é para uma única loja com PDV, estoque e clientes. O Profissional amplia para até 3 lojas e traz hotkeys de caixa e StockMap. O Enterprise remove limites de lojas e inclui dashboard com relatórios e importação CSV de estoque.",
  },
  {
    question: "Como funciona a cobrança?",
    answer:
      "A cobrança é recorrente via Mercado Pago — mensal ou anual, escolha o plano. O valor apareceu em reais (BRL) nas tarifas. Para assinar, entre em contato pelo WhatsApp ou use o checkout online quando disponível.",
  },
  {
    question: "O que está incluso em cada plano?",
    answer:
      "Todos os planos incluem PDV offline-first, controle de estoque auditado e cadastro de clientes. O Profissional adiciona hotkeys de caixa e StockMap. O Enterprise adiciona dashboard, relatórios e importação CSV de estoque, além de lojas ilimitadas.",
  },
  {
    question: "Existe período de teste?",
    answer: (
      <>
        O Nex Gestão Vendas oferece assinaturas em diferentes status, incluindo trialing. 
        Entre em contato pelo WhatsApp para saber se há condições de teste disponíveis para o seu caso.
      </>
    ),
  },
  {
    question: "Posso mudar de plano?",
    answer:
      "Sim. A gestão de planos é feita pelo administrador da plataforma. Se precisar migrar de plano, fale com o nosso time pelo WhatsApp que orienta a transição e o ajuste da sua assinatura.",
  },
  {
    question: "Posso cancelar?",
    answer:
      "Sim. A assinatura pode ser cancelada a qualquer momento. O cancelamento é registrado no sistema e o acesso ao PDV passa a seguir a política de assinatura vigente. Se tiver dúvidas sobre o encerramento, fale conosco pelo WhatsApp.",
  },
] as const;

// ---------------------------------------------------------------------------
// Componentes internos
// ---------------------------------------------------------------------------

type TierPosition = "entry" | "middle" | "enterprise";

const TIER_DISPLAY_LABELS: Record<TierPosition, string> = {
  entry: "Essencial",
  middle: "Profissional",
  enterprise: "Enterprise",
};

function planNameToTierPosition(name: string): TierPosition | null {
  const normalized = name.trim();
  if (normalized === "Essencial") return "entry";
  if (normalized === "Profissional") return "middle";
  if (normalized === "Enterprise") return "enterprise";
  return null;
}

function sortPlansByPrice(plans: PublicPlanRecord[]): PublicPlanRecord[] {
  const parseAmount = (amount: string): number => {
    const normalized = amount.replace(",", ".");
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return [...plans].sort((a, b) => parseAmount(a.amount) - parseAmount(b.amount));
}

function resolveTierMeta(
  planName: string,
  totalPlans: number,
): { position: TierPosition | null; displayLabel: string; isPopular: boolean } {
  const position = planNameToTierPosition(planName);
  if (position === null) {
    return { position: null, displayLabel: planName, isPopular: false };
  }

  // O plano do meio (Profissional) é "Mais Popular" quando há 3 planos
  const isPopular = totalPlans === 3 && position === "middle";

  return {
    position,
    displayLabel: TIER_DISPLAY_LABELS[position],
    isPopular,
  };
}

function formatPlanPrice(
  amount: string,
  interval: SubscriptionBillingInterval,
): string {
  const period = SUBSCRIPTION_BILLING_INTERVAL_LABELS[interval];
  return `${formatBRL(amount)} / ${period.toLowerCase()}`;
}

function formatPlanPriceBracket(
  amount: string,
  interval: SubscriptionBillingInterval,
): string {
  const period = SUBSCRIPTION_BILLING_INTERVAL_LABELS[interval];
  return `${formatBRL(amount)}<span className="text-base font-medium text-slate-500"> / ${period.toLowerCase()}</span>`;
}

// ---------------------------------------------------------------------------
// Botão WhatsApp
// ---------------------------------------------------------------------------

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
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-700 hover:shadow-md active:scale-[0.98] ${className}`.trim()}
    >
      <MessageCircle size={18} aria-hidden="true" />
      {label}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Lista de benefícios
// ---------------------------------------------------------------------------

function FeatureList({ features }: { features: readonly string[] }) {
  return (
    <ul className="mt-4 space-y-2">
      {features.map((feature) => (
        <li key={feature} className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-600">
          <Check
            size={16}
            className="mt-0.5 shrink-0 text-emerald-600"
            aria-hidden="true"
          />
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Card do plano
// ---------------------------------------------------------------------------

interface PlanCardProps {
  plan: PublicPlanRecord;
  tierMeta: ReturnType<typeof resolveTierMeta>;
  whatsAppConfigured: boolean;
  checkoutEnabled: boolean;
  isAuthenticated: boolean;
}

function PlanCard({
  plan,
  tierMeta,
  whatsAppConfigured,
  checkoutEnabled,
  isAuthenticated,
}: PlanCardProps) {
  const displayName = tierMeta.displayLabel;
  const planWhatsAppUrl = getAssinaturasWhatsAppUrl(displayName);
  const limitInfo = TIER_LIMITS[plan.name] ?? null;
  const LimitIcon: React.ElementType = limitInfo?.icon ?? Store;

  return (
    <article
      className={`relative flex h-full flex-col rounded-2xl border bg-white p-6 shadow-sm transition-all duration-200 ${
        tierMeta.isPopular
          ? "z-10 scale-[1.02] border-emerald-500 shadow-lg ring-1 ring-emerald-500/30"
          : "border-slate-200 hover:border-slate-300 hover:shadow-md"
      }`}
    >
      {/* Destaque "Mais Popular" */}
      {tierMeta.isPopular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-white shadow-sm">
          Mais Popular
        </span>
      )}

      {/* Cabeçalho do card */}
      <header className="mb-5">
        <div className="flex items-center gap-2">
          {tierMeta.position && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                tierMeta.position === "entry"
                  ? "bg-slate-100 text-slate-600"
                  : tierMeta.position === "middle"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-900 text-white"
              }`}
            >
              {tierMeta.position === "entry" ? "Início" :
               tierMeta.position === "middle" ? "Crescimento" : "Escala"}
            </span>
          )}
          <h3 className="text-xl font-bold text-slate-900">{displayName}</h3>
        </div>
      </header>

      {/* Preço */}
      <div className="mb-4">
        <p
          className="text-3xl font-bold tabular-nums text-slate-900"
          dangerouslySetInnerHTML={{
            __html: formatPlanPriceBracket(plan.amount, plan.billingInterval),
          }}
        />
      </div>

      {/* Descrição */}
      {plan.description && (
        <p className="mb-5 text-sm leading-relaxed text-slate-600">
          {plan.description}
        </p>
      )}

      {/* Limite do plano */}
      {limitInfo && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
          <LimitIcon size={20} className="shrink-0 text-emerald-600" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {limitInfo.label}
            </p>
            <p className="text-sm font-bold text-slate-900">{limitInfo.value}</p>
          </div>
        </div>
      )}

      {/* Benefícios */}
      {tierMeta.position && TIER_FEATURES[displayName] && (
        <FeatureList features={TIER_FEATURES[displayName]} />
      )}

      {/* Botões */}
      <div className="mt-auto pt-6">
        <div className="flex flex-col gap-3">
          <SubscribePlanButton
            planId={plan.id}
            planLabel={displayName}
            checkoutEnabled={checkoutEnabled}
            isAuthenticated={isAuthenticated}
          />
          {whatsAppConfigured && planWhatsAppUrl && (
            <WhatsAppCta
              href={planWhatsAppUrl}
              label="Contratar via WhatsApp"
              className="w-full"
            />
          )}
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Tabela de comparação
// ---------------------------------------------------------------------------

interface ComparisonTableProps {
  plans: PublicPlanRecord[];
}

function ComparisonTable({ plans }: ComparisonTableProps) {
  const sortedPlans = sortPlansByPrice(plans);
  const planNames = sortedPlans.map((p) => p.name);
  const hasAllTiers = planNames.length === 3;

  const comparisonRows = [
    { feature: "PDV offline-first", checks: ["Essencial", "Profissional", "Enterprise"] },
    { feature: "Controle de estoque auditado", checks: ["Essencial", "Profissional", "Enterprise"] },
    { feature: "Cadastro de clientes", checks: ["Essencial", "Profissional", "Enterprise"] },
    { feature: "Hotkeys de caixa (F12)", checks: [null, "Profissional", "Enterprise"] },
    { feature: "StockMap em tempo real", checks: [null, "Profissional", "Enterprise"] },
    { feature: "Dashboard e relatórios", checks: [null, null, "Enterprise"] },
    { feature: "Importação CSV de estoque", checks: [null, null, "Enterprise"] },
    {
      feature: "Número de lojas",
      values: [
        { plan: "Essencial", value: "1 loja" },
        { plan: "Profissional", value: "Até 3 lojas" },
        { plan: "Enterprise", value: "Ilimitadas" },
      ],
    },
  ];

  return (
    <section
      aria-labelledby="comparison-heading"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h2
        id="comparison-heading"
        className="mb-6 text-center text-2xl font-bold text-slate-900"
      >
        Compare os planos
      </h2>

      {hasAllTiers ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px] text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="py-3 pr-4 text-left font-semibold text-slate-700">
                  Recurso
                </th>
                {sortedPlans.map((plan) => (
                  <th
                    key={plan.id}
                    className="py-3 px-3 text-center font-semibold text-slate-700"
                  >
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.feature} className="border-t border-slate-100">
                  <td className="py-3 pr-4 text-slate-600">{row.feature}</td>
                  {sortedPlans.map((plan) => {
                    const planName = plan.name;
                    if ("values" in row) {
                      const valueRow = (row as { values: { plan: string; value: string }[] }).values;
                      const match = valueRow.find((v) => v.plan === planName);
                      return (
                        <td
                          key={planName}
                          className="py-3 px-3 text-center text-slate-700 bg-slate-50/50"
                        >
                          {match ? match.value : "—"}
                        </td>
                      );
                    }
                    const hasCheck = (row as { checks: (string | null)[] }).checks[
                      planNames.indexOf(planName)
                    ];
                    return (
                      <td
                        key={planName}
                        className="py-3 px-3 text-center"
                      >
                        {hasCheck ? (
                          <Check
                            size={18}
                            className="mx-auto text-emerald-600"
                            aria-label={`${row.feature}: incluso no ${planName}`}
                          />
                        ) : (
                          <span className="mx-auto text-slate-300" aria-label="Não incluso">
                            —
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-4 text-center text-sm text-slate-500">
          Compare os planos disponíveis para ver diferenças de recursos e limites.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lista de FAQ
// ---------------------------------------------------------------------------

function FAQList() {
  return (
    <section
      aria-labelledby="faq-heading"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h2
        id="faq-heading"
        className="mb-2 text-center text-xl font-bold text-slate-900"
      >
        Perguntas frequentes
      </h2>
      <p className="mb-6 text-center text-sm text-slate-500">
        Tire dúvidas sobre planos, cobrança e recursos do Nex Gestão Vendas.
      </p>
      <dl className="grid gap-6 md:grid-cols-2">
        {FAQ_ITEMS.map((item) => (
          <div key={item.question} className="flex flex-col gap-1.5">
            <dt className="font-semibold text-slate-900">{item.question}</dt>
            <dd className="text-sm leading-relaxed text-slate-600">
              {typeof item.answer === "string" ? item.answer : item.answer}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CTA final
// ---------------------------------------------------------------------------

function BottomCta({
  whatsAppConfigured,
  heroWhatsAppUrl,
}: {
  whatsAppConfigured: boolean;
  heroWhatsAppUrl: string | null;
}) {
  return (
    <section
      aria-labelledby="cta-heading"
      className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-8 shadow-sm text-center"
    >
      <h2
        id="cta-heading"
        className="text-2xl font-bold text-slate-900 sm:text-3xl"
      >
        Pronto para organizar melhor suas vendas?
      </h2>
      <p className="mt-3 max-w-lg mx-auto text-sm leading-relaxed text-slate-600">
        Comece agora e transforme a gestão do seu negócio. PDV, estoque e clientes
        em um só lugar.
      </p>
      <div className="mt-6 flex flex-col items-center gap-3">
        {whatsAppConfigured && heroWhatsAppUrl ? (
          <WhatsAppCta
            href={heroWhatsAppUrl}
            label="Começar agora"
            className="w-full max-w-xs"
          />
        ) : (
          <a
            href="/login"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 transition-all hover:bg-slate-50 hover:border-slate-400 active:scale-[0.98]"
          >
            Começar agora
            <ArrowRight size={18} aria-hidden="true" />
          </a>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Seção de prova social — mantida, com placeholder honesto
// ---------------------------------------------------------------------------

const SOCIAL_PROOF_METRICS = [
  { value: "X", label: "lojas" },
  { value: "Y", label: "vendas/dia" },
  { value: "segundos", label: "sync" },
] as const;

function SocialProofSection() {
  return (
    <section
      aria-label="Prova social"
      className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 sm:p-6"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {SOCIAL_PROOF_METRICS.map((metric, index) => (
          <div
            key={metric.label}
            className={`text-center ${index > 0 ? "sm:border-l sm:border-slate-200 sm:pl-4" : ""}`}
          >
            <p className="text-2xl font-bold tabular-nums text-slate-900">
              {metric.value}
            </p>
            <p className="mt-1 text-sm text-slate-500">{metric.label}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-center text-xs text-slate-400">
        Métricas ilustrativas — placeholders até dados reais de operação.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Página principal de planos
// ---------------------------------------------------------------------------

interface PlansSalesPageProps {
  plans: PublicPlanRecord[];
  loadError: string | null;
  isAuthenticated: boolean;
  checkoutEnabled?: boolean;
  pdvHref?: string;
}

export function PlansSalesPage({
  plans,
  loadError,
  isAuthenticated,
  checkoutEnabled = false,
  pdvHref = "/pdv",
}: PlansSalesPageProps) {
  const heroWhatsAppUrl = getAssinaturasWhatsAppUrl();
  const whatsAppConfigured = heroWhatsAppUrl !== null;
  const sortedPlans = sortPlansByPrice(plans);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-10 bg-[var(--background)] p-6 pb-16 text-slate-900">
      {/* Cabeçalho */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
          Nex Gestão Vendas
        </p>
        <nav className="flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50"
          >
            Entrar
          </Link>
          <Link
            href={pdvHref}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              isAuthenticated
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
            }`}
          >
            Abrir PDV
          </Link>
        </nav>
      </header>

      {/* Hero — novo título e subtítulo */}
      <section className="flex flex-col gap-6">
        <div>
          <h1 className="text-balance text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Escolha o plano ideal para o seu negócio
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-600">
            PDV offline-first, estoque auditado e controle de clientes em um só lugar.
            Do celular à loja, tudo sincroniza automaticamente.
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
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50"
          >
            Entrar
          </Link>
        </div>
      </section>

      {/* Prova social (mantida) */}
      <SocialProofSection />

      {/* Planos disponíveis — nova seção */}
      <section aria-labelledby="plans-heading" className="flex flex-col gap-6">
        <div>
          <h2
            id="plans-heading"
            className="text-2xl font-bold text-slate-900 sm:text-3xl"
          >
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
            <p className="font-semibold text-slate-900">
              Nenhum plano disponível no momento
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Novos planos serão publicados em breve. Use o WhatsApp ou entre em
              contato para saber mais.
            </p>
          </div>
        ) : (
          <>
            {/* Cards dos planos */}
            <ul className="grid items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
              {sortedPlans.map((plan, index) => {
                const tierMeta = resolveTierMeta(plan.name, sortedPlans.length);
                return (
                  <li key={plan.id} className="h-full">
                    <PlanCard
                      plan={plan}
                      tierMeta={tierMeta}
                      whatsAppConfigured={whatsAppConfigured}
                      checkoutEnabled={checkoutEnabled}
                      isAuthenticated={isAuthenticated}
                    />
                  </li>
                );
              })}
            </ul>

            {/* Linha de status do checkout/WhatsApp */}
            <p className="text-center text-sm font-medium text-slate-600">
              {checkoutEnabled
                ? "Assine online com Mercado Pago ou fale conosco pelo WhatsApp."
                : "Fale no WhatsApp — checkout online em breve."}
            </p>

            {/* Tabela de comparação */}
            <div className="mt-6">
              <ComparisonTable plans={sortedPlans} />
            </div>
          </>
        )}
      </section>

      {/* FAQ */}
      <FAQList />

      {/* CTA final */}
      <BottomCta
        whatsAppConfigured={whatsAppConfigured}
        heroWhatsAppUrl={heroWhatsAppUrl}
      />
    </main>
  );
}
