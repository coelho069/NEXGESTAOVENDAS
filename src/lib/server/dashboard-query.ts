import { canViewReports, type MemberRole } from "@/lib/domain/rbac";
import {
  defaultDashboardPeriod,
  EMPTY_DASHBOARD,
  parseDashboardPeriod,
  type DashboardCashSummary,
  type DashboardInventorySummary,
  type DashboardPaymentMethod,
  type DashboardSummary,
} from "@/lib/domain/dashboard";
import { getAuthedContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fixtureStoreOptions, pdvFixturesEnabled } from "@/lib/pdv/fixtures";
import { storeIdSchema } from "@/lib/validation/schemas";
import type { StoreOption } from "@/lib/auth/store-context";

export type DashboardRow = {
  product_id: string;
  sku: string;
  product_name: string;
  revenue: string;
  cogs: string | null;
  gross_profit: string | null;
  units_sold: number;
  on_hand: number;
  sell_through: string | null;
  discounts: string;
  cogs_available: boolean;
};

export type DashboardPayload = {
  summary: DashboardSummary;
  rows: DashboardRow[];
  next_cursor: string | null;
  from: string;
  to: string;
};

export type DashboardLoadResult = {
  degraded: boolean;
  forbidden: boolean;
  role: MemberRole | null;
  storeId: string | null;
  stores: StoreOption[];
  payload: DashboardPayload;
  message: string | null;
};

type JsonRecord = Record<string, unknown>;

const PAYMENT_METHODS: readonly DashboardPaymentMethod[] = [
  "cash",
  "card",
  "pix",
  "voucher",
  "other",
];

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : asString(value);
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, entry]) => {
      const number = asNumber(entry);
      return number === null ? [] : [[key, number]];
    })
  );
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, entry]) => {
      const string = asString(entry);
      return string === null ? [] : [[key, string]];
    })
  );
}

function normalizeCashSummary(value: unknown): DashboardCashSummary | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const stringFields = [
    "captured_cash_payments",
    "cash_ledger_sales",
    "cash_ledger_net",
    "supplies",
    "withdrawals",
    "closed_expected",
    "closed_counted",
    "closed_difference",
  ] as const;
  const values = Object.fromEntries(
    stringFields.map((field) => [field, asString(raw[field])])
  );
  const openSessions = asNumber(raw.open_sessions);
  const closedSessions = asNumber(raw.closed_sessions);
  if (
    Object.values(values).some((value) => value === null) ||
    openSessions === null ||
    closedSessions === null
  ) {
    return null;
  }
  return {
    capturedCashPayments: values.captured_cash_payments!,
    cashLedgerSales: values.cash_ledger_sales!,
    cashLedgerNet: values.cash_ledger_net!,
    supplies: values.supplies!,
    withdrawals: values.withdrawals!,
    openSessions,
    closedSessions,
    closedExpected: values.closed_expected!,
    closedCounted: values.closed_counted!,
    closedDifference: values.closed_difference!,
  };
}

function normalizeInventorySummary(value: unknown): DashboardInventorySummary | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const onHandQuantity = asString(raw.on_hand_quantity);
  const skuCount = asNumber(raw.sku_count);
  const negativeQuantityRows = asNumber(raw.negative_quantity_rows);
  if (onHandQuantity === null || skuCount === null || negativeQuantityRows === null) {
    return null;
  }
  return { onHandQuantity, skuCount, negativeQuantityRows };
}

function normalizeSummary(value: unknown): DashboardSummary | null {
  const raw = asRecord(value);
  if (!raw) return null;

  const revenue = asString(raw.revenue);
  const unitsSold = asNumber(raw.units_sold);
  const salesCount = asNumber(raw.sales_count);
  const totalDiscounts = asString(raw.total_discounts);
  const itemDiscounts = asString(raw.item_discounts);
  const saleDiscounts = asString(raw.sale_discounts);
  const averageTicket = asNullableString(raw.average_ticket);
  const cogsAvailable = raw.cogs_available === true;
  const cash = normalizeCashSummary(raw.cash);
  const inventory = normalizeInventorySummary(raw.inventory);
  if (
    revenue === null ||
    unitsSold === null ||
    salesCount === null ||
    totalDiscounts === null ||
    itemDiscounts === null ||
    saleDiscounts === null ||
    cash === null ||
    inventory === null
  ) {
    return null;
  }

  const paymentsByMethod = normalizeStringRecord(raw.payments_by_method);
  const paymentCountsByMethod = normalizeNumberRecord(raw.payment_counts_by_method);
  if (
    PAYMENT_METHODS.some(
      (method) =>
        typeof paymentsByMethod[method] !== "string" ||
        typeof paymentCountsByMethod[method] !== "number"
    )
  ) {
    return null;
  }

  return {
    revenue,
    cogs: cogsAvailable ? asNullableString(raw.cogs) : null,
    grossProfit: cogsAvailable ? asNullableString(raw.gross_profit) : null,
    marginPercent: cogsAvailable ? asNullableString(raw.margin_percent) : null,
    unitsSold,
    sellThrough: asNullableString(raw.sell_through),
    salesCount,
    averageTicket,
    totalDiscounts,
    itemDiscounts,
    saleDiscounts,
    paymentsByMethod: {
      cash: paymentsByMethod.cash!,
      card: paymentsByMethod.card!,
      pix: paymentsByMethod.pix!,
      voucher: paymentsByMethod.voucher!,
      other: paymentsByMethod.other!,
    },
    paymentCountsByMethod: {
      cash: paymentCountsByMethod.cash!,
      card: paymentCountsByMethod.card!,
      pix: paymentCountsByMethod.pix!,
      voucher: paymentCountsByMethod.voucher!,
      other: paymentCountsByMethod.other!,
    },
    cash,
    inventory,
    excludedSales: normalizeNumberRecord(raw.excluded_sales),
    excludedPayments: normalizeNumberRecord(raw.excluded_payments),
    fiscalByStatus: normalizeNumberRecord(raw.fiscal_by_status),
    cogsAvailable,
  };
}

