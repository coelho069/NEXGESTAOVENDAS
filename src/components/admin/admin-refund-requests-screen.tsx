"use client";

import { useRef, useState, useTransition } from "react";
import { Phase21AuditButton } from "@/components/admin/phase21-audit-button";
import { reviewRefundRequestAction } from "@/lib/server/admin-refund-request-actions";
import { adminActionErrorMessage } from "@/components/admin/admin-action-messages";
import { formatBRL } from "@/lib/money";
import type { RefundSandboxPresentation } from "@/lib/server/admin-refund-requests-query";
import type { RefundRequestRow } from "@/lib/server/refund-requests";
import type { RefundReviewAction } from "@/lib/domain/refund-request";

const STATUS_LABELS: Record<string, string> = {
  submitted: "Recebido",
  requested: "Recebido",
  in_review: "Em análise",
  approved: "Aprovado",
  rejected: "Recusado",
  withdrawn: "Retirado",
  processing: "Processando",
  refunded: "Reembolsado",
};

const WINDOW_LABELS: Record<RefundRequestRow["window_assessment"], string> = {
  within_window: "Dentro do prazo",
  outside_window: "Fora do prazo",
  unknown: "Data desconhecida",
};

const CLOSED_LABELS: Partial<Record<string, string>> = {
  approved: "Decisão registrada. O estorno não é enviado ao Mercado Pago nesta etapa.",
  rejected: "Pedido recusado. Nenhum valor foi estornado.",
  withdrawn: "Pedido retirado.",
};

type ScreenRow = RefundRequestRow & {
  status: string;
  provider_refund_status?: string;
};

type LocalSettlement = {
  phase: "processing" | "settled";
  status: string;
  providerRefundStatus: string | null;
  processingState: string | null;
  error: string | null;
  retryable: boolean;
  financialEffect: false;
};

function confirmedRefund(body: {
  ok?: boolean;
  status?: string;
  provider_refund_status?: string | null;
  financial_effect?: boolean;
}): boolean {
  return (
    body.ok === true &&
    body.status === "refunded" &&
    body.provider_refund_status === "completed" &&
    body.financial_effect === false
  );
}

export function AdminRefundRequestsScreen({
  data,
  error,
  balanceNotice = null,
  sandboxEnabled = false,
  sandbox = null,
}: {
  data: ScreenRow[] | null;
  error: string | null;
  balanceNotice?: string | null;
  sandboxEnabled?: boolean;
  sandbox?: Record<string, RefundSandboxPresentation> | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, LocalSettlement>>({});
  const [pending, startTransition] = useTransition();
  const busyRef = useRef(false);

  function run(action: RefundReviewAction, id: string) {
    setActionError(null);
    startTransition(async () => {
      const result = await reviewRefundRequestAction({
        id,
        action,
        resolution_note: note,
        acknowledge_outside_window: acknowledge,
      });
      if (!result.ok) {
        setActionError(adminActionErrorMessage(result.error));
        return;
      }
      setNote("");
      setAcknowledge(false);
    });
  }

  async function processSandbox(id: string, retry: boolean) {
    if (busyRef.current) {
      setActionError(adminActionErrorMessage("processing_in_progress"));
      return;
    }
    busyRef.current = true;
    setActionError(null);
    setLocal((current) => ({
      ...current,
      [id]: {
        phase: "processing",
        status: "processing",
        providerRefundStatus: "processing",
        processingState: "processing",
        error: null,
        retryable: false,
        financialEffect: false,
      },
    }));
    try {
      const response = await fetch("/api/admin/reembolsos/processar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id, confirm: true, retry }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        status?: string;
        provider_refund_status?: string | null;
        processing_state?: string | null;
        financial_effect?: boolean;
        retryable?: boolean;
      };
      const confirmed = confirmedRefund(body);
      setLocal((current) => ({
        ...current,
        [id]: {
          phase: "settled",
          status: confirmed ? "refunded" : body.status === "refunded" ? "processing" : (body.status ?? "processing"),
          providerRefundStatus: confirmed ? "completed" : (body.provider_refund_status ?? "processing"),
          processingState: confirmed ? "completed" : (body.processing_state ?? "processing"),
          error: confirmed ? null : (body.error ?? "unavailable"),
          retryable: confirmed ? false : body.retryable === true,
          financialEffect: false,
        },
      }));
      if (!confirmed && body.error) setActionError(adminActionErrorMessage(body.error));
    } catch {
      setLocal((current) => ({
        ...current,
        [id]: {
          phase: "settled",
          status: "processing",
          providerRefundStatus: "processing",
          processingState: "unknown",
          error: "provider_timeout",
          retryable: true,
          financialEffect: false,
        },
      }));
      setActionError(adminActionErrorMessage("provider_timeout"));
    } finally {
      busyRef.current = false;
    }
  }

  return (
    <main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Pedidos de reembolso</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {sandboxEnabled
            ? "Ambiente local: o processamento usa somente o sandbox em memória. Nenhum estorno é enviado ao Mercado Pago ou ao Stripe."
            : "Fila de análise da assinatura paga no Mercado Pago. Aprovar ou recusar encerra o pedido. Esta tela não envia estorno ao Mercado Pago."}
        </p>
      </header>
      {balanceNotice ? (
        <p
          role="alert"
          data-testid="account-balance-notice"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          {balanceNotice}
        </p>
      ) : null}
      <Phase21AuditButton />
      {error ? <p role="alert">{adminActionErrorMessage(error)}</p> : null}
      {actionError ? <p role="alert">{actionError}</p> : null}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-card text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Quando</th>
              <th className="px-3 py-2 font-medium">E-mail</th>
              <th className="px-3 py-2 font-medium">Pagamento</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Prazo</th>
              <th className="px-3 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((row) => {
              const view = sandbox?.[row.id];
              const settlement = local[row.id];
              const status = settlement?.status ?? row.status;
              const providerStatus = settlement?.providerRefundStatus ?? view?.provider_refund_status ?? row.provider_refund_status;
              const showRefunded = status === "refunded" && providerStatus === "completed";
              const retryable = settlement ? settlement.retryable : (view?.retryable ?? false);
              const reviewClosed =
                status === "rejected" ||
                status === "withdrawn" ||
                status === "refunded" ||
                (status === "approved" && !sandboxEnabled) ||
                (status === "processing" && !sandboxEnabled);
              return (
                <tr key={row.id} className="border-t border-border align-top">
                  <td className="px-3 py-3 whitespace-nowrap">{row.created_at.slice(0, 16).replace("T", " ")}</td>
                  <td className="px-3 py-3">{row.payer_email}</td>
                  <td className="px-3 py-3 font-mono text-xs">{row.mp_payment_id}</td>
                  <td className="px-3 py-3" data-testid={`refund-status-${row.id}`}>
                    {STATUS_LABELS[status] ?? status}
                    {sandboxEnabled ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        <div data-testid={`refund-snapshot-amount-${row.id}`}>
                          {view?.snapshot_amount ? formatBRL(view.snapshot_amount) : "Valor indisponível"}
                        </div>
                        <div data-testid={`refund-provider-${row.id}`}>
                          Mercado Pago · {view?.payment_method ?? "Checkout Pro"}
                        </div>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">{WINDOW_LABELS[row.window_assessment]}</td>
                  <td className="px-3 py-3">
                    {settlement?.phase === "processing" ? (
                      <p role="status" data-testid={`refund-processing-${row.id}`}>
                        Processando no sandbox. O reembolso ainda não foi confirmado.
                      </p>
                    ) : null}
                    {showRefunded ? (
                      <p data-testid={`refund-result-${row.id}`}>
                        Reembolso sandbox confirmado. Nenhum valor real foi movimentado.
                      </p>
                    ) : null}
                    {settlement?.phase === "settled" && !showRefunded && settlement.error ? (
                      <p role="alert" data-testid={`refund-error-${row.id}`}>
                        {adminActionErrorMessage(settlement.error)}
                      </p>
                    ) : null}
                    {sandboxEnabled && !showRefunded && (row.status === "approved" || retryable || settlement?.phase === "processing") ? (
                      <div className="flex max-w-xs flex-col gap-2">
                        {row.status === "approved" && (!settlement || settlement.phase === "processing") ? (
                          <button
                            type="button"
                            data-testid={`refund-confirm-${row.id}`}
                            disabled={pending || settlement?.phase === "processing"}
                            onClick={() => processSandbox(row.id, false)}
                          >
                            Confirmar processamento
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {sandboxEnabled && retryable && settlement?.phase !== "processing" && !showRefunded ? (
                      <button type="button" data-testid={`refund-retry-${row.id}`} onClick={() => processSandbox(row.id, true)}>
                        Tentar novamente
                      </button>
                    ) : null}
                    {reviewClosed && !showRefunded && settlement?.phase !== "processing" ? (
                      <span className="text-muted-foreground">{CLOSED_LABELS[row.status] ?? CLOSED_LABELS[status]}</span>
                    ) : !sandboxEnabled || (status !== "approved" && status !== "processing" && status !== "refunded") ? (
                      <div className="flex flex-col gap-2">
                        <button type="button" className="text-left underline" onClick={() => setSelectedId(row.id)}>
                          Analisar
                        </button>
                        {selectedId === row.id ? (
                          <div className="flex max-w-xs flex-col gap-2">
                            <textarea
                              aria-label="Nota da análise"
                              value={note}
                              onChange={(event) => setNote(event.target.value)}
                              rows={3}
                              className="rounded-lg border border-border bg-background px-2 py-1"
                            />
                            {row.window_assessment === "outside_window" ? (
                              <label className="flex items-start gap-2">
                                <input
                                  type="checkbox"
                                  checked={acknowledge}
                                  onChange={(event) => setAcknowledge(event.target.checked)}
                                />
                                <span>Confirmo a análise fora do prazo de 7 dias.</span>
                              </label>
                            ) : null}
                            <div className="flex flex-wrap gap-2">
                              {row.status === "submitted" ? (
                                <button type="button" disabled={pending} onClick={() => run("start_review", row.id)}>
                                  Iniciar análise
                                </button>
                              ) : null}
                              {row.status === "in_review" ? (
                                <button type="button" disabled={pending} onClick={() => run("approve", row.id)}>
                                  Aprovar
                                </button>
                              ) : null}
                              <button type="button" disabled={pending} onClick={() => run("reject", row.id)}>
                                Recusar
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {data && data.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-muted-foreground">
                  Nenhum pedido registrado.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
