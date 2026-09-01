import type { Enums } from "@/lib/db/types";
import type { CatalogProduct } from "@/lib/domain/catalog";
import type { CartLine } from "@/lib/domain/sale";
import { cartSubtotal, cartTotal, lineTotal } from "@/lib/domain/sale";
import { money, multiplyMoney, toMoneyString } from "@/lib/money";

export type MemberRole = Enums<"member_role">;

export type StockMap = Record<string, number>;

export type SaleState = {
  lines: CartLine[];
  discount: string;
  customerId: string | null;
};

export type SaleTotals = {
  subtotal: string;
  discount: string;
  total: string;
  itemCount: number;
};

export type SaleOpOk = { ok: true; state: SaleState; error?: undefined };
export type SaleOpFail = { ok: false; state: SaleState; error: string };
export type SaleOpResult = SaleOpOk | SaleOpFail;

export const DISCOUNT_LIMIT_PERCENT: Record<MemberRole, string> = {
  cashier: "5.00",
  manager: "20.00",
  admin: "100.00",
};

const MONEY_PATTERN = /^\d+\.\d{2}$/;

export function emptySaleState(): SaleState {
  return { lines: [], discount: "0.00", customerId: null };
}

export function parseMoneyInput(raw: string): string | null {
  const normalized = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return null;
  try {
    const value = money(normalized);
    if (value.isNaN() || value.lt(0)) return null;
    return toMoneyString(value);
  } catch {
    return null;
  }
}

export function maxDiscountForRole(subtotal: string, role: MemberRole): string {
  const percent = DISCOUNT_LIMIT_PERCENT[role];
  return toMoneyString(money(subtotal).times(percent).dividedBy(100));
}

function fail(state: SaleState, error: string): SaleOpFail {
  return { ok: false, state, error };
}

function ok(state: SaleState): SaleOpOk {
  return { ok: true, state };
}

function projectedAvailable(stock: StockMap | null | undefined, productId: string): number | null {
  if (!stock) return null;
  return stock[productId] ?? 0;
}

export function addItem(
  state: SaleState,
  product: CatalogProduct,
  quantity: number,
  stock?: StockMap | null
): SaleOpResult {
  if (!product.isActive) {
    return fail(state, `Produto inativo: ${product.name}`);
  }
  if (!(quantity > 0)) {
    return fail(state, "Quantidade deve ser positiva");
  }

  const existing = state.lines.find((line) => line.productId === product.productId);
  const nextQty = (existing?.quantity ?? 0) + quantity;
  const available = projectedAvailable(stock, product.productId);
  if (available !== null && nextQty > available) {
    return fail(state, `Estoque insuficiente para ${product.name}`);
  }

  const nextLine: CartLine = existing
    ? { ...existing, quantity: nextQty }
    : {
        productId: product.productId,
        sku: product.sku,
        name: product.name,
        unitPrice: product.unitPrice,
        quantity,
        discount: "0.00",
      };

  const lines = existing
    ? state.lines.map((line) => (line.productId === product.productId ? nextLine : line))
    : [...state.lines, nextLine];

  return ok({ ...state, lines });
}

export function removeItem(state: SaleState, productId: string): SaleOpResult {
  return ok({ ...state, lines: state.lines.filter((line) => line.productId !== productId) });
}

export function setQuantity(
  state: SaleState,
  productId: string,
  quantity: number,
  stock?: StockMap | null,
  product?: CatalogProduct | null
): SaleOpResult {
  if (quantity <= 0) {
    return removeItem(state, productId);
  }
  if (product && !product.isActive) {
    return fail(state, `Produto inativo: ${product.name}`);
  }
  const line = state.lines.find((item) => item.productId === productId);
  if (!line) {
    return fail(state, "Item não está no carrinho");
  }
  const available = projectedAvailable(stock, productId);
  if (available !== null && quantity > available) {
    return fail(state, `Estoque insuficiente para ${line.name}`);
  }
  return ok({
    ...state,
    lines: state.lines.map((item) => (item.productId === productId ? { ...item, quantity } : item)),
  });
}

export function applyDiscount(state: SaleState, discount: string, role: MemberRole): SaleOpResult {
  if (!MONEY_PATTERN.test(discount)) {
    return fail(state, "Desconto deve ser valor monetário 0.00");
  }
  const amount = money(discount);
  if (amount.lt(0)) {
    return fail(state, "Desconto não pode ser negativo");
  }
  const subtotal = cartSubtotal(state.lines);
  if (amount.gt(money(subtotal))) {
    return fail(state, "Desconto não pode exceder o subtotal");
  }
  const max = maxDiscountForRole(subtotal, role);
  if (amount.gt(money(max))) {
    return fail(state, `Desconto excede o limite do ${role} (${max})`);
  }
  return ok({ ...state, discount });
}

export function calculateTotals(state: SaleState): SaleTotals {
  const subtotal = cartSubtotal(state.lines);
  return {
    subtotal,
    discount: state.discount,
    total: cartTotal(state.lines, state.discount),
    itemCount: state.lines.reduce((count, line) => count + line.quantity, 0),
  };
}

export function validateSale(
  state: SaleState,
  options: { stock?: StockMap | null; products?: CatalogProduct[]; role: MemberRole }
): SaleOpResult {
  if (state.lines.length === 0) {
    return fail(state, "Carrinho vazio");
  }

  for (const line of state.lines) {
    if (!(line.quantity > 0)) {
      return fail(state, `Quantidade inválida para ${line.name}`);
    }
    const catalogItem = options.products?.find((product) => product.productId === line.productId);
    if (catalogItem && !catalogItem.isActive) {
      return fail(state, `Produto inativo: ${line.name}`);
    }
    const available = projectedAvailable(options.stock, line.productId);
    if (available !== null && line.quantity > available) {
      return fail(state, `Estoque insuficiente para ${line.name}`);
    }
    if (money(line.discount).gt(money(multiplyMoney(line.unitPrice, line.quantity)))) {
      return fail(state, `Desconto do item excede o total de ${line.name}`);
    }
    void lineTotal(line);
  }

  const discountCheck = applyDiscount({ ...state, discount: "0.00" }, state.discount, options.role);
  if (!discountCheck.ok) {
    return fail(state, discountCheck.error);
  }

  const totals = calculateTotals(state);
  if (money(totals.total).lt(0)) {
    return fail(state, "Total não pode ser negativo");
  }

  return ok(state);
}

export function cartQtyByProduct(lines: CartLine[]): Record<string, number> {
  return lines.reduce<Record<string, number>>((acc, line) => {
    acc[line.productId] = (acc[line.productId] ?? 0) + line.quantity;
    return acc;
  }, {});
}

export function projectedRemaining(stockQty: number, cartQty: number): number {
  return stockQty - cartQty;
}