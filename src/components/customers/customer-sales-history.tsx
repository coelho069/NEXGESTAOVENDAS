import { formatBRL } from "@/lib/money";
import {
  paymentMethodLabel,
  saleStatusLabel,
  type SaleHistoryListItem,
} from "@/lib/domain/sale-history";
import type { CustomerSalesListItem, CustomerSalesSummary } from "@/lib/domain/customer-sales";
import { formatSaoPauloDate } from "@/lib/domain/receipt";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";

/** Tokens do tema de login (cartão de vidro sobre t.color.bg). */
const ui = {
  panel: {
    border: `1px solid ${t.color.glassBorder}`,
    background: "rgba(255, 255, 255, 0.03)",
    color: t.color.textBody,
  },
  highlight: {
    border: "1px solid rgba(16, 185, 129, 0.3)",
    background: "rgba(16, 185, 129, 0.08)",
  },
  heading: { color: t.color.text, fontFamily: t.font.heading },
  muted: { color: t.color.textMuted },
  body: { color: t.color.textBody },
  strong: { color: t.color.text },
  highlightLabel: { color: "#6EE7B7" },
  error: { color: "#FCA5A5" },
  loadMore: {
    border: `1px solid ${t.color.borderStrong}`,
    background: "rgba(255, 255, 255, 0.04)",
    color: t.color.text,
    borderRadius: t.radius.md,
  },
} as const;

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
        className="rounded-xl px-4 py-3"
        style={ui.highlight}
        data-testid="customer-lifetime-revenue"
      >
        <div className="text-xs font-semibold uppercase tracking-wide" style={ui.highlightLabel}>
          Total já rendido
        </div>
        <div className="mt-1 text-2xl font-bold" style={ui.strong}>
          {formatBRL(summary.lifetime_revenue)}
        </div>
        <div className="mt-1 text-sm" style={ui.body}>
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
        <h3 className="text-sm font-semibold" style={ui.heading}>Histórico de vendas</h3>
        {error ? (
          <p role="alert" data-testid="customer-sales-error" className="mt-2 text-sm" style={ui.error}>
            {error}
          </p>
        ) : null}
        {loading && rows.length === 0 ? (
          <p className="mt-2 text-sm" style={ui.muted}>Carregando vendas...</p>
        ) : rows.length === 0 ? (
          <p data-testid="customer-sales-empty" className="mt-2 text-sm" style={ui.muted}>
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
            className="mt-3 w-full px-3 py-2 text-sm font-semibold disabled:opacity-50"
            style={ui.loadMore}
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
      className="flex items-start justify-between gap-3 rounded-xl px-3 py-3"
      style={ui.panel}
    >
      <div>
        <div className="text-sm font-semibold" style={ui.strong}>
          {saleStatusLabel(row.status)} · {formatBRL(row.total)}
        </div>
        <div className="text-xs" style={ui.muted}>
          {formatSaoPauloDate(row.created_at)} · {paymentMethodLabel(row.payment_method)}
          {row.store_name ? ` · ${row.store_name}` : ""}
        </div>
        <div className="text-xs" style={{ color: t.color.textMuted, opacity: 0.8 }}>{row.sale_id}</div>
      </div>
    </li>
  );
}
