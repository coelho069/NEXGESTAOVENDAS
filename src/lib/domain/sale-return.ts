import { money, toMoneyString } from "@/lib/money";
import type { MemberRole } from "@/lib/domain/rbac";

export const SALE_RETURN_REASONS = [
  "produto_com_defeito",
  "cliente_desistiu",
  "produto_incorreto",
  "erro_de_venda",
  "outro",
] as const;

export type SaleReturnReason = (typeof SALE_RETURN_REASONS)[number];
export type SaleReturnOperation = "cancel" | "return";

export type ReturnableSaleItem = {
  sale_item_id: string;
  product_id: string;
  product_sku: string;
  product_name: string;
  quantity_sold: string;
  quantity_returned: string;
  quantity_returnable: string;
  unit_price: string;
  line_discount: string;
  line_total: string;
};

export type SaleReturnLineInput = {
  sale_item_id: string;
  quantity: string;
};

export type SaleReturnComputation = {
  lines: Array<{
    sale_item_id: string;
    product_id: string;
    quantity: string;
    unit_price: string;
    line_discount: string;
    line_total: string;
  }>;
  items_subtotal: string;
  header_discount_share: string;
  refund_total: string;
};

const QTY_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,3})?$/;
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,9})\.\d{2}$/;

export function saleReturnReasonLabel(reason: string): string {
  switch (reason) {
    case "produto_com_defeito":
      return "Produto com defeito";
    case "cliente_desistiu":
      return "Cliente desistiu";
    case "produto_incorreto":
      return "Produto incorreto";
    case "erro_de_venda":
      return "Erro de venda";
    case "outro":
      return "Outro";
    default:
      return reason;
  }
}

export function canCancelSale(role: MemberRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

export function canReturnSale(role: MemberRole | null | undefined): boolean {
  return role === "admin" || role === "manager" || role === "cashier";
}

export function isSaleReturnableStatus(status: string): boolean {
  return status === "confirmed" || status === "partially_refunded";
}

export function isSaleCancellableStatus(status: string): boolean {
  return status === "confirmed";
}

export function nextSaleStatusAfterReturn(input: {
  operation: SaleReturnOperation;
  remainingReturnableQty: string;
}): "cancelled" | "refunded" | "partially_refunded" {
  const remaining = money(input.remainingReturnableQty);
  if (input.operation === "cancel") return "cancelled";
  if (remaining.lte(0)) return "refunded";
  return "partially_refunded";
}

export function buildReturnableItems(
  items: Array<{
    sale_item_id: string;
    product_id: string;
    product_sku: string;
    product_name: string;
    quantity: string | number;
    unit_price: string;
    discount: string;
    total: string;
  }>,
  returnedByItemId: Record<string, string>
): ReturnableSaleItem[] {
  return items.map((item) => {
    const sold = money(item.quantity);
    const returned = money(returnedByItemId[item.sale_item_id] ?? "0");
    const returnable = sold.minus(returned);
    return {
      sale_item_id: item.sale_item_id,
      product_id: item.product_id,
      product_sku: item.product_sku,
      product_name: item.product_name,
      quantity_sold: sold.toFixed(3),
      quantity_returned: returned.toFixed(3),
      quantity_returnable: returnable.lt(0) ? "0.000" : returnable.toFixed(3),
      unit_price: item.unit_price,
      line_discount: item.discount,
      line_total: item.total,
    };
  });
}

export function computeSaleReturn(input: {
  items: ReturnableSaleItem[];
  lines: SaleReturnLineInput[];
  saleSubtotal: string;
  saleHeaderDiscount: string;
  alreadyRefundedTotal: string;
  saleTotal: string;
}): { ok: true; value: SaleReturnComputation } | { ok: false; error: string } {
  if (!MONEY_PATTERN.test(input.saleSubtotal) || !MONEY_PATTERN.test(input.saleHeaderDiscount)) {
    return { ok: false, error: "Totais da venda inválidos" };
  }
  if (!MONEY_PATTERN.test(input.alreadyRefundedTotal) || !MONEY_PATTERN.test(input.saleTotal)) {
    return { ok: false, error: "Totais de estorno inválidos" };
  }
  if (input.lines.length === 0) {
    return { ok: false, error: "Selecione ao menos um item para devolução" };
  }

  const seen = new Set<string>();
  const computedLines: SaleReturnComputation["lines"] = [];
  let itemsSubtotal = money(0);

  for (const line of input.lines) {
    if (seen.has(line.sale_item_id)) {
      return { ok: false, error: "Item duplicado na devolução" };
    }
    seen.add(line.sale_item_id);
    if (!QTY_PATTERN.test(line.quantity) || money(line.quantity).lte(0)) {
      return { ok: false, error: "Quantidade de devolução inválida" };
    }

    const source = input.items.find((item) => item.sale_item_id === line.sale_item_id);
    if (!source) {
      return { ok: false, error: "Item não pertence à venda" };
    }
    const qty = money(line.quantity);
    if (qty.gt(money(source.quantity_returnable))) {
      return { ok: false, error: "Quantidade devolvida excede o vendido" };
    }

    const soldQty = money(source.quantity_sold);
    const lineTotal = money(source.line_total).times(qty).div(soldQty);
    const lineDiscount = money(source.line_discount).times(qty).div(soldQty);
    const roundedTotal = toMoneyString(lineTotal);
    const roundedDiscount = toMoneyString(lineDiscount);
    itemsSubtotal = itemsSubtotal.plus(money(roundedTotal));
    computedLines.push({
      sale_item_id: source.sale_item_id,
      product_id: source.product_id,
      quantity: qty.toFixed(3),
      unit_price: source.unit_price,
      line_discount: roundedDiscount,
      line_total: roundedTotal,
    });
  }

  const saleSubtotal = money(input.saleSubtotal);
  const headerShare =
    saleSubtotal.lte(0) || money(input.saleHeaderDiscount).lte(0)
      ? money(0)
      : money(input.saleHeaderDiscount).times(itemsSubtotal).div(saleSubtotal);
  const headerDiscountShare = toMoneyString(headerShare);
  let refundTotal = itemsSubtotal.minus(money(headerDiscountShare));
  if (refundTotal.lt(0)) {
    return { ok: false, error: "Valor de devolução inválido" };
  }

  const remainingRefundable = money(input.saleTotal).minus(money(input.alreadyRefundedTotal));
  if (refundTotal.gt(remainingRefundable)) {
    // Absorb rounding residue into the final return when closing the sale.
    if (refundTotal.minus(remainingRefundable).abs().lte("0.02")) {
      refundTotal = remainingRefundable;
    } else {
      return { ok: false, error: "Valor de devolução excede o saldo da venda" };
    }
  }

  return {
    ok: true,
    value: {
      lines: computedLines,
      items_subtotal: toMoneyString(itemsSubtotal),
      header_discount_share: headerDiscountShare,
      refund_total: toMoneyString(refundTotal),
    },
  };
}

export function validateSaleReturnReason(reason: string, notes?: string | null): string | null {
  if (!SALE_RETURN_REASONS.includes(reason as SaleReturnReason)) {
    return "Motivo de devolução inválido";
  }
  if (reason === "outro") {
    const trimmed = (notes ?? "").trim();
    if (trimmed.length < 3) {
      return "Descreva o motivo da operação";
    }
    if (trimmed.length > 500) {
      return "Motivo excede o limite";
    }
  }
  return null;
}
