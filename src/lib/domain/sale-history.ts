import type { Enums } from "@/lib/db/types";
import type { LocalPayment, LocalSale, LocalSaleItem } from "@/lib/offline/types";

export type SaleHistoryListItem = {
  sale_id: string;
  status: string;
  sync_status: string;
  total: string;
  discount: string;
  subtotal: string;
  customer_name: string | null;
  cashier_id: string | null;
  operator_name: string | null;
  payment_method: string | null;
  payment_status: string | null;
  created_at: string;
  confirmed_at: string | null;
};

export type SaleHistoryDetailItem = {
  sale_item_id?: string;
  product_id: string;
  product_sku: string;
  product_name: string;
  quantity: string;
  quantity_returned?: string;
  quantity_returnable?: string;
  unit_price: string;
  discount: string;
  total: string;
};

export type SaleHistoryDetailPayment = {
  payment_id: string;
  method: string;
  status: string;
  amount: string;
};

export type SaleHistoryReturnRecord = {
  return_id: string;
  operation: string;
  reason: string;
  notes: string | null;
  refund_total: string;
  payment_refund_status: string;
  operator_id: string | null;
  created_at: string;
  items: Array<{
    sale_item_id: string;
    product_id: string;
    quantity: string;
    line_total: string;
  }>;
};

export type SaleHistoryDetail = SaleHistoryListItem & {
  items: SaleHistoryDetailItem[];
  payments: SaleHistoryDetailPayment[];
  returns?: SaleHistoryReturnRecord[];
  refunded_total?: string;
  refundable_total?: string;
  notes: string | null;
};

export type SaleHistoryListResponse = {
  rows: SaleHistoryListItem[];
  next_cursor: { after_created_at: string; after_id: string } | null;
  has_more: boolean;
};

export function saleStatusLabel(status: string): string {
  switch (status) {
    case "confirmed":
      return "Confirmada";
    case "pending_sync":
      return "Pendente de sync";
    case "draft":
      return "Rascunho";
    case "cancelled":
      return "Cancelada";
    case "refunded":
      return "Estornada";
    case "partially_refunded":
      return "Estorno parcial";
    default:
      return status;
  }
}

export function paymentMethodLabel(method: string | null): string {
  switch (method) {
    case "cash":
      return "Dinheiro";
    case "card":
      return "Cartão";
    case "pix":
      return "PIX";
    case "voucher":
      return "Vale";
    case "other":
      return "Outro";
    default:
      return method ?? "—";
  }
}

export function buildLocalSaleHistoryList(
  sales: LocalSale[],
  payments: LocalPayment[],
  options?: { limit?: number; query?: string }
): SaleHistoryListResponse {
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
  const query = options?.query?.trim().toLowerCase() ?? "";
  const paymentBySale = new Map<string, LocalPayment>();
  for (const payment of payments) {
    if (!paymentBySale.has(payment.saleId)) {
      paymentBySale.set(payment.saleId, payment);
    }
  }

  const sorted = [...sales].sort((a, b) => {
    const byDate = b.createdAt.localeCompare(a.createdAt);
    if (byDate !== 0) return byDate;
    return b.id.localeCompare(a.id);
  });

  const filtered = sorted.filter((sale) => {
    if (!query) return true;
    const payment = paymentBySale.get(sale.id);
    const haystack = [
      sale.id,
      sale.serverSaleId ?? "",
      sale.status,
      sale.syncStatus,
      sale.total,
      payment?.method ?? "",
      payment?.status ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });

  const page = filtered.slice(0, limit + 1);
  const hasMore = page.length > limit;
  const rows = page.slice(0, limit).map((sale) => {
    const payment = paymentBySale.get(sale.id);
    return {
      sale_id: sale.serverSaleId ?? sale.id,
      status: sale.status,
      sync_status: sale.syncStatus,
      total: sale.total,
      discount: sale.discount,
      subtotal: sale.subtotal,
      customer_name: null,
      cashier_id: null,
      operator_name: null,
      payment_method: payment?.method ?? null,
      payment_status: payment?.status ?? null,
      created_at: sale.createdAt,
      confirmed_at: sale.confirmedAt ?? null,
    } satisfies SaleHistoryListItem;
  });

  const last = rows.at(-1);
  return {
    rows,
    next_cursor:
      hasMore && last
        ? { after_created_at: last.created_at, after_id: last.sale_id }
        : null,
    has_more: hasMore,
  };
}

export function buildLocalSaleHistoryDetail(
  sale: LocalSale,
  items: LocalSaleItem[],
  payments: LocalPayment[]
): SaleHistoryDetail {
  const payment = payments[0] ?? null;
  return {
    sale_id: sale.serverSaleId ?? sale.id,
    status: sale.status,
    sync_status: sale.syncStatus,
    total: sale.total,
    discount: sale.discount,
    subtotal: sale.subtotal,
    customer_name: null,
    cashier_id: null,
    operator_name: null,
    payment_method: payment?.method ?? null,
    payment_status: payment?.status ?? null,
    created_at: sale.createdAt,
    confirmed_at: sale.confirmedAt ?? null,
    notes: null,
    items: items.map((item) => ({
      sale_item_id: item.id,
      product_id: item.productId,
      product_sku: item.productSku,
      product_name: item.productName,
      quantity: String(item.quantity),
      quantity_returned: "0.000",
      quantity_returnable: String(item.quantity),
      unit_price: item.unitPrice,
      discount: item.discount,
      total: item.total,
    })),
    payments: payments.map((row) => ({
      payment_id: row.id,
      method: row.method,
      status: row.status,
      amount: row.amount,
    })),
  };
}

export function isQueryableSaleStatus(status: string): status is Enums<"sale_status"> {
  return [
    "draft",
    "pending_sync",
    "confirmed",
    "cancelled",
    "refunded",
    "partially_refunded",
  ].includes(status);
}
