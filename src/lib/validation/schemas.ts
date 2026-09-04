import Decimal from "decimal.js";
import { z } from "zod";
import { isValidDateOnly, parseDashboardPeriod } from "@/lib/domain/dashboard";
import { toInventoryDelta } from "@/lib/domain/quantity";

const moneyPattern = /^(?:0|[1-9]\d{0,9})\.\d{2}$/;
const signedMoneyPattern = /^-?(?:0|[1-9]\d{0,9})\.\d{2}$/;
export const storeIdSchema = z.string().uuid();

const saleQuantitySchema = z
  .number()
  .finite()
  .positive()
  .refine((value) => new Decimal(value).lte("999999999.999"), "quantity exceeds numeric(12,3)")
  .refine((value) => new Decimal(value).decimalPlaces() <= 3, "quantity supports at most three decimal places");

export const saleItemInputSchema = z.object({
  product_id: z.string().uuid(),
  quantity: saleQuantitySchema,
  unit_price: z.string().regex(moneyPattern, "unit_price must be numeric(12,2) string"),
  discount: z
    .string()
    .regex(moneyPattern, "discount must be numeric(12,2) string")
    .optional()
    .default("0.00"),
});

export const paymentInputSchema = z.object({
  method: z.enum(["cash", "card", "pix", "voucher", "other"]),
  amount: z.string().regex(moneyPattern, "amount must be numeric(12,2) string"),
});

export const processSaleInputSchema = z
  .object({
    sale_id: z.string().uuid().optional(),
    store_id: z.string().uuid(),
    client_mutation_id: z.string().uuid(),
    suspended_sale_id: z.string().uuid().optional(),
    suspension_claim_id: z.string().uuid().optional(),
    recovery_client_mutation_id: z.string().uuid().optional(),
    cash_session_id: z.string().uuid().optional(),
    terminal_id: z.string().uuid().optional(),
    customer_id: z.string().uuid().optional(),
    discount: z
      .string()
      .regex(moneyPattern, "discount must be numeric(12,2) string")
      .optional()
      .default("0.00"),
    items: z.array(saleItemInputSchema).min(1).max(500),
    payments: z.array(paymentInputSchema).length(1, "exactly one payment is required for a sale"),
  })
  .superRefine((payload, context) => {
    const seenProducts = new Set<string>();
    payload.items.forEach((item, index) => {
      if (seenProducts.has(item.product_id)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "product_id"],
          message: "duplicate product_id is not allowed",
        });
      }
      seenProducts.add(item.product_id);
    });
  });

export type ProcessSaleInput = z.infer<typeof processSaleInputSchema>;

export const reconcilePaymentInputSchema = z
  .object({
    store_id: storeIdSchema,
    payment_id: z.string().uuid().optional(),
    client_mutation_id: z.string().uuid().optional(),
  })
  .refine(
    (value) => Boolean(value.payment_id || value.client_mutation_id),
    "payment_id or client_mutation_id is required"
  );

export type ReconcilePaymentInput = z.infer<typeof reconcilePaymentInputSchema>;

const fiscalDocumentReferenceSchema = z
  .object({
    store_id: storeIdSchema,
    fiscal_document_id: z.string().uuid().optional(),
    sale_id: z.string().uuid().optional(),
    operation_id: z.string().uuid().optional(),
  })
  .superRefine((value, context) => {
    if (!value.fiscal_document_id && !value.sale_id) {
      context.addIssue({
        code: "custom",
        path: ["fiscal_document_id"],
        message: "fiscal_document_id or sale_id is required",
      });
    }
  });

export const fiscalIssueInputSchema = z.object({
  store_id: storeIdSchema,
  sale_id: z.string().uuid(),
  operation_id: z.string().uuid().optional(),
});

export const fiscalCancelInputSchema = fiscalDocumentReferenceSchema;
export const fiscalReconcileInputSchema = fiscalDocumentReferenceSchema;
export const fiscalRetryInputSchema = z.object({
  store_id: storeIdSchema,
  fiscal_document_id: z.string().uuid(),
  operation_id: z.string().uuid().optional(),
});
export const fiscalWorkerInputSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(10),
  fiscal_document_id: z.string().uuid().optional(),
});

