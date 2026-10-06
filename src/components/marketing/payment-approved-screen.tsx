"use client";

import Link from "next/link";
import { Check, Mail } from "lucide-react";
import { BrandMark } from "@/components/landing/components/BrandMark";
import { landingTheme as t, tabularNums } from "@/components/landing/theme/landing-theme";

type Props = {
  planName: string | null;
  amountLabel: string | null;
  maskedEmail: string | null;
  accessEmailSent: boolean;
  loginHref: string;
};

const CSS = `
.nx-approved-cta {
  display: inline-flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: ${t.radius.md};
  padding: 13px 18px;
  font-size: 15px;
  font-weight: 600;
  font-family: ${t.font.body};
  color: #FFFFFF;
  text-decoration: none;
  cursor: pointer;
  background: linear-gradient(135deg, ${t.color.secondary} 0%, #1D4ED8 55%, ${t.color.accent} 100%);
  box-shadow: ${t.shadow.ctaGlow};
  transition: box-shadow ${t.motion.fast} ease, transform ${t.motion.fast} ease, filter ${t.motion.fast} ease;
}
.nx-approved-cta:focus-visible { outline: 2px solid ${t.color.accent}; outline-offset: 3px; }
@media (hover: hover) {
  .nx-approved-cta:hover {
    box-shadow: ${t.shadow.ctaAccentGlow};
    transform: translateY(-1px);
    filter: brightness(1.05);
  }
}
.nx-approved-link {
  color: ${t.color.textMuted};
  text-decoration: none;
  font-size: 13.5px;
  font-weight: 500;
  transition: color ${t.motion.fast} ease;
}
.nx-approved-link:hover, .nx-approved-link:focus-visible {
  color: ${t.color.text};
  outline: none;
}
@media (prefers-reduced-motion: reduce) {
  .nx-approved-cta, .nx-approved-link { transition: none; }
  .nx-approved-cta:hover { transform: none; }
}
`;

