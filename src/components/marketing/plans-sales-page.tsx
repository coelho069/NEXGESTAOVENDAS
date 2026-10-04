"use client";

import React, { useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  Check,
  MessageCircle,
  ArrowRight,
  Store,
  BarChart3,
  ClipboardList,
  Zap,
  WifiOff,
  Users,
  FileText,
  Keyboard,
  Clock,
  Search,
  ChevronDown,
  Puzzle,
} from "lucide-react";
import { SUBSCRIPTION_BILLING_INTERVAL_LABELS } from "@/lib/domain/admin-subscriptions";
import type { PublicPlanRecord } from "@/lib/domain/public-plans";
import { getAssinaturasWhatsAppUrl } from "@/lib/assinaturas/whatsapp";
import { formatBRL } from "@/lib/money";
import { SubscribePlanButton } from "@/components/marketing/subscribe-plan-button";
import { REFUND_POLICY_PATH } from "@/lib/domain/refund-policy";
import { Navbar } from "@/components/landing/components/Navbar";
import { Footer } from "@/components/landing/components/Footer";
import { Reveal } from "@/components/landing/components/Reveal";
import { landingTheme as t, tabularNums } from "@/components/landing/theme/landing-theme";

// ---------------------------------------------------------------------------
// Dados comerciais reais — espelhados do seed SQL e do negócio, não inventados
// ---------------------------------------------------------------------------

const TIER_LIMITS: Record<string, { label: string; value: string; icon: typeof Store }> = {
  Essencial: { label: "Lojas", value: "1", icon: Store },
  Profissional: { label: "Lojas", value: "Até 3", icon: Store },
  Enterprise: { label: "Lojas", value: "Ilimitadas", icon: Store },
};

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

type TierPosition = "entry" | "middle" | "enterprise";

const TIER_DISPLAY_LABELS: Record<TierPosition, string> = {
  entry: "Essencial",
  middle: "Crescimento",
  enterprise: "Escala",
};

const PLANOS_NAV_LINKS = [
  { label: "Recursos", href: "#recursos" },
  { label: "Como funciona", href: "#como-funciona" },
  { label: "Planos", href: "#planos" },
  { label: "FAQ", href: "#faq" },
] as const;

type FaqItem = {
  question: string;
  answer: string;
  href?: string;
  linkLabel?: string;
};

const FAQ_ITEMS: readonly FaqItem[] = [
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
      "Sim. A assinatura pode ser cancelada a qualquer momento. O cancelamento evita a renovação; o acesso segue até o fim do período já pago. Cancelar não estorna o ciclo corrente. Se tiver dúvidas sobre o encerramento, fale conosco pelo WhatsApp.",
  },
  {
    question: "Como funciona o reembolso?",
    answer:
      "A cobrança é de assinatura de software, não de produto físico. Pedidos de estorno da primeira cobrança seguem prazo, uso em produção e as demais condições da política. Reembolso não é o mesmo que cancelar para não renovar.",
    href: REFUND_POLICY_PATH,
    linkLabel: "Ler a Política de Reembolsos e Devoluções",
  },
];

const PRODUCT_FEATURES = [
  { icon: ClipboardList, title: "PDV", description: "Ponto de venda completo para processar vendas da loja." },
  { icon: Store, title: "Estoque", description: "Controle de estoque auditado, com histórico de cada movimentação." },
  { icon: Users, title: "Clientes", description: "Cadastro e consulta de clientes centralizados na plataforma." },
  { icon: BarChart3, title: "Dashboard", description: "Visão geral da operação com indicadores da loja." },
  { icon: FileText, title: "Relatórios", description: "Relatórios para acompanhar o desempenho das vendas." },
  { icon: Keyboard, title: "Atalhos de caixa", description: "Hotkeys para agilizar o fechamento da venda no caixa." },
  { icon: WifiOff, title: "Funcionamento offline", description: "O PDV continua operando sem internet e sincroniza depois." },
] as const;

