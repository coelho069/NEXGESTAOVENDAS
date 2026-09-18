"use client";

import { useState } from "react";
import { Loader2, X, CreditCard } from "lucide-react";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type StripeCheckoutResponse = {
  checkout_url?: string;
  error?: string;
};

/**
 * Sole subscription rail on the plans page: Stripe Checkout (mode=subscription)
 * for plans mapped via STRIPE_PRICE_PLAN_<SLUG>. Plans without a mapping never
 * render this component with an actionable button.
 */
async function requestStripeCheckout(body: {
  plan_id: string;
  payer_email: string;
  client_mutation_id: string;
}): Promise<{ checkoutUrl: string | null }> {
  const response = await fetch("/api/subscriptions/stripe/public-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as StripeCheckoutResponse;
  if (!response.ok || !payload.checkout_url) {
    return { checkoutUrl: null };
  }
  return { checkoutUrl: payload.checkout_url };
}

function StartStripeCheckoutForm({
  planId,
  planLabel,
  onDone,
}: {
  planId: string;
  planLabel: string;
  onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (loading) return;
    const normalized = email.trim();
    if (!EMAIL_PATTERN.test(normalized)) {
      setError("invalid_email");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { checkoutUrl } = await requestStripeCheckout({
        plan_id: planId,
        payer_email: normalized,
        client_mutation_id: crypto.randomUUID(),
      });
      if (!checkoutUrl) {
        setError("checkout_unavailable");
        return;
      }
      window.location.assign(checkoutUrl);
    } catch {
      setError("checkout_unavailable");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Assinar plano ${planLabel}`}
    >
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Começar agora</h3>
            <p className="mt-1 text-sm text-slate-600">
              Informe seu e-mail para assinar o plano {planLabel}.
            </p>
          </div>
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
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
          <label className="text-sm font-medium text-slate-700" htmlFor="checkout-email">
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
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
          />
          <p className="text-xs text-slate-500">
            Você será direcionado ao checkout seguro do Stripe para concluir a assinatura.
            Após o pagamento, enviaremos seu acesso por este e-mail.
          </p>
          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <CreditCard size={18} aria-hidden="true" />}
            {loading ? "Preparando..." : "Continuar para o pagamento"}
          </button>
          {error === "invalid_email" ? (
            <p role="alert" className="text-center text-xs text-rose-600">
              Informe um e-mail válido.
            </p>
          ) : null}
          {error === "checkout_unavailable" ? (
            <p role="alert" className="text-center text-xs text-rose-600">
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
  /** Server-resolved STRIPE_PRICE_PLAN_<SLUG> mapping for this plan. */
  stripeEnabled: boolean;
  /** Global subscription checkout gate (env). */
  subscriptionEnabled: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  if (!subscriptionEnabled) {
    return (
      <span className="inline-flex w-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-500">
        Em breve
      </span>
    );
  }

  if (!stripeEnabled) {
    return (
      <span className="inline-flex w-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-500">
        Indisponível para assinatura
      </span>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
      >
        <CreditCard size={18} aria-hidden="true" />
        Assinar com Stripe
      </button>
      {modalOpen ? (
        <StartStripeCheckoutForm
          planId={planId}
          planLabel={planLabel}
          onDone={() => setModalOpen(false)}
        />
      ) : null}
    </div>
  );
}
