import Link from "next/link";
import { MessageCircle } from "lucide-react";
import {
  SUBSCRIPTION_BILLING_INTERVAL_LABELS,
  type SubscriptionBillingInterval,
} from "@/lib/domain/admin-subscriptions";
import type { PublicPlanRecord } from "@/lib/domain/public-plans";
import { getAssinaturasWhatsAppUrl } from "@/lib/assinaturas/whatsapp";
import { formatBRL } from "@/lib/money";

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

function PlanCard({ plan, whatsAppConfigured }: { plan: PublicPlanRecord; whatsAppConfigured: boolean }) {
  const planWhatsAppUrl = getAssinaturasWhatsAppUrl(plan.name);

  return (
    <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-xl font-bold text-slate-900">{plan.name}</h3>
      <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-700">
        {formatPlanPrice(plan.amount, plan.billingInterval)}
      </p>
      {plan.description ? (
        <p className="mt-4 flex-1 text-sm leading-relaxed text-slate-600">{plan.description}</p>
      ) : (
        <p className="mt-4 flex-1 text-sm text-slate-400">Plano PDV Nex Gestão Vendas.</p>
      )}
      <div className="mt-6">
        {whatsAppConfigured && planWhatsAppUrl ? (
          <WhatsAppCta href={planWhatsAppUrl} label="Contratar via WhatsApp" className="w-full" />
        ) : (
          <span
            aria-disabled="true"
            className="inline-flex w-full cursor-not-allowed items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-400"
          >
            Em breve
          </span>
        )}
      </div>
    </article>
  );
}

export function PlansSalesPage({
  plans,
  loadError,
  isAuthenticated,
  pdvHref = "/pdv",
}: {
  plans: PublicPlanRecord[];
  loadError: string | null;
  isAuthenticated: boolean;
  pdvHref?: string;
}) {
  const heroWhatsAppUrl = getAssinaturasWhatsAppUrl();
  const whatsAppConfigured = heroWhatsAppUrl !== null;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-12 p-6 pb-16">
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
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">
            PDV local-first para o varejo brasileiro
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-600">
            Inventário auditado, controle de caixa e operação offline — escolha o plano ideal para sua loja.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {whatsAppConfigured && heroWhatsAppUrl ? (
            <WhatsAppCta href={heroWhatsAppUrl} label="Falar com vendas no WhatsApp" />
          ) : (
            <span
              aria-disabled="true"
              className="inline-flex cursor-not-allowed items-center rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-400"
            >
              Contratação em breve
            </span>
          )}
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Já sou cliente
          </Link>
        </div>
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
        ) : plans.length === 0 ? (
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
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => (
              <li key={plan.id}>
                <PlanCard plan={plan} whatsAppConfigured={whatsAppConfigured} />
              </li>
            ))}
          </ul>
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
