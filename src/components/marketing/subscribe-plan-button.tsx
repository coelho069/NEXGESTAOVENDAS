"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, X, CreditCard } from "lucide-react";
import { REFUND_POLICY_PATH } from "@/lib/domain/refund-policy";
import { MIN_SUBSCRIPTION_AGE, isAdultOnDate, isIsoDate, todayInSaoPaulo } from "@/lib/domain/age-gate";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Folha local do componente (tema escuro da landing / login). Só aparência:
 * não altera comportamento nem markup semântico.
 */
const PLAN_CSS = `
.nx-plan-overlay { background: #0B0F19B3; }
.nx-plan-card {
  background: ${t.color.glassBg};
  border: 1px solid ${t.color.glassBorder};
  box-shadow: ${t.shadow.card};
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
.nx-plan-title { color: ${t.color.text}; }
.nx-plan-body { color: ${t.color.textBody}; }
.nx-plan-muted { color: ${t.color.textMuted}; }
.nx-plan-label { color: ${t.color.textBody}; }
.nx-plan-link { color: ${t.color.accent}; text-decoration: none; }
.nx-plan-link:hover { text-decoration: underline; }
.nx-plan-close { color: ${t.color.textMuted}; }
.nx-plan-close:hover { background: rgba(255, 255, 255, 0.06); color: ${t.color.text}; }
.nx-plan-close:focus-visible { outline: 2px solid ${t.color.accent}; outline-offset: 2px; }
.nx-plan-input {
  background: ${t.color.surface};
  border-color: ${t.color.borderStrong};
  color: ${t.color.text};
}
.nx-plan-input::placeholder { color: ${t.color.textMuted}; }
.nx-plan-input:focus {
  border-color: ${t.color.accent};
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.3);
}
.nx-plan-cta {
  border: none;
  color: #FFFFFF;
  background: linear-gradient(135deg, ${t.color.secondary} 0%, #1D4ED8 55%, ${t.color.accent} 100%);
  box-shadow: ${t.shadow.ctaGlow};
  font-family: ${t.font.body};
  transition: box-shadow ${t.motion.fast} ease, transform ${t.motion.fast} ease, filter ${t.motion.fast} ease, opacity ${t.motion.fast} ease;
}
.nx-plan-cta:not(:disabled):hover { filter: brightness(1.08); transform: translateY(-1px); }
.nx-plan-cta:focus-visible { outline: 2px solid ${t.color.accent}; outline-offset: 2px; }
.nx-plan-cta:disabled { opacity: 0.7; cursor: not-allowed; }
.nx-plan-soon {
  background: ${t.color.glassBg};
  border: 1px solid ${t.color.glassBorder};
  color: ${t.color.textMuted};
}
.nx-plan-error { color: #FDA4AF; }
@media (prefers-reduced-motion: reduce) {
  .nx-plan-cta, .nx-plan-cta:not(:disabled):hover { transition: none; transform: none; }
}
`;

function PlanButtonStyles() {
  return <style>{PLAN_CSS}</style>;
}

type CheckoutProResponse = {
  init_point?: string;
  error?: string;
};

/**
 * Contratação pública via Mercado Pago Checkout Pro (Preference → init_point).
 * Stripe Embedded / PIX Stripe ficam desligados. O visitante informa o e-mail,
 * o servidor devolve o init_point (ou sandbox_init_point) e o navegador redireciona.
 */
