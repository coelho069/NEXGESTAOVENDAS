import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import {
  getElectronicPaymentAdapterAlerts,
  type PaymentAdapterAlert,
} from "@/lib/adapters/payment";
import { EMPTY_DASHBOARD } from "@/lib/domain/dashboard";
import type { DashboardLoadResult, DashboardRow } from "@/lib/server/dashboard-query";

const STORE_ID = "22222222-2222-4222-8222-222222222201";

function makeRow(overrides: Partial<DashboardRow>): DashboardRow {
  return {
    product_id: "product-ok",
    sku: "OK-001",
    product_name: "Produto ok",
    revenue: "10.00",
    cogs: "4.00",
    gross_profit: "6.00",
    units_sold: 1,
    on_hand: 5,
    sell_through: "16.67",
    discounts: "0.00",
    cogs_available: true,
    ...overrides,
  };
}

function makeResult(overrides: Partial<DashboardLoadResult> = {}): DashboardLoadResult {
  return {
    degraded: false,
    forbidden: false,
    role: "manager",
    storeId: STORE_ID,
    stores: [{ id: STORE_ID, name: "Loja Centro" }],
    message: null,
    payload: {
      summary: {
        ...EMPTY_DASHBOARD,
        revenue: "25.00",
        salesCount: 2,
        averageTicket: "12.50",
        totalDiscounts: "1.00",
        excludedSales: { cancelled: 2, refunded: 1 },
        excludedPayments: { refunded: 3, unknown: 1 },
        inventory: {
          onHandQuantity: "3.000",
          skuCount: 4,
          negativeQuantityRows: 1,
        },
      },
      rows: [
        makeRow({ product_id: "p-ok", sku: "BEV-001", product_name: "Água", on_hand: 8 }),
        makeRow({ product_id: "p-zero", sku: "SNK-000", product_name: "Salgadinho", on_hand: 0 }),
        makeRow({ product_id: "p-neg", sku: "DRY-NEG", product_name: "Biscoito", on_hand: -1 }),
      ],
      next_cursor: null,
      from: "2026-09-01",
      to: "2026-09-02",
    },
    ...overrides,
  };
}

const defaultAlerts = getElectronicPaymentAdapterAlerts();

afterEach(() => {
  cleanup();
});

describe("dashboard OPEX P0", () => {
  it("renders excluded sale and payment counts from the RPC payload", () => {
    render(
      <DashboardScreen storeId={STORE_ID} initial={makeResult()} paymentAlerts={defaultAlerts} />
    );

    const excluded = screen.getByTestId("dashboard-excluded");
    expect(excluded).toHaveTextContent("Cancelada");
    expect(excluded).toHaveTextContent("2");
    expect(excluded).toHaveTextContent("Estornada");
    expect(excluded).toHaveTextContent("1");
    expect(excluded).toHaveTextContent("Pagamento estornado");
    expect(excluded).toHaveTextContent("3");
    expect(excluded).toHaveTextContent("Pagamento unknown");
    expect(screen.getByTestId("dashboard-revenue")).toHaveTextContent("25,00");
  });

  it("lists current-page SKUs with on_hand <= 0 and links to inventory with store", () => {
    render(
      <DashboardScreen storeId={STORE_ID} initial={makeResult()} paymentAlerts={defaultAlerts} />
    );

    const critical = screen.getByTestId("dashboard-critical-stock");
    expect(critical).toHaveTextContent("Linhas negativas (loja)");
    expect(critical).toHaveTextContent("1");
    expect(critical).toHaveTextContent("SNK-000");
    expect(critical).toHaveTextContent("DRY-NEG");
    expect(critical).not.toHaveTextContent("BEV-001");
    expect(screen.getByTestId("dashboard-inventory-link")).toHaveAttribute(
      "href",
      `/inventory?store=${STORE_ID}`
    );
  });

  it("shows amber payment not_configured and unknown from adapter/payload", () => {
    const alerts: PaymentAdapterAlert[] = [
      { method: "card", adapterStatus: "not_configured", operationStatus: "not_configured" },
      { method: "pix", adapterStatus: "not_configured", operationStatus: "not_configured" },
      { method: "other", adapterStatus: "not_configured", operationStatus: "unknown" },
    ];
    render(<DashboardScreen storeId={STORE_ID} initial={makeResult()} paymentAlerts={alerts} />);

    const strip = screen.getByTestId("dashboard-alerts");
    expect(strip).toHaveClass("bg-amber-50");
    expect(strip).toHaveTextContent("not_configured");
    expect(strip).toHaveTextContent("Cartão");
    expect(strip).toHaveTextContent("PIX");
    expect(strip).toHaveTextContent("Outro");
    expect(strip).toHaveTextContent("unknown");
    expect(strip).toHaveTextContent("3 venda(s) e 4 pagamento(s)");
  });

  it("keeps cashier blocked from OPEX cards by existing RBAC", () => {
    render(
      <DashboardScreen
        storeId={STORE_ID}
        initial={makeResult({ role: "cashier", forbidden: true })}
        paymentAlerts={defaultAlerts}
      />
    );

    expect(screen.getByTestId("permission-denied")).toBeVisible();
    expect(screen.queryByTestId("dashboard-metrics")).toBeNull();
    expect(screen.queryByTestId("dashboard-excluded")).toBeNull();
    expect(screen.queryByTestId("dashboard-critical-stock")).toBeNull();
    expect(screen.queryByTestId("dashboard-alerts")).toBeNull();
  });

  it("does not invent excluded counts when the payload is empty", () => {
    render(
      <DashboardScreen
        storeId={STORE_ID}
        initial={makeResult({
          payload: {
            summary: EMPTY_DASHBOARD,
            rows: [],
            next_cursor: null,
            from: "2026-09-01",
            to: "2026-09-02",
          },
        })}
        paymentAlerts={defaultAlerts}
      />
    );

    const excluded = screen.getByTestId("dashboard-excluded");
    expect(excluded).toHaveTextContent("Vendas excluídas");
    expect(excluded).toHaveTextContent("Nenhuma venda excluída no período.");
    expect(excluded).toHaveTextContent("Nenhum pagamento excluído no período.");
    expect(screen.getByTestId("dashboard-revenue")).toHaveTextContent("0,00");
  });
});

describe("electronic payment adapter alerts", () => {
  it("reports card/pix/voucher/other as not_configured without Stripe KPIs", () => {
    const alerts = getElectronicPaymentAdapterAlerts();
    expect(alerts.map((alert) => alert.method)).toEqual(["card", "pix", "voucher", "other"]);
    for (const alert of alerts) {
      expect(alert.adapterStatus).toBe("not_configured");
      expect(alert.operationStatus).toBe("not_configured");
    }
  });
});
