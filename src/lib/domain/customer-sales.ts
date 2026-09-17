import type { SaleHistoryListItem } from "@/lib/domain/sale-history";

export type CustomerSalesSummary = {
  lifetime_revenue: string;
  sales_count: number;
  last_sale_at: string | null;
};

export type CustomerSalesListItem = SaleHistoryListItem & {
  store_id: string;
  store_name: string | null;
};

export type CustomerSalesResponse = {
  summary: CustomerSalesSummary;
  rows: CustomerSalesListItem[];
  next_cursor: { after_created_at: string; after_id: string } | null;
  has_more: boolean;
};

function readMoney(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) return null;
  return value;
}

function readOptionalString(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : null;
}

export function parseCustomerSalesSummary(value: unknown): CustomerSalesSummary | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const lifetimeRevenue = readMoney(row.lifetime_revenue);
  if (lifetimeRevenue == null || typeof row.sales_count !== "number") return null;
  return {
    lifetime_revenue: lifetimeRevenue,
    sales_count: row.sales_count,
    last_sale_at: readOptionalString(row.last_sale_at),
  };
}

export function parseCustomerSalesListItem(value: unknown): CustomerSalesListItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const total = readMoney(row.total);
  const discount = readMoney(row.discount);
  const subtotal = readMoney(row.subtotal);
  if (
    typeof row.sale_id !== "string" ||
    typeof row.status !== "string" ||
    typeof row.sync_status !== "string" ||
    typeof row.created_at !== "string" ||
    typeof row.store_id !== "string" ||
    total == null ||
    discount == null ||
    subtotal == null
  ) {
    return null;
  }
  return {
    sale_id: row.sale_id,
    store_id: row.store_id,
    store_name: readOptionalString(row.store_name),
    status: row.status,
    sync_status: row.sync_status,
    total,
    discount,
    subtotal,
    customer_name: readOptionalString(row.customer_name),
    cashier_id: readOptionalString(row.cashier_id),
    operator_name: readOptionalString(row.operator_name),
    payment_method: readOptionalString(row.payment_method),
    payment_status: readOptionalString(row.payment_status),
    created_at: row.created_at,
    confirmed_at: readOptionalString(row.confirmed_at),
  };
}

export function parseCustomerSalesResponse(value: unknown): CustomerSalesResponse | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const summary = parseCustomerSalesSummary(row.summary);
  if (!summary || !Array.isArray(row.rows)) return null;
  const rows = row.rows
    .map((item) => parseCustomerSalesListItem(item))
    .filter((item): item is CustomerSalesListItem => item != null);
  if (rows.length !== row.rows.length) return null;

  let nextCursor: CustomerSalesResponse["next_cursor"] = null;
  if (row.next_cursor != null) {
    if (!row.next_cursor || typeof row.next_cursor !== "object") return null;
    const cursor = row.next_cursor as Record<string, unknown>;
    if (typeof cursor.after_created_at !== "string" || typeof cursor.after_id !== "string") {
      return null;
    }
    nextCursor = {
      after_created_at: cursor.after_created_at,
      after_id: cursor.after_id,
    };
  }

  return {
    summary,
    rows,
    has_more: row.has_more === true,
    next_cursor: nextCursor,
  };
}
