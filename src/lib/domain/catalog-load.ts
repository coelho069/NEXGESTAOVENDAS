import type { ProductRow } from "@/lib/domain/product";

export function resolveCatalogLoad(input: {
  failed: boolean;
  data: ProductRow[] | null;
  fixtures: boolean;
  fixtureProducts: ProductRow[];
}): { products: ProductRow[]; error: string | null } {
  if (!input.failed && input.data) {
    return { products: input.data, error: null };
  }
  if (input.fixtures) {
    return { products: input.fixtureProducts, error: null };
  }
  return { products: [], error: "Falha ao carregar catálogo" };
}
