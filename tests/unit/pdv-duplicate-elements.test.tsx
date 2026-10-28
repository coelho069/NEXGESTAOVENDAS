import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PdvScreen } from "@/components/pdv/pdv-screen";
import { DEMO_STORE_CENTRO } from "@/lib/domain/catalog";
import { fixtureStoreOptions } from "@/lib/pdv/fixtures";
import { useCartStore } from "@/stores/cart-store";
import { usePdvUiStore } from "@/stores/pdv-ui-store";

/**
 * Contagem medida em jsdom com NEXT_PUBLIC_PDV_FIXTURES=1 e fetch local
 * (nenhuma chamada a Stripe ou Mercado Pago):
 * - montagem com loja Centro: nenhum data-testid repetido; nenhum id repetido
 * - após adicionar BEV-001: projected-stock-BEV-001 fica só na grade
 *   (a linha do carrinho não monta um segundo StockLabel)
 * - diálogo de desconto aberto e fechado: o mesmo par permanece
 * - Atualizar lista (vendas suspensas) não cria outro data-testid repetido
 */

const FINANCIAL_HOST = /stripe\.com|mercadopago/i;

function blockedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (FINANCIAL_HOST.test(url)) {
    return Promise.reject(new Error(`provedor financeiro bloqueado no teste: ${url}`));
  }
  return Promise.resolve(
    new Response(
      JSON.stringify({ configured: false, testmode: false, status: "not_configured" }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  );
}

function repeated(attribute: "data-testid" | "id"): Array<[string, number]> {
  const counts = new Map<string, number>();
  const selector = attribute === "id" ? "[id]" : "[data-testid]";
  for (const node of document.querySelectorAll(selector)) {
    const value = node.getAttribute(attribute);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).sort(([left], [right]) => left.localeCompare(right));
}

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

describe("PDV duplicate elements", () => {
  const fetchCalls: string[] = [];

  beforeEach(() => {
    fetchCalls.length = 0;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_PDV_FIXTURES", "1");
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      return blockedFetch(input);
    });
    resetPdvState();
  });

  afterEach(() => {
    cleanup();
    resetPdvState();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps each data-testid unique on mount, refresh, add-to-cart and discount dialog", async () => {
    const stores = fixtureStoreOptions().map((store) => ({ ...store, role: "cashier" as const }));
    render(<PdvScreen stores={stores} initialStoreId={DEMO_STORE_CENTRO} role="cashier" />);

    await waitFor(() => {
      expect(screen.getByTestId("pdv-layout")).toBeInTheDocument();
      expect(screen.getByTestId("product-sku-BEV-001")).toBeInTheDocument();
      expect(screen.getByTestId("projected-stock-BEV-001")).toBeInTheDocument();
    });

    const mount = { testIds: repeated("data-testid"), ids: repeated("id") };

    fireEvent.click(screen.getByTestId("product-sku-BEV-001"));
    await waitFor(() => {
      expect(screen.getByTestId("cart-line-BEV-001")).toBeInTheDocument();
    });
    expect(screen.getAllByTestId("projected-stock-BEV-001")).toHaveLength(1);
    expect(
      screen.getByTestId("cart-line-BEV-001").querySelector("[data-testid='projected-stock-BEV-001']")
    ).toBeNull();
    expect(screen.getByTestId("product-sku-BEV-001").querySelector("[data-testid='projected-stock-BEV-001']")).toBeTruthy();
    const afterAdd = { testIds: repeated("data-testid"), ids: repeated("id") };

    fireEvent.click(screen.getByTestId("open-discount"));
    await waitFor(() => {
      expect(screen.getByTestId("discount-dialog")).toBeInTheDocument();
    });
    const dialogOpen = { testIds: repeated("data-testid"), ids: repeated("id") };

    fireEvent.click(screen.getByRole("button", { name: "Fechar desconto" }));
    await waitFor(() => {
      expect(screen.queryByTestId("discount-dialog")).toBeNull();
    });
    const dialogClosed = { testIds: repeated("data-testid"), ids: repeated("id") };

    fireEvent.click(screen.getByTestId("open-suspended-sales"));
    await waitFor(() => {
      expect(screen.getByTestId("refresh-suspended-sales")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("refresh-suspended-sales"));
    await waitFor(() => {
      expect(screen.getByTestId("suspended-sales-empty")).toBeInTheDocument();
    });
    const afterRefresh = { testIds: repeated("data-testid"), ids: repeated("id") };

    expect(fetchCalls.filter((url) => FINANCIAL_HOST.test(url))).toEqual([]);
    expect({ mount, afterAdd, dialogOpen, dialogClosed, afterRefresh }).toEqual({
      mount: { testIds: [], ids: [] },
      afterAdd: { testIds: [], ids: [] },
      dialogOpen: { testIds: [], ids: [] },
      dialogClosed: { testIds: [], ids: [] },
      afterRefresh: { testIds: [], ids: [] },
    });
  });
});
