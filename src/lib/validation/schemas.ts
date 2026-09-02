import Decimal from "decimal.js";
import { z } from "zod";

const moneyPattern = /^(?:0|[1-9]\d{0,9})\.\d{2}$/;
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
    customer_id: z.string().uuid().optional(),
    discount: z
      .string()
      .regex(moneyPattern, "discount must be numeric(12,2) string")
      .optional()
      .default("0.00"),
    items: z.array(saleItemInputSchema).min(1),
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

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export type LoginInput = z.infer<typeof loginInputSchema>;

export const pullChangesQuerySchema = z.object({
  store_id: z.string().uuid(),
  since: z.string().min(1).optional(),
});

export type PullChangesQuery = z.infer<typeof pullChangesQuerySchema>;

const quantitySchema = z.number().refine((value) => Number.isFinite(value) && value !== 0, {
  message: "delta must be a non-zero number",
});

export const inventoryAdjustSchema = z
  .object({
    store_id: z.string().uuid(),
    product_id: z.string().uuid().optional(),
    sku: z.string().min(1).optional(),
    delta: quantitySchema,
    reason: z.string().trim().min(1).max(500),
    movement_type: z.enum(["restock", "adjustment"]),
  })
  .refine((data) => data.movement_type !== "restock" || data.delta > 0, {
    message: "restock requires positive delta",
    path: ["delta"],
  });

export type InventoryAdjustInput = z.infer<typeof inventoryAdjustSchema>;

export const inventoryImportSchema = z.object({
  store_id: z.string().uuid(),
  csv: z.string().min(1),
});

export type InventoryImportInput = z.infer<typeof inventoryImportSchema>;

export const inventoryListQuerySchema = z.object({
  store_id: z.string().uuid(),
  cursor_sku: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;

export const dashboardMetricsQuerySchema = z.object({
  store_id: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cursor_sku: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type DashboardMetricsQuery = z.infer<typeof dashboardMetricsQuerySchema>;

export const productWriteSchema = z.object({
  store_id: z.string().uuid().optional(),
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  unit_price: z.string().regex(moneyPattern, "unit_price must be numeric(12,2) string"),
  cost_price: z.string().regex(moneyPattern, "cost_price must be numeric(12,2) string"),
  barcode: z.string().trim().max(64).nullable().optional(),
  is_active: z.boolean().optional().default(true),
  category_id: z.string().uuid().nullable().optional(),
});

export type ProductWriteInput = z.infer<typeof productWriteSchema>;

export const productPatchSchema = productWriteSchema.omit({ store_id: true }).partial();

export type ProductPatchInput = z.infer<typeof productPatchSchema>;