function normalizePayload(value: unknown): DashboardPayload | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const summary = normalizeSummary(raw.summary);
  const from = asString(raw.from);
  const to = asString(raw.to);
  const nextCursor = asNullableString(raw.next_cursor);
  const rawRows = Array.isArray(raw.rows) ? raw.rows : null;
  if (summary === null || from === null || to === null || rawRows === null) return null;

  const rows: DashboardRow[] = [];
  for (const rawRow of rawRows) {
    const row = asRecord(rawRow);
    if (!row) return null;
    const productId = asString(row.product_id);
    const sku = asString(row.sku);
    const productName = asString(row.product_name);
    const revenue = asString(row.revenue);
    const unitsSold = asNumber(row.units_sold);
    const onHand = asNumber(row.on_hand);
    const discounts = asString(row.discounts);
    if (
      productId === null ||
      sku === null ||
      productName === null ||
      revenue === null ||
      unitsSold === null ||
      onHand === null ||
      discounts === null
    ) {
      return null;
    }
    rows.push({
      product_id: productId,
      sku,
      product_name: productName,
      revenue,
      cogs: asNullableString(row.cogs),
      gross_profit: asNullableString(row.gross_profit),
      units_sold: unitsSold,
      on_hand: onHand,
      sell_through: asNullableString(row.sell_through),
      discounts,
      cogs_available: row.cogs_available === true,
    });
  }

  return { summary, rows, next_cursor: nextCursor, from, to };
}

export async function loadDashboard(params: {
  storeId?: string;
  from?: string;
  to?: string;
  cursorSku?: string;
}): Promise<DashboardLoadResult> {
  const hasRequestedPeriod = params.from !== undefined || params.to !== undefined;
  const requestedPeriod =
    params.from !== undefined
      ? parseDashboardPeriod(params.from, params.to)
      : null;
  const period = requestedPeriod ?? defaultDashboardPeriod();
  const from = period.from;
  const to = period.to;
  const empty: DashboardPayload = {
    summary: EMPTY_DASHBOARD,
    rows: [],
    next_cursor: null,
    from,
    to,
  };

  const auth = await getAuthedContext(params.storeId);
  const fixtureMode = !auth && pdvFixturesEnabled();
  const stores = auth?.stores.map(({ id, name }) => ({ id, name })) ?? (fixtureMode ? fixtureStoreOptions() : []);
  const fixtureRequestedStoreIsValid =
    params.storeId === undefined ||
    (storeIdSchema.safeParse(params.storeId).success && stores.some((store) => store.id === params.storeId));
  const storeId = auth?.storeId
    ?? (fixtureMode && fixtureRequestedStoreIsValid
      ? params.storeId ?? stores[0]?.id ?? null
      : null);
  const role = auth?.role ?? (fixtureMode && storeId ? "cashier" : null);

  if (!auth && !fixtureMode) {
    return {
      degraded: true,
      forbidden: true,
      role: null,
      storeId: null,
      stores: [],
      payload: empty,
      message: "Dashboard oficial disponível somente online e com autenticação.",
    };
  }

  if (!auth && fixtureMode && storeId && role) {
    return {
      degraded: true,
      forbidden: true,
      role,
      storeId,
      stores,
      payload: empty,
      message: "Dashboard local de demonstração indisponível.",
    };
  }

  if (!storeId || !role || !canViewReports(role)) {
    return {
      degraded: false,
      forbidden: true,
      role,
      storeId,
      stores,
      payload: empty,
      message: auth?.stores.length ? "Selecione uma loja autorizada." : "Acesso à loja negado.",
    };
  }

  if (hasRequestedPeriod && !requestedPeriod) {
    return {
      degraded: true,
      forbidden: false,
      role,
      storeId,
      stores,
      payload: empty,
      message: "Período inválido: use início inclusivo, fim exclusivo e no máximo 366 dias.",
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_dashboard_metrics", {
      p_payload: {
        store_id: storeId,
        from,
        to,
        cursor_sku: params.cursorSku,
        limit: 20,
      },
    });
    if (error) {
      return {
        degraded: true,
        forbidden: false,
        role,
        storeId,
        stores,
        payload: empty,
        message: "Dashboard indisponível no servidor.",
      };
    }
    const payload = normalizePayload(data);
    if (!payload) {
      return {
        degraded: true,
        forbidden: false,
        role,
        storeId,
        stores,
        payload: empty,
        message: "Dashboard indisponível: resposta financeira incompleta.",
      };
    }
    return { degraded: false, forbidden: false, role, storeId, stores, payload, message: null };
  } catch {
    return {
      degraded: true,
      forbidden: false,
      role,
      storeId,
      stores,
      payload: empty,
      message: "Dashboard indisponível (servidor/Supabase). Estado degradado.",
    };
  }
}