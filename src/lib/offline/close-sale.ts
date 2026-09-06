import { v4 as uuidv4 } from "uuid";
import { buildProcessSalePayload, cartSubtotal, cartTotal, lineTotal } from "@/lib/domain/sale";
import { validateSaleAmounts } from "@/lib/domain/sale-ops";
import { evaluateSaleCommercialRules } from "@/lib/domain/store-settings";
import { processSaleInputSchema, type ProcessSaleInput } from "@/lib/validation/schemas";
import { money } from "@/lib/money";
import {
  compareInventoryQuantities,
  subtractInventoryQuantities,
  toInventoryQuantity,
} from "@/lib/domain/quantity";
import { rethrowIfQuotaExceeded } from "@/lib/offline/quota";
import { assertNoSecrets } from "@/lib/offline/secrets";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";
import type { CloseSaleInput, CloseSaleResult, LocalSale, OutboxCommand } from "@/lib/offline/types";

function assertCashOnlyAndNoSecrets(input: CloseSaleInput): void {
  assertNoSecrets(input, "closeSale");
  const method = input.payments[0]?.method;
  if (input.payments.length !== 1 || method !== "cash") {
    if (method === "pix") {
      throw new Error(
        "PIX não pode ser finalizado offline nem enfileirado como pago. Use dinheiro ou conecte-se com provedor configurado."
      );
    }
    if (method === "card") {
      throw new Error(
        "Cartão não pode ser finalizado offline nem enfileirado como aprovado. Use dinheiro ou conecte-se com provedor configurado."
      );
    }
    if (method === "other") {
      throw new Error(
        "TEF não pode ser finalizado offline nem enfileirado como aprovado. Use dinheiro ou conecte-se com provedor configurado."
      );
    }
    throw new Error("Apenas um pagamento em dinheiro é suportado no fluxo offline atual");
  }
}

function comparablePayload(payload: ProcessSaleInput): string {
  const withoutSaleId = { ...payload };
  delete withoutSaleId.sale_id;
  return JSON.stringify(withoutSaleId);
}

export async function closeSale(db: PdvLocalDatabase, input: CloseSaleInput): Promise<CloseSaleResult> {
  assertCashOnlyAndNoSecrets(input);

  // Enforce commercial rules before writing local sale + outbox.
  // When flags are provided, block locally so sync will not later reject.
  // When flags are omitted (legacy callers/tests), skip — callers that know
  // store policy (checkout) must pass flags; unavailable settings should
  // refuse checkout upstream rather than enqueue a doomed mutation.
  if (input.commercialFlags) {
    const blocked = evaluateSaleCommercialRules({
      settings: {
        require_customer_on_sale: input.commercialFlags.require_customer_on_sale === true,
        require_open_cash_session: input.commercialFlags.require_open_cash_session === true,
        require_customer_document: input.commercialFlags.require_customer_document === true,
      },
      customerId: input.customerId ?? null,
      customerDocument: input.customerDocument,
      cashSessionOpen: Boolean(input.cashSessionId),
    });
    if (blocked) {
      throw new Error(blocked.message);
    }
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

  const saleId = input.saleId ?? uuidv4();
  const subtotal = cartSubtotal(input.lines);
  const total = cartTotal(input.lines, discount);
  if (money(total).lt(0)) {
    throw new Error("Total da venda não pode ser negativo");
  }
  if (input.payments[0]?.amount !== total) {
    throw new Error("Pagamento deve corresponder ao total da venda");
  }

  const payload = buildProcessSalePayload(
    input.storeId,
    input.clientMutationId,
    input.lines,
    "cash",
    {
      discount,
      customerId: input.customerId,
      saleId,
      suspendedSaleId: input.suspendedSaleId,
      suspensionClaimId: input.suspensionClaimId,
      cashSessionId: input.cashSessionId,
      terminalId: input.terminalId,
    }
  );
  const parsedPayload = processSaleInputSchema.safeParse(payload);
  if (!parsedPayload.success) {
    throw new Error("Payload de venda inválido");
  }
  const canonicalPayload = parsedPayload.data;

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
          const existingOutbox = await db.outbox.get(input.clientMutationId);
          if (
            existing.storeId !== input.storeId ||
            !existingOutbox ||
            comparablePayload(existingOutbox.payload) !== comparablePayload(canonicalPayload)
          ) {
            throw new Error("clientMutationId já utilizado com outra venda");
          }
          return {
            saleId: existing.id,
            clientMutationId: existing.clientMutationId,
            duplicate: true,
          };
        }

        const outboxExisting = await db.outbox.get(input.clientMutationId);
        if (outboxExisting) {
          if (
            outboxExisting.storeId !== input.storeId ||
            comparablePayload(outboxExisting.payload) !== comparablePayload(canonicalPayload)
          ) {
            throw new Error("clientMutationId já utilizado com outra venda");
          }
          return {
            saleId: outboxExisting.saleId,
            clientMutationId: outboxExisting.clientMutationId,
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
          const nextQuantity = subtractInventoryQuantities(available, line.quantity);
          await db.inventoryBalances.put({
            storeId: input.storeId,
            productId: line.productId,
            quantity: nextQuantity,
            serverQuantity: toInventoryQuantity(balance?.serverQuantity ?? available),
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
          stockReconciled: false,
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

        if (canonicalPayload.client_mutation_id !== input.clientMutationId) {
          throw new Error("clientMutationId is immutable");
        }

        const command: OutboxCommand = {
          clientMutationId: input.clientMutationId,
          saleId,
          storeId: input.storeId,
          type: "process_sale",
          payload: canonicalPayload,
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
