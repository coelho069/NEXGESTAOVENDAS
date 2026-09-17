import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppNav } from "@/components/layout/app-nav";

const STORE_A = "11111111-1111-4111-8111-111111111111";

describe("AppNav assinaturas link", () => {
  it("hides Assinaturas for tenant users", () => {
    render(<AppNav role="admin" storeId={STORE_A} />);
    expect(screen.queryByRole("link", { name: "Assinaturas" })).not.toBeInTheDocument();
  });

  it("exposes Assinaturas for platform admins", () => {
    render(<AppNav role="cashier" storeId={STORE_A} isPlatformAdmin />);
    expect(screen.getByRole("link", { name: "Assinaturas" })).toHaveAttribute(
      "href",
      "/admin/assinaturas"
    );
  });
});
