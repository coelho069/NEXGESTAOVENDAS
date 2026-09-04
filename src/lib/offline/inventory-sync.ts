import { v4 as uuidv4 } from "uuid";
import Decimal from "decimal.js";
import { getInventoryAdjustment } from "@/lib/offline/inventory-outbox";
import type { PdvLocalDatabase } from "@/lib/offline/pdv-local-db";
import {
  addInventoryDifferences,
  subtractInventoryDifferences,
  toInventoryDifference,
  toInventoryQuantity,
} from "@/lib/domain/quantity";
import type {
  LocalConflict,
  LocalInventoryMovement,
} from "@/lib/offline/types";

export type RemoteInventoryMovement = {
  id: string;
  store_id: string;
  product_id: string;
  client_mutation_id?: string;
  terminal_id?: string;
  import_id?: string;
  import_row?: number;
  movement_type: LocalInventoryMovement["movementType"];
  quantity_change: string;
  balance_after: string;
  created_at: string;
};

export async function pendingInventoryDeltas(
  db: PdvLocalDatabase,
  storeId: string,
  excludeClientMutationId?: string
): Promise<Map<string, string>> {
  const commands = await db.inventoryOutbox
    .where("storeId")
    .equals(storeId)
    .toArray();
  const totals = new Map<string, string>();
  for (const command of commands) {
    if (
      command.clientMutationId === excludeClientMutationId ||
      (command.status !== "pending" &&
        command.status !== "processing" &&
        !(command.status === "conflict" && command.outcomeUnknown === true))
    ) {
      continue;
    }
    const previous = totals.get(command.productId) ?? "0.000";
    totals.set(
      command.productId,
      addInventoryDifferences(previous, command.payload.delta)
    );
  }
  return totals;
}

export async function reconcileInventoryAdjustment(
  db: PdvLocalDatabase,
  movement: RemoteInventoryMovement,
  expectedProcessingUpdatedAt?: string,
  serverQuantity?: string
): Promise<void> {
  await db.transaction(
    "rw",
    [db.inventoryOutbox, db.inventoryBalances, db.inventoryMovements, db.conflicts],
    async () => {
      const command = await db.inventoryOutbox.get(movement.client_mutation_id ?? "");
      if (!command || command.storeId !== movement.store_id) return;
      if (
        expectedProcessingUpdatedAt !== undefined &&
        (command.status !== "processing" ||
          command.updatedAt !== expectedProcessingUpdatedAt)
      ) {
        return;
      }
      if (
        command.status === "failed" ||
        (command.status === "conflict" && command.outcomeUnknown !== true)
      ) {
        return;
      }

      const balance = await db.inventoryBalances.get([
        command.storeId,
        command.productId,
      ]);
      const previousServer = toInventoryQuantity(
        balance?.serverQuantity ?? "0.000"
      );
      const previousProjected = toInventoryQuantity(
        balance?.quantity ?? previousServer
      );
      const activeBefore = await pendingInventoryDeltas(db, command.storeId);
      const productActiveBefore = activeBefore.get(command.productId) ?? "0.000";
      const reserved = new Decimal(previousServer)
        .plus(productActiveBefore)
        .minus(previousProjected);
      const previousOthers = subtractInventoryDifferences(
        productActiveBefore,
        command.payload.delta
      );

      await db.inventoryOutbox.put({
        ...command,
        status: "synced",
        lastError: undefined,
        outcomeUnknown: undefined,
        updatedAt: new Date().toISOString(),
      });

      const nextServer = toInventoryQuantity(
        serverQuantity ?? movement.balance_after
      );
      const nextProjected = projectInventoryQuantity(
        nextServer,
        previousOthers,
        reserved
      );
      await db.inventoryBalances.put({
        storeId: command.storeId,
        productId: command.productId,
        serverQuantity: nextServer,
        quantity: nextProjected,
        updatedAt: movement.created_at,
      });

      await db.inventoryMovements.put(toLocalInventoryMovement(movement));
      await hideInventoryConflict(db, command.clientMutationId);
    }
  );
}

export async function recordInventoryConflict(
  db: PdvLocalDatabase,
  input: {
    clientMutationId: string;
    httpStatus: number;
    message: string;
    expectedProcessingUpdatedAt?: string;
  }
): Promise<LocalConflict | null> {
  return finalizeInventoryCommand(db, input, "conflict", false);
}

export async function markInventoryAdjustmentUncertain(
  db: PdvLocalDatabase,
  input: {
    clientMutationId: string;
    message: string;
    expectedProcessingUpdatedAt: string;
  }
): Promise<LocalConflict | null> {
  return finalizeInventoryCommand(db, {
    ...input,
    httpStatus: 0,
  }, "uncertain", true);
}

