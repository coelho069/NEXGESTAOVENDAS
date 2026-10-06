"use client";

import { useState } from "react";
import { REFUND_REQUEST_REASONS, type RefundRequestReason } from "@/lib/domain/refund-request";

const REASON_LABELS: Record<RefundRequestReason, string> = {
  arrependimento: "Arrependimento",
  cobranca_indevida: "Cobrança indevida",
  cobranca_duplicada: "Cobrança duplicada",
  falha_no_servico: "Falha no serviço",
  problema_tecnico: "Problema técnico",
  outro: "Outro motivo",
};

function mutationId(): string {
  const key = "nex-refund-request-mutation-id";
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(key, created);
  return created;
}

export function RefundRequestForm() {
  const [payerEmail, setPayerEmail] = useState("");
  const [mpPaymentId, setMpPaymentId] = useState("");
  const [reason, setReason] = useState<RefundRequestReason>("arrependimento");
  const [notes, setNotes] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [intensiveUse, setIntensiveUse] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/refund-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_mutation_id: mutationId(),
          payer_email: payerEmail,
          mp_payment_id: mpPaymentId.trim(),
          reason,
          notes,
          intensive_use_declared: intensiveUse,
          ...(paidOn ? { paid_on: paidOn } : {}),
        }),
      });
      const body = (await response.json()) as { error?: string; replayed?: boolean };
      if (!response.ok) {
        setError(publicError(body.error));
        return;
      }
      window.sessionStorage.removeItem("nex-refund-request-mutation-id");
      setMessage(
        body.replayed
          ? "Este pedido já estava registrado. Não criamos outro."
          : "Pedido registrado. A análise não movimenta dinheiro; se for aprovado, o estorno segue depois pelo Mercado Pago."
      );
    } catch {
      setError("Não foi possível registrar o pedido. Tente de novo em instantes.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div>
        <label htmlFor="refund-email" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          E-mail da conta
        </label>
        <input
          id="refund-email"
          type="email"
          required
          autoComplete="email"
          value={payerEmail}
          onChange={(event) => setPayerEmail(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
        />
      </div>
      <div>
        <label htmlFor="refund-payment" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          ID do pagamento no Mercado Pago
        </label>
        <input
          id="refund-payment"
          inputMode="numeric"
          required
          pattern="[0-9]{6,20}"
          value={mpPaymentId}
          onChange={(event) => setMpPaymentId(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
        />
      </div>
      <div>
        <label htmlFor="refund-reason" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Motivo
        </label>
        <select
          id="refund-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value as RefundRequestReason)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
        >
          {REFUND_REQUEST_REASONS.map((value) => (
            <option key={value} value={value}>
              {REASON_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="refund-notes" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Detalhes {reason === "outro" ? "(obrigatório)" : "(opcional)"}
        </label>
        <textarea
          id="refund-notes"
          rows={3}
          maxLength={2000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
        />
      </div>
      <div>
        <label htmlFor="refund-paid-on" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Data do pagamento (se souber)
        </label>
        <input
          id="refund-paid-on"
          type="date"
          value={paidOn}
          onChange={(event) => setPaidOn(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
        />
      </div>
      <label className="flex items-start gap-2 text-slate-700">
        <input
          type="checkbox"
          checked={intensiveUse}
          onChange={(event) => setIntensiveUse(event.target.checked)}
          className="mt-1"
        />
        <span>Já emiti documento fiscal em produção ou processei vendas reais nesta conta.</span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Registrando…" : "Registrar pedido de reembolso"}
      </button>
      {message ? (
        <p role="status" className="text-sm text-emerald-700">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function publicError(code: string | undefined): string {
  switch (code) {
    case "open_refund_request_exists":
      return "Já existe um pedido em análise para este pagamento.";
    case "idempotency_payload_mismatch":
      return "Este identificador de pedido já foi usado com outros dados. Atualize a página e tente de novo.";
    case "paid_on_in_future":
      return "A data do pagamento não pode ser futura.";
    case "rate_limited":
      return "Muitas tentativas. Aguarde um pouco e tente de novo.";
    case "Validation failed":
      return "Revise o e-mail, o ID numérico do Mercado Pago e o motivo.";
    default:
      return "Não foi possível registrar o pedido. Você ainda pode enviar pelo e-mail de suporte.";
  }
}