const PAGE_CSS = `
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
section[id] { scroll-margin-top: ${t.layout.navClearance}; }
.nx-plan-card { transition: transform ${t.motion.base} ease, box-shadow ${t.motion.base} ease, border-color ${t.motion.base} ease; }
@media (hover: hover) {
  .nx-plan-card:hover { transform: translateY(-3px); box-shadow: ${t.shadow.card}; }
  .nx-plan-popular:hover { box-shadow: 0 24px 48px -16px rgba(16, 185, 129, 0.35); }
}
.nx-plan-cta { transition: box-shadow ${t.motion.fast} ease, transform ${t.motion.fast} ease, filter ${t.motion.fast} ease; }
@media (hover: hover) {
  .nx-plan-cta:hover { box-shadow: ${t.shadow.ctaAccentGlow}; transform: translateY(-1px); filter: brightness(1.05); }
  .nx-plan-cta-ghost:hover { border-color: rgba(255,255,255,0.28) !important; background: rgba(255,255,255,0.06) !important; }
}
.nx-faq-chevron { transition: transform ${t.motion.base} ease; }
.nx-faq-chevron.open { transform: rotate(180deg); }
@media (max-width: 900px) { .nx-plans-hero { grid-template-columns: 1fr !important; } .nx-plans-grid { grid-template-columns: 1fr !important; } }
@media (max-width: 1024px) { .nx-feature-grid { grid-template-columns: repeat(2, 1fr) !important; } }
@media (max-width: 720px) { .nx-feature-grid { grid-template-columns: 1fr !important; } .nx-problem-grid { grid-template-columns: 1fr !important; } .nx-steps-grid { grid-template-columns: 1fr !important; } }
`;

const container: CSSProperties = {
  maxWidth: t.layout.max,
  margin: "0 auto",
  padding: "0 24px",
};

const sectionTitle: CSSProperties = {
  margin: "0 0 12px",
  fontFamily: t.font.heading,
  fontSize: "clamp(26px, 3.4vw, 38px)",
  fontWeight: 800,
  letterSpacing: "-0.01em",
  color: t.color.text,
  textAlign: "center",
};

const cardSurface: CSSProperties = {
  borderRadius: t.radius.lg,
  border: `1px solid ${t.color.border}`,
  background: "linear-gradient(145deg, #1E293B 0%, #101828 55%, #0D1424 100%)",
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
  const isPopular = totalPlans === 3 && position === "middle";
  return {
    position,
    displayLabel: TIER_DISPLAY_LABELS[position],
    isPopular,
  };
}

interface PlanCardProps {
  plan: PublicPlanRecord;
  tierMeta: ReturnType<typeof resolveTierMeta>;
  checkoutEnabled: boolean;
}

