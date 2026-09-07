import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AppNav } from "@/components/layout/app-nav";

const pathname = vi.hoisted(() => ({ current: "/dashboard" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

afterEach(() => {
  cleanup();
  pathname.current = "/dashboard";
});

describe("AppNav", () => {
  it("marks the current route as the active page", () => {
    render(<AppNav role="manager" storeId="store-1" />);

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "PDV" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Inventário" })).toHaveAttribute(
      "href",
      "/inventory?store=store-1"
    );
  });

  it("hides dashboard for cashier and keeps store query on PDV", () => {
    pathname.current = "/pdv";
    render(<AppNav role="cashier" storeId="store-1" />);

    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
    expect(screen.getByRole("link", { name: "PDV" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "PDV" })).toHaveAttribute("href", "/pdv?store=store-1");
  });
});
