import { describe, expect, it } from "vitest";
import {
  aggregatePaymentsByMethod,
  averageTicket,
  isOfficialRevenueSale,
  parseDashboardPeriod,
} from "@/lib/domain/dashboard";
import { formatBRL } from "@/lib/money";
import { dashboardMetricsQuerySchema } from "@/lib/validation/schemas";

describe("blocker 9 dashboard domain", () => {
  it("calculates the average ticket with decimal strings", () => {
    expect(averageTicket("10.00", 3)).toBe("3.33");
    expect(averageTicket("0.30", 2)).toBe("0.15");
    expect(averageTicket("0.00", 0)).toBeNull();
  });

  it("uses an inclusive start and exclusive end date range", () => {
    expect(parseDashboardPeriod("2026-09-01", "2026-09-02")).toEqual({
      from: "2026-09-01",
      to: "2026-09-02",
    });
    expect(parseDashboardPeriod("2026-09-01", "2026-09-01")).toBeNull();
    expect(parseDashboardPeriod("2026-02-28", "2026-03-01")).toEqual({
      from: "2026-02-28",
      to: "2026-03-01",
    });
    expect(parseDashboardPeriod("2026-02-30", "2026-03-01")).toBeNull();
    expect(
      parseDashboardPeriod("2026-01-01", "2027-01-03")
    ).toBeNull();
  });

  it("counts only confirmed sales with captured payments as official revenue", () => {
    expect(isOfficialRevenueSale("confirmed", "captured")).toBe(true);
    expect(isOfficialRevenueSale("confirmed", "pending")).toBe(false);
    expect(isOfficialRevenueSale("confirmed", "unknown")).toBe(false);
    expect(isOfficialRevenueSale("cancelled", "captured")).toBe(false);
    expect(isOfficialRevenueSale("suspended", "captured")).toBe(false);
  });

  it("groups captured payment amounts by method without binary floating point", () => {
    expect(
      aggregatePaymentsByMethod([
        { method: "cash", amount: "0.10" },
        { method: "cash", amount: "0.20" },
        { method: "card", amount: "1.25" },
      ])
    ).toEqual({
      cash: "0.30",
      card: "1.25",
      pix: "0.00",
      voucher: "0.00",
      other: "0.00",
    });
  });

  it("formats persisted money for display without making it an official aggregate", () => {
    expect(formatBRL("1234.50")).toContain("1.234,50");
  });

  it("rejects an invalid or same-day API period", () => {
    const base = {
      store_id: "22222222-2222-4222-8222-222222222201",
      from: "2026-09-01",
    };
    expect(
      dashboardMetricsQuerySchema.safeParse({ ...base, to: "2026-09-01" }).success
    ).toBe(false);
    expect(
      dashboardMetricsQuerySchema.safeParse({ ...base, to: "2026-09-02" }).success
    ).toBe(true);
  });
});
