"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Check,
  MessageCircle,
  ArrowRight,
  Store,
  BarChart3,
  ClipboardList,
  Zap,
  Menu,
  X,
  WifiOff,
  Users,
  FileText,
  Keyboard,
  Clock,
  Search,
  TrendingUp,
  ChevronDown,
  Puzzle,
} from "lucide-react";
import {
  SUBSCRIPTION_BILLING_INTERVAL_LABELS,
  type SubscriptionBillingInterval,
} from "@/lib/domain/admin-subscriptions";
import type { PublicPlanRecord } from "@/lib/domain/public-plans";
import { getAssinaturasWhatsAppUrl } from "@/lib/assinaturas/whatsapp";
import { formatBRL } from "@/lib/money";
import { SubscribePlanButton } from "@/components/marketing/subscribe-plan-button";
import { PriceDisplay } from "@/components/marketing/price-display";

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

type TierPosition = "entry" | "middle" | "enterprise";

const TIER_DISPLAY_LABELS: Record<TierPosition, string> = {
  entry: "Essencial",
  middle: "Crescimento",
  enterprise: "Escala",
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

  // O plano do meio é "Mais Popular" quando há 3 planos
  const isPopular = totalPlans === 3 && position === "middle";

  return {
    position,
    displayLabel: TIER_DISPLAY_LABELS[position],
    isPopular,
  };
}

