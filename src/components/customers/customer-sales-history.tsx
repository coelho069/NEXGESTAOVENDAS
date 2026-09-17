import { formatBRL } from "@/lib/money";
import {
  paymentMethodLabel,
  saleStatusLabel,
  type SaleHistoryListItem,
} from "@/lib/domain/sale-history";
import type { CustomerSalesListItem, CustomerSalesSummary } from "@/lib/domain/customer-sales";
import { formatSaoPauloDate } from "@/lib/domain/receipt";

type CustomerSalesHistoryProps = {
  summary: CustomerSalesSummary;
  rows: CustomerSalesListItem[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
};

export function CustomerSalesHistory({
  summary,
  rows,
  loading,
  error,
  hasMore,
  onLoadMore,
}: CustomerSalesHistoryProps) {
  return (
    <div className="space-y-4" data-testid="customer-sales-history">
      <div
        className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3"
        data-testid="customer-lifetime-revenue"
      >
        <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
          Total já rendido
        </div>
        <div className="mt-1 text-2xl font-bold text-emerald-950">
          {formatBRL(summary.lifetime_revenue)}
        </div>
        <div className="mt-1 text-sm text-emerald-900">
          {summary.sales_count === 0
            ? "Nenhuma venda confirmada registrada para este cliente."
            : `${summary.sales_count} venda${summary.sales_count === 1 ? "" : "s"} confirmada${summary.sales_count === 1 ? "" : "s"}${
                summary.last_sale_at
                  ? ` · última em ${formatSaoPauloDate(summary.last_sale_at)}`
                  : ""
              }`}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-800">Histórico de vendas</h3>
        {error ? (
          <p role="alert" data-testid="customer-sales-error" className="mt-2 text-sm text-amber-800">
            {error}
          </p>
        ) : null}
        {loading && rows.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Carregando vendas...</p>
        ) : rows.length === 0 ? (
          <p data-testid="customer-sales-empty" className="mt-2 text-sm text-slate-500">
            Este cliente ainda não possui vendas nas lojas que você acessa.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {rows.map((row) => (
              <CustomerSalesRow key={row.sale_id} row={row} />
            ))}
          </ul>
        )}
        {hasMore ? (
          <button
            type="button"
            data-testid="customer-sales-load-more"
            className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
            onClick={onLoadMore}
            disabled={loading}
          >
            {loading ? "Carregando..." : "Carregar mais"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CustomerSalesRow({ row }: { row: SaleHistoryListItem & { store_name?: string | null } }) {
  return (
    <li
      data-testid={`customer-sales-row-${row.sale_id}`}
      className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3"
    >
      <div>
        <div className="text-sm font-semibold text-slate-900">
          {saleStatusLabel(row.status)} · {formatBRL(row.total)}
        </div>
        <div className="text-xs text-slate-500">
          {formatSaoPauloDate(row.created_at)} · {paymentMethodLabel(row.payment_method)}
          {row.store_name ? ` · ${row.store_name}` : ""}
        </div>
        <div className="text-xs text-slate-400">{row.sale_id}</div>
      </div>
    </li>
  );
}
