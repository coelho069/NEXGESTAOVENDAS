import { v4 as uuidv4 } from "uuid";
import {
  buildReturnableItems,
  computeSaleReturn,
  nextSaleStatusAfterReturn,
  validateSaleReturnReason,
  type SaleReturnOperation,
  type SaleReturnReason,
} from "@/lib/domain/sale-return";
import type { SaleHistoryDetail, SaleHistoryReturnRecord } from "@/lib/domain/sale-history";
import { money, toMoneyString } from "@/lib/money";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";
import { addInventoryQuantities, toInventoryQuantity } from "@/lib/domain/quantity";

const FIXTURE_RETURNS_KEY = "nex-pdv-sale-returns-fixture-v1";

/** Fixture mode has no sync server: mark closed local sales as confirmed so cancel/return can run. */
export async function confirmFixtureLocalSales(db: PdvLocalDatabase): Promise<void> {
  const sales = await db.sales.toArray();
  const now = new Date().toISOString();
  for (const sale of sales) {
    if (sale.status !== "pending_sync") continue;
    await db.sales.update(sale.id, {
      status: "confirmed",
      syncStatus: "synced",
      confirmedAt: sale.confirmedAt ?? now,
      stockReconciled: true,
    });
    const payments = await db.payments.where("saleId").equals(sale.id).toArray();
    for (const payment of payments) {
      if (payment.status === "pending" || payment.status === "authorized") {
        await db.payments.update(payment.id, { status: "captured" });
      }
    }
    const commands = await db.outbox.where("saleId").equals(sale.id).toArray();
    for (const command of commands) {
      if (command.status === "pending" || command.status === "processing") {
        await db.outbox.update(command.clientMutationId, {
          status: "synced",
          updatedAt: now,
        });
      }
    }
  }
}

type FixtureReturnStore = Record<string, SaleHistoryReturnRecord[]>;

function readFixtureReturns(): FixtureReturnStore {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FIXTURE_RETURNS_KEY) ?? "{}");
    if (!raw || typeof raw !== "object") return {};
    return raw as FixtureReturnStore;
  } catch {
    return {};
  }
}

function writeFixtureReturns(store: FixtureReturnStore): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(FIXTURE_RETURNS_KEY, JSON.stringify(store));
}

export function listFixtureReturnsForSale(saleId: string): SaleHistoryReturnRecord[] {
  return readFixtureReturns()[saleId] ?? [];
}

export function enrichLocalSaleDetailWithReturns(detail: SaleHistoryDetail): SaleHistoryDetail {
  const returns = listFixtureReturnsForSale(detail.sale_id);
  const returnedByItem: Record<string, string> = {};
  let refundedTotal = money(0);
  for (const row of returns) {
    refundedTotal = refundedTotal.plus(money(row.refund_total));
    for (const item of row.items) {
      returnedByItem[item.sale_item_id] = money(returnedByItem[item.sale_item_id] ?? "0")
        .plus(money(item.quantity))
        .toFixed(3);
    }
  }

  const items = detail.items.map((item) => {
    const saleItemId = item.sale_item_id ?? item.product_id;
    const returned = returnedByItem[saleItemId] ?? "0.000";
    const returnable = money(item.quantity).minus(money(returned));
    return {
      ...item,
      sale_item_id: saleItemId,
      quantity_returned: returned,
      quantity_returnable: returnable.lt(0) ? "0.000" : returnable.toFixed(3),
    };
  });

  return {
    ...detail,
    items,
    returns,
    refunded_total: toMoneyString(refundedTotal),
    refundable_total: toMoneyString(
      money(detail.total).minus(refundedTotal).lt(0)
        ? money(0)
        : money(detail.total).minus(refundedTotal)
    ),
    status:
      returns.some((row) => row.operation === "cancel")
        ? "cancelled"
        : money(detail.total).minus(refundedTotal).lte(0) && returns.length > 0
          ? "refunded"
          : returns.length > 0
            ? "partially_refunded"
            : detail.status,
  };
}