function formatPlanPrice(amount: string, interval: SubscriptionBillingInterval): string {
  const period = SUBSCRIPTION_BILLING_INTERVAL_LABELS[interval];
  return `${formatBRL(amount)} / ${period.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// FAQ — perguntas e respostas reais do produto
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
      "A cobrança é recorrente via Mercado Pago — mensal ou anual, escolha o plano. Para assinar, entre em contato pelo WhatsApp ou use o checkout online quando disponível.",
  },
  {
    question: "O que está incluso em cada plano?",
    answer:
      "Todos os planos incluem PDV offline-first, controle de estoque auditado e cadastro de clientes. O Profissional adiciona hotkeys de caixa e StockMap. O Enterprise adiciona dashboard, relatórios e importação CSV de estoque, além de lojas ilimitadas.",
  },
  {
    question: "Existe período de teste?",
    answer:
      "O Nex Gestão Vendas oferece assinaturas em diferentes status, incluindo trialing. Entre em contato pelo WhatsApp para saber se há condições de teste disponíveis para o seu caso.",
  },
  {
    question: "Posso mudar de plano?",
    answer:
      "Sim. A gestão de planos é feita pelo administrador da plataforma. Se precisar migrar de plano, fale com o nosso time pelo WhatsApp que orienta a transição e o ajuste da sua assinatura.",
  },
  {
    question: "Posso cancelar?",
    answer:
      "Sim. A assinatura pode ser cancelada a qualquer momento. O cancelamento é registrado no sistema e o acesso ao PDV segue a política de assinatura vigente. Se tiver dúvidas sobre o encerramento, fale conosco pelo WhatsApp.",
  },
] as const;

// ---------------------------------------------------------------------------
// Recursos do produto — somente o que existe de fato no sistema
// ---------------------------------------------------------------------------

const PRODUCT_FEATURES = [
  { icon: ClipboardList, title: "PDV", description: "Ponto de venda completo para processar vendas da loja." },
  { icon: Store, title: "Estoque", description: "Controle de estoque auditado, com histórico de cada movimentação." },
  { icon: Users, title: "Clientes", description: "Cadastro e consulta de clientes centralizados na plataforma." },
  { icon: BarChart3, title: "Dashboard", description: "Visão geral da operação com indicadores da loja." },
  { icon: FileText, title: "Relatórios", description: "Relatórios para acompanhar o desempenho das vendas." },
  { icon: Keyboard, title: "Atalhos de caixa", description: "Hotkeys para agilizar o fechamento da venda no caixa." },
  { icon: WifiOff, title: "Funcionamento offline", description: "O PDV continua operando sem internet e sincroniza depois." },
] as const;

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function SiteHeader({
  isAuthenticated,
  pdvHref,
}: {
  isAuthenticated: boolean;
  pdvHref: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navLinks = [
    { href: "#recursos", label: "Recursos" },
    { href: "#como-funciona", label: "Como funciona" },
    { href: "#planos", label: "Planos" },
    { href: "#faq", label: "FAQ" },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="#" className="flex items-center gap-2.5" aria-label="Nex Gestão Vendas — início">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white shadow-sm">
            N
          </span>
          <span className="text-sm font-bold uppercase tracking-wider text-slate-900 sm:text-base">
            Nex Gestão Vendas
          </span>
        </Link>

        <nav className="hidden items-center gap-7 lg:flex" aria-label="Navegação principal">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <Link
            href="/login"
            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
          >
            Entrar
          </Link>
          <Link
            href={isAuthenticated ? pdvHref : "/login"}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
          >
            Abrir PDV
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 transition-colors hover:bg-slate-50 lg:hidden"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
        >
          {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
      </div>

      {menuOpen && (
        <div className="border-t border-slate-200 bg-white lg:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4" aria-label="Navegação mobile">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-4">
              <Link
                href="/login"
                onClick={() => setMenuOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-center text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50"
              >
                Entrar
              </Link>
              <Link
                href={isAuthenticated ? pdvHref : "/login"}
                onClick={() => setMenuOpen(false)}
                className="rounded-lg bg-emerald-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
              >
                Abrir PDV
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Cartão do plano
// ---------------------------------------------------------------------------

interface PlanCardProps {
  plan: PublicPlanRecord;
  tierMeta: ReturnType<typeof resolveTierMeta>;
  checkoutEnabled: boolean;
  isAuthenticated: boolean;
}

function PlanCard({ plan, tierMeta, checkoutEnabled, isAuthenticated }: PlanCardProps) {
  const displayName = tierMeta.displayLabel;
  const features = TIER_FEATURES[plan.name] ?? [];
  const limitInfo = TIER_LIMITS[plan.name] ?? null;
  const period = SUBSCRIPTION_BILLING_INTERVAL_LABELS[plan.billingInterval]?.toLowerCase() ?? "";
  const isPopular = tierMeta.isPopular;

  return (
    <article
      className={`relative flex h-full flex-col rounded-3xl border p-8 transition-all duration-200 ${
        isPopular
          ? "z-10 border-emerald-500 bg-slate-900 text-white shadow-xl shadow-emerald-900/20 ring-1 ring-emerald-500/40 lg:-translate-y-3"
          : "border-slate-200 bg-white shadow-sm hover:border-slate-300 hover:shadow-md"
      }`}
    >
      {isPopular && (
        <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-white shadow-md">
          Mais popular
        </span>
      )}

      <header>
        <h3 className={`text-lg font-semibold ${isPopular ? "text-emerald-300" : "text-emerald-700"}`}>
          {displayName}
        </h3>
        <div className="mt-3 flex items-baseline gap-1.5">
          <PriceDisplay
            price={formatBRL(plan.amount)}
            className={isPopular ? "text-4xl font-bold tabular-nums text-white" : "text-4xl font-bold tabular-nums text-slate-900"}
          />
          <span className={`text-sm font-medium ${isPopular ? "text-slate-300" : "text-slate-500"}`}>
            / {period}
          </span>
        </div>
        {plan.description ? (
          <p className={`mt-3 text-sm leading-relaxed ${isPopular ? "text-slate-300" : "text-slate-600"}`}>
            {plan.description}
          </p>
        ) : null}
        {limitInfo ? (
          <p className={`mt-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${isPopular ? "text-emerald-300" : "text-slate-500"}`}>
            <limitInfo.icon size={14} aria-hidden="true" />
            {limitInfo.label}: {limitInfo.value}
          </p>
        ) : null}
      </header>

      <ul className={`mt-6 flex-1 space-y-3 border-t pt-6 ${isPopular ? "border-white/10" : "border-slate-100"}`}>
        {features.map((feature) => (
          <li key={feature} className={`flex items-start gap-2.5 text-sm leading-relaxed ${isPopular ? "text-slate-200" : "text-slate-600"}`}>
            <Check size={16} className={`mt-0.5 shrink-0 ${isPopular ? "text-emerald-400" : "text-emerald-600"}`} aria-hidden="true" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mt-8">
        <SubscribePlanButton
          planId={plan.id}
          planLabel={displayName}
          stripeEnabled={plan.stripeEnabled}
          subscriptionEnabled={checkoutEnabled}
        />
      </div>
    </article>
  );
}



// ---------------------------------------------------------------------------
// FAQ expansível
// ---------------------------------------------------------------------------

function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="scroll-mt-24 bg-slate-50 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Perguntas frequentes
          </h2>
          <p className="mt-3 text-base text-slate-600">
            Tudo que você precisa saber antes de assinar.
          </p>
        </div>

        <div className="mt-10 space-y-3">
          {FAQ_ITEMS.map((item, index) => {
            const isOpen = openIndex === index;
            return (
              <div
                key={item.question}
                className={`overflow-hidden rounded-2xl border bg-white transition-colors ${
                  isOpen ? "border-emerald-300 shadow-sm" : "border-slate-200"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="text-sm font-semibold text-slate-900 sm:text-base">{item.question}</span>
                  <ChevronDown
                    size={18}
                    className={`shrink-0 text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                </button>
                {isOpen ? (
                  <div className="px-5 pb-5">
                    <p className="text-sm leading-relaxed text-slate-600">{item.answer}</p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}


// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export interface PlansSalesPageProps {
  plans: PublicPlanRecord[];
  loadError?: string | null;
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
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader isAuthenticated={isAuthenticated} pdvHref={pdvHref} />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-slate-50 via-white to-white">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(16,185,129,0.10),transparent)]"
          aria-hidden="true"
        />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:py-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <Zap size={13} aria-hidden="true" />
              PDV, estoque e clientes em uma plataforma
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl lg:text-[3.4rem]">
              Venda mais. Controle seu estoque. Gerencie sua loja em um só lugar.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
              O Nex Gestão Vendas reúne PDV, estoque, clientes e gestão em uma plataforma
              simples para sua operação.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href={isAuthenticated ? pdvHref : "/login"}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-emerald-600/25 transition-all hover:bg-emerald-700 hover:shadow-emerald-700/30 active:scale-[0.98]"
              >
                Começar agora
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link
                href={pdvHref}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3.5 text-base font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50 active:scale-[0.98]"
              >
                Abrir PDV
              </Link>
            </div>
            {whatsAppConfigured && heroWhatsAppUrl ? (
              <p className="mt-6 text-sm text-slate-500">
                Prefere falar com a gente?{" "}
                <a
                  href={heroWhatsAppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:text-emerald-800"
                >
                  <MessageCircle size={14} aria-hidden="true" />
                  Chamar no WhatsApp
                </a>
              </p>
            ) : null}
          </div>

          {/* Representação visual da interface — cards ilustrativos, não screenshot */}
          <div className="relative mx-auto w-full max-w-md lg:max-w-none" aria-hidden="true">
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-900/10">
              <div className="flex items-center gap-1.5 px-2 pb-3 pt-1">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-slate-900 p-4 text-white">
                  <ClipboardList size={20} className="text-emerald-400" />
                  <p className="mt-2 text-sm font-semibold">PDV</p>
                  <p className="mt-0.5 text-xs text-slate-300">Caixa offline-first</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <Store size={20} className="text-emerald-600" />
                  <p className="mt-2 text-sm font-semibold text-slate-900">Estoque</p>
                  <p className="mt-0.5 text-xs text-slate-500">Auditado por movimentação</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <Users size={20} className="text-blue-600" />
                  <p className="mt-2 text-sm font-semibold text-slate-900">Clientes</p>
                  <p className="mt-0.5 text-xs text-slate-500">Cadastro centralizado</p>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <BarChart3 size={20} className="text-emerald-700" />
                  <p className="mt-2 text-sm font-semibold text-slate-900">Dashboard</p>
                  <p className="mt-0.5 text-xs text-emerald-700">Sua operação em foco</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* Problema → Solução */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Sua operação não precisa ser complicada.
          </h2>
          <p className="mt-3 text-base text-slate-600">
            A maior parte do esforço do varejo se perde em processo manual e informação atrasada.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {[
            { icon: Clock, title: "Caixa lento", description: "Fila parada e venda perdida quando o sistema trava ou a internet cai." },
            { icon: Search, title: "Estoque desatualizado", description: "Produto sumindo da prateleira sem ninguém perceber o momento." },
            { icon: Puzzle, title: "Informações espalhadas", description: "Dados da loja divididos entre cadernos, planilhas e memória." },
          ].map((problem) => (
            <div key={problem.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-rose-500">
                <problem.icon size={20} aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-900">{problem.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{problem.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-3xl bg-slate-900 px-6 py-10 text-center sm:px-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">A solução</p>
          <p className="mt-3 text-2xl font-bold text-white sm:text-3xl">
            Com o Nex, tudo fica conectado.
          </p>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-300">
            Venda no PDV, movimente o estoque, consulte o cliente e acompanhe a operação
            no mesmo lugar — com sincronização automática.
          </p>
        </div>
      </section>


      {/* Recursos */}
      <section id="recursos" className="scroll-mt-24 bg-slate-50 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Tudo que sua loja precisa para vender e organizar a operação.
            </h2>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {PRODUCT_FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <feature.icon size={20} aria-hidden="true" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-slate-900">{feature.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* Como funciona */}
      <section id="como-funciona" className="scroll-mt-24 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Como funciona
            </h2>
            <p className="mt-3 text-base text-slate-600">
              Três passos para colocar sua loja no Nex.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-3 sm:gap-5">
            {[
              { step: "1", title: "Crie sua conta", description: "Escolha um plano e crie seu acesso em poucos minutos." },
              { step: "2", title: "Configure sua loja", description: "Cadastre produtos, estoque e clientes da sua operação." },
              { step: "3", title: "Comece a vender", description: "Use o PDV no dia a dia e acompanhe tudo pela plataforma." },
            ].map((step, index) => (
              <div key={step.step} className="relative text-center sm:text-left">
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-2xl font-bold text-white shadow-lg shadow-emerald-600/25">
                  {step.step}
                </span>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Planos */}
      <section id="planos" className="scroll-mt-24 bg-slate-50 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Escolha o plano ideal para o seu negócio
            </h2>
            <p className="mt-3 text-base text-slate-600">
              Planos com cobrança recorrente via Mercado Pago. Cancele quando quiser.
            </p>
          </div>

          {loadError ? (
            <p className="mx-auto mt-8 max-w-xl rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-center text-sm font-medium text-amber-800">
              Não foi possível carregar os planos agora. Atualize a página ou fale conosco pelo WhatsApp.
            </p>
          ) : null}

          <div className="mt-12 grid grid-cols-1 items-stretch gap-6 lg:grid-cols-3 lg:gap-8">
            {sortedPlans.map((plan) => {
              const tierMeta = resolveTierMeta(plan.name, sortedPlans.length);
              return (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  tierMeta={tierMeta}
                  checkoutEnabled={checkoutEnabled}
                  isAuthenticated={isAuthenticated}
                />
              );
            })}
          </div>
        </div>
      </section>

      {/* Comparação de planos */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Compare os planos
            </h2>
            <p className="mt-3 text-base text-slate-600">
              Recursos e limites reais de cada tier.
            </p>
          </div>

          <div className="mt-10 space-y-4">
            {ORDERED_PLAN_NAMES.map((name) => {
              const features = TIER_FEATURES[name] ?? [];
              const limitInfo = TIER_LIMITS[name] ?? null;
              return (
                <div
                  key={name}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-lg font-bold text-slate-900">{name}</h3>
                    {limitInfo ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <limitInfo.icon size={14} aria-hidden="true" />
                        {limitInfo.label}: {limitInfo.value}
                      </span>
                    ) : null}
                  </div>
                  <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm text-slate-600">
                        <Check size={14} className="mt-1 shrink-0 text-emerald-600" aria-hidden="true" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <FaqSection />

      {/* CTA final */}
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="rounded-3xl bg-gradient-to-br from-emerald-600 to-emerald-700 px-6 py-14 text-center shadow-xl shadow-emerald-700/25 sm:px-12">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Pronto para organizar sua operação?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-emerald-50">
              Comece a vender e gerencie sua loja em um só lugar.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href={isAuthenticated ? pdvHref : "/login"}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-8 py-3.5 text-base font-semibold text-emerald-700 shadow-lg transition-transform hover:bg-emerald-50 active:scale-[0.98] sm:w-auto"
              >
                Começar agora
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <a
                href="#planos"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/40 px-8 py-3.5 text-base font-semibold text-white transition-colors hover:bg-white/10 sm:w-auto"
              >
                Ver planos
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-slate-50 py-12">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">
                  N
                </span>
                <span className="text-sm font-bold uppercase tracking-wider text-slate-900">
                  Nex Gestão Vendas
                </span>
              </div>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-500">
                Plataforma de vendas com PDV, estoque e gestão para o varejo.
              </p>
            </div>
            <nav aria-label="Links do rodapé" className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm">
              {[
                { href: "/login", label: "Login" },
                { href: "/pdv", label: "PDV" },
                { href: "#planos", label: "Planos" },
                { href: "#faq", label: "FAQ" },
              ].map((link) => (
                <Link key={link.label} href={link.href} className="text-slate-600 transition-colors hover:text-slate-900">
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="mt-10 border-t border-slate-200 pt-6">
            <p className="text-xs text-slate-400">
              © 2026 Nex Gestão Vendas. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
