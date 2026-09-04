import Decimal from "decimal.js";
import type { CartLine } from "@/lib/domain/sale";
import { lineTotal } from "@/lib/domain/sale";

export type SuspendedSaleStatus = "suspended" | "claimed" | "completed";

export type SuspendedSnapshotItem = {
  product_id: string;
  sku: string;
  name: string;
  quantity: string;
  unit_price: string;
  discount: string;
  total: string;
};

export type SuspendedSaleSnapshot = {
  version: 1;
  org_id: string;
  store_id: string;
  operator_id: string;
  terminal_id: string;
  client_mutation_id: string;
  request_items: Array<{
    product_id: string;
    quantity: string;
    unit_price: string;
    discount: string;
  }>;
  items: SuspendedSnapshotItem[];
  subtotal: string;
  discount: string;
  total: string;
  customer_id: string | null;
  customer_name: string | null;
  notes: string | null;
  created_at: string;
};

export type SuspendedSaleSummary = {
  suspended_sale_id: string;
  status: Exclude<SuspendedSaleStatus, "completed">;
  operator_id: string;
  terminal_id: string;
  customer_id: string | null;
  customer_name: string | null;
  item_count: number;
  subtotal: string;
  discount: string;
  total: string;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
};

export type SuspendedSaleRecovery = {
  suspended_sale_id: string;
  status: "claimed";
  claim_id: string;
  store_id: string;
  terminal_id: string;
  snapshot: SuspendedSaleSnapshot;
  replay: boolean;
};

export type SuspendedCartContext = {
  suspendedSaleId: string;
  claimId: string;
};

export function canTransitionSuspendedSale(
  from: SuspendedSaleStatus,
  to: SuspendedSaleStatus
): boolean {
  return (
    (from === "suspended" && to === "claimed") ||
    (from === "claimed" && (to === "suspended" || to === "completed"))
  );
}

export function snapshotToCartLines(snapshot: SuspendedSaleSnapshot): CartLine[] {
  return snapshot.items.map((item) => ({
    productId: item.product_id,
    sku: item.sku,
    name: item.name,
    unitPrice: item.unit_price,
    quantity: parseQuantity(item.quantity),
    discount: item.discount,
  }));
}

export function snapshotTotalMatchesCart(
  snapshot: Pick<SuspendedSaleSnapshot, "items" | "discount" | "total">,
  lines: CartLine[],
  discount: string
): boolean {
  if (snapshot.discount !== discount || snapshot.items.length !== lines.length) return false;
  const snapshotIds = snapshot.items.map((item) => item.product_id).sort();
  const lineIds = lines.map((line) => line.productId).sort();
  if (JSON.stringify(snapshotIds) !== JSON.stringify(lineIds)) return false;

  return lines.every((line) => {
    const original = snapshot.items.find((item) => item.product_id === line.productId);
    return Boolean(
      original &&
        original.unit_price === line.unitPrice &&
        original.discount === line.discount &&
        new Decimal(original.quantity).eq(line.quantity) &&
        lineTotal(line) === original.total
    );
  });
}

export function createSnapshotFromCart(input: {
  orgId: string;
  storeId: string;
  operatorId: string;
  terminalId: string;
  clientMutationId: string;
  lines: CartLine[];
  discount: string;
  customerId: string | null;
  customerName: string | null;
  notes?: string | null;
  createdAt?: string;
}): SuspendedSaleSnapshot {
  const items = input.lines.map((line) => ({
    product_id: line.productId,
    sku: line.sku,
    name: line.name,
    quantity: line.quantity.toFixed(3),
    unit_price: line.unitPrice,
    discount: line.discount,
    total: lineTotal(line),
  }));

  return {
    version: 1,
    org_id: input.orgId,
    store_id: input.storeId,
    operator_id: input.operatorId,
    terminal_id: input.terminalId,
    client_mutation_id: input.clientMutationId,
    request_items: items.map(({ product_id, quantity, unit_price, discount }) => ({
      product_id,
      quantity,
      unit_price,
      discount,
    })),
    items,
    subtotal: items
      .reduce((sum, item) => sum.plus(item.total), new Decimal(0))
      .toFixed(2),
    discount: input.discount,
    total: items
      .reduce((sum, item) => sum.plus(item.total), new Decimal(0))
      .minus(input.discount)
      .toFixed(2),
    customer_id: input.customerId,
    customer_name: input.customerName,
    notes: input.notes ?? null,
    created_at: input.createdAt ?? new Date().toISOString(),
  };
}

function parseQuantity(value: string): number {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Snapshot de venda suspensa contém quantidade inválida");
  }
  return quantity;
}
