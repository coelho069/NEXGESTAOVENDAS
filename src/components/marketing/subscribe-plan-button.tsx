"use client";

import { useState } from "react";
import Link from "next/link";
import { CreditCard, Loader2 } from "lucide-react";

export function SubscribePlanButton({
  planId,
  planLabel,
  checkoutEnabled,
  isAuthenticated,
}: {
  planId: string;
  planLabel: string;
  checkoutEnabled: boolean;
  isAuthenticated: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!checkoutEnabled) {
    return (
      <span
        aria-disabled="true"
        className="inline-flex w-full cursor-not-allowed items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-400"
      >
        Em breve
      </span>
    );
  }

  if (!isAuthenticated) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent("/")}`}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-600 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
      >
        Entrar para assinar
      </Link>
    );
  }

  async function handleSubscribe() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/subscriptions/mercadopago/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: planId,
          client_mutation_id: crypto.randomUUID(),
        }),
      });
      const payload = (await response.json()) as { init_point?: string; error?: string };
      if (!response.ok || !payload.init_point) {
        setError(payload.error ?? "checkout_unavailable");
        return;
      }
      window.location.assign(payload.init_point);
    } catch {
      setError("checkout_unavailable");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <button
        type="button"
        onClick={() => void handleSubscribe()}
        disabled={loading}
        aria-label={`Assinar plano ${planLabel} com Mercado Pago`}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {loading ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : null}
        <CreditCard size={18} aria-hidden="true" />
        Assinar com Mercado Pago
      </button>
      {error ? (
        <p role="alert" className="text-center text-xs text-rose-600">
          Não foi possível iniciar o checkout. Tente novamente ou fale conosco.
        </p>
      ) : null}
    </div>
  );
}