function PlanCard({ plan, tierMeta, checkoutEnabled }: PlanCardProps) {
  const displayName = tierMeta.displayLabel;
  const features = TIER_FEATURES[plan.name] ?? [];
  const limitInfo = TIER_LIMITS[plan.name] ?? null;
  const period = SUBSCRIPTION_BILLING_INTERVAL_LABELS[plan.billingInterval]?.toLowerCase() ?? "";
  const isPopular = tierMeta.isPopular;

  const cardStyle: CSSProperties = isPopular
    ? {
        ...cardSurface,
        position: "relative",
        border: "1px solid rgba(16, 185, 129, 0.45)",
        background: "linear-gradient(180deg, rgba(16, 185, 129, 0.12) 0%, rgba(15, 23, 42, 0.92) 100%)",
        boxShadow: "0 24px 48px -16px rgba(16, 185, 129, 0.25)",
      }
    : { ...cardSurface };

  return (
    <article
      className={`nx-plan-card${isPopular ? " nx-plan-popular" : ""}`}
      style={{
        ...cardStyle,
        display: "flex",
        flexDirection: "column",
        padding: 28,
        height: "100%",
      }}
    >
      {isPopular && (
        <span
          style={{
            position: "absolute",
            top: -12,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "4px 14px",
            borderRadius: t.radius.full,
            background: t.color.accent,
            color: t.color.accentText,
            fontSize: 11,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Mais popular
        </span>
      )}

      <header>
        <h3
          style={{
            margin: 0,
            fontFamily: t.font.heading,
            fontSize: 18,
            fontWeight: 700,
            color: isPopular ? t.color.accent : "#93C5FD",
          }}
        >
          {displayName}
        </h3>
        <div style={{ marginTop: 12, display: "flex", alignItems: "baseline", gap: 6 }}>
          <span
            style={{
              fontFamily: t.font.heading,
              fontSize: "clamp(28px, 4vw, 36px)",
              fontWeight: 800,
              color: t.color.text,
              ...tabularNums,
            }}
          >
            {formatBRL(plan.amount)}
          </span>
          <span style={{ fontSize: 14, fontWeight: 500, color: t.color.textMuted }}>/ {period}</span>
        </div>
        {plan.description ? (
          <p style={{ margin: "12px 0 0", fontSize: 14, lineHeight: 1.55, color: t.color.textMuted }}>
            {plan.description}
          </p>
        ) : null}
        {limitInfo ? (
          <p
            style={{
              margin: "10px 0 0",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11.5,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: isPopular ? t.color.accent : t.color.textMuted,
            }}
          >
            <limitInfo.icon size={14} aria-hidden="true" />
            {limitInfo.label}: {limitInfo.value}
          </p>
        ) : null}
      </header>

      <ul
        style={{
          listStyle: "none",
          margin: "24px 0 0",
          padding: "24px 0 0",
          flex: 1,
          borderTop: `1px solid ${isPopular ? "rgba(16, 185, 129, 0.2)" : t.color.border}`,
        }}
      >
        {features.map((feature) => (
          <li
            key={feature}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              marginBottom: 12,
              fontSize: 14,
              lineHeight: 1.55,
              color: t.color.textBody,
            }}
          >
            <Check size={16} style={{ marginTop: 2, flexShrink: 0, color: t.color.accent }} aria-hidden="true" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <div style={{ marginTop: 24 }}>
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

function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" style={{ padding: "48px 0 80px" }}>
      <div style={{ ...container, maxWidth: 720 }}>
        <Reveal>
          <div style={{ textAlign: "center", marginBottom: 36 }}>
            <h2 style={sectionTitle}>Perguntas frequentes</h2>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: t.color.textMuted }}>
              Tudo que você precisa saber antes de assinar.
            </p>
          </div>
        </Reveal>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {FAQ_ITEMS.map((item, index) => {
            const isOpen = openIndex === index;
            return (
              <Reveal key={item.question} delay={index * 40}>
                <div
                  style={{
                    borderRadius: t.radius.lg,
                    border: isOpen ? "1px solid rgba(16, 185, 129, 0.35)" : `1px solid ${t.color.border}`,
                    background: "rgba(30, 41, 59, 0.45)",
                    overflow: "hidden",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                    aria-expanded={isOpen}
                    style={{
                      display: "flex",
                      width: "100%",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 16,
                      padding: "16px 20px",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: t.font.body,
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 600, color: t.color.text }}>{item.question}</span>
                    <ChevronDown
                      size={18}
                      className={`nx-faq-chevron${isOpen ? " open" : ""}`}
                      style={{ flexShrink: 0, color: t.color.textMuted }}
                      aria-hidden="true"
                    />
                  </button>
                  {isOpen ? (
                    <div style={{ padding: "0 20px 18px" }}>
                      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: t.color.textMuted }}>{item.answer}</p>
                      {item.href && item.linkLabel ? (
                        <p style={{ margin: "12px 0 0" }}>
                          <Link
                            href={item.href}
                            style={{ fontSize: 14, fontWeight: 600, color: t.color.accent, textDecoration: "none" }}
                          >
                            {item.linkLabel}
                          </Link>
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

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
  const headerPdvHref = isAuthenticated ? pdvHref : "/login";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: t.color.bg,
        color: t.color.text,
        fontFamily: t.font.body,
        WebkitFontSmoothing: "antialiased",
        overflowX: "hidden",
      }}
    >
      <style>{PAGE_CSS}</style>
      <Navbar
        links={PLANOS_NAV_LINKS}
        brandLabel="Nex Gestão Vendas"
        loginLabel="Entrar"
        primaryCta={{ label: "Abrir PDV", href: headerPdvHref }}
      />

      <main style={{ paddingTop: t.layout.navClearance }}>
        {/* Hero */}
        <section
          style={{
            position: "relative",
            overflow: "hidden",
            padding: "48px 0 80px",
            background:
              "radial-gradient(1100px 540px at 50% -120px, rgba(37, 99, 235, 0.14) 0%, rgba(37, 99, 235, 0.05) 45%, transparent 72%)",
          }}
        >
          <div style={container}>
            <div
              className="nx-plans-hero"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 48,
                alignItems: "center",
              }}
            >
              <div>
                <Reveal>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 16px",
                      borderRadius: t.radius.full,
                      border: `1px solid ${t.color.glassBorder}`,
                      background: "rgba(15, 23, 42, 0.6)",
                      color: t.color.textBody,
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    <Zap size={13} aria-hidden="true" />
                    PDV, estoque e clientes em uma plataforma
                  </span>
                </Reveal>
                <Reveal delay={60}>
                  <h1
                    style={{
                      margin: "24px 0 20px",
                      fontFamily: t.font.heading,
                      fontSize: "clamp(32px, 4.8vw, 54px)",
                      fontWeight: 800,
                      lineHeight: 1.1,
                      letterSpacing: "-0.02em",
                      color: t.color.text,
                    }}
                  >
                    Venda mais. Controle seu estoque. Gerencie sua loja em um só lugar.
                  </h1>
                </Reveal>
                <Reveal delay={100}>
                  <p style={{ margin: "0 0 28px", maxWidth: 520, fontSize: 17, lineHeight: 1.65, color: t.color.textMuted }}>
                    O Nex Gestão Vendas reúne PDV, estoque, clientes e gestão em uma plataforma simples para sua
                    operação.
                  </p>
                </Reveal>
                <Reveal delay={140}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                    <Link
                      href={isAuthenticated ? pdvHref : "/login"}
                      className="nx-plan-cta"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        height: 52,
                        padding: "0 28px",
                        borderRadius: t.radius.md,
                        background: `linear-gradient(135deg, ${t.color.accent} 0%, #0EA371 100%)`,
                        color: t.color.accentText,
                        fontSize: 15,
                        fontWeight: 800,
                        fontFamily: t.font.heading,
                        textDecoration: "none",
                      }}
                    >
                      Começar agora
                      <ArrowRight size={18} aria-hidden="true" />
                    </Link>
                    <Link
                      href={pdvHref}
                      className="nx-plan-cta nx-plan-cta-ghost"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        height: 52,
                        padding: "0 24px",
                        borderRadius: t.radius.md,
                        border: `1px solid rgba(255, 255, 255, 0.14)`,
                        color: t.color.text,
                        fontSize: 15,
                        fontWeight: 600,
                        textDecoration: "none",
                        background: "transparent",
                      }}
                    >
                      Abrir PDV
                    </Link>
                  </div>
                  {whatsAppConfigured && heroWhatsAppUrl ? (
                    <p style={{ margin: "20px 0 0", fontSize: 14, color: t.color.textMuted }}>
                      Prefere falar com a gente?{" "}
                      <a
                        href={heroWhatsAppUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontWeight: 600,
                          color: t.color.accent,
                          textDecoration: "none",
                        }}
                      >
                        <MessageCircle size={14} aria-hidden="true" />
                        Chamar no WhatsApp
                      </a>
                    </p>
                  ) : null}
                </Reveal>
              </div>

              <Reveal delay={120}>
                <div style={{ borderRadius: t.radius.xl, border: `1px solid ${t.color.border}`, background: "rgba(15, 23, 42, 0.75)", padding: 20, boxShadow: t.shadow.card }} aria-hidden="true">
                  <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                    {["#F87171", "#FBBF24", "#34D399"].map((c) => (
                      <span key={c} style={{ width: 10, height: 10, borderRadius: t.radius.full, background: c, opacity: 0.75 }} />
                    ))}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
                    {[
                      { icon: ClipboardList, label: "PDV", sub: "Caixa offline-first", accent: true },
                      { icon: Store, label: "Estoque", sub: "Auditado por movimentação", accent: false },
                      { icon: Users, label: "Clientes", sub: "Cadastro centralizado", accent: false },
                      { icon: BarChart3, label: "Dashboard", sub: "Sua operação em foco", accent: false },
                    ].map((panel) => (
                      <div
                        key={panel.label}
                        style={{
                          borderRadius: t.radius.md,
                          border: panel.accent ? "1px solid rgba(16, 185, 129, 0.35)" : `1px solid ${t.color.border}`,
                          background: panel.accent ? "rgba(16, 185, 129, 0.1)" : "rgba(255,255,255,0.03)",
                          padding: 16,
                        }}
                      >
                        <panel.icon size={20} style={{ color: panel.accent ? t.color.accent : "#93C5FD" }} />
                        <p style={{ margin: "10px 0 0", fontSize: 14, fontWeight: 600, color: t.color.text }}>{panel.label}</p>
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: t.color.textMuted }}>{panel.sub}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* Problema → Solução */}
        <section style={{ padding: "48px 0 80px" }}>
          <div style={container}>
            <Reveal>
              <div style={{ textAlign: "center", maxWidth: 560, margin: "0 auto 40px" }}>
                <h2 style={sectionTitle}>Sua operação não precisa ser complicada.</h2>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: t.color.textMuted }}>
                  A maior parte do esforço do varejo se perde em processo manual e informação atrasada.
                </p>
              </div>
            </Reveal>
            <div className="nx-problem-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
              {[
                { icon: Clock, title: "Caixa lento", description: "Fila parada e venda perdida quando o sistema trava ou a internet cai." },
                { icon: Search, title: "Estoque desatualizado", description: "Produto sumindo da prateleira sem ninguém perceber o momento." },
                { icon: Puzzle, title: "Informações espalhadas", description: "Dados da loja divididos entre cadernos, planilhas e memória." },
              ].map((problem, i) => (
                <Reveal key={problem.title} delay={i * 50}>
                  <div style={{ ...cardSurface, padding: 24 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: "rgba(248, 113, 113, 0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: "#F87171" }}>
                      <problem.icon size={20} aria-hidden="true" />
                    </div>
                    <h3 style={{ margin: "16px 0 8px", fontFamily: t.font.heading, fontSize: 16, fontWeight: 700, color: t.color.text }}>{problem.title}</h3>
                    <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: t.color.textMuted }}>{problem.description}</p>
                  </div>
                </Reveal>
              ))}
            </div>
            <Reveal delay={80}>
              <div
                style={{
                  marginTop: 32,
                  borderRadius: t.radius.xl,
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                  background: "linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(15, 23, 42, 0.9) 100%)",
                  padding: "36px 28px",
                  textAlign: "center",
                }}
              >
                <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: t.color.accent }}>A solução</p>
                <p style={{ margin: "12px 0 0", fontFamily: t.font.heading, fontSize: "clamp(22px, 3vw, 30px)", fontWeight: 800, color: t.color.text }}>
                  Com o Nex, tudo fica conectado.
                </p>
                <p style={{ margin: "12px auto 0", maxWidth: 520, fontSize: 14, lineHeight: 1.65, color: t.color.textMuted }}>
                  Venda no PDV, movimente o estoque, consulte o cliente e acompanhe a operação no mesmo lugar — com
                  sincronização automática.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Recursos */}
        <section id="recursos" style={{ padding: "48px 0 80px" }}>
          <div style={container}>
            <Reveal>
              <h2 style={{ ...sectionTitle, marginBottom: 40 }}>
                Tudo que sua loja precisa para vender e organizar a operação.
              </h2>
            </Reveal>
            <div className="nx-feature-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
              {PRODUCT_FEATURES.map((feature, i) => (
                <Reveal key={feature.title} delay={i * 40}>
                  <div style={{ ...cardSurface, padding: 24, height: "100%" }}>
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: "rgba(37, 99, 235, 0.14)", border: "1px solid rgba(37, 99, 235, 0.3)", display: "flex", alignItems: "center", justifyContent: "center", color: "#93C5FD" }}>
                      <feature.icon size={20} aria-hidden="true" />
                    </div>
                    <h3 style={{ margin: "16px 0 8px", fontFamily: t.font.heading, fontSize: 15, fontWeight: 700, color: t.color.text }}>{feature.title}</h3>
                    <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: t.color.textMuted }}>{feature.description}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Como funciona */}
        <section id="como-funciona" style={{ padding: "48px 0 80px" }}>
          <div style={container}>
            <Reveal>
              <div style={{ textAlign: "center", marginBottom: 40 }}>
                <h2 style={sectionTitle}>Como funciona</h2>
                <p style={{ margin: 0, fontSize: 16, color: t.color.textMuted }}>Três passos para colocar sua loja no Nex.</p>
              </div>
            </Reveal>
            <div className="nx-steps-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
              {[
                { step: "1", title: "Crie sua conta", description: "Escolha um plano e crie seu acesso em poucos minutos." },
                { step: "2", title: "Configure sua loja", description: "Cadastre produtos, estoque e clientes da sua operação." },
                { step: "3", title: "Comece a vender", description: "Use o PDV no dia a dia e acompanhe tudo pela plataforma." },
              ].map((step, i) => (
                <Reveal key={step.step} delay={i * 50}>
                  <div style={{ textAlign: "center" }}>
                    <span style={{ display: "inline-flex", width: 56, height: 56, alignItems: "center", justifyContent: "center", borderRadius: t.radius.lg, background: `linear-gradient(135deg, ${t.color.accent} 0%, #0EA371 100%)`, fontFamily: t.font.heading, fontSize: 22, fontWeight: 800, color: t.color.accentText }}>
                      {step.step}
                    </span>
                    <h3 style={{ margin: "16px 0 8px", fontFamily: t.font.heading, fontSize: 17, fontWeight: 700, color: t.color.text }}>{step.title}</h3>
                    <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: t.color.textMuted }}>{step.description}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Planos */}
        <section id="planos" style={{ padding: "48px 0 80px" }}>
          <div style={container}>
            <Reveal>
              <div style={{ textAlign: "center", marginBottom: 40 }}>
                <h2 style={sectionTitle}>Escolha o plano ideal para o seu negócio</h2>
                <p style={{ margin: 0, fontSize: 16, color: t.color.textMuted }}>
                  Planos com cobrança recorrente via Mercado Pago. Cancele quando quiser.
                </p>
              </div>
            </Reveal>

            {loadError ? (
              <p style={{ maxWidth: 520, margin: "0 auto 24px", padding: "16px 20px", borderRadius: t.radius.lg, border: "1px solid rgba(251, 191, 36, 0.35)", background: "rgba(251, 191, 36, 0.08)", textAlign: "center", fontSize: 14, color: "#FCD34D" }}>
                Não foi possível carregar os planos agora. Atualize a página ou fale conosco pelo WhatsApp.
              </p>
            ) : null}

            {!loadError && sortedPlans.length === 0 ? (
              <p style={{ maxWidth: 520, margin: "0 auto", padding: "16px 20px", borderRadius: t.radius.lg, border: `1px solid ${t.color.border}`, background: "rgba(30, 41, 59, 0.45)", textAlign: "center", fontSize: 14, color: t.color.textMuted }}>
                Nenhum plano disponível no momento. Fale conosco pelo WhatsApp.
              </p>
            ) : null}

            <div className="nx-plans-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24, alignItems: "stretch" }}>
              {sortedPlans.map((plan, i) => {
                const tierMeta = resolveTierMeta(plan.name, sortedPlans.length);
                return (
                  <Reveal key={plan.id} delay={i * 60}>
                    <PlanCard plan={plan} tierMeta={tierMeta} checkoutEnabled={checkoutEnabled} />
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* Comparação */}
        <section style={{ padding: "48px 0 80px" }}>
          <div style={container}>
            <Reveal>
              <div style={{ textAlign: "center", marginBottom: 36 }}>
                <h2 style={sectionTitle}>Compare os planos</h2>
                <p style={{ margin: 0, fontSize: 16, color: t.color.textMuted }}>Recursos e limites reais de cada tier.</p>
              </div>
            </Reveal>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {ORDERED_PLAN_NAMES.map((name, i) => {
                const features = TIER_FEATURES[name] ?? [];
                const limitInfo = TIER_LIMITS[name] ?? null;
                return (
                  <Reveal key={name} delay={i * 40}>
                    <div style={{ ...cardSurface, padding: "24px 28px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                        <h3 style={{ margin: 0, fontFamily: t.font.heading, fontSize: 18, fontWeight: 700, color: t.color.text }}>{name}</h3>
                        {limitInfo ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: t.color.textMuted }}>
                            <limitInfo.icon size={14} aria-hidden="true" />
                            {limitInfo.label}: {limitInfo.value}
                          </span>
                        ) : null}
                      </div>
                      <ul style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                        {features.map((feature) => (
                          <li key={feature} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 14, color: t.color.textBody }}>
                            <Check size={14} style={{ marginTop: 3, flexShrink: 0, color: t.color.accent }} aria-hidden="true" />
                            {feature}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        <FaqSection />

        {/* CTA final */}
        <section style={{ padding: "48px 0 80px" }}>
          <div style={container}>
            <Reveal>
              <div
                style={{
                  padding: 1.5,
                  borderRadius: t.radius.xl,
                  background: `linear-gradient(135deg, ${t.color.secondary} 0%, ${t.color.accent} 100%)`,
                  boxShadow: "0 24px 80px -24px rgba(37, 99, 235, 0.45)",
                }}
              >
                <div
                  style={{
                    borderRadius: 22.5,
                    textAlign: "center",
                    padding: "clamp(48px, 7vw, 72px) 24px",
                    background: [
                      "radial-gradient(600px 300px at 18% 0%, rgba(37, 99, 235, 0.28), transparent 62%)",
                      "radial-gradient(520px 300px at 82% 100%, rgba(16, 185, 129, 0.22), transparent 62%)",
                      "#0F172A",
                    ].join(", "),
                  }}
                >
                  <h2 style={{ margin: "0 auto 14px", maxWidth: 640, fontFamily: t.font.heading, fontSize: "clamp(26px, 3.6vw, 40px)", fontWeight: 800, color: "#FFFFFF" }}>
                    Pronto para organizar sua operação?
                  </h2>
                  <p style={{ margin: "0 auto 28px", maxWidth: 480, fontSize: 16, lineHeight: 1.6, color: t.color.textBody }}>
                    Comece a vender e gerencie sua loja em um só lugar.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12 }}>
                    <Link
                      href={isAuthenticated ? pdvHref : "/login"}
                      className="nx-plan-cta"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        height: 52,
                        padding: "0 32px",
                        borderRadius: t.radius.md,
                        background: "#FFFFFF",
                        color: t.color.primary,
                        fontSize: 15,
                        fontWeight: 800,
                        fontFamily: t.font.heading,
                        textDecoration: "none",
                      }}
                    >
                      Começar agora
                      <ArrowRight size={18} aria-hidden="true" />
                    </Link>
                    <a
                      href="#planos"
                      className="nx-plan-cta nx-plan-cta-ghost"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        height: 52,
                        padding: "0 28px",
                        borderRadius: t.radius.md,
                        border: "1px solid rgba(255, 255, 255, 0.35)",
                        color: "#FFFFFF",
                        fontSize: 15,
                        fontWeight: 600,
                        textDecoration: "none",
                        background: "transparent",
                      }}
                    >
                      Ver planos
                    </a>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
