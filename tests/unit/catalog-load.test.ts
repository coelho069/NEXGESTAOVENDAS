import { describe, expect, it } from "vitest";
import { DEMO_PRODUCTS } from "@/lib/domain/catalog";
import {
  catalogLoadCauseFromUnknown,
  formatCatalogLoadError,
  resolveCatalogLoad,
} from "@/lib/domain/catalog-load";

describe("catalog load error passthrough", () => {
  it("surfaces supabase message and code when query fails without fixtures", () => {
    const resolved = resolveCatalogLoad({
      failed: true,
      data: null,
      fixtures: false,
      fixtureProducts: DEMO_PRODUCTS,
      cause: { message: "permission denied for table products", code: "42501" },
    });

    expect(resolved.products).toEqual([]);
    expect(resolved.error).toContain("Falha ao carregar catálogo");
    expect(resolved.error).toContain("permission denied for table products");
    expect(resolved.error).toContain("42501");
  });

  it("keeps generic error when no cause is provided", () => {
    expect(formatCatalogLoadError()).toBe("Falha ao carregar catálogo");
    expect(formatCatalogLoadError(null)).toBe("Falha ao carregar catálogo");
    expect(formatCatalogLoadError({ message: "   ", code: "" })).toBe("Falha ao carregar catálogo");
  });

  it("does not leak fixtures when production load fails", () => {
    const resolved = resolveCatalogLoad({
      failed: true,
      data: null,
      fixtures: false,
      fixtureProducts: DEMO_PRODUCTS,
      cause: "JWT expired",
    });

    expect(resolved.products).toEqual([]);
    expect(resolved.error).toBe("Falha ao carregar catálogo: JWT expired");
  });

  it("still uses fixtures and hides the error when fixtures are enabled", () => {
    const resolved = resolveCatalogLoad({
      failed: true,
      data: null,
      fixtures: true,
      fixtureProducts: DEMO_PRODUCTS,
      cause: { message: "permission denied for table products", code: "42501" },
    });

    expect(resolved.products).toEqual(DEMO_PRODUCTS);
    expect(resolved.error).toBeNull();
  });

  it("reads message and code from a thrown supabase-like object", () => {
    const cause = catalogLoadCauseFromUnknown({
      message: "permission denied for table products",
      code: "42501",
    });

    expect(formatCatalogLoadError(cause)).toBe(
      "Falha ao carregar catálogo: permission denied for table products (42501)"
    );
  });
});
