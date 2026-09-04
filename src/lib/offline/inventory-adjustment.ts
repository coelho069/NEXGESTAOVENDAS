import { inventoryAdjustSchema } from "@/lib/validation/schemas";
import {
  addInventoryQuantities,
  toInventoryQuantity,
  type QuantityInput,
} from "@/lib/domain/quantity";
import { getTerminalId } from "@/lib/offline/terminal-identity";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";
import type {
  InventoryAdjustmentPayload,
  InventoryOutboxCommand,
} from "@/lib/offline/types";

export type QueueInventoryAdjustmentInput = {
  storeId: string;
  productId: string;
  clientMutationId: string;
  terminalId?: string;
  importId?: string;
  importRow?: number;
  delta: QuantityInput;
  reason: string;
  movementType: "restock" | "adjustment";
};

export type QueueInventoryAdjustmentResult = {
  clientMutationId: string;
  balanceAfter: string;
  duplicate: boolean;
};

export async function queueInventoryAdjustment(
  db: PdvLocalDatabase,
  input: QueueInventoryAdjustmentInput
): Promise<QueueInventoryAdjustmentResult> {
  const terminalId = input.terminalId ?? getTerminalId();
  const parsed = inventoryAdjustSchema.safeParse({
    store_id: input.storeId,
    product_id: input.productId,
    client_mutation_id: input.clientMutationId,
    terminal_id: terminalId,
    import_id: input.importId,
    import_row: input.importRow,
    delta: input.delta,
    reason: input.reason,
    movement_type: input.movementType,
  });
  if (!parsed.success || !parsed.data.product_id) {
    throw new Error("Ajuste de inventário inválido");
  }

  const payload: InventoryAdjustmentPayload = {
    store_id: parsed.data.store_id,
    product_id: parsed.data.product_id,
    client_mutation_id: parsed.data.client_mutation_id,
    terminal_id: parsed.data.terminal_id,
    import_id: parsed.data.import_id,
    import_row: parsed.data.import_row,
    delta: parsed.data.delta,
    reason: parsed.data.reason,
    movement_type: parsed.data.movement_type,
  };

  const now = new Date().toISOString();
  return db.transaction(
    "rw",
    [db.inventoryBalances, db.inventoryOutbox],
    async () => {
      const existing = await db.inventoryOutbox.get(payload.client_mutation_id);
      if (existing) {
        if (!samePayload(existing.payload, payload)) {
          throw new Error("clientMutationId já utilizado com outra operação");
        }
        const balance = await db.inventoryBalances.get([
          payload.store_id,
          payload.product_id,
        ]);
        return {
          clientMutationId: payload.client_mutation_id,
          balanceAfter: toInventoryQuantity(balance?.quantity ?? "0.000"),
          duplicate: true,
        };
      }

      const current = await db.inventoryBalances.get([
        payload.store_id,
        payload.product_id,
      ]);
      const balanceAfter = addInventoryQuantities(
        current?.quantity ?? "0.000",
        payload.delta
      );

      await db.inventoryBalances.put({
        storeId: payload.store_id,
        productId: payload.product_id,
        quantity: balanceAfter,
        serverQuantity: toInventoryQuantity(current?.serverQuantity ?? "0.000"),
        updatedAt: now,
      });

      const command: InventoryOutboxCommand = {
        clientMutationId: payload.client_mutation_id,
        storeId: payload.store_id,
        productId: payload.product_id,
        terminalId: payload.terminal_id ?? terminalId,
        type: "adjust_inventory",
        payload,
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await db.inventoryOutbox.add(command);

      return {
        clientMutationId: payload.client_mutation_id,
        balanceAfter,
        duplicate: false,
      };
    }
  );
}

function samePayload(
  left: InventoryAdjustmentPayload,
  right: InventoryAdjustmentPayload
): boolean {
  return (
    left.store_id === right.store_id &&
    left.product_id === right.product_id &&
    left.client_mutation_id === right.client_mutation_id &&
    left.terminal_id === right.terminal_id &&
    left.import_id === right.import_id &&
    left.import_row === right.import_row &&
    left.delta === right.delta &&
    left.reason === right.reason &&
    left.movement_type === right.movement_type
  );
}
