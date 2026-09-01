import { z } from "zod";

const moneyPattern = /^\d+\.\d{2}$/;

export const saleItemInputSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().positive(),
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

export const processSaleInputSchema = z.object({
  store_id: z.string().uuid(),
  client_mutation_id: z.string().uuid(),
  customer_id: z.string().uuid().optional(),
  discount: z
    .string()
    .regex(moneyPattern, "discount must be numeric(12,2) string")
    .optional()
    .default("0.00"),
  items: z.array(saleItemInputSchema).min(1),
  payments: z.array(paymentInputSchema).min(1),
});

export type ProcessSaleInput = z.infer<typeof processSaleInputSchema>;

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export type LoginInput = z.infer<typeof loginInputSchema>;
