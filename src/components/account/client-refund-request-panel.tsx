"use client";

import { useState } from "react";
import {
  CLIENT_REFUND_FORM_REASONS,
  type ClientRefundFormReason,
  type ClientRefundPaymentView,
} from "@/lib/domain/client-refund-eligibility";
import {
  REFUND_GMAIL_REQUIRED_MESSAGE,
  type RefundGmailAccess,
} from "@/lib/domain/refund-gmail-access";

export const CLIENT_REFUND_BUTTON_LABEL = "Solicitar reembolso";
export const CLIENT_REFUND_CONFIRMATION =
  "Entendo que esta solicitação será analisada e que o envio do pedido não garante o reembolso.";
export const CLIENT_REFUND_SUCCESS = "Solicitação enviada com sucesso.";
export const CLIENT_REFUND_OPEN_STATUS = "Status: Em análise";

const REASON_LABELS: Record<ClientRefundFormReason, string> = {
  arrependimento: "Arrependimento",
  cobranca_indevida: "Cobrança indevida",
  cobranca_duplicada: "Cobrança duplicada",
  falha_no_servico: "Falha no serviço",
  problema_tecnico: "Problema técnico",
  outro: "Outro motivo",
};

const ERROR_LABELS: Record<string, string> = {
  unauthenticated: "Entre na sua conta para solicitar a análise.",
  gmail_verified_required: REFUND_GMAIL_REQUIRED_MESSAGE,
  payment_not_owned: "Este pagamento não pertence à sua conta.",
  missing_payment: "Este pagamento não está elegível para análise.",
  unpaid: "Este pagamento não está elegível para análise.",
  unknown_paid_on: "Não foi possível confirmar a data deste pagamento.",
  outside_window: "Este pagamento está fora do prazo de 7 dias.",
  open_refund_request_exists: "Já existe um pedido em aberto para este pagamento.",
  idempotency_payload_mismatch: "Recarregue a página e envie o pedido outra vez.",
  validation_failed: "Revise o motivo do pedido.",
  csrf_failed: "Não foi possível enviar o pedido a partir desta página.",
  rate_limited: "Muitas tentativas. Aguarde e tente de novo.",
  unavailable: "Não foi possível registrar o pedido agora.",
};

function mutationId(mpPaymentId: string): string {
  const key = `nex-owned-refund-mutation:${mpPaymentId}`;
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(key, created);
  return created;
}

type RefundDraft = {
  reason: ClientRefundFormReason;
  notes: string;
  confirmed: boolean;
};

const EMPTY_DRAFT: RefundDraft = {
  reason: "arrependimento",
  notes: "",
  confirmed: false,
};

