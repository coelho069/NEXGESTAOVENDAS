import type { Tables } from "@/lib/db/types";

export type ProductRow = Pick<
  Tables<"products">,
  "id" | "sku" | "name" | "unit_price" | "barcode" | "category_id" | "is_active"
>;

export function filterActiveProducts(products: ProductRow[]): ProductRow[] {
  return products.filter((product) => product.is_active);
}

export function searchProducts(products: ProductRow[], query: string): ProductRow[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return products;

  return products.filter((product) => {
    return (
      product.name.toLowerCase().includes(normalized) ||
      product.sku.toLowerCase().includes(normalized) ||
      (product.barcode ?? "").toLowerCase().includes(normalized)
    );
  });
}
