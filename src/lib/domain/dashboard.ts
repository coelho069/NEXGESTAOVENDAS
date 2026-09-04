import { money, toMoneyString } from "@/lib/money";

export const REPORT_TIMEZONE = "America/Sao_Paulo";
export const REPORT_MAX_DAYS = 366;

export type DashboardDateRange = {
  from: string;
  to: string;
};

export type DashboardPaymentMethod =
  | "cash"
  | "card"
  | "pix"
  | "voucher"
  | "other";

export type DashboardCashSummary = {
  capturedCashPayments: string;
  cashLedgerSales: string;
  cashLedgerNet: string;
  supplies: string;
  withdrawals: string;
  openSessions: number;
  closedSessions: number;
  closedExpected: string;
  closedCounted: string;
  closedDifference: string;
};

export type DashboardInventorySummary = {
  onHandQuantity: string;
  skuCount: number;
  negativeQuantityRows: number;
};

export type DashboardSummary = {
  revenue: string;
  cogs: string | null;
  grossProfit: string | null;
  marginPercent: string | null;
  unitsSold: number;
  sellThrough: string | null;
  salesCount: number;
  averageTicket: string | null;
  totalDiscounts: string;
  itemDiscounts: string;
  saleDiscounts: string;
  paymentsByMethod: Record<DashboardPaymentMethod, string>;
  paymentCountsByMethod: Record<DashboardPaymentMethod, number>;
  cash: DashboardCashSummary;
  inventory: DashboardInventorySummary;
  excludedSales: Record<string, number>;
  excludedPayments: Record<string, number>;
  fiscalByStatus: Record<string, number>;
  cogsAvailable: boolean;
};

export type DashboardLineInput = {
  revenue: string;
  cogs: string;
  unitsSold: number;
  onHand: number;
};

const PAYMENT_METHODS: readonly DashboardPaymentMethod[] = [
  "cash",
  "card",
  "pix",
  "voucher",
  "other",
];

const ZERO_PAYMENT_TOTALS: Record<DashboardPaymentMethod, string> = {
  cash: "0.00",
  card: "0.00",
  pix: "0.00",
  voucher: "0.00",
  other: "0.00",
};

const ZERO_PAYMENT_COUNTS: Record<DashboardPaymentMethod, number> = {
  cash: 0,
  card: 0,
  pix: 0,
  voucher: 0,
  other: 0,
};

export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function addCalendarDays(value: string, days: number): string {
  if (!isValidDateOnly(value)) throw new Error("Invalid calendar date");
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return [
    result.getUTCFullYear().toString().padStart(4, "0"),
    (result.getUTCMonth() + 1).toString().padStart(2, "0"),
    result.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

export function defaultDashboardPeriod(now = new Date()): DashboardDateRange {
  const from = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIMEZONE,
  }).format(now);
  return { from, to: addCalendarDays(from, 1) };
}

export function parseDashboardPeriod(
  from?: string,
  to?: string
): DashboardDateRange | null {
  if (!from || !isValidDateOnly(from)) return null;
  const end = to ?? addCalendarDays(from, 1);
  if (!isValidDateOnly(end) || from >= end) return null;

  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = end.split("-").map(Number);
  const startOrdinal = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const endOrdinal = Date.UTC(toYear, toMonth - 1, toDay);
  const days = (endOrdinal - startOrdinal) / (24 * 60 * 60 * 1000);
  if (days < 1 || days > REPORT_MAX_DAYS) return null;

  return { from, to: end };
}

export function lineGrossProfit(revenue: string, cogs: string): string {
  return toMoneyString(money(revenue).minus(money(cogs)));
}

export function marginPercent(revenue: string, cogs: string): string {
  const rev = money(revenue);
  if (rev.lte(0)) return "0.00";
  return toMoneyString(money(lineGrossProfit(revenue, cogs)).times(100).dividedBy(rev));
}

