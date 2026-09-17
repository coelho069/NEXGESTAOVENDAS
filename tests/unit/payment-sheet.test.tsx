import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PaymentSheet } from "@/components/pdv/payment-sheet";

const TOTAL = "3.50";

function renderSheet(overrides: Partial<Parameters<typeof PaymentSheet>[0]> = {}) {
  const onCash = vi.fn();
  const onCard = vi.fn();
  const onClose = vi.fn();
  render(
    <PaymentSheet
      open={true}
      total={TOTAL}
      disabled={false}
      cardSelectable={false}
      onCash={onCash}
      onCard={onCard}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onCash, onCard, onClose };
}

describe("PaymentSheet cash change UX", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows ask-change after selecting Dinheiro", () => {
    renderSheet();
    fireEvent.click(screen.getByTestId("checkout-cash"));
    expect(screen.getByTestId("cash-change-ask")).toBeVisible();
    expect(screen.queryByTestId("cash-change-received")).toBeNull();
  });

  it("calls onCash immediately when change is not needed", () => {
    const { onCash } = renderSheet();
    fireEvent.click(screen.getByTestId("checkout-cash"));
    fireEvent.click(screen.getByTestId("cash-change-no"));
    expect(onCash).toHaveBeenCalledTimes(1);
  });

  it("requires received >= total and shows troco before confirming", () => {
    const { onCash } = renderSheet();
    fireEvent.click(screen.getByTestId("checkout-cash"));
    fireEvent.click(screen.getByTestId("cash-change-yes"));
    expect(screen.getByTestId("cash-change-received")).toBeVisible();

    fireEvent.change(screen.getByTestId("cash-received-input"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("cash-change-confirm"));
    expect(screen.getByTestId("cash-change-error")).toHaveTextContent(
      "Valor recebido deve ser maior ou igual ao total."
    );
    expect(onCash).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("cash-received-input"), { target: { value: "10" } });
    expect(screen.getByTestId("cash-change-amount")).toHaveTextContent("Troco:");
    fireEvent.click(screen.getByTestId("cash-change-confirm"));
    expect(onCash).toHaveBeenCalledTimes(1);
  });

  it("back from ask-change returns to methods without calling onCash", () => {
    const { onCash } = renderSheet();
    fireEvent.click(screen.getByTestId("checkout-cash"));
    fireEvent.click(screen.getByTestId("cash-change-back"));
    expect(screen.getByTestId("checkout-cash")).toBeVisible();
    expect(onCash).not.toHaveBeenCalled();
  });

  it("close does not call onCash", () => {
    const { onCash, onClose } = renderSheet();
    fireEvent.click(screen.getByTestId("checkout-cash"));
    const closeButtons = screen.getAllByLabelText("Fechar pagamento");
    fireEvent.click(closeButtons[closeButtons.length - 1]!);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCash).not.toHaveBeenCalled();
  });
});