async function requestMercadoPagoCheckout(body: {
  plan_id: string;
  payer_email: string;
  birth_date: string;
  client_mutation_id: string;
}): Promise<{ initPoint: string | null }> {
  const response = await fetch("/api/subscriptions/mercadopago/public-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as CheckoutProResponse;
  if (!response.ok || !payload.init_point) {
    return { initPoint: null };
  }
  return { initPoint: payload.init_point };
}

function StartCheckoutForm({
  planId,
  planLabel,
  onDone,
}: {
  planId: string;
  planLabel: string;
  onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const adultConfirmed = isAdultOnDate(birthDate, todayInSaoPaulo());

  async function handleSubmit() {
    if (loading) return;
    const normalized = email.trim();
    if (!EMAIL_PATTERN.test(normalized)) {
      setError("invalid_email");
      return;
    }
    if (!isIsoDate(birthDate)) {
      setError("invalid_birth_date");
      return;
    }
    // Pergunta de idade: só quem tem 18 anos ou mais pode assinar. A data é
    // autodeclarada, e o servidor repete a checagem (rota public-checkout).
    if (!isAdultOnDate(birthDate, todayInSaoPaulo())) {
      setError("under_age");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { initPoint } = await requestMercadoPagoCheckout({
        plan_id: planId,
        payer_email: normalized,
        birth_date: birthDate,
        client_mutation_id: crypto.randomUUID(),
      });
      if (!initPoint) {
        setError("checkout_unavailable");
        return;
      }
      window.location.assign(initPoint);
    } catch {
      setError("checkout_unavailable");
    } finally {
      setLoading(false);
    }
  }


  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm nx-plan-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Assinar plano ${planLabel}`}
    >
      <PlanButtonStyles />
      <div className="w-full max-w-sm rounded-3xl p-6 nx-plan-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold nx-plan-title">Começar agora</h3>
            <p className="mt-1 text-sm nx-plan-body">
              Informe seu e-mail para assinar o plano {planLabel}.
            </p>
          </div>
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg p-1.5 transition-colors nx-plan-close"
            aria-label="Fechar"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form
          className="mt-5 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
            <label className="text-sm font-medium nx-plan-label" htmlFor="checkout-birth-date">
              Qual é a sua data de nascimento?
            </label>
            <input
              id="checkout-birth-date"
              type="date"
              required
              max={todayInSaoPaulo()}
              autoComplete="bday"
              value={birthDate}
              onChange={(event) => setBirthDate(event.target.value)}
              className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition-colors nx-plan-input"
            />
            <p className="text-xs nx-plan-muted">
              A assinatura é permitida apenas para maiores de {MIN_SUBSCRIPTION_AGE} anos.
            </p>
            {adultConfirmed ? (
            <>
            <label className="text-sm font-medium nx-plan-label" htmlFor="checkout-email">
              E-mail
            </label>
            <input
              id="checkout-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="voce@empresa.com.br"
              className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition-colors nx-plan-input"
            />
            <p className="text-xs nx-plan-muted">
              Você será direcionado ao checkout seguro do Mercado Pago (PIX ou cartão).
              Após o pagamento, enviaremos seu acesso por este e-mail.
            </p>
            <p className="text-xs nx-plan-muted">
              Ao continuar, você concorda com a{" "}
              <Link
                href={REFUND_POLICY_PATH}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold nx-plan-link"
              >
                Política de Reembolsos e Devoluções
              </Link>
              .
            </p>
            <button
              type="submit"
              disabled={loading}
              aria-busy={loading}
              className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold nx-plan-cta"
            >
              {loading ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <CreditCard size={18} aria-hidden="true" />}
              {loading ? "Preparando..." : "Continuar para o pagamento"}
            </button>
            </>
            ) : null}
            {error === "invalid_email" ? (
              <p role="alert" className="text-center text-xs nx-plan-error">
                Informe um e-mail válido.
              </p>
            ) : null}
            {error === "invalid_birth_date" ? (
              <p role="alert" className="text-center text-xs nx-plan-error">
                Informe sua data de nascimento.
              </p>
            ) : null}
            {isIsoDate(birthDate) && !adultConfirmed ? (
              <p role="alert" className="text-center text-xs nx-plan-error">
                É necessário ter {MIN_SUBSCRIPTION_AGE} anos ou mais para assinar.
              </p>
            ) : null}
            {error === "checkout_unavailable" ? (
              <p role="alert" className="text-center text-xs nx-plan-error">
                Não foi possível iniciar a contratação. Tente novamente.
              </p>
            ) : null}
          </form>
      </div>
    </div>
  );
}


export function SubscribePlanButton({
  planId,
  planLabel,
  stripeEnabled,
  subscriptionEnabled,
}: {
  planId: string;
  planLabel: string;
  /** Stripe fica desligado; gate efetivo é subscriptionEnabled (MP Checkout Pro). */
  stripeEnabled: boolean;
  /** Global subscription checkout gate (env). */
  subscriptionEnabled: boolean;
}) {
  void stripeEnabled;
  const [modalOpen, setModalOpen] = useState(false);

  if (!subscriptionEnabled) {
    return (
      <span className="inline-flex w-full items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-medium nx-plan-soon">
        <PlanButtonStyles />
        Em breve
      </span>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <PlanButtonStyles />
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors nx-plan-cta"
      >
        <CreditCard size={18} aria-hidden="true" />
        Assinar
      </button>
      {modalOpen ? (
        <StartCheckoutForm
          planId={planId}
          planLabel={planLabel}
          onDone={() => setModalOpen(false)}
        />
      ) : null}
    </div>
  );
}
