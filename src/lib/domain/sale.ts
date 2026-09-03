import type { ProcessSaleInput } from "@/lib/validation/schemas";
import { money, multiplyMoney, subtractMoney, sumMoney, toMoneyString } from "@/lib/money";

export type CartLine = {
  productId: string;
  sku: string;
  name: string;
  unitPrice: string;
  quantity: number;
  discount: string;
};

export function lineTotal(line: CartLine): string {
  const gross = multiplyMoney(line.unitPrice, line.quantity);
  return subtractMoney(gross, line.discount);
}

export function cartSubtotal(lines: CartLine[]): string {
  return sumMoney(lines.map(lineTotal));
}

export function cartTotal(lines: CartLine[], discount = "0.00"): string {
  return subtractMoney(cartSubtotal(lines), discount);
}

export function buildProcessSalePayload(
  storeId: string,
  clientMutationId: string,
  lines: CartLine[],
  paymentMethod: ProcessSaleInput["payments"][number]["method"],
  options?: { customerId?: string; discount?: string; saleId?: string }
): ProcessSaleInput {
  const discount = options?.discount ?? "0.00";
  const total = cartTotal(lines, discount);

  if (paymentMethod !== "cash") {
    throw new Error("Only cash payments are supported in Sprint 1 MVP");
  }

  return {
    sale_id: options?.saleId,
    store_id: storeId,
    client_mutation_id: clientMutationId,
    customer_id: options?.customerId,
    discount,
    items: lines.map((line) => ({
      product_id: line.productId,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      discount: line.discount,
    })),
    payments: [{ method: paymentMethod, amount: total }],
  };
}

export function validateCartStock(
  lines: CartLine[],
  balances: Record<string, number>
): string | null {
  for (const line of lines) {
    const available = balances[line.productId] ?? 0;
    if (available < line.quantity) {
      return `Estoque insuficiente para ${line.name}`;
    }
  }
  return null;
}

export function parseUnitPrice(value: number | string): string {
  return toMoneyString(money(value));
}
