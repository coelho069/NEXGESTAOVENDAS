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
  status: Extract<Enums<"payment_status">, "pending" | "captured" | "failed">;
};

export type LocalInventoryBalance = {
  storeId: string;
  productId: string;
  quantity: number;
  serverQuantity: number;
  updatedAt: string;
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
  createdAt: string;
  updatedAt: string;
};

export type LocalConflict = {
  id: string;
  clientMutationId: string;
  saleId: string;
  httpStatus: number;
  message: string;
  createdAt: string;
  visible: true;
};

export type LocalMeta = {
  key: string;
  value: string;
};

export type CloseSaleInput = {
  storeId: string;
  clientMutationId: string;
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
  inventory: Array<{
    store_id: string;
    product_id: string;
    quantity: number;
    updated_at: string;
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
