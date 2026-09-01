import { money, toMoneyString } from "@/lib/money";

export type DashboardLineInput = {
  revenue: string;
  cogs: string;
  unitsSold: number;
  onHand: number;
};

export type DashboardSummary = {
  revenue: string;
  cogs: string;
  grossProfit: string;
  marginPercent: string;
  unitsSold: number;
  sellThrough: string;
};

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
  };
}

export const EMPTY_DASHBOARD: DashboardSummary = {
  revenue: "0.00",
  cogs: "0.00",
  grossProfit: "0.00",
  marginPercent: "0.00",
  unitsSold: 0,
  sellThrough: "0.00",
};