export async function processFixtureSaleReturn(input: {
  db: PdvLocalDatabase;
  storeId: string;
  saleId: string;
  operation: SaleReturnOperation;
  reason: SaleReturnReason;
  notes?: string;
  clientMutationId: string;
  items: Array<{ sale_item_id: string; quantity: string }>;
}): Promise<{
  return_id: string;
  sale_id: string;
  operation: SaleReturnOperation;
  sale_status: string;
  refund_total: string;
  payment_refund_status: string;
  payment_method: string;
  replay: boolean;
}> {
  const reasonError = validateSaleReturnReason(input.reason, input.notes);
  if (reasonError) throw new Error(reasonError);

  const existing = listFixtureReturnsForSale(input.saleId).find(
    (row) => row.return_id === input.clientMutationId
  );
  if (existing) {
    return {
      return_id: existing.return_id,
      sale_id: input.saleId,
      operation: existing.operation as SaleReturnOperation,
      sale_status: "confirmed",
      refund_total: existing.refund_total,
      payment_refund_status: existing.payment_refund_status,
      payment_method: "cash",
      replay: true,
    };
  }

  const sale =
    (await input.db.sales.get(input.saleId)) ??
    (await input.db.sales.filter((row) => row.serverSaleId === input.saleId).first());
  if (!sale || sale.storeId !== input.storeId) {
    throw new Error("Venda não encontrada");
  }
  // LocalSaleStatus is draft|pending_sync|confirmed|cancelled only.
  // partially_refunded/refunded are derived from fixture returns
  // (enrichLocalSaleDetailWithReturns), not persisted on the local sale row.
  // Returnability is sold qty − already returned (buildReturnableItems below).
  if (sale.status !== "confirmed") {
    throw new Error("Venda não disponível para cancelamento/devolução");
  }

  const saleItems = await input.db.saleItems.where("saleId").equals(sale.id).toArray();
  const payments = await input.db.payments.where("saleId").equals(sale.id).toArray();
  const payment = payments[0];
  const prior = listFixtureReturnsForSale(input.saleId);
  const returnedByItem: Record<string, string> = {};
  let alreadyRefunded = money(0);
  for (const row of prior) {
    alreadyRefunded = alreadyRefunded.plus(money(row.refund_total));
    for (const item of row.items) {
      returnedByItem[item.sale_item_id] = money(returnedByItem[item.sale_item_id] ?? "0")
        .plus(money(item.quantity))
        .toFixed(3);
    }
  }

  const returnable = buildReturnableItems(
    saleItems.map((item) => ({
      sale_item_id: item.id,
      product_id: item.productId,
      product_sku: item.productSku,
      product_name: item.productName,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      discount: item.discount,
      total: item.total,
    })),
    returnedByItem
  );

  const lines =
    input.operation === "cancel"
      ? returnable
          .filter((item) => money(item.quantity_returnable).gt(0))
          .map((item) => ({
            sale_item_id: item.sale_item_id,
            quantity: item.quantity_returnable,
          }))
      : input.items;

  const computed = computeSaleReturn({
    items: returnable,
    lines,
    saleSubtotal: sale.subtotal,
    saleHeaderDiscount: sale.discount,
    alreadyRefundedTotal: toMoneyString(alreadyRefunded),
    saleTotal: sale.total,
  });
  if (!computed.ok) throw new Error(computed.error);

  const remainingQty = returnable.reduce((total, item) => {
    const selected = lines.find((line) => line.sale_item_id === item.sale_item_id);
    const returning = money(selected?.quantity ?? "0");
    return total.plus(money(item.quantity_returnable).minus(returning));
  }, money(0));

  const nextStatus = nextSaleStatusAfterReturn({
    operation: input.operation,
    remainingReturnableQty: remainingQty.toFixed(3),
  });

  const paymentMethod = payment?.method ?? "cash";
  const paymentRefundStatus =
    paymentMethod === "cash" ? "completed" : "pending_external";

  for (const line of computed.value.lines) {
    const balance = await input.db.inventoryBalances.get([input.storeId, line.product_id]);
    const currentQty = balance?.quantity ?? toInventoryQuantity(0);
    const nextQty = addInventoryQuantities(currentQty, line.quantity);
    await input.db.inventoryBalances.put({
      storeId: input.storeId,
      productId: line.product_id,
      quantity: nextQty,
      serverQuantity: balance?.serverQuantity ?? currentQty,
      updatedAt: new Date().toISOString(),
    });
  }

  if (nextStatus === "cancelled") {
    await input.db.sales.update(sale.id, { status: "cancelled" });
  }

  if (payment && paymentMethod === "cash" && (nextStatus === "cancelled" || nextStatus === "refunded")) {
    await input.db.payments.update(payment.id, { status: "refunded" });
  }

  const record: SaleHistoryReturnRecord = {
    return_id: input.clientMutationId,
    operation: input.operation,
    reason: input.reason,
    notes: input.notes ?? null,
    refund_total: computed.value.refund_total,
    payment_refund_status: paymentRefundStatus,
    operator_id: null,
    created_at: new Date().toISOString(),
    items: computed.value.lines.map((line) => ({
      sale_item_id: line.sale_item_id,
      product_id: line.product_id,
      quantity: line.quantity,
      line_total: line.line_total,
    })),
  };

  const store = readFixtureReturns();
  store[input.saleId] = [...(store[input.saleId] ?? []), record];
  writeFixtureReturns(store);

  return {
    return_id: record.return_id,
    sale_id: input.saleId,
    operation: input.operation,
    sale_status: nextStatus,
    refund_total: computed.value.refund_total,
    payment_refund_status: paymentRefundStatus,
    payment_method: paymentMethod,
    replay: false,
  };
}

export function createReturnReceiptModel(input: {
  storeName: string;
  saleId: string;
  operation: SaleReturnOperation;
  reason: string;
  refundTotal: string;
  paymentRefundStatus: string;
  paymentMethod: string;
  items: Array<{ product_id: string; quantity: string; line_total: string; product_name?: string }>;
}) {
  return {
    saleId: input.saleId,
    storeName: input.storeName,
    createdAt: new Date().toISOString(),
    customerName: null,
    operatorName: null,
    lines: input.items.map((item) => ({
      productId: item.product_id,
      sku: item.product_id.slice(0, 8),
      name: item.product_name ?? "Item devolvido",
      quantity: Number(item.quantity),
      unitPrice: "0.00",
      discount: "0.00",
    })),
    subtotal: input.refundTotal,
    discount: "0.00",
    total: input.refundTotal,
    payments: [
      {
        method: input.paymentMethod,
        amount: input.refundTotal,
        status: input.paymentRefundStatus === "completed" ? "refunded" : "pending",
      },
    ],
    syncStatus: "synced",
    saleStatus: input.operation === "cancel" ? "cancelled" : "refunded",
    documentKind: input.operation === "cancel" ? "cancelamento" : "devolucao",
  } as const;
}

export function newReturnMutationId(): string {
  return uuidv4();
}