export type FiscalIssueInput = z.infer<typeof fiscalIssueInputSchema>;
export type FiscalCancelInput = z.infer<typeof fiscalCancelInputSchema>;
export type FiscalReconcileInput = z.infer<typeof fiscalReconcileInputSchema>;
export type FiscalRetryInput = z.infer<typeof fiscalRetryInputSchema>;
export type FiscalWorkerInput = z.infer<typeof fiscalWorkerInputSchema>;

export const suspendedSaleItemInputSchema = saleItemInputSchema;

export const suspendSaleInputSchema = z.object({
  store_id: storeIdSchema,
  client_mutation_id: z.string().uuid(),
  terminal_id: z.string().uuid(),
  customer_id: z.string().uuid().optional(),
  discount: z
    .string()
    .regex(moneyPattern, "discount must be numeric(12,2) string")
    .optional()
    .default("0.00"),
  notes: z.string().trim().max(500).optional(),
  items: z.array(suspendedSaleItemInputSchema).min(1).max(500),
});

export type SuspendSaleInput = z.infer<typeof suspendSaleInputSchema>;

export const suspendedSaleListQuerySchema = z.object({
  store_id: storeIdSchema,
  terminal_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  after_created_at: z.string().datetime().optional(),
  after_id: z.string().uuid().optional(),
}).superRefine((value, context) => {
  if (Boolean(value.after_created_at) !== Boolean(value.after_id)) {
    context.addIssue({
      code: "custom",
      path: ["after_id"],
      message: "after_created_at and after_id must be provided together",
    });
  }
});

export type SuspendedSaleListQuery = z.infer<typeof suspendedSaleListQuerySchema>;

export const recoverSuspendedSaleInputSchema = z.object({
  store_id: storeIdSchema,
  terminal_id: z.string().uuid(),
  recovery_client_mutation_id: z.string().uuid(),
});

export type RecoverSuspendedSaleInput = z.infer<typeof recoverSuspendedSaleInputSchema>;

export const releaseSuspendedSaleInputSchema = z.object({
  store_id: storeIdSchema,
  claim_id: z.string().uuid(),
});

export type ReleaseSuspendedSaleInput = z.infer<typeof releaseSuspendedSaleInputSchema>;

export const cashSessionQuerySchema = z.object({
  store_id: z.string().uuid(),
  terminal_id: z.string().uuid(),
});

export const cashOpenSchema = z.object({
  action: z.literal("open"),
  store_id: z.string().uuid(),
  terminal_id: z.string().uuid(),
  client_mutation_id: z.string().uuid(),
  opening_amount: z.string().regex(moneyPattern, "opening_amount must be numeric(12,2) string"),
});

export const cashMovementSchema = z
  .object({
    action: z.literal("movement"),
    cash_session_id: z.string().uuid(),
    store_id: z.string().uuid(),
    terminal_id: z.string().uuid(),
    client_mutation_id: z.string().uuid(),
    movement_type: z.enum(["supply", "withdrawal", "adjustment"]),
    amount: z.string().regex(signedMoneyPattern, "amount must be numeric(12,2) string"),
    reason: z.string().trim().min(1).max(500),
  })
  .superRefine((payload, context) => {
    const amount = new Decimal(payload.amount);
    if (amount.isZero()) {
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "amount must be non-zero",
      });
    }
    if (!amount.isPositive() && payload.movement_type !== "adjustment") {
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "supply and withdrawal amounts must be positive",
      });
    }
  });

export const cashCloseSchema = z.object({
  action: z.literal("close"),
  cash_session_id: z.string().uuid(),
  store_id: z.string().uuid(),
  terminal_id: z.string().uuid(),
  client_mutation_id: z.string().uuid(),
  counted_amount: z.string().regex(moneyPattern, "counted_amount must be numeric(12,2) string"),
});

export const cashActionSchema = z.discriminatedUnion("action", [
  cashOpenSchema,
  cashMovementSchema,
  cashCloseSchema,
]);

export type CashActionInput = z.infer<typeof cashActionSchema>;

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export type LoginInput = z.infer<typeof loginInputSchema>;

const syncTimestampSchema = z.string().min(1).refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "timestamp must be a valid date",
});