export function sellThroughPercent(unitsSold: number, onHand: number): string {
  const denom = unitsSold + onHand;
  if (!(denom > 0)) return "0.00";
  return toMoneyString(money(unitsSold).times(100).dividedBy(denom));
}

export function averageTicket(revenue: string, salesCount: number): string | null {
  if (salesCount <= 0 || money(revenue).lte(0)) return null;
  return toMoneyString(money(revenue).dividedBy(salesCount));
}

export function isOfficialRevenueSale(
  saleStatus: string,
  paymentStatus: string
): boolean {
  return saleStatus === "confirmed" && paymentStatus === "captured";
}

export function aggregatePaymentsByMethod(
  payments: Array<{ method: DashboardPaymentMethod; amount: string }>
): Record<DashboardPaymentMethod, string> {
  const totals = { ...ZERO_PAYMENT_TOTALS };
  for (const payment of payments) {
    if (!PAYMENT_METHODS.includes(payment.method)) continue;
    totals[payment.method] = toMoneyString(
      money(totals[payment.method]).plus(money(payment.amount))
    );
  }
  return totals;
}

export function summarizeDashboard(lines: DashboardLineInput[]): DashboardSummary {
  const revenue = lines.reduce((acc, line) => acc.plus(money(line.revenue)), money(0));
  const cogs = lines.reduce((acc, line) => acc.plus(money(line.cogs)), money(0));
  const unitsSold = lines.reduce((acc, line) => acc + line.unitsSold, 0);
  const onHand = lines.reduce((acc, line) => acc + line.onHand, 0);
  const revenueStr = toMoneyString(revenue);
  const cogsStr = toMoneyString(cogs);
  return {
    revenue: revenueStr,
    cogs: cogsStr,
    grossProfit: lineGrossProfit(revenueStr, cogsStr),
    marginPercent: marginPercent(revenueStr, cogsStr),
    unitsSold,
    sellThrough: sellThroughPercent(unitsSold, onHand),
    salesCount: 0,
    averageTicket: null,
    totalDiscounts: "0.00",
    itemDiscounts: "0.00",
    saleDiscounts: "0.00",
    paymentsByMethod: { ...ZERO_PAYMENT_TOTALS },
    paymentCountsByMethod: { ...ZERO_PAYMENT_COUNTS },
    cash: {
      capturedCashPayments: "0.00",
      cashLedgerSales: "0.00",
      cashLedgerNet: "0.00",
      supplies: "0.00",
      withdrawals: "0.00",
      openSessions: 0,
      closedSessions: 0,
      closedExpected: "0.00",
      closedCounted: "0.00",
      closedDifference: "0.00",
    },
    inventory: {
      onHandQuantity: "0.000",
      skuCount: 0,
      negativeQuantityRows: 0,
    },
    excludedSales: {},
    excludedPayments: {},
    fiscalByStatus: {},
    cogsAvailable: true,
  };
}

export const EMPTY_DASHBOARD: DashboardSummary = {
  revenue: "0.00",
  cogs: null,
  grossProfit: null,
  marginPercent: null,
  unitsSold: 0,
  sellThrough: null,
  salesCount: 0,
  averageTicket: null,
  totalDiscounts: "0.00",
  itemDiscounts: "0.00",
  saleDiscounts: "0.00",
  paymentsByMethod: { ...ZERO_PAYMENT_TOTALS },
  paymentCountsByMethod: { ...ZERO_PAYMENT_COUNTS },
  cash: {
    capturedCashPayments: "0.00",
    cashLedgerSales: "0.00",
    cashLedgerNet: "0.00",
    supplies: "0.00",
    withdrawals: "0.00",
    openSessions: 0,
    closedSessions: 0,
    closedExpected: "0.00",
    closedCounted: "0.00",
    closedDifference: "0.00",
  },
  inventory: {
    onHandQuantity: "0.000",
    skuCount: 0,
    negativeQuantityRows: 0,
  },
  excludedSales: {},
  excludedPayments: {},
  fiscalByStatus: {},
  cogsAvailable: false,
};