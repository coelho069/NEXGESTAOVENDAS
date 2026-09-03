import type { Enums } from "@/lib/db/types";
import type { CatalogProduct } from "@/lib/domain/catalog";
import type { CartLine } from "@/lib/domain/sale";
import { cartSubtotal, cartTotal } from "@/lib/domain/sale";
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

const MONEY_PATTERN = /^(?:0|[1-9]\d{0,9})\.\d{2}$/;

function isSupportedQuantity(quantity: number): boolean {
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  const decimal = money(quantity);
  return decimal.lte("999999999.999") && decimal.decimalPlaces() <= 3;
}

export function discountExceedsRoleCap(discount: string, subtotal: string, role: MemberRole): boolean {
  return money(discount).gt(money(maxDiscountForRole(subtotal, role)));
}

export function salePayloadExceedsDiscountCap(
  payload: { discount: string; items: Array<{ quantity: number; unit_price: string; discount?: string }> },
  role: MemberRole
): boolean {
  const totalDiscount = payload.items.reduce(
    (acc, item) => acc.plus(money(item.discount ?? "0.00")),
    money(payload.discount)
  );
  return discountExceedsRoleCap(totalDiscount.toFixed(2), itemsGrossSubtotal(payload.items), role);
}

export function discountLimitHttpStatus(exceeded: boolean): 403 | 200 {
  return exceeded ? 403 : 200;
}

export function itemsGrossSubtotal(
  items: Array<{ quantity: number; unit_price: string; discount?: string }>
): string {
  return items
    .reduce((acc, item) => {
      return acc.plus(money(multiplyMoney(item.unit_price, item.quantity)));
    }, money(0))
    .toFixed(2);
}

export function isLocalStockEmpty(stock: StockMap | null | undefined): boolean {
  if (!stock) return true;
  return Object.keys(stock).length === 0;
}

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
  if (stock !== undefined && isLocalStockEmpty(stock)) {
    return fail(state, "Estoque local vazio");
  }
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

export function validateSaleAmounts(state: SaleState, role: MemberRole): string | null {
  if (state.lines.length === 0) {
    return "Carrinho vazio";
  }

  if (!MONEY_PATTERN.test(state.discount)) {
    return "Desconto deve ser valor monetário 0.00";
  }

  const productIds = new Set<string>();
  for (const line of state.lines) {
    if (productIds.has(line.productId)) {
      return `Produto duplicado no carrinho: ${line.name}`;
    }
    productIds.add(line.productId);

    if (!isSupportedQuantity(line.quantity)) {
      return `Quantidade inválida para ${line.name}`;
    }
    if (!MONEY_PATTERN.test(line.unitPrice) || !MONEY_PATTERN.test(line.discount)) {
      return `Valores inválidos para ${line.name}`;
    }
    if (money(line.discount).gt(money(multiplyMoney(line.unitPrice, line.quantity)))) {
      return `Desconto do item excede o total de ${line.name}`;
    }
  }

  const discountCheck = applyDiscount({ ...state, discount: "0.00" }, state.discount, role);
  if (!discountCheck.ok) {
    return discountCheck.error;
  }

  const totals = calculateTotals(state);
  if (money(totals.total).lt(0)) {
    return "Total não pode ser negativo";
  }
  return null;
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

  if (isLocalStockEmpty(options.stock)) {
    return fail(state, "Estoque local vazio");
  }

  const amountError = validateSaleAmounts(state, options.role);
  if (amountError) {
    return fail(state, amountError);
  }

  for (const line of state.lines) {
    const catalogItem = options.products?.find((product) => product.productId === line.productId);
    if (catalogItem && !catalogItem.isActive) {
      return fail(state, `Produto inativo: ${line.name}`);
    }
    const available = projectedAvailable(options.stock, line.productId);
    if (available !== null && line.quantity > available) {
      return fail(state, `Estoque insuficiente para ${line.name}`);
    }
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