export const pullChangesQuerySchema = z.object({
  store_id: z.string().uuid(),
  since: syncTimestampSchema.optional(),
  sales_after_updated_at: syncTimestampSchema.optional(),
  sales_after_id: z.string().uuid().optional(),
  inventory_after_updated_at: syncTimestampSchema.optional(),
  inventory_after_product_id: z.string().uuid().optional(),
  inventory_after_created_at: syncTimestampSchema.optional(),
  inventory_after_id: z.string().uuid().optional(),
  reconcile_id: z.array(z.string().uuid()).max(50).default([]),
  reconcile_inventory_id: z.array(z.string().uuid()).max(50).default([]),
}).superRefine((value, context) => {
  if (Boolean(value.sales_after_updated_at) !== Boolean(value.sales_after_id)) {
    context.addIssue({
      code: "custom",
      path: ["sales_after_id"],
      message: "sales_after_updated_at and sales_after_id must be provided together",
    });
  }
  if (Boolean(value.inventory_after_created_at) !== Boolean(value.inventory_after_id)) {
    context.addIssue({
      code: "custom",
      path: ["inventory_after_id"],
      message: "inventory_after_created_at and inventory_after_id must be provided together",
    });
  }
  if (
    Boolean(value.inventory_after_updated_at) !==
    Boolean(value.inventory_after_product_id)
  ) {
    context.addIssue({
      code: "custom",
      path: ["inventory_after_product_id"],
      message:
        "inventory_after_updated_at and inventory_after_product_id must be provided together",
    });
  }
});

export type PullChangesQuery = z.infer<typeof pullChangesQuerySchema>;

const quantitySchema = z
  .union([z.number().finite(), z.string().trim().min(1)])
  .transform((value, context) => {
    try {
      return toInventoryDelta(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "delta must be a finite non-zero numeric(12,3)",
      });
      return z.NEVER;
    }
  });

export const inventoryAdjustSchema = z
  .object({
    store_id: z.string().uuid(),
    product_id: z.string().uuid().optional(),
    sku: z.string().min(1).optional(),
    client_mutation_id: z.string().uuid(),
    terminal_id: z.string().uuid().optional(),
    import_id: z.string().uuid().optional(),
    import_row: z.number().int().positive().optional(),
    delta: quantitySchema,
    reason: z.string().trim().min(1).max(500),
    movement_type: z.enum(["restock", "adjustment"]),
  })
  .superRefine((data, context) => {
    if (data.movement_type === "restock" && !new Decimal(data.delta).isPositive()) {
      context.addIssue({
        code: "custom",
        message: "restock requires positive delta",
        path: ["delta"],
      });
    }
    if (Boolean(data.import_id) !== Boolean(data.import_row)) {
      context.addIssue({
        code: "custom",
        message: "import_id and import_row must be provided together",
        path: ["import_id"],
      });
    }
  });

export type InventoryAdjustInput = z.infer<typeof inventoryAdjustSchema>;

export const inventoryImportSchema = z.object({
  store_id: z.string().uuid(),
  import_id: z.string().uuid(),
  csv: z.string().min(1).max(1_000_000),
});

export type InventoryImportInput = z.infer<typeof inventoryImportSchema>;

export const inventoryListQuerySchema = z.object({
  store_id: z.string().uuid(),
  cursor_sku: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;

const reportDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
  .refine(isValidDateOnly, "date must be a real calendar date");

export const dashboardMetricsQuerySchema = z.object({
  store_id: z.string().uuid(),
  from: reportDateSchema,
  to: reportDateSchema,
  cursor_sku: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
}).superRefine((value, context) => {
  if (!parseDashboardPeriod(value.from, value.to)) {
    context.addIssue({
      code: "custom",
      path: ["to"],
      message: "period must be [start,end), from before to, and at most 366 days",
    });
  }
});

export type DashboardMetricsQuery = z.infer<typeof dashboardMetricsQuerySchema>;

export const productWriteSchema = z.object({
  store_id: storeIdSchema,
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  unit_price: z.string().regex(moneyPattern, "unit_price must be numeric(12,2) string"),
  cost_price: z.string().regex(moneyPattern, "cost_price must be numeric(12,2) string"),
  barcode: z.string().trim().max(64).nullable().optional(),
  is_active: z.boolean().optional().default(true),
  category_id: z.string().uuid().nullable().optional(),
});

export type ProductWriteInput = z.infer<typeof productWriteSchema>;

export const productPatchSchema = productWriteSchema
  .omit({ store_id: true, is_active: true })
  .partial()
  .extend({
    store_id: storeIdSchema,
    is_active: z.boolean().optional(),
  });

export type ProductPatchInput = z.infer<typeof productPatchSchema>;
