import { useEffect, useMemo, useState } from "react";
import { formatBRL } from "@/lib/money";
import type { MemberRole } from "@/lib/domain/rbac";
import type { SaleHistoryDetail } from "@/lib/domain/sale-history";
import {
  SALE_RETURN_REASONS,
  buildReturnableItems,
  canCancelSale,
  canReturnSale,
  computeSaleReturn,
  isSaleCancellableStatus,
  isSaleReturnableStatus,
  saleReturnReasonLabel,
  validateSaleReturnReason,
  type SaleReturnOperation,
  type SaleReturnReason,
} from "@/lib/domain/sale-return";

type SaleReturnDialogProps = {
  open: boolean;
  detail: SaleHistoryDetail | null;
  role: MemberRole | null;
  mutating: boolean;
  error: string | null;
  onSubmit: (input: {
    operation: SaleReturnOperation;
    reason: SaleReturnReason;
    notes?: string;
    items: Array<{ sale_item_id: string; quantity: string }>;
  }) => Promise<void>;
  onClose: () => void;
};

export function SaleReturnDialog({
  open,
  detail,
  role,
  mutating,
  error,
  onSubmit,
  onClose,
}: SaleReturnDialogProps) {
  const [operation, setOperation] = useState<SaleReturnOperation>("return");
  const [reason, setReason] = useState<SaleReturnReason>("cliente_desistiu");
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState<string | null>(null);

  const returnableItems = useMemo(() => {
    if (!detail) return [];
    const returned: Record<string, string> = {};
    for (const item of detail.items) {
      if (item.sale_item_id) {
        returned[item.sale_item_id] = item.quantity_returned ?? "0";
      }
    }
    return buildReturnableItems(
      detail.items.map((item) => ({
        sale_item_id: item.sale_item_id ?? item.product_id,
        product_id: item.product_id,
        product_sku: item.product_sku,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount: item.discount,
        total: item.total,
      })),
      returned
    );
  }, [detail]);

  useEffect(() => {
    if (!open || !detail) return;
    setOperation(
      canCancelSale(role) && isSaleCancellableStatus(detail.status) ? "return" : "return"
    );
    setReason("cliente_desistiu");
    setNotes("");
    setLocalError(null);
    const next: Record<string, string> = {};
    for (const item of returnableItems) {
      next[item.sale_item_id] = "0";
    }
    setQuantities(next);
  }, [open, detail, role, returnableItems]);

  const selectedLines = useMemo(
    () =>
      Object.entries(quantities)
        .filter(([, quantity]) => Number(quantity) > 0)
        .map(([sale_item_id, quantity]) => ({ sale_item_id, quantity })),
    [quantities]
  );

  const preview = useMemo(() => {
    if (!detail) return null;
    if (operation === "cancel") {
      const lines = returnableItems
        .filter((item) => Number(item.quantity_returnable) > 0)
        .map((item) => ({
          sale_item_id: item.sale_item_id,
          quantity: item.quantity_returnable,
        }));
      return computeSaleReturn({
        items: returnableItems,
        lines,
        saleSubtotal: detail.subtotal,
        saleHeaderDiscount: detail.discount,
        alreadyRefundedTotal: detail.refunded_total ?? "0.00",
        saleTotal: detail.total,
      });
    }
    return computeSaleReturn({
      items: returnableItems,
      lines: selectedLines,
      saleSubtotal: detail.subtotal,
      saleHeaderDiscount: detail.discount,
      alreadyRefundedTotal: detail.refunded_total ?? "0.00",
      saleTotal: detail.total,
    });
  }, [detail, operation, returnableItems, selectedLines]);

  if (!open || !detail) return null;

  const canCancel = canCancelSale(role) && isSaleCancellableStatus(detail.status);
  const canReturn = canReturnSale(role) && isSaleReturnableStatus(detail.status);

  return (
    <div data-testid="sale-return-dialog" className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50"
        aria-label="Fechar devolução"
        onClick={onClose}
      />
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {operation === "cancel" ? "Cancelar venda" : "Devolver itens"}
            </h2>
            <p className="text-xs text-slate-500">Venda {detail.sale_id}</p>
          </div>
          <button type="button" className="text-sm text-slate-500" onClick={onClose}>
            Fechar
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {canReturn ? (
            <button
              type="button"
              data-testid="sale-return-mode-return"
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                operation === "return"
                  ? "bg-indigo-600 text-white"
                  : "border border-slate-200 text-slate-700"
              }`}
              onClick={() => setOperation("return")}
            >
              Devolução
            </button>
          ) : null}
          {canCancel ? (
            <button
              type="button"
              data-testid="sale-return-mode-cancel"
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                operation === "cancel"
                  ? "bg-rose-600 text-white"
                  : "border border-slate-200 text-slate-700"
              }`}
              onClick={() => setOperation("cancel")}
            >
              Cancelamento total
            </button>
          ) : null}
        </div>

        {operation === "return" ? (
          <ul className="mt-4 space-y-2">
            {returnableItems.map((item) => (
              <li
                key={item.sale_item_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-900">{item.product_name}</div>
                  <div className="text-xs text-slate-500">
                    {item.product_sku} · vendido {item.quantity_sold} · devolvido{" "}
                    {item.quantity_returned} · disponível {item.quantity_returnable}
                  </div>
                </div>
                <label className="text-xs text-slate-600">
                  Qtd
                  <input
                    data-testid={`sale-return-qty-${item.sale_item_id}`}
                    className="mt-1 block w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    value={quantities[item.sale_item_id] ?? "0"}
                    onChange={(event) =>
                      setQuantities((current) => ({
                        ...current,
                        [item.sale_item_id]: event.target.value,
                      }))
                    }
                    inputMode="decimal"
                    disabled={mutating || Number(item.quantity_returnable) <= 0}
                  />
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900">
            O cancelamento devolve todos os itens restantes e estorna o saldo elegível da venda.
          </p>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-700">
            Motivo
            <select
              data-testid="sale-return-reason"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
              value={reason}
              onChange={(event) => setReason(event.target.value as SaleReturnReason)}
              disabled={mutating}
            >
              {SALE_RETURN_REASONS.map((value) => (
                <option key={value} value={value}>
                  {saleReturnReasonLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Observações
            <input
              data-testid="sale-return-notes"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={mutating}
              placeholder={reason === "outro" ? "Obrigatório" : "Opcional"}
            />
          </label>
        </div>

        <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm">
          <div className="flex justify-between">
            <span>Valor calculado pelo servidor/domínio</span>
            <strong data-testid="sale-return-preview-total">
              {preview?.ok ? formatBRL(preview.value.refund_total) : "—"}
            </strong>
          </div>
          {detail.payment_method && detail.payment_method !== "cash" ? (
            <p className="mt-2 text-xs text-amber-800">
              Pagamento {detail.payment_method}: o estorno externo ficará pendente até o provedor
              confirmar. Estoque será revertido agora.
            </p>
          ) : null}
        </div>

        {localError || error ? (
          <p role="alert" data-testid="sale-return-error" className="mt-3 text-sm text-red-700">
            {localError ?? error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
            onClick={onClose}
            disabled={mutating}
          >
            Voltar
          </button>
          <button
            type="button"
            data-testid="sale-return-confirm"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={mutating || !preview?.ok}
            onClick={() => {
              const reasonError = validateSaleReturnReason(reason, notes);
              if (reasonError) {
                setLocalError(reasonError);
                return;
              }
              if (!preview?.ok) {
                setLocalError(preview?.error ?? "Devolução inválida");
                return;
              }
              setLocalError(null);
              void onSubmit({
                operation,
                reason,
                notes: notes.trim() || undefined,
                items: preview.value.lines.map((line) => ({
                  sale_item_id: line.sale_item_id,
                  quantity: line.quantity,
                })),
              });
            }}
          >
            {mutating ? "Processando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
