import type { Tables } from "@/lib/db/types";

export type ProductRow = Pick<
  Tables<"products">,
  "id" | "sku" | "name" | "unit_price" | "barcode" | "category_id" | "is_active"
>;

export function filterActiveProducts(products: ProductRow[]): ProductRow[] {
  return products.filter((product) => product.is_active);
}

function isExactProductMatch(product: ProductRow, normalized: string): boolean {
  return (
    product.sku.toLowerCase() === normalized ||
    product.name.toLowerCase() === normalized ||
    (product.barcode ?? "").toLowerCase() === normalized
  );
}

export function searchProducts(products: ProductRow[], query: string): ProductRow[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return products;

  const matches = products.filter((product) => {
    return (
      product.name.toLowerCase().includes(normalized) ||
      product.sku.toLowerCase().includes(normalized) ||
      (product.barcode ?? "").toLowerCase().includes(normalized)
    );
  });

  return matches.sort((left, right) => {
    const leftExact = isExactProductMatch(left, normalized);
    const rightExact = isExactProductMatch(right, normalized);
    if (leftExact && !rightExact) return -1;
    if (!leftExact && rightExact) return 1;
    return 0;
  });
}

/**
 * Valida uma linha de produto vinda da API (PostgREST via servidor).
 * Mantém o formato de ProductRow; linhas inválidas devolvem null.
 */
export function parseCatalogProduct(value: unknown): ProductRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const priceOk = typeof row.unit_price === "number" || typeof row.unit_price === "string";
  if (
    typeof row.id !== "string" ||
    typeof row.sku !== "string" ||
    typeof row.name !== "string" ||
    !priceOk ||
    typeof row.is_active !== "boolean"
  ) {
    return null;
  }
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    unit_price: row.unit_price as ProductRow["unit_price"],
    barcode: typeof row.barcode === "string" ? row.barcode : null,
    category_id: typeof row.category_id === "string" ? row.category_id : null,
    is_active: row.is_active,
  };
}