export function PaymentApprovedScreen({
  planName,
  amountLabel,
  maskedEmail,
  accessEmailSent,
  loginHref,
}: Props) {
  const emailTarget = maskedEmail ?? "seu e-mail";

  return (
    <div
      data-testid="payment-approved"
      style={{
        position: "relative",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(20px, 5vw, 40px)",
        background: t.color.bg,
        color: t.color.text,
        fontFamily: t.font.body,
        WebkitFontSmoothing: "antialiased",
        overflowX: "hidden",
      }}
    >
      <style>{CSS}</style>
      <div
        aria-hidden="true"
        style={{
          pointerEvents: "none",
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(900px 480px at 50% -80px, rgba(16, 185, 129, 0.16) 0%, rgba(16, 185, 129, 0.04) 48%, transparent 72%), radial-gradient(640px 360px at 100% 100%, rgba(37, 99, 235, 0.10) 0%, transparent 65%)",
        }}
      />

      <main style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 480 }}>
        <article
          style={{
            width: "100%",
            padding: "clamp(28px, 5vw, 36px)",
            borderRadius: t.radius.xl,
            border: `1px solid ${t.color.glassBorder}`,
            background: t.color.glassBg,
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: `${t.shadow.card}, 0 0 0 1px rgba(255, 255, 255, 0.03) inset`,
          }}
        >
          <div style={{ marginBottom: 24, textAlign: "center" }}>
            <Link
              href="/"
              aria-label="NexGestão — voltar ao início"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                textDecoration: "none",
                marginBottom: 22,
              }}
            >
              <BrandMark size={32} gradientId="nx-approved-brand-grad" />
              <span
                style={{
                  color: t.color.text,
                  fontFamily: t.font.heading,
                  fontSize: 20,
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                }}
              >
                NexGestão
              </span>
            </Link>

            <div
              aria-hidden="true"
              style={{
                margin: "0 auto 16px",
                width: 56,
                height: 56,
                borderRadius: t.radius.full,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(16, 185, 129, 0.14)",
                border: "1px solid rgba(16, 185, 129, 0.35)",
                color: t.color.accent,
              }}
            >
              <Check size={28} strokeWidth={2.5} />
            </div>

            <p
              style={{
                margin: "0 0 8px",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: t.color.accent,
              }}
            >
              Assinatura ativa
            </p>
            <h1
              style={{
                margin: "0 0 8px",
                fontFamily: t.font.heading,
                fontSize: "clamp(26px, 5vw, 32px)",
                fontWeight: 800,
                letterSpacing: "-0.03em",
                lineHeight: 1.1,
                color: t.color.text,
              }}
            >
              Pagamento aprovado
            </h1>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: t.color.textMuted }}>
              Recebemos a confirmação do Mercado Pago. Sua assinatura já está ativa.
            </p>
          </div>

          <dl
            style={{
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: "14px 16px",
              borderRadius: t.radius.lg,
              border: `1px solid ${t.color.border}`,
              background: "rgba(15, 23, 42, 0.45)",
            }}
          >
            {planName ? <Row label="Plano" value={planName} /> : null}
            {amountLabel ? <Row label="Valor" value={amountLabel} numeric /> : null}
            <Row label="Status" value="Aprovado" accent />
          </dl>

          <div
            style={{
              marginTop: 16,
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              padding: "12px 14px",
              borderRadius: t.radius.lg,
              background: "rgba(37, 99, 235, 0.08)",
              border: "1px solid rgba(37, 99, 235, 0.22)",
            }}
          >
            <Mail size={18} aria-hidden="true" style={{ marginTop: 2, flexShrink: 0, color: "#93C5FD" }} />
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: t.color.textBody }}>
              {accessEmailSent ? (
                <>
                  Enviamos o acesso do PDV para <strong style={{ color: t.color.text }}>{emailTarget}</strong>.
                  Confira a caixa de entrada e o spam.
                </>
              ) : (
                <>
                  Sua conta foi criada. O e-mail de acesso chega em instantes em{" "}
                  <strong style={{ color: t.color.text }}>{emailTarget}</strong>. Se não aparecer em alguns
                  minutos, fale com o suporte.
                </>
              )}
            </p>
          </div>

          <ol
            style={{
              margin: "18px 0 0",
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <Step n="1" text="Abra o e-mail de acesso e guarde a senha temporária." />
            <Step n="2" text="Entre no PDV com o mesmo e-mail usado no pagamento." />
          </ol>

          <Link href={loginHref} className="nx-approved-cta" style={{ marginTop: 22 }}>
            Ir para o login do PDV
          </Link>

          <div
            style={{
              marginTop: 22,
              paddingTop: 16,
              borderTop: `1px solid ${t.color.border}`,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px 16px",
            }}
          >
            <Link href="/" className="nx-approved-link">
              Voltar ao início
            </Link>
            <span aria-hidden="true" style={{ color: t.color.borderStrong }}>
              ·
            </span>
            <Link href="/planos" className="nx-approved-link">
              Ver planos
            </Link>
          </div>
        </article>
        <p style={{ margin: "16px 0 0", textAlign: "center", fontSize: 12, color: t.color.textMuted }}>
          Nex Gestão Vendas · Pagamentos processados pelo Mercado Pago
        </p>
      </main>
    </div>
  );
}

function Row({
  label,
  value,
  numeric,
  accent,
}: {
  label: string;
  value: string;
  numeric?: boolean;
  accent?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
      <dt style={{ fontSize: 13.5, color: t.color.textMuted }}>{label}</dt>
      <dd
        style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 600,
          color: accent ? t.color.accent : t.color.text,
          ...(numeric ? tabularNums : null),
        }}
      >
        {value}
      </dd>
    </div>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <li style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 22,
          height: 22,
          borderRadius: t.radius.full,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 700,
          color: t.color.accentText,
          background: t.color.accent,
        }}
      >
        {n}
      </span>
      <span style={{ fontSize: 13.5, lineHeight: 1.45, color: t.color.textBody }}>{text}</span>
    </li>
  );
}
