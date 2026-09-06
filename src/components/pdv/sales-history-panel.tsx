import { formatBRL } from "@/lib/money";
import type { MemberRole } from "@/lib/domain/rbac";
import {
  paymentMethodLabel,
  saleStatusLabel,
  type SaleHistoryDetail,
  type SaleHistoryListItem,
} from "@/lib/domain/sale-history";
import { formatSaoPauloDate } from "@/lib/domain/receipt";
import {
  canCancelSale,
  canReturnSale,
  isSaleCancellableStatus,
  isSaleReturnableStatus,
  saleReturnReasonLabel,
} from "@/lib/domain/sale-return";

type SalesHistoryPanelProps = {
  open: boolean;
  rows: SaleHistoryListItem[];
  detail: SaleHistoryDetail | null;
  loading: boolean;
  detailLoading: boolean;
  error: string | null;
  query: string;
  hasMore: boolean;
  role: MemberRole | null;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onOpenDetail: (saleId: string) => void;
  onClearDetail: () => void;
  onStartReturn: () => void;
  onClose: () => void;
};

export function SalesHistoryPanel({
  open,
  rows,
  detail,
  loading,
  detailLoading,
  error,
  query,
  hasMore,
  role,
  onQueryChange,
  onRefresh,
  onLoadMore,
  onOpenDetail,
  onClearDetail,
  onStartReturn,
  onClose,
}: SalesHistoryPanelProps) {
  if (!open) return null;

  const showReturn =
    detail &&
    canReturnSale(role) &&
    isSaleReturnableStatus(detail.status) &&
    (detail.items.some((item) => Number(item.quantity_returnable ?? 0) > 0) ||
      isSaleCancellableStatus(detail.status));
  const showCancel = detail && canCancelSale(role) && isSaleCancellableStatus(detail.status);

  return (
    <div data-testid="sales-history-panel" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="Fechar histórico de vendas"
        onClick={onClose}
      />
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Consulta de vendas</h2>
            <p className="text-xs text-slate-500">Histórico da loja com paginação server-side</p>
          </div>
          <button type="button" className="text-sm text-slate-500" onClick={onClose}>
            Fechar
          </button>
        </div>

        <div className="space-y-3 border-b border-slate-100 px-5 py-3">
          <div className="flex flex-wrap gap-2">
            <input
              data-testid="sales-history-search"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Buscar por ID, cliente, operador ou método"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onRefresh();
              }}
            />
            <button
              type="button"
              data-testid="sales-history-refresh"
              className="rounded-lg border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-700"
              onClick={onRefresh}
              disabled={loading}
            >
              Buscar
            </button>
          </div>
          {error ? (
            <p role="alert" data-testid="sales-history-error" className="text-sm text-amber-800">
              {error}
            </p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {detail ? (
            <div data-testid="sales-history-detail" className="space-y-4">
              <button
                type="button"
                className="text-sm font-medium text-indigo-700"
                onClick={onClearDetail}
              >
                ← Voltar à lista
              </button>
              <div className="rounded-xl border border-slate-200 p-4 text-sm">
                <div className="font-semibold text-slate-900">Venda {detail.sale_id}</div>
                <div className="mt-1 text-slate-600">
                  {saleStatusLabel(detail.status)} · {formatSaoPauloDate(detail.created_at)}
                </div>
                <div className="mt-1 text-slate-600">
                  Operador: {detail.operator_name ?? "—"} · Cliente: {detail.customer_name ?? "—"}
                </div>
                <div className="mt-1 text-slate-600">
                  Pagamento: {paymentMethodLabel(detail.payment_method)} ·{" "}
                  {detail.payment_status ?? "—"}
                </div>
                <div className="mt-2 font-semibold text-slate-900">Total {formatBRL(detail.total)}</div>
                <div className="mt-1 text-xs text-slate-500">
                  Devolvido {formatBRL(detail.refunded_total ?? "0.00")} · Restante{" "}
                  {formatBRL(detail.refundable_total ?? detail.total)}
                </div>
              </div>

              {(showReturn || showCancel) && (
                <div className="flex flex-wrap gap-2">
                  {showReturn ? (
                    <button
                      type="button"
                      data-testid="sale-history-return"
                      className="rounded-lg border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-700"
                      onClick={onStartReturn}
                    >
                      Devolver
                    </button>
                  ) : null}
                  {showCancel ? (
                    <button
                      type="button"
                      data-testid="sale-history-cancel"
                      className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700"
                      onClick={onStartReturn}
                    >
                      Cancelar venda
                    </button>
                  ) : null}
                </div>
              )}

              <ul className="space-y-2">
                {detail.items.map((item) => (
                  <li
                    key={`${item.sale_item_id ?? item.product_id}-${item.product_sku}`}
                    className="flex justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm"
                  >
                    <span>
                      {item.product_name} · {item.product_sku} · qtd {item.quantity}
                      {item.quantity_returnable != null
                        ? ` · devolvível ${item.quantity_returnable}`
                        : ""}
                    </span>
                    <span className="font-medium">{formatBRL(item.total)}</span>
                  </li>
                ))}
              </ul>

              {(detail.returns?.length ?? 0) > 0 ? (
                <div data-testid="sale-history-returns" className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-800">Devoluções / cancelamentos</h3>
                  {detail.returns?.map((row) => (
                    <div
                      key={row.return_id}
                      className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-950"
                    >
                      <div className="font-medium">
                        {row.operation === "cancel" ? "CANCELAMENTO" : "DEVOLUÇÃO"} ·{" "}
                        {formatBRL(row.refund_total)}
                      </div>
                      <div className="text-xs">
                        {saleReturnReasonLabel(row.reason)} · {row.payment_refund_status} ·{" "}
                        {formatSaoPauloDate(row.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : loading && rows.length === 0 ? (
            <p className="text-sm text-slate-500">Carregando vendas...</p>
          ) : rows.length === 0 ? (
            <p data-testid="sales-history-empty" className="text-sm text-slate-500">
              Nenhuma venda encontrada para esta loja.
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((row) => (
                <li key={row.sale_id}>
                  <button
                    type="button"
                    data-testid={`sales-history-row-${row.sale_id}`}
                    className="flex w-full items-start justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3 text-left hover:border-indigo-300"
                    onClick={() => onOpenDetail(row.sale_id)}
                    disabled={detailLoading}
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {saleStatusLabel(row.status)} · {formatBRL(row.total)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatSaoPauloDate(row.created_at)} ·{" "}
                        {paymentMethodLabel(row.payment_method)}
                      </div>
                      <div className="text-xs text-slate-400">{row.sale_id}</div>
                    </div>
                    <span className="text-xs font-medium text-indigo-700">Detalhes</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!detail && hasMore ? (
          <div className="border-t border-slate-100 p-4">
            <button
              type="button"
              data-testid="sales-history-load-more"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
              onClick={onLoadMore}
              disabled={loading}
            >
              {loading ? "Carregando..." : "Carregar mais"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
