import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { Ticket } from "lucide-react";
import Link from "next/link";
import { OpenAnneSupportButton } from "@/components/support/open-anne-support-button";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";

export const metadata: Metadata = {
  title: "Suporte · Tickets — Nex Gestão Vendas",
  description: "Acompanhe os chamados de suporte do PDV Nex Gestão Vendas.",
};

const CSS = `
.nx-tickets-ghost {
  display: inline-flex;
  align-items: center;
  border: 1px solid ${t.color.borderStrong};
  border-radius: ${t.radius.md};
  background: transparent;
  padding: 8px 14px;
  font-size: 14px;
  font-weight: 600;
  font-family: ${t.font.body};
  color: ${t.color.textBody};
  text-decoration: none;
  transition: background ${t.motion.fast} ease, color ${t.motion.fast} ease;
}
.nx-tickets-ghost:hover, .nx-tickets-ghost:focus-visible {
  background: rgba(255, 255, 255, 0.06);
  color: ${t.color.text};
  outline: none;
}
`;

const page: CSSProperties = {
  minHeight: "100vh",
  background: t.color.bg,
  color: t.color.textBody,
  fontFamily: t.font.body,
  WebkitFontSmoothing: "antialiased",
  position: "relative",
  overflowX: "hidden",
};

const glassCard: CSSProperties = {
  borderRadius: t.radius.xl,
  border: `1px solid ${t.color.glassBorder}`,
  background: t.color.glassBg,
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  boxShadow: `${t.shadow.card}, 0 0 0 1px rgba(255, 255, 255, 0.03) inset`,
};

const iconBubble: CSSProperties = {
  background: `linear-gradient(135deg, ${t.color.secondary} 0%, ${t.color.accent} 100%)`,
  color: "#FFFFFF",
  boxShadow: t.shadow.ctaGlow,
};

export default function TicketsPage() {
  return (
    <div style={page}>
      <style>{CSS}</style>
      <div
        aria-hidden="true"
        style={{
          pointerEvents: "none",
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(900px 480px at 50% -80px, rgba(37, 99, 235, 0.16) 0%, rgba(37, 99, 235, 0.04) 48%, transparent 72%), radial-gradient(640px 360px at 100% 100%, rgba(16, 185, 129, 0.08) 0%, transparent 65%)",
        }}
      />
      <main className="relative z-[1] mx-auto max-w-3xl px-4 py-10">
        <header className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg" style={iconBubble}>
            <Ticket size={22} aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight" style={{ color: t.color.text, fontFamily: t.font.heading }}>
              Tickets de Suporte
            </h1>
            <p className="text-sm" style={{ color: t.color.textMuted }}>Chamados do sistema NEX Gestão Vendas</p>
          </div>
        </header>

        <div className="p-6 text-sm leading-relaxed" style={{ ...glassCard, color: t.color.textBody }}>
          <p className="font-semibold" style={{ color: t.color.text }}>Nenhum ticket ainda</p>
          <p className="mt-1">
            Precisa de ajuda agora? Fale com a Anne, assistente virtual de suporte, pelo chat no
            canto inferior direito — o atendimento é rápido para incidentes de caixa (impressora,
            rede, sync).
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/" className="nx-tickets-ghost">
              Voltar ao início
            </Link>
            <OpenAnneSupportButton
              label="Abrir chat de suporte"
              testId="tickets-anne-chat-cta"
              className="inline-flex items-center gap-2 rounded-[12px] bg-[linear-gradient(135deg,#2563EB_0%,#1D4ED8_55%,#10B981_100%)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_32px_-8px_rgba(37,99,235,0.55)] transition-shadow hover:shadow-[0_12px_32px_-8px_rgba(16,185,129,0.45)] disabled:cursor-not-allowed disabled:opacity-55"
            />
          </div>
        </div>
      </main>
    </div>
  );
}
