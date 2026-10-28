"use client";

import { useRef, useState } from "react";
import {
  CLIENT_REFUND_FORM_REASONS,
  type ClientRefundFormReason,
  type ClientRefundPaymentView,
} from "@/lib/domain/client-refund-eligibility";
import {
  REFUND_GMAIL_REQUIRED_MESSAGE,
  type RefundGmailAccess,
} from "@/lib/domain/refund-gmail-access";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";

/** Tokens escuros (mesma linguagem do cartão de vidro do login). */
const PANEL_TEXT_STYLE = { color: t.color.textBody } as const;
const PANEL_SURFACE_STYLE = {
  borderRadius: t.radius.lg,
  border: `1px solid ${t.color.borderStrong}`,
  background: t.color.roiPanelBg,
  color: t.color.textBody,
} as const;
const PANEL_OPTION_STYLE = {
  border: `1px solid ${t.color.borderStrong}`,
  background: "rgba(15, 23, 42, 0.55)",
  color: t.color.textBody,
} as const;
const PANEL_OPTION_PRESSED_STYLE = {
  border: "1px solid rgba(37, 99, 235, 0.55)",
  background: "rgba(37, 99, 235, 0.14)",
  color: t.color.textBody,
} as const;
const PANEL_INPUT_STYLE = {
  border: `1px solid ${t.color.borderStrong}`,
  background: "rgba(15, 23, 42, 0.55)",
  color: t.color.text,
  colorScheme: "dark",
} as const;
const PANEL_PRIMARY_BUTTON_STYLE = {
  border: "none",
  background: `linear-gradient(135deg, ${t.color.secondary} 0%, #1D4ED8 55%, ${t.color.accent} 100%)`,
  color: "#FFFFFF",
  boxShadow: t.shadow.ctaGlow,
} as const;

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
  refund_already_approved: "O reembolso deste pagamento já foi aprovado.",
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

function uniquePayments(payments: ClientRefundPaymentView[]): ClientRefundPaymentView[] {
  const seen = new Set<string>();
  const unique: ClientRefundPaymentView[] = [];
  for (const payment of payments) {
    if (seen.has(payment.mpPaymentId)) continue;
    seen.add(payment.mpPaymentId);
    unique.push(payment);
  }
  return unique;
}

type SelectedRefundPayment = {
  paymentId: string;
  snapshot: ClientRefundPaymentView;
};

function samePaymentView(left: ClientRefundPaymentView, right: ClientRefundPaymentView): boolean {
  return (
    left.mpPaymentId === right.mpPaymentId &&
    left.paidOn === right.paidOn &&
    left.eligible === right.eligible &&
    left.blockReason === right.blockReason &&
    left.latestStatus === right.latestStatus
  );
}

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
      className="grid w-full gap-3"
      aria-labelledby={`client-refund-option-${payment.mpPaymentId}`}
      data-testid="client-refund-form"
      data-payment-id={payment.mpPaymentId}
    >
      <label className="grid gap-1 text-sm">
        Motivo
        <select
          required
          value={draft.reason}
          onChange={(event) => onDraft({ reason: event.target.value as ClientRefundFormReason })}
          className="w-full rounded-lg px-3 py-2"
          style={PANEL_INPUT_STYLE}
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
          className="w-full rounded-lg px-3 py-2"
          style={PANEL_INPUT_STYLE}
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
        className="w-full rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 sm:w-fit"
        style={PANEL_PRIMARY_BUTTON_STYLE}
      >
        {pending ? "Enviando solicitação…" : CLIENT_REFUND_BUTTON_LABEL}
      </button>
      {error ? (
        <p className="text-sm" style={{ color: "#FCA5A5" }}>
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function ClientRefundSlot({
  payments,
  access,
}: {
  payments: ClientRefundPaymentView[];
  access: RefundGmailAccess;
}) {
  const seenPayments = useRef(payments.length > 0);
  if (payments.length > 0) seenPayments.current = true;
  if (access === "allowed" && payments.length === 0 && !seenPayments.current) return null;
  return (
    <div data-testid="client-refund-slot" className="w-full px-4 py-4 sm:px-6">
      <ClientRefundRequestPanel payments={payments} access={access} />
    </div>
  );
}

export function ClientRefundRequestPanel({
  payments,
  access = "allowed",
}: {
  payments: ClientRefundPaymentView[];
  access?: RefundGmailAccess;
}) {
  const listed = uniquePayments(payments);
  const initialPayment = listed.find((payment) => payment.eligible) ?? listed[0] ?? null;
  const [selection, setSelection] = useState<SelectedRefundPayment | null>(() =>
    initialPayment ? { paymentId: initialPayment.mpPaymentId, snapshot: initialPayment } : null
  );
  const [drafts, setDrafts] = useState<Record<string, RefundDraft>>({});
  const [submittedIds, setSubmittedIds] = useState<ReadonlySet<string>>(() => new Set());

  if (access !== "allowed") {
    return (
      <section className="grid w-full gap-3" style={PANEL_TEXT_STYLE} data-testid="client-refund-panel" data-refund-access={access}>
        <p className="text-sm" style={PANEL_TEXT_STYLE} role="status">
          {access === "unauthenticated"
            ? "Entre na sua conta para solicitar a análise."
            : REFUND_GMAIL_REQUIRED_MESSAGE}
        </p>
        {access === "unauthenticated" ? (
          <a href="/login" className="text-sm font-semibold underline" style={{ color: "#93C5FD" }}>
            Entrar
          </a>
        ) : null}
      </section>
    );
  }

  const selectedPaymentId = selection?.paymentId ?? null;
  const listedMatch =
    selectedPaymentId === null
      ? null
      : (listed.find((payment) => payment.mpPaymentId === selectedPaymentId) ?? null);
  if (selection && listedMatch && !samePaymentView(listedMatch, selection.snapshot)) {
    setSelection({ paymentId: selection.paymentId, snapshot: listedMatch });
  }
  const resolved = listedMatch ?? selection?.snapshot ?? null;
  if (!resolved) return null;
  const active = resolved;

  function choose(payment: ClientRefundPaymentView) {
    setSelection({ paymentId: payment.mpPaymentId, snapshot: payment });
  }
  const submitted = submittedIds.has(active.mpPaymentId);
  const open = active.blockReason === "open_request" || submitted;
  const showForm = active.eligible && !submitted;
  const draft = drafts[active.mpPaymentId] ?? EMPTY_DRAFT;

  function updateDraft(patch: Partial<RefundDraft>) {
    const id = active.mpPaymentId;
    setDrafts((current) => {
      const previous = current[id] ?? EMPTY_DRAFT;
      return { ...current, [id]: { ...previous, ...patch } };
    });
  }

  return (
    <section className="grid w-full gap-3" style={PANEL_TEXT_STYLE} data-testid="client-refund-panel">
      <ul className="grid w-full gap-2" aria-label="Pagamentos elegíveis">
        {listed.map((payment) => {
          const pressed = payment.mpPaymentId === active.mpPaymentId;
          return (
            <li key={payment.mpPaymentId}>
              <button
                type="button"
                id={`client-refund-option-${payment.mpPaymentId}`}
                aria-pressed={pressed}
                data-testid="client-refund-payment-option"
                data-payment-id={payment.mpPaymentId}
                onClick={() => choose(payment)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm"
                style={pressed ? PANEL_OPTION_PRESSED_STYLE : PANEL_OPTION_STYLE}
              >
                <span className="font-medium" style={{ color: t.color.text }}>Pagamento {payment.mpPaymentId}</span>
                <span className="mt-0.5 block" style={{ color: t.color.textMuted }}>
                  {payment.paidOn ? `Pago em ${payment.paidOn}` : "Data de pagamento indisponível"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div
        key={active.mpPaymentId}
        className="p-4"
        style={PANEL_SURFACE_STYLE}
        data-testid="client-refund-detail"
        data-payment-id={active.mpPaymentId}
      >
        {showForm ? (
          <PaymentRequestForm
            key={active.mpPaymentId}
            payment={active}
            draft={draft}
            onDraft={updateDraft}
            onSubmitted={() => {
              const id = active.mpPaymentId;
              setSubmittedIds((current) => new Set(current).add(id));
            }}
          />
        ) : open ? (
          <p className="mt-2 text-sm font-medium" style={{ color: t.color.text }}>{CLIENT_REFUND_OPEN_STATUS}</p>
        ) : null}
        {submitted ? (
          <p className="mt-2 text-sm" style={{ color: "#6EE7B7" }}>{CLIENT_REFUND_SUCCESS}</p>
        ) : null}
      </div>
    </section>
  );
}
