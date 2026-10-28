"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PaymentApprovedScreen } from "@/components/marketing/payment-approved-screen";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";

export type PaymentScreenOutcome = "paid" | "pending" | "failed" | "unknown";

export type PaymentStatusResponse = {
  outcome: PaymentScreenOutcome;
  plan_name: string | null;
  amount: number | null;
  currency: string | null;
  masked_email: string | null;
  access_email_sent: boolean;
};

type Props = {
  /** Static route intent: sucesso | pendente | falha. */
  variant: "sucesso" | "pendente" | "falha";
  /** Query string from MP return (payment_id, external_reference, ...). */
  query: Record<string, string>;
  /** Existing PDV login route — CTA target on success. */
  loginHref: string;
};

function formatBRL(amount: number, currency: string | null): string {
  if (currency && currency.toUpperCase() !== "BRL") {
    return `${currency} ${amount.toFixed(2)}`;
  }
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
}

/** Preserve MP params, whitelisted — never reflected raw into the DOM. */
const MP_PARAM_KEYS = [
  "collection_id",
  "collection_status",
  "payment_id",
  "status",
  "external_reference",
  "preference_id",
  "merchant_order_id",
] as const;

function pickMpParams(search: string): Record<string, string> {
  const params = new URLSearchParams(search);
  const picked: Record<string, string> = {};
  for (const key of MP_PARAM_KEYS) {
    const value = params.get(key);
    if (value) picked[key] = value;
  }
  return picked;
}

const CSS = `
.nx-pay-cta {
  border: none;
  border-radius: ${t.radius.md};
  color: #FFFFFF;
  text-decoration: none;
  font-family: ${t.font.body};
  background: linear-gradient(135deg, ${t.color.secondary} 0%, #1D4ED8 55%, ${t.color.accent} 100%);
  box-shadow: ${t.shadow.ctaGlow};
  transition: box-shadow ${t.motion.fast} ease, transform ${t.motion.fast} ease, filter ${t.motion.fast} ease, opacity ${t.motion.fast} ease;
}
.nx-pay-cta:focus-visible { outline: 2px solid ${t.color.accent}; outline-offset: 3px; }
.nx-pay-cta:disabled { cursor: not-allowed; opacity: 0.55; box-shadow: none; filter: grayscale(0.2); }
@media (hover: hover) {
  .nx-pay-cta:not(:disabled):hover {
    box-shadow: ${t.shadow.ctaAccentGlow};
    transform: translateY(-1px);
    filter: brightness(1.05);
  }
}
.nx-pay-ghost {
  border: 1px solid ${t.color.borderStrong};
  border-radius: ${t.radius.md};
  background: transparent;
  color: ${t.color.textBody};
  text-decoration: none;
  font-family: ${t.font.body};
  transition: background ${t.motion.fast} ease, color ${t.motion.fast} ease;
}
.nx-pay-ghost:hover, .nx-pay-ghost:focus-visible { background: rgba(255, 255, 255, 0.06); color: ${t.color.text}; outline: none; }
.nx-pay-ghost:disabled { cursor: not-allowed; opacity: 0.55; }
.nx-pay-footer-link {
  color: ${t.color.textMuted};
  text-decoration: none;
  transition: color ${t.motion.fast} ease;
}
.nx-pay-footer-link:hover, .nx-pay-footer-link:focus-visible { color: ${t.color.text}; outline: none; }
@media (prefers-reduced-motion: reduce) {
  .nx-pay-cta, .nx-pay-ghost, .nx-pay-footer-link { transition: none; }
  .nx-pay-cta:not(:disabled):hover { transform: none; }
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

const innerPanel: CSSProperties = {
  borderRadius: t.radius.lg,
  border: `1px solid ${t.color.border}`,
  background: "rgba(15, 23, 42, 0.45)",
};

const heading: CSSProperties = {
  color: t.color.text,
  fontFamily: t.font.heading,
  letterSpacing: "-0.02em",
};

const bodyText: CSSProperties = { color: t.color.textBody };
const mutedText: CSSProperties = { color: t.color.textMuted };

const brandMark: CSSProperties = {
  background: `linear-gradient(135deg, ${t.color.secondary} 0%, ${t.color.accent} 100%)`,
  color: "#FFFFFF",
  boxShadow: t.shadow.ctaGlow,
};

function iconBubble(tone: "amber" | "rose" | "neutral"): CSSProperties {
  const palette = {
    amber: { bg: "rgba(245, 158, 11, 0.14)", border: "rgba(245, 158, 11, 0.35)" },
    rose: { bg: "rgba(239, 68, 68, 0.14)", border: "rgba(239, 68, 68, 0.35)" },
    neutral: { bg: "rgba(148, 163, 184, 0.14)", border: "rgba(148, 163, 184, 0.3)" },
  }[tone];
  return {
    background: palette.bg,
    border: `1px solid ${palette.border}`,
    color: t.color.text,
  };
}

export function PaymentConfirmationScreen({ variant, query, loginHref }: Props) {
  // SSR-safe: read window.location once on mount to avoid hydration mismatch.
  const [mpQuery, setMpQuery] = useState<Record<string, string>>(query);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setMpQuery(pickMpParams(window.location.search));
    }
  }, []);

  const [state, setState] = useState<{
    loading: boolean;
    data: PaymentStatusResponse | null;
    error: string | null;
  }>({ loading: true, data: null, error: null });

  const fetchStatus = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const search = new URLSearchParams(mpQuery).toString();
      const response = await fetch(`/api/subscriptions/mercadopago/public-checkout/status?${search}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        setState((prev) => ({ ...prev, loading: false, error: "status_unavailable" }));
        return;
      }
      const data = (await response.json()) as PaymentStatusResponse;
      setState({ loading: false, data, error: null });
    } catch {
      setState((prev) => ({ ...prev, loading: false, error: "status_unavailable" }));
    }
  }, [mpQuery]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Neutral state: auto-refetch a few times while MP/webhook settle.
  const attemptsRef = useRef(0);
  useEffect(() => {
    const unknown = state.data?.outcome === "unknown" || (!state.loading && !state.data && !state.error);
    const stalePendingOnSuccessRoute = variant === "sucesso" && state.data?.outcome === "pending";
    if (!unknown && !stalePendingOnSuccessRoute) return;
    if (attemptsRef.current >= 2) return;
    const timer = setTimeout(
      () => {
        attemptsRef.current += 1;
        void fetchStatus();
      },
      attemptsRef.current === 0 ? 3_000 : 6_000
    );
    return () => clearTimeout(timer);
  }, [state.data, state.loading, state.error, variant, fetchStatus]);

  const outcome = state.data?.outcome ?? null;
  const isPending = outcome === "pending";
  const isFailed = outcome === "failed";
  const showNeutral = variant !== "sucesso" && (outcome === "unknown" || outcome === null);
  // /pagamento/sucesso is the Mercado Pago auto_return for an approved payment.
  // Show that screen immediately; only leave it when the status API says otherwise.
  const showApproved = variant === "sucesso" ? !isPending && !isFailed : outcome === "paid";

  const amount = state.data?.amount != null ? formatBRL(state.data.amount, state.data.currency) : null;

  if (showApproved) {
    return (
      <PaymentApprovedScreen
        planName={state.data?.plan_name ?? null}
        amountLabel={amount}
        maskedEmail={state.data?.masked_email ?? null}
        accessEmailSent={state.data?.access_email_sent === true}
        loginHref={loginHref}
      />
    );
  }

  return (
    <main className="flex min-h-screen flex-col" style={page}>
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
      <header style={{ position: "relative", zIndex: 1, borderBottom: `1px solid ${t.color.border}`, background: t.color.glassBg }}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2.5"
            aria-label="Nex Gestão Vendas — início"
            style={{ textDecoration: "none" }}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold" style={brandMark}>
              NX
            </span>
            <span className="text-sm font-bold uppercase tracking-wider sm:text-base" style={heading}>
              Nex Gestão Vendas
            </span>
          </Link>
        </div>
      </header>

      <section className="relative z-[1] mx-auto w-full max-w-md flex-1 px-4 py-10 sm:py-16">
        {showNeutral ? (
          <NeutralState loading={state.loading} error={state.error} onRetry={fetchStatus} />
        ) : isPending ? (
          <article className="p-6 sm:p-8" style={glassCard}>
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full text-2xl"
              style={iconBubble("amber")}
              aria-hidden="true"
            >
              ⏳
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight" style={heading}>
              Pagamento em processamento
            </h1>
            <p className="mt-2 text-sm leading-relaxed" style={bodyText}>
              Recebemos seu pagamento e ele está em análise. Pagamentos por PIX ou boleto podem levar alguns
              minutos (até 2 dias úteis para boleto) para serem confirmados. Você não precisa fazer nada agora.
            </p>

            <dl className="mt-6 space-y-3 p-4 text-sm" style={innerPanel}>
              {state.data?.plan_name ? (
                <div className="flex items-center justify-between gap-4">
                  <dt style={mutedText}>Plano</dt>
                  <dd className="font-semibold" style={{ color: t.color.text }}>{state.data.plan_name}</dd>
                </div>
              ) : null}
              {amount ? (
                <div className="flex items-center justify-between gap-4">
                  <dt style={mutedText}>Valor</dt>
                  <dd className="font-semibold tabular-nums" style={{ color: t.color.text }}>{amount}</dd>
                </div>
              ) : null}
            </dl>

            <p className="mt-4 text-sm" style={bodyText}>
              O acesso ao PDV é liberado assim que o pagamento for confirmado.
            </p>

            <button
              type="button"
              onClick={() => void fetchStatus()}
              disabled={state.loading}
              className="nx-pay-cta mt-6 inline-flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-semibold"
            >
              {state.loading ? (
                <>
                  <span
                    className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                    aria-hidden="true"
                  />
                  Atualizando…
                </>
              ) : (
                "Já paguei — atualizar"
              )}
            </button>
          </article>
        ) : (
          <article className="p-6 sm:p-8" style={glassCard}>
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full text-2xl"
              style={iconBubble("rose")}
              aria-hidden="true"
            >
              ❌
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight" style={heading}>
              Não foi possível concluir
            </h1>
            <p className="mt-2 text-sm leading-relaxed" style={bodyText}>
              O pagamento não foi aprovado ou foi cancelado. Nenhuma cobrança foi efetivada. Você pode tentar
              novamente com outra forma de pagamento.
            </p>

            <div className="mt-6 flex flex-col gap-3">
              <Link
                href="/planos"
                className="nx-pay-cta inline-flex w-full items-center justify-center px-4 py-3 text-sm font-semibold"
              >
                Tentar novamente
              </Link>
              <Link
                href="/"
                className="nx-pay-ghost inline-flex w-full items-center justify-center px-4 py-3 text-sm font-semibold"
              >
                Voltar ao início
              </Link>
            </div>
          </article>
        )}
      </section>

      <footer className="relative z-[1] py-6" style={{ borderTop: `1px solid ${t.color.border}`, background: "rgba(15, 23, 42, 0.45)" }}>
        <p className="text-center text-xs" style={mutedText}>
          Nex Gestão Vendas · Pagamentos processados pelo Mercado Pago
        </p>
      </footer>
    </main>
  );
}

function NeutralState({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <article className="p-6 sm:p-8" style={glassCard}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full" style={iconBubble("neutral")} aria-hidden="true">
        {error ? (
          <span className="text-xl">❓</span>
        ) : (
          <span
            className="h-6 w-6 animate-spin rounded-full border-2"
            style={{ borderColor: "rgba(148, 163, 184, 0.35)", borderTopColor: t.color.accent }}
          />
        )}
      </div>
      <h1 className="mt-4 text-2xl font-bold tracking-tight" style={heading}>Estamos confirmando…</h1>
      <p className="mt-2 text-sm leading-relaxed" style={bodyText}>
        {error
          ? "Não conseguimos verificar seu pagamento agora. Atualize em instantes."
          : "Recebemos o retorno do pagamento e estamos confirmando os dados. Esta página atualiza automaticamente."}
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={loading}
        className="nx-pay-ghost mt-6 inline-flex w-full items-center justify-center px-4 py-3 text-sm font-semibold"
      >
        {loading ? "Verificando…" : "Atualizar"}
      </button>
    </article>
  );
}
