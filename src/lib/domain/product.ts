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
