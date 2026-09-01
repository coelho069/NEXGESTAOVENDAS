import type { ProductRow } from "@/lib/domain/product";
import { parseUnitPrice } from "@/lib/domain/sale";

export type CatalogProduct = {
  productId: string;
  sku: string;
  name: string;
  unitPrice: string;
  barcode: string | null;
  isActive: boolean;
};

export type CatalogCustomer = {
  id: string;
  name: string;
  document: string | null;
  email: string | null;
};

export const DEMO_STORE_CENTRO = "22222222-2222-4222-8222-222222222201";
export const DEMO_STORE_SHOPPING = "22222222-2222-4222-8222-222222222202";

export const DEMO_PRODUCTS: ProductRow[] = [
  {
    id: "44444444-4444-4444-8444-444444444401",
    sku: "BEV-001",
    name: "Agua Mineral 500ml",
    unit_price: 3.5,
    barcode: "7891000100011",
    category_id: "33333333-3333-4333-8333-333333333301",
    is_active: true,
  },
  {
    id: "44444444-4444-4444-8444-444444444402",
    sku: "BEV-002",
    name: "Refrigerante Lata 350ml",
    unit_price: 5,
    barcode: "7891000100028",
    category_id: "33333333-3333-4333-8333-333333333301",
    is_active: true,
  },
  {
    id: "44444444-4444-4444-8444-444444444403",
    sku: "PAD-001",
    name: "Pao Frances Unidade",
    unit_price: 1.2,
    barcode: "7891000200017",
    category_id: "33333333-3333-4333-8333-333333333302",
    is_active: true,
  },
  {
    id: "44444444-4444-4444-8444-444444444404",
    sku: "PAD-002",
    name: "Bolo de Fuba Fatia",
    unit_price: 8.9,
    barcode: "7891000200024",
    category_id: "33333333-3333-4333-8333-333333333302",
    is_active: true,
  },
  {
    id: "44444444-4444-4444-8444-444444444405",
    sku: "HIG-001",
    name: "Sabonete Liquido 250ml",
    unit_price: 12.9,
    barcode: "7891000300010",
    category_id: "33333333-3333-4333-8333-333333333303",
    is_active: true,
  },
];

export const DEMO_CUSTOMERS: CatalogCustomer[] = [
  {
    id: "55555555-5555-4555-8555-555555555501",
    name: "Cliente Consumidor",
    document: null,
    email: "consumidor@example.invalid",
  },
  {
    id: "55555555-5555-4555-8555-555555555502",
    name: "Maria Silva",
    document: "12345678901",
    email: "maria.silva@example.invalid",
  },
];

const DEMO_QTY_CENTRO: Record<string, number> = {
  "44444444-4444-4444-8444-444444444401": 120,
  "44444444-4444-4444-8444-444444444402": 80,
  "44444444-4444-4444-8444-444444444403": 200,
  "44444444-4444-4444-8444-444444444404": 24,
  "44444444-4444-4444-8444-444444444405": 35,
};

const DEMO_QTY_SHOP: Record<string, number> = {
  "44444444-4444-4444-8444-444444444401": 90,
  "44444444-4444-4444-8444-444444444402": 60,
  "44444444-4444-4444-8444-444444444403": 150,
  "44444444-4444-4444-8444-444444444404": 18,
  "44444444-4444-4444-8444-444444444405": 20,
};

export function demoStockForStore(storeId: string): Record<string, number> {
  if (storeId === DEMO_STORE_SHOPPING) return { ...DEMO_QTY_SHOP };
  return { ...DEMO_QTY_CENTRO };
}

export function toCatalogProduct(row: ProductRow): CatalogProduct {
  return {
    productId: row.id,
    sku: row.sku,
    name: row.name,
    unitPrice: parseUnitPrice(row.unit_price),
    barcode: row.barcode,
    isActive: row.is_active,
  };
}

export function findProductByScan(products: CatalogProduct[], code: string): CatalogProduct | undefined {
  const normalized = code.trim().toLowerCase();
  if (!normalized) return undefined;
  return products.find(
    (product) =>
      product.sku.toLowerCase() === normalized || (product.barcode ?? "").toLowerCase() === normalized
  );
}