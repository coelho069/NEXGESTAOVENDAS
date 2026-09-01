import { v4 as uuidv4 } from "uuid";
import { buildProcessSalePayload, cartSubtotal, cartTotal, lineTotal } from "@/lib/domain/sale";
import { rethrowIfQuotaExceeded } from "@/lib/offline/quota";
import { assertNoSecrets } from "@/lib/offline/secrets";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";
import type { CloseSaleInput, CloseSaleResult, LocalSale, OutboxCommand } from "@/lib/offline/types";

function assertCashOnlyAndNoSecrets(input: CloseSaleInput): void {
  assertNoSecrets(input, "closeSale");
  for (const payment of input.payments) {
    if (payment.method !== "cash") {
      throw new Error("Only cash payments are supported in Sprint 1 MVP");
    }
  }
}

export async function closeSale(db: PdvLocalDatabase, input: CloseSaleInput): Promise<CloseSaleResult> {
  assertCashOnlyAndNoSecrets(input);

  try {
    return await db.transaction(
      "rw",
      db.sales,
      db.saleItems,
      db.payments,
      db.inventoryBalances,
      db.outbox,
      async () => {
        const existing = await db.sales.where("clientMutationId").equals(input.clientMutationId).first();
        if (existing) {
          return {
            saleId: existing.id,
            clientMutationId: existing.clientMutationId,
            duplicate: true,
          };
        }

        const outboxExisting = await db.outbox.get(input.clientMutationId);
        if (outboxExisting) {
          return {
            saleId: outboxExisting.saleId,
            clientMutationId: outboxExisting.clientMutationId,
            duplicate: true,
          };
        }

        const discount = input.discount ?? "0.00";
        const saleId = input.saleId ?? uuidv4();
        const createdAt = new Date().toISOString();
        const subtotal = cartSubtotal(input.lines);
        const total = cartTotal(input.lines, discount);

        for (const line of input.lines) {
          const balance = await db.inventoryBalances.get([input.storeId, line.productId]);
          const available = balance?.quantity ?? 0;
          if (available < line.quantity) {
            throw new Error(`Estoque insuficiente para ${line.name}`);
          }
          const nextQuantity = available - line.quantity;
          await db.inventoryBalances.put({
            storeId: input.storeId,
            productId: line.productId,
            quantity: nextQuantity,
            serverQuantity: balance?.serverQuantity ?? available,
            updatedAt: createdAt,
          });
        }

        const sale: LocalSale = {
          id: saleId,
          storeId: input.storeId,
          clientMutationId: input.clientMutationId,
          customerId: input.customerId,
          status: "pending_sync",
          syncStatus: "pending",
          subtotal,
          discount,
          total,
          createdAt,
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

        for (const payment of input.payments) {
          await db.payments.add({
            id: uuidv4(),
            saleId,
            method: payment.method,
            amount: payment.amount,
            status: "pending",
          });
        }

        const payload = buildProcessSalePayload(
          input.storeId,
          input.clientMutationId,
          input.lines,
          "cash",
          { discount, customerId: input.customerId }
        );

        if (payload.client_mutation_id !== input.clientMutationId) {
          throw new Error("clientMutationId is immutable");
        }

        const command: OutboxCommand = {
          clientMutationId: input.clientMutationId,
          saleId,
          storeId: input.storeId,
          type: "process_sale",
          payload,
          status: "pending",
          attemptCount: 0,
          nextAttemptAt: createdAt,
          createdAt,
          updatedAt: createdAt,
        };

        await db.outbox.add(command);

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
