import { v4 as uuidv4 } from "uuid";
import { cartSubtotal, cartTotal, lineTotal } from "@/lib/domain/sale";
import { validateSaleAmounts } from "@/lib/domain/sale-ops";
import { money } from "@/lib/money";
import {
  compareInventoryQuantities,
  subtractInventoryQuantities,
  toInventoryQuantity,
} from "@/lib/domain/quantity";
import { rethrowIfQuotaExceeded } from "@/lib/offline/quota";
import { assertNoSecrets } from "@/lib/offline/secrets";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";
import type { CloseSaleInput, CloseSaleResult, LocalSale } from "@/lib/offline/types";

export async function recordCapturedPixSale(
  db: PdvLocalDatabase,
  input: CloseSaleInput & { serverSaleId: string; providerReference: string }
): Promise<CloseSaleResult> {
  assertNoSecrets(input, "recordCapturedPixSale");
  if (input.payments.length !== 1 || input.payments[0]?.method !== "pix") {
    throw new Error("recordCapturedPixSale exige exatamente um pagamento PIX");
  }

  const discount = input.discount ?? "0.00";
  const amountError = validateSaleAmounts(
    {
      lines: input.lines,
      discount,
      customerId: input.customerId ?? null,
    },
    input.role ?? "cashier"
  );
  if (amountError) {
    throw new Error(amountError);
  }

  const saleId = input.saleId ?? input.serverSaleId;
  const subtotal = cartSubtotal(input.lines);
  const total = cartTotal(input.lines, discount);
  if (money(total).lt(0) || input.payments[0]?.amount !== total) {
    throw new Error("Pagamento PIX deve corresponder ao total da venda");
  }

  try {
    return await db.transaction(
      "rw",
      db.sales,
      db.saleItems,
      db.payments,
      db.inventoryBalances,
      async () => {
        const existing = await db.sales.where("clientMutationId").equals(input.clientMutationId).first();
        if (existing) {
          return {
            saleId: existing.id,
            clientMutationId: existing.clientMutationId,
            duplicate: true,
          };
        }

        const createdAt = new Date().toISOString();
        for (const line of input.lines) {
          const balance = await db.inventoryBalances.get([input.storeId, line.productId]);
          const available = balance?.quantity ?? "0.000";
          if (compareInventoryQuantities(available, line.quantity) < 0) {
            throw new Error(`Estoque insuficiente para ${line.name}`);
          }
          await db.inventoryBalances.put({
            storeId: input.storeId,
            productId: line.productId,
            quantity: subtractInventoryQuantities(available, line.quantity),
            serverQuantity: toInventoryQuantity(balance?.serverQuantity ?? available),
            updatedAt: createdAt,
          });
        }

        const sale: LocalSale = {
          id: saleId,
          storeId: input.storeId,
          clientMutationId: input.clientMutationId,
          customerId: input.customerId,
          status: "confirmed",
          syncStatus: "synced",
          subtotal,
          discount,
          total,
          createdAt,
          confirmedAt: createdAt,
          serverSaleId: input.serverSaleId,
          stockReconciled: true,
        };
        await db.sales.add(sale);

        for (const line of input.lines) {
          await db.saleItems.add({
            id: uuidv4(),
            saleId,
            productId: line.productId,
            productName: line.name,
            productSku: line.sku,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discount: line.discount,
            total: lineTotal(line),
          });
        }

        await db.payments.add({
          id: uuidv4(),
          saleId,
          method: "pix",
          amount: input.payments[0]!.amount,
          status: "captured",
          providerReference: input.providerReference,
          reconciledAt: createdAt,
        });

        return {
          saleId,
          clientMutationId: input.clientMutationId,
          duplicate: false,
        };
      }
    );
  } catch (error) {
    rethrowIfQuotaExceeded(error);
  }
}
