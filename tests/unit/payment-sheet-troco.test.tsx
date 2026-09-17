import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { PaymentSheet } from "@/components/pdv/payment-sheet";

afterEach(() => {
  cleanup();
});

function renderSheet(overrides: Partial<ComponentProps<typeof PaymentSheet>> = {}) {
  const onCash = vi.fn();
  const onCard = vi.fn();
  const onClose = vi.fn();
  const props = {
    open: true,
    total: "25.50",
    disabled: false,
    cardSelectable: false,
    onCash,
    onCard,
    onClose,
    ...overrides,
  };
  const view = render(<PaymentSheet {...props} />);
  return { ...view, onCash, onCard, onClose, props };
}

describe("PaymentSheet cash troco UX", () => {
  it("asks for troco after selecting Dinheiro and pays immediately on Não", () => {
    const { onCash, onCard, onClose } = renderSheet();

    expect(screen.getByTestId("pdv-payment-sheet")).toBeVisible();
    expect(screen.getByTestId("payment-sheet-total")).toHaveTextContent("25,50");

    fireEvent.click(screen.getByTestId("checkout-cash"));
    expect(onCash).not.toHaveBeenCalled();
    expect(screen.getByTestId("troco-ask")).toHaveTextContent("Precisa de troco?");

    fireEvent.click(screen.getByTestId("troco-no"));
    expect(onCash).toHaveBeenCalledTimes(1);
    expect(onCard).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("computes troco from received amount without changing charged total, then calls onCash", () => {
    const { onCash } = renderSheet({ total: "10.00" });

    fireEvent.click(screen.getByTestId("checkout-cash"));
    fireEvent.click(screen.getByTestId("troco-yes"));

    const input = screen.getByTestId("troco-received-input");
    fireEvent.change(input, { target: { value: "20" } });

    expect(screen.getByTestId("payment-sheet-total")).toHaveTextContent("10,00");
    expect(screen.getByTestId("troco-amount")).toHaveTextContent("10,00");
    expect(screen.getByText(/total cobrado permanece/i)).toHaveTextContent("10,00");

    fireEvent.click(screen.getByTestId("troco-confirm"));
    expect(onCash).toHaveBeenCalledTimes(1);
  });

  it("blocks confirm when received is below total", () => {
    const { onCash } = renderSheet({ total: "15.00" });

    fireEvent.click(screen.getByTestId("checkout-cash"));
    fireEvent.click(screen.getByTestId("troco-yes"));
    fireEvent.change(screen.getByTestId("troco-received-input"), { target: { value: "10" } });

    expect(screen.getByTestId("troco-insufficient")).toBeVisible();
    expect(screen.queryByTestId("troco-amount")).toBeNull();
    expect(screen.getByTestId("troco-confirm")).toBeDisabled();

    fireEvent.click(screen.getByTestId("troco-confirm"));
    expect(onCash).not.toHaveBeenCalled();
  });

  it("back from troco steps returns to methods without calling onCash or onClose", () => {
    const { onCash, onClose } = renderSheet();

    fireEvent.click(screen.getByTestId("checkout-cash"));
    fireEvent.click(screen.getByTestId("troco-yes"));
    fireEvent.change(screen.getByTestId("troco-received-input"), { target: { value: "50" } });
    fireEvent.click(screen.getByTestId("troco-back"));

    expect(screen.getByTestId("troco-ask")).toBeVisible();
    expect(onCash).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("troco-back"));
    expect(screen.getByTestId("checkout-cash")).toBeVisible();
    expect(onCash).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("close from troco step only invokes onClose (cart clear is outside this sheet)", () => {
    const { onCash, onClose } = renderSheet();

    fireEvent.click(screen.getByTestId("checkout-cash"));
    fireEvent.click(screen.getByTestId("troco-yes"));
    fireEvent.click(screen.getAllByLabelText("Fechar pagamento")[0]);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCash).not.toHaveBeenCalled();
  });

  it("does not alter card button wiring", () => {
    const { onCash, onCard } = renderSheet({ cardSelectable: true });

    fireEvent.click(screen.getByTestId("checkout-card"));
    expect(onCard).toHaveBeenCalledTimes(1);
    expect(onCash).not.toHaveBeenCalled();
    expect(screen.queryByTestId("troco-ask")).toBeNull();
  });
});
