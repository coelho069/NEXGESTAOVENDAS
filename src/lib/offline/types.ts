import type { ProcessSaleInput } from "@/lib/validation/schemas";
import type { Enums } from "@/lib/db/types";

export const PDV_LOCAL_DB_NAME = "pdv_local_v1";

export type LocalSaleStatus = Extract<
  Enums<"sale_status">,
  "draft" | "pending_sync" | "confirmed" | "cancelled"
>;

export type LocalSyncStatus = Enums<"sync_status">;

export type LocalSale = {
  id: string;
  storeId: string;
  clientMutationId: string;
  customerId?: string;
  status: LocalSaleStatus;
  syncStatus: LocalSyncStatus;
  subtotal: string;
  discount: string;
  total: string;
  createdAt: string;
  confirmedAt?: string;
  serverSaleId?: string;
  stockReconciled?: boolean;
  outcomeUnknown?: boolean;
  fiscalStatus?: Enums<"fiscal_document_status">;
};

export type LocalSaleItem = {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: string;
  discount: string;
  total: string;
};

export type LocalPayment = {
  id: string;
  saleId: string;
  method: Enums<"payment_method">;
  amount: string;
  status: Extract<
    Enums<"payment_status">,
    "pending" | "authorized" | "captured" | "failed" | "unknown" | "cancelled" | "refunded"
  >;
  providerReference?: string;
  reconciledAt?: string;
};

export type LocalInventoryBalance = {
  storeId: string;
  productId: string;
  quantity: string;
  serverQuantity: string;
  updatedAt: string;
};

export type InventoryAdjustmentPayload = {
  store_id: string;
  product_id: string;
  client_mutation_id: string;
  terminal_id?: string;
  import_id?: string;
  import_row?: number;
  delta: string;
  reason: string;
  movement_type: "restock" | "adjustment";
};

export type InventoryOutboxCommand = {
  clientMutationId: string;
  storeId: string;
  productId: string;
  terminalId: string;
  type: "adjust_inventory";
  payload: InventoryAdjustmentPayload;
  status: LocalSyncStatus;
  attemptCount: number;
  nextAttemptAt: string;
  lastError?: string;
  outcomeUnknown?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LocalInventoryMovement = {
  id: string;
  storeId: string;
  productId: string;
  clientMutationId?: string;
  terminalId?: string;
  importId?: string;
  importRow?: number;
  movementType: Enums<"inventory_movement_type">;
  quantityChange: string;
  balanceAfter: string;
  createdAt: string;
};

export type OutboxCommand = {
  clientMutationId: string;
  saleId: string;
  storeId: string;
  type: "process_sale";
  payload: ProcessSaleInput;
  status: LocalSyncStatus;
  attemptCount: number;
  nextAttemptAt: string;
  lastError?: string;
  outcomeUnknown?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LocalConflict = {
  id: string;
  clientMutationId: string;
  saleId?: string;
  entityType?: "sale" | "inventory";
  storeId?: string;
  productId?: string;
  httpStatus: number;
  message: string;
  outcomeUnknown?: boolean;
  createdAt: string;
  visible: boolean;
};

export type LocalMeta = {
  key: string;
  value: string;
};

export type CloseSaleInput = {
  storeId: string;
  clientMutationId: string;
  suspendedSaleId?: string;
  suspensionClaimId?: string;
  cashSessionId?: string;
  terminalId?: string;
  role?: Enums<"member_role">;
  saleId?: string;
  lines: Array<{
    productId: string;
    sku: string;
    name: string;
    unitPrice: string;
    quantity: number;
    discount: string;
  }>;
  discount?: string;
  customerId?: string;
  payments: Array<{ method: Enums<"payment_method">; amount: string }>;
};

export type CloseSaleResult = {
  saleId: string;
  clientMutationId: string;
  duplicate: boolean;
};

export type PullChangesResponse = {
  serverTime: string;
  hasMore?: boolean;
  nextCursor?: {
    since: string | null;
    salesAfterUpdatedAt?: string;
    salesAfterId?: string;
    inventoryAfterUpdatedAt?: string;
    inventoryAfterProductId?: string;
    inventoryAfterCreatedAt?: string;
    inventoryAfterId?: string;
  };
  inventory: Array<{
    store_id: string;
    product_id: string;
    quantity: string;
    updated_at: string;
  }>;
  inventoryMovements: Array<{
    id: string;
    store_id: string;
    product_id: string;
    client_mutation_id?: string;
    terminal_id?: string;
    import_id?: string;
    import_row?: number;
    movement_type: Enums<"inventory_movement_type">;
    quantity_change: string;
    balance_after: string;
    created_at: string;
  }>;
  sales: Array<{
    id: string;
    client_mutation_id: string;
    status: Enums<"sale_status">;
    sync_status: Enums<"sync_status">;
    total: number | string;
    updated_at: string;
  }>;
};