export async function markInventoryAdjustmentFailed(
  db: PdvLocalDatabase,
  input: {
    clientMutationId: string;
    message: string;
    expectedProcessingUpdatedAt?: string;
  }
): Promise<LocalConflict | null> {
  return finalizeInventoryCommand(db, {
    ...input,
    httpStatus: 0,
  }, "failed", false);
}

export async function listInventoryConflicts(
  db: PdvLocalDatabase
): Promise<LocalConflict[]> {
  return (await db.conflicts.toArray()).filter(
    (conflict) => conflict.visible && conflict.entityType === "inventory"
  );
}

function toLocalInventoryMovement(
  movement: RemoteInventoryMovement
): LocalInventoryMovement {
  return {
    id: movement.id,
    storeId: movement.store_id,
    productId: movement.product_id,
    clientMutationId: movement.client_mutation_id,
    terminalId: movement.terminal_id,
    importId: movement.import_id,
    importRow: movement.import_row,
    movementType: movement.movement_type,
    quantityChange: toInventoryDifference(movement.quantity_change),
    balanceAfter: toInventoryQuantity(movement.balance_after),
    createdAt: movement.created_at,
  };
}

async function finalizeInventoryCommand(
  db: PdvLocalDatabase,
  input: {
    clientMutationId: string;
    httpStatus: number;
    message: string;
    expectedProcessingUpdatedAt?: string;
  },
  outcome: "conflict" | "uncertain" | "failed",
  keepProjection: boolean
): Promise<LocalConflict | null> {
  let result: LocalConflict | null = null;
  await db.transaction(
    "rw",
    [db.inventoryOutbox, db.inventoryBalances, db.conflicts],
    async () => {
      const command = await getInventoryAdjustment(db, input.clientMutationId);
      if (
        !command ||
        command.status !== "processing" ||
        (input.expectedProcessingUpdatedAt !== undefined &&
          command.updatedAt !== input.expectedProcessingUpdatedAt)
      ) {
        return;
      }

      const balance = await db.inventoryBalances.get([
        command.storeId,
        command.productId,
      ]);
      const previousServer = toInventoryQuantity(
        balance?.serverQuantity ?? "0.000"
      );
      const previousProjected = toInventoryQuantity(
        balance?.quantity ?? previousServer
      );
      const activeBefore = await pendingInventoryDeltas(db, command.storeId);
      const productActiveBefore = activeBefore.get(command.productId) ?? "0.000";
      const reserved = new Decimal(previousServer)
        .plus(productActiveBefore)
        .minus(previousProjected);
      const remaining = subtractInventoryDifferences(
        productActiveBefore,
        command.payload.delta
      );

      await db.inventoryOutbox.put({
        ...command,
        status: "conflict",
        attemptCount:
          outcome === "uncertain"
            ? command.attemptCount + 1
            : command.attemptCount,
        lastError:
          outcome === "uncertain"
            ? `outcome uncertain: ${input.message}`
            : input.message,
        outcomeUnknown: outcome === "uncertain",
        updatedAt: new Date().toISOString(),
      });

      if (!keepProjection) {
        await db.inventoryBalances.put({
          storeId: command.storeId,
          productId: command.productId,
          serverQuantity: previousServer,
          quantity: projectInventoryQuantity(
            previousServer,
            remaining,
            reserved
          ),
          updatedAt: new Date().toISOString(),
        });
      }

      if (outcome === "uncertain" || outcome === "conflict") {
        const existing = await db.conflicts
          .where("clientMutationId")
          .equals(input.clientMutationId)
          .first();
        if (existing) {
          result = existing;
          return;
        }
        result = {
          id: uuidv4(),
          clientMutationId: input.clientMutationId,
          entityType: "inventory",
          storeId: command.storeId,
          productId: command.productId,
          httpStatus: input.httpStatus,
          message:
            outcome === "uncertain"
              ? `Resultado remoto incerto: ${input.message}`
              : input.message,
          createdAt: new Date().toISOString(),
          visible: true,
        };
        await db.conflicts.add(result);
      }
    }
  );
  return result;
}

async function hideInventoryConflict(
  db: PdvLocalDatabase,
  clientMutationId: string
): Promise<void> {
  const conflicts = await db.conflicts
    .where("clientMutationId")
    .equals(clientMutationId)
    .toArray();
  for (const conflict of conflicts) {
    if (conflict.visible && conflict.entityType === "inventory") {
      await db.conflicts.put({ ...conflict, visible: false });
    }
  }
}

export function projectInventoryQuantity(
  serverQuantity: string,
  pendingDelta: string,
  reserved: Decimal | string | number
): string {
  const projected = new Decimal(serverQuantity)
    .plus(pendingDelta)
    .minus(new Decimal(reserved));
  if (projected.isNegative()) return "0.000";
  return toInventoryQuantity(projected.toFixed(3));
}
