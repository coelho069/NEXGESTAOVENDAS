import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StockLabel } from "@/components/pdv/stock-label";

// Estoque fracionário (numeric(12,3)): a subtração não pode vazar ruído de ponto flutuante.
describe("StockLabel com estoque fracionário", () => {
  afterEach(() => cleanup());

  it("mostra 0,1 para 1.1 de estoque com 1 no carrinho (sem 0.10000000000000009)", () => {
    render(<StockLabel productId="p1" sku="FRAC-1" stockQty={1.1} cartQty={1} />);
    expect(screen.getByTestId("projected-stock-FRAC-1").textContent).toBe("Estoque projetado: 0,1 un");
  });

  it("marca em vermelho quando o projetado chega a zero", () => {
    render(<StockLabel productId="p2" sku="ZERO-1" stockQty={2} cartQty={2} />);
    const label = screen.getByTestId("projected-stock-ZERO-1");
    expect(label.textContent).toBe("Estoque projetado: 0 un");
    expect(label.className).toContain("text-red-400");
  });

  it("mostra traço quando não há linha local de estoque", () => {
    render(<StockLabel productId="p3" sku="NONE-1" stockQty={undefined} cartQty={0} />);
    expect(screen.getByText("Estoque —")).toBeTruthy();
  });
});
