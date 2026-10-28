import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PdvScreen } from "@/components/pdv/pdv-screen";
import { StockLabel } from "@/components/pdv/stock-label";
import { DEMO_STORE_CENTRO } from "@/lib/domain/catalog";
import { cartSubtotal, cartTotal } from "@/lib/domain/sale";
import { fixtureStoreOptions } from "@/lib/pdv/fixtures";
import { createCartStore } from "@/stores/cart-store";
import { useCartStore } from "@/stores/cart-store";
import { usePdvUiStore } from "@/stores/pdv-ui-store";

// Diagnóstico: fixtures locais (NEXT_PUBLIC_PDV_FIXTURES=1), fetch bloqueado para provedores financeiros.

const LINE = {
  productId: "44444444-4444-4444-8444-444444444401",
  sku: "BEV-001",
  name: "Agua Mineral 500ml",
  unitPrice: "3.50",
  quantity: 1,
  discount: "0.00",
};

function fetchStub(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (/stripe\.com|mercadopago/i.test(url)) return Promise.reject(new Error(`bloqueado: ${url}`));
  return Promise.resolve(
    new Response(JSON.stringify({ configured: false, testmode: false, status: "not_configured" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
}

function resetState() {
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

describe("diagnostico: carrinho (quantidade, incremento, subtotal)", () => {
  it("addLine com mesmo produto soma quantidade em uma linha só", () => {
    const store = createCartStore({ persist: false });
    store.getState().addLine(LINE);
    store.getState().addLine(LINE);
    expect(store.getState().lines).toHaveLength(1);
    expect(store.getState().lines[0]?.quantity).toBe(2);
  });

  it("updateQuantity para 0 remove a linha; decremento parcial mantém", () => {
    const store = createCartStore({ persist: false });
    store.getState().addLine({ ...LINE, quantity: 3 });
    store.getState().updateQuantity(LINE.productId, 2);
    expect(store.getState().lines[0]?.quantity).toBe(2);
    store.getState().updateQuantity(LINE.productId, 0);
    expect(store.getState().lines).toHaveLength(0);
  });

  it("subtotal e total em string decimal (3 x 3.50 - 0.50 = 10.00)", () => {
    const lines = [{ ...LINE, quantity: 3 }];
    expect(cartSubtotal(lines)).toBe("10.50");
    expect(cartTotal(lines, "0.50")).toBe("10.00");
  });

  it("não há bloqueio de quantidade acima do estoque no store (apenas UX via StockLabel)", () => {
    const store = createCartStore({ persist: false });
    store.getState().addLine({ ...LINE, quantity: 999 });
    expect(store.getState().lines[0]?.quantity).toBe(999);
  });
});

describe("diagnostico: StockLabel (estoque zero, positivo, indefinido)", () => {
  afterEach(() => {
    cleanup();
  });

  it("sem entrada de estoque mostra 'Estoque —' e não data-testid", () => {
    render(<StockLabel productId="p1" sku="X" stockQty={undefined} cartQty={0} />);
    expect(screen.getByText("Estoque —")).toBeInTheDocument();
    expect(screen.queryByTestId("projected-stock-X")).toBeNull();
  });

  it("estoque zero mostra projetado 0 em vermelho", () => {
    render(<StockLabel productId="p1" sku="X" stockQty={0} cartQty={0} />);
    const el = screen.getByTestId("projected-stock-X");
    expect(el.textContent).toContain("Estoque projetado: 0");
    expect(el.className).toContain("text-red-400");
  });

  it("estoque 5 com 2 no carrinho mostra projetado 3 em tom normal", () => {
    render(<StockLabel productId="p1" sku="X" stockQty={5} cartQty={2} />);
    const el = screen.getByTestId("projected-stock-X");
    expect(el.textContent).toContain("Estoque projetado: 3");
    expect(el.className).not.toContain("text-red-400");
  });

  it("carrinho acima do estoque mostra projetado NEGATIVO (sem trava visual)", () => {
    render(<StockLabel productId="p1" sku="X" stockQty={2} cartQty={5} />);
    expect(screen.getByTestId("projected-stock-X").textContent).toContain("Estoque projetado: -3");
  });
});

describe("diagnostico: PdvScreen com fixtures (repro do teste duplicado)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_PDV_FIXTURES", "1");
    vi.stubGlobal("fetch", vi.fn(fetchStub));
    resetState();
  });
  afterEach(() => {
    cleanup();
    resetState();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("monta grade com estoque do BEV-001 (timeout de 5s, não 1s)", async () => {
    const stores = fixtureStoreOptions().map((s) => ({ ...s, role: "cashier" as const }));
    const started = Date.now();
    render(<PdvScreen stores={stores} initialStoreId={DEMO_STORE_CENTRO} role="cashier" />);
    await waitFor(
      () => {
        expect(screen.getByTestId("product-sku-BEV-001")).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    const productReadyMs = Date.now() - started;
    await waitFor(
      () => {
        expect(screen.getByTestId("projected-stock-BEV-001")).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    const stockReadyMs = Date.now() - started;
    // Registra tempos para o relatório (não é asserção de negócio).
    console.log(`[diagnostico] produto visível em ${productReadyMs}ms; estoque visível em ${stockReadyMs}ms`);
  });
});
