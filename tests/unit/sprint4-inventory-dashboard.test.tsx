import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PermissionGate } from "@/components/auth/permission-gate";
import {
  EMPTY_DASHBOARD,
  marginPercent,
  sellThroughPercent,
  summarizeDashboard,
} from "@/lib/domain/dashboard";
import { parseInventoryCsv, toExportCsv, wouldGoNegative } from "@/lib/domain/inventory";
import {
  canEditProducts,
  canManageInventory,
  canSeeCostPrice,
  canViewReports,
  rowsBelongToOrg,
} from "@/lib/domain/rbac";
import {
  dashboardMetricsQuerySchema,
  inventoryAdjustSchema,
  inventoryImportSchema,
  productWriteSchema,
} from "@/lib/validation/schemas";

describe("inventory CSV", () => {
  it("rejects missing header, zero delta, restock negative and empty reason", () => {
    expect(parseInventoryCsv("").errors[0]?.message).toMatch(/vazio/i);

    const header = parseInventoryCsv("sku,qty,reason\nA,1,x");
    expect(header.rows).toHaveLength(0);
    expect(header.errors[0]?.message).toMatch(/Cabeçalho/);

    const parsed = parseInventoryCsv(
      [
        "sku,delta,reason,movement_type",
        "BEV-001,0,compra,restock",
        "BEV-001,-2,compra,restock",
        "BEV-002,1,,adjustment",
        "BEV-003,4,compra,restock",
      ].join("\n")
    );
    expect(parsed.rows).toEqual([
      expect.objectContaining({ sku: "BEV-003", delta: 4, movementType: "restock" }),
    ]);
    expect(parsed.errors.map((issue) => issue.message).join(" ")).toMatch(/zero/);
    expect(parsed.errors.some((issue) => /positivo/i.test(issue.message))).toBe(true);
    expect(parsed.errors.some((issue) => /Motivo/i.test(issue.message))).toBe(true);
  });

  it("exports CSV without leaking cost when omitted", () => {
    const csv = toExportCsv([
      { sku: "BEV-001", name: 'Agua "Mineral"', quantity: 12, unitPrice: "3.50" },
    ]);
    expect(csv).toContain("sku,name,quantity,unit_price,cost_price");
    expect(csv).toContain("BEV-001");
    expect(csv).toMatch(/Agua ""Mineral""/);
    expect(csv.split("\n")[1]?.endsWith(",")).toBe(true);
  });

  it("blocks negative stock adjustments", () => {
    expect(wouldGoNegative(2, -2)).toBe(false);
    expect(wouldGoNegative(2, -3)).toBe(true);
  });
});

describe("dashboard metrics", () => {
  it("computes COGS, margin and sell-through with decimal strings", () => {
    const summary = summarizeDashboard([
      { revenue: "10.00", cogs: "4.00", unitsSold: 2, onHand: 8 },
      { revenue: "5.50", cogs: "1.10", unitsSold: 1, onHand: 0 },
    ]);
    expect(summary.revenue).toBe("15.50");
    expect(summary.cogs).toBe("5.10");
    expect(summary.grossProfit).toBe("10.40");
    expect(summary.marginPercent).toBe(marginPercent("15.50", "5.10"));
    expect(summary.unitsSold).toBe(3);
    expect(summary.sellThrough).toBe(sellThroughPercent(3, 8));
    expect(summary.sellThrough).toBe("27.27");
    expect(marginPercent("0.00", "1.00")).toBe("0.00");
    expect(EMPTY_DASHBOARD.revenue).toBe("0.00");
  });
});

describe("RBAC and org isolation", () => {
  it("limits cashier on reports, inventory writes and cost price", () => {
    expect(canViewReports("cashier")).toBe(false);
    expect(canManageInventory("cashier")).toBe(false);
    expect(canEditProducts("cashier")).toBe(false);
    expect(canSeeCostPrice("cashier")).toBe(false);
    expect(canViewReports("manager")).toBe(true);
    expect(canManageInventory("admin")).toBe(true);
  });

  it("rejects rows from another organization", () => {
    const orgA = "11111111-1111-4111-8111-111111111111";
    const orgB = "99999999-9999-4999-8999-999999999999";
    expect(rowsBelongToOrg([{ orgId: orgA }, { orgId: orgA }], orgA)).toBe(true);
    expect(rowsBelongToOrg([{ orgId: orgA }, { orgId: orgB }], orgA)).toBe(false);
  });

  it("renders PermissionGate as UX fallback only", () => {
    render(
      <PermissionGate role="cashier" allow={["admin", "manager"]}>
        <div>secret-report</div>
      </PermissionGate>
    );
    expect(screen.getByTestId("permission-denied")).toBeVisible();
    expect(screen.queryByText("secret-report")).toBeNull();
  });
});

describe("Zod inventory and dashboard", () => {
  const storeId = "22222222-2222-4222-8222-222222222201";

  it("accepts audited adjust payload and rejects restock with negative delta", () => {
    const ok = inventoryAdjustSchema.safeParse({
      store_id: storeId,
      sku: "BEV-001",
      delta: 2,
      reason: "compra",
      movement_type: "restock",
    });
    expect(ok.success).toBe(true);

    const bad = inventoryAdjustSchema.safeParse({
      store_id: storeId,
      sku: "BEV-001",
      delta: -1,
      reason: "compra",
      movement_type: "restock",
    });
    expect(bad.success).toBe(false);
  });

  it("validates import, dashboard query and product money strings", () => {
    expect(inventoryImportSchema.safeParse({ store_id: storeId, csv: "x" }).success).toBe(true);
    expect(
      dashboardMetricsQuerySchema.safeParse({
        store_id: storeId,
        from: "2026-09-01",
        to: "2026-09-01",
      }).success
    ).toBe(true);
    expect(
      productWriteSchema.safeParse({
        sku: "NEW-001",
        name: "Novo",
        unit_price: "1.50",
        cost_price: "0.40",
      }).success
    ).toBe(true);
    expect(
      productWriteSchema.safeParse({
        sku: "NEW-001",
        name: "Novo",
        unit_price: 1.5,
        cost_price: "0.40",
      }).success
    ).toBe(false);
  });
});
