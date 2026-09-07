import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoreSelect } from "@/components/auth/store-select";

const STORE_A = { id: "22222222-2222-4222-8222-222222222201", name: "Loja Centro" };
const STORE_B = { id: "22222222-2222-4222-8222-222222222202", name: "Loja Shopping" };

describe("StoreSelect", () => {
  afterEach(() => {
    cleanup();
  });

  it("hides the dropdown and pins the store when membership has exactly one store", () => {
    render(
      <form>
        <StoreSelect name="store" testId="store-select" stores={[STORE_A]} value={STORE_A.id} />
      </form>
    );

    expect(screen.queryByTestId("store-select")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByTestId("store-select-fixed")).toHaveTextContent("Loja Centro");
    expect(screen.getByTestId("store-select-hidden")).toHaveValue(STORE_A.id);
  });

  it("keeps the dropdown when the operator has two or more stores", () => {
    const onChange = vi.fn();
    render(
      <StoreSelect
        testId="store-select"
        stores={[STORE_A, STORE_B]}
        value={STORE_A.id}
        onChange={onChange}
      />
    );

    const select = screen.getByTestId("store-select");
    expect(select).toBeVisible();
    expect(select).toHaveValue(STORE_A.id);
    fireEvent.change(select, { target: { value: STORE_B.id } });
    expect(onChange).toHaveBeenCalledWith(STORE_B.id);
  });

  it("keeps an empty picker when no store is authorized", () => {
    render(<StoreSelect testId="store-select" stores={[]} value={null} />);

    expect(screen.getByTestId("store-select")).toBeDisabled();
    expect(screen.queryByTestId("store-select-fixed")).toBeNull();
  });
});