function PaymentRequestForm({
  payment,
  draft,
  onDraft,
  onSubmitted,
}: {
  payment: ClientRefundPaymentView;
  draft: RefundDraft;
  onDraft: (patch: Partial<RefundDraft>) => void;
  onSubmitted: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !draft.confirmed) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/refund-requests", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_mutation_id: mutationId(payment.mpPaymentId),
          mp_payment_id: payment.mpPaymentId,
          reason: draft.reason,
          notes: draft.notes,
          confirmed: true,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string; ok?: boolean } | null;
      if (!response.ok || !payload?.ok) {
        const code = payload?.error ?? "unavailable";
        setError(ERROR_LABELS[code] ?? ERROR_LABELS.unavailable);
        return;
      }
      window.sessionStorage.removeItem(`nex-owned-refund-mutation:${payment.mpPaymentId}`);
      onSubmitted();
    } catch {
      setError(ERROR_LABELS.unavailable);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 grid w-full gap-3"
      data-testid="client-refund-form"
      data-payment-id={payment.mpPaymentId}
    >
      <label className="grid gap-1 text-sm">
        Motivo
        <select
          required
          value={draft.reason}
          onChange={(event) => onDraft({ reason: event.target.value as ClientRefundFormReason })}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
        >
          {CLIENT_REFUND_FORM_REASONS.map((value) => (
            <option key={value} value={value}>
              {REASON_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Observação
        <textarea
          value={draft.notes}
          onChange={(event) => onDraft({ notes: event.target.value })}
          maxLength={2000}
          rows={3}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
        />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.confirmed}
          onChange={(event) => onDraft({ confirmed: event.target.checked })}
          required
        />
        <span>{CLIENT_REFUND_CONFIRMATION}</span>
      </label>
      <button
        type="submit"
        disabled={pending || !draft.confirmed}
        className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 sm:w-fit"
      >
        {pending ? "Enviando solicitação…" : CLIENT_REFUND_BUTTON_LABEL}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </form>
  );
}

export function ClientRefundRequestPanel({
  payments,
  access = "allowed",
}: {
  payments: ClientRefundPaymentView[];
  access?: RefundGmailAccess;
}) {
  const initialId = payments.find((payment) => payment.eligible)?.mpPaymentId ?? payments[0]?.mpPaymentId ?? null;
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(initialId);
  const [drafts, setDrafts] = useState<Record<string, RefundDraft>>({});
  const [submittedIds, setSubmittedIds] = useState<ReadonlySet<string>>(() => new Set());

  if (access !== "allowed") {
    return (
      <section className="grid w-full gap-3" data-testid="client-refund-panel" data-refund-access={access}>
        <p className="text-sm text-slate-700" role="status">
          {access === "unauthenticated"
            ? "Entre na sua conta para solicitar a análise."
            : REFUND_GMAIL_REQUIRED_MESSAGE}
        </p>
        {access === "unauthenticated" ? (
          <a href="/login" className="text-sm font-semibold text-sky-800 underline">
            Entrar
          </a>
        ) : null}
      </section>
    );
  }

  if (payments.length === 0) return null;

  const selected = payments.find((payment) => payment.mpPaymentId === selectedPaymentId) ?? payments[0];
  const submitted = submittedIds.has(selected.mpPaymentId);
  const open = selected.blockReason === "open_request" || submitted;
  const showForm = selected.eligible && !submitted;
  const draft = drafts[selected.mpPaymentId] ?? EMPTY_DRAFT;

  function updateDraft(patch: Partial<RefundDraft>) {
    const id = selected.mpPaymentId;
    setDrafts((current) => {
      const previous = current[id] ?? EMPTY_DRAFT;
      return { ...current, [id]: { ...previous, ...patch } };
    });
  }

  return (
    <section className="grid w-full gap-3" data-testid="client-refund-panel">
      <ul className="grid w-full gap-2" aria-label="Pagamentos elegíveis">
        {payments.map((payment) => {
          const active = payment.mpPaymentId === selected.mpPaymentId;
          return (
            <li key={payment.mpPaymentId}>
              <button
                type="button"
                aria-pressed={active}
                data-testid="client-refund-payment-option"
                data-payment-id={payment.mpPaymentId}
                onClick={() => setSelectedPaymentId(payment.mpPaymentId)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                  active ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"
                }`}
              >
                <span className="font-medium text-slate-900">Pagamento {payment.mpPaymentId}</span>
                <span className="mt-0.5 block text-slate-600">
                  {payment.paidOn ? `Pago em ${payment.paidOn}` : "Data de pagamento indisponível"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div
        className="rounded-xl border border-slate-200 bg-white p-4"
        data-testid="client-refund-detail"
        data-payment-id={selected.mpPaymentId}
      >
        <p className="text-sm font-medium text-slate-900">Solicitação para o pagamento {selected.mpPaymentId}</p>
        <p className="text-sm text-slate-600">
          {selected.paidOn ? `Pago em ${selected.paidOn}` : "Data de pagamento indisponível"}
        </p>
        {showForm ? (
          <PaymentRequestForm
            key={selected.mpPaymentId}
            payment={selected}
            draft={draft}
            onDraft={updateDraft}
            onSubmitted={() => {
              const id = selected.mpPaymentId;
              setSubmittedIds((current) => new Set(current).add(id));
            }}
          />
        ) : open ? (
          <p className="mt-2 text-sm font-medium text-slate-800">{CLIENT_REFUND_OPEN_STATUS}</p>
        ) : null}
        {submitted ? <p className="mt-2 text-sm text-emerald-800">{CLIENT_REFUND_SUCCESS}</p> : null}
      </div>
    </section>
  );
}
