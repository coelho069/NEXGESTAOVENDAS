"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

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
  const isPaid = outcome === "paid";
  const isPending = outcome === "pending";
  const isFailed = outcome === "failed";
  const showNeutral = outcome === "unknown" || outcome === null;

  const amount = state.data?.amount != null ? formatBRL(state.data.amount, state.data.currency) : null;

  return (
    <main className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Nex Gestão Vendas — início">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white shadow-sm">
              NX
            </span>
            <span className="text-sm font-bold uppercase tracking-wider text-slate-900 sm:text-base">
              Nex Gestão Vendas
            </span>
          </Link>
        </div>
      </header>

      <section className="mx-auto w-full max-w-md flex-1 px-4 py-10 sm:py-16">
        {showNeutral ? (
          <NeutralState loading={state.loading} error={state.error} onRetry={fetchStatus} />
        ) : isPaid ? (
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl"
              aria-hidden="true"
            >
              ✅
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Pagamento confirmado</h1>
            <p className="mt-2 text-sm text-slate-600">
              Tudo certo{state.data?.masked_email ? `, ${state.data.masked_email}` : ""}! Sua assinatura está ativa.
            </p>

            <dl className="mt-6 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              {state.data?.plan_name ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Plano</dt>
                  <dd className="font-semibold text-slate-900">{state.data.plan_name}</dd>
                </div>
              ) : null}
              {amount ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Valor</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">{amount}</dd>
                </div>
              ) : null}
            </dl>

            <p className="mt-4 text-sm leading-relaxed text-slate-600">
              {state.data?.access_email_sent ? (
                <>
                  Enviamos o acesso do PDV para{" "}
                  <span className="font-medium text-slate-900">{state.data.masked_email}</span>. Confira também a
                  caixa de spam.
                </>
              ) : (
                <>
                  Sua conta foi criada. O e-mail de acesso será enviado em instantes — se não chegar em alguns
                  minutos, fale com o suporte.
                </>
              )}
            </p>

            <Link
              href={loginHref}
              className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
            >
              Ir para o login do PDV
            </Link>
          </article>
        ) : isPending ? (
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl"
              aria-hidden="true"
            >
              ⏳
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
              Pagamento em processamento
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Recebemos seu pagamento e ele está em análise. Pagamentos por PIX ou boleto podem levar alguns
              minutos (até 2 dias úteis para boleto) para serem confirmados. Você não precisa fazer nada agora.
            </p>

            <dl className="mt-6 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              {state.data?.plan_name ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Plano</dt>
                  <dd className="font-semibold text-slate-900">{state.data.plan_name}</dd>
                </div>
              ) : null}
              {amount ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Valor</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">{amount}</dd>
                </div>
              ) : null}
            </dl>

            <p className="mt-4 text-sm text-slate-600">
              O acesso ao PDV é liberado assim que o pagamento for confirmado.
            </p>

            <button
              type="button"
              onClick={() => void fetchStatus()}
              disabled={state.loading}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
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
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-2xl"
              aria-hidden="true"
            >
              ❌
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
              Não foi possível concluir
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              O pagamento não foi aprovado ou foi cancelado. Nenhuma cobrança foi efetivada. Você pode tentar
              novamente com outra forma de pagamento.
            </p>

            <div className="mt-6 flex flex-col gap-3">
              <Link
                href="/planos"
                className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
              >
                Tentar novamente
              </Link>
              <Link
                href="/"
                className="inline-flex w-full items-center justify-center rounded-lg border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
              >
                Voltar ao início
              </Link>
            </div>
          </article>
        )}
      </section>

      <footer className="border-t border-slate-200 bg-white py-6">
        <p className="text-center text-xs text-slate-500">
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
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100" aria-hidden="true">
        {error ? (
          <span className="text-xl">❓</span>
        ) : (
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        )}
      </div>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Estamos confirmando…</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        {error
          ? "Não conseguimos verificar seu pagamento agora. Atualize em instantes."
          : "Recebemos o retorno do pagamento e estamos confirmando os dados. Esta página atualiza automaticamente."}
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={loading}
        className="mt-6 inline-flex w-full items-center justify-center rounded-lg border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Verificando…" : "Atualizar"}
      </button>
    </article>
  );
}
