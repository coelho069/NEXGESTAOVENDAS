import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProductSearch } from "@/components/features/ProductSearch";
import { useCartStore } from "@/stores/useCartStore";

const STORE_A = "22222222-2222-4222-8222-222222222201";
const STORE_B = "22222222-2222-4222-8222-222222222202";
const stores = [
  { id: STORE_A, name: "Loja Centro" },
  { id: STORE_B, name: "Loja Shopping" },
];

describe("reconstructed product feature", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_PDV_FIXTURES", "1");
    localStorage.clear();
    useCartStore.getState().clear();
    useCartStore.getState().setLines([]);
    useCartStore.getState().setStoreId(null);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    useCartStore.getState().clear();
    useCartStore.getState().setStoreId(null);
    vi.unstubAllEnvs();
  });

  it("debounces search and adds the selected product to the cart", async () => {
    render(<ProductSearch scopeKey="test" stores={stores} initialStoreId={STORE_A} />);

    await waitFor(() => {
      expect(screen.getByText("Agua Mineral 500ml")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Buscar produto"), {
      target: { value: "BEV-001" },
    });

    await waitFor(() => {
      expect(screen.getByText("Agua Mineral 500ml")).toBeInTheDocument();
      expect(screen.queryByText("Refrigerante Lata 350ml")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    expect(useCartStore.getState().lines).toEqual([
      {
        productId: "44444444-4444-4444-8444-444444444401",
        sku: "BEV-001",
        name: "Agua Mineral 500ml",
        unitPrice: "3.50",
        quantity: 1,
        discount: "0.00",
      },
    ]);
    expect(useCartStore.getState().storeId).toBe(STORE_A);
  });

  it("does not add a product without an authorized store context", async () => {
    render(<ProductSearch scopeKey="no-store" />);

    await waitFor(() => {
      expect(screen.getByText("Agua Mineral 500ml")).toBeInTheDocument();
    });

    expect(screen.getAllByRole("button", { name: "Adicionar" })[0]).toBeDisabled();
    expect(useCartStore.getState().lines).toEqual([]);
  });

  it("does not silently move an open cart to another store", async () => {
    render(<ProductSearch scopeKey="store-switch" stores={stores} initialStoreId={STORE_A} />);

    await waitFor(() => {
      expect(screen.getByText("Agua Mineral 500ml")).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Adicionar" })[0]!);

    fireEvent.change(screen.getByTestId("feature-store"), { target: { value: STORE_B } });

    expect(useCartStore.getState().storeId).toBe(STORE_A);
    expect(screen.getByTestId("feature-store-message")).toHaveTextContent("carrinho aberto");
  });
});
