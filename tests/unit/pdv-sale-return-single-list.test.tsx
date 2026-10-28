import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaleHistoryDetail } from "@/lib/domain/sale-history";
import { PdvScreen } from "@/components/pdv/pdv-screen";
import { DEMO_STORE_CENTRO } from "@/lib/domain/catalog";
import { fixtureStoreOptions } from "@/lib/pdv/fixtures";
import { useCartStore } from "@/stores/cart-store";
import { usePdvUiStore } from "@/stores/pdv-ui-store";

const detail: SaleHistoryDetail = {
  sale_id: "sale-1",
  status: "confirmed",
  sync_status: "synced",
  total: "10.00",
  discount: "0.00",
  subtotal: "10.00",
  customer_name: null,
  cashier_id: null,
  operator_name: null,
  payment_method: "cash",
  payment_status: "captured",
  created_at: "2026-10-07T15:00:00.000Z",
  confirmed_at: "2026-10-07T15:00:00.000Z",
  notes: null,
  refunded_total: "0.00",
  refundable_total: "10.00",
  payments: [],
  items: [
    {
      sale_item_id: "item-1",
      product_id: "prod-1",
      product_sku: "BEV-001",
      product_name: "Agua Mineral Duplicada",
      quantity: "1.000",
      quantity_returned: "0.000",
      quantity_returnable: "1.000",
      unit_price: "10.00",
      discount: "0.00",
      total: "10.00",
    },
  ],
};

vi.mock("@/hooks/use-sales-history", () => ({
  useSalesHistory: () => ({
    rows: [],
    detail,
    loading: false,
    detailLoading: false,
    mutating: false,
    error: null,
    query: "",
    hasMore: false,
    setQuery: vi.fn(),
    refresh: vi.fn(async () => undefined),
    loadMore: vi.fn(async () => undefined),
    openDetail: vi.fn(async () => undefined),
    submitReturn: vi.fn(async () => undefined),
    clearDetail: vi.fn(),
    clearError: vi.fn(),
  }),
}));

function resetPdvState() {
  localStorage.clear();
  useCartStore.setState({
    storeId: null,
    lines: [],
    discount: "0.00",
    customerId: null,
    customerName: null,
    suspendedSaleId: null,
    suspensionClaimId: null,
    checkoutAttemptId: null,
    checkoutInFlight: false,
  });
  usePdvUiStore.setState({
    selectedProductId: null,
    openPanel: "none",
    lastReceipt: null,
    pendingPix: null,
    draftReason: null,
    inventoryEpoch: 0,
  });
}

describe("PDV sale return list", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_PDV_FIXTURES", "1");
    vi.stubGlobal(
      "fetch",
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ configured: false, status: "not_configured" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        )
    );
    resetPdvState();
  });

  afterEach(() => {
    cleanup();
    resetPdvState();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps the sale item list in one panel while the return dialog is open", async () => {
    const stores = fixtureStoreOptions().map((store) => ({ ...store, role: "cashier" as const }));
    render(<PdvScreen stores={stores} initialStoreId={DEMO_STORE_CENTRO} role="cashier" />);

    await waitFor(() => {
      expect(screen.getByTestId("open-sales-history")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("open-sales-history"));

    expect(screen.getByTestId("sales-history-panel")).toBeTruthy();
    expect(screen.getAllByText(/Agua Mineral Duplicada/)).toHaveLength(1);

    fireEvent.click(screen.getByTestId("sale-history-return"));

    expect(screen.queryByTestId("sales-history-panel")).toBeNull();
    expect(screen.getByTestId("sale-return-dialog")).toBeTruthy();
    expect(screen.getAllByText(/Agua Mineral Duplicada/)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));

    expect(screen.queryByTestId("sale-return-dialog")).toBeNull();
    expect(screen.getByTestId("sales-history-panel")).toBeTruthy();
    expect(screen.getAllByText(/Agua Mineral Duplicada/)).toHaveLength(1);
  });
});
