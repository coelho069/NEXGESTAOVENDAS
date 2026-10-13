/**
 * Formas de pagamento manuais da loja. Só marcação: a loja usa a própria
 * maquininha e o próprio PIX, e a venda apenas registra a forma escolhida.
 */
export const MANUAL_PAYMENT_METHODS = ["cash", "pix_manual", "debito_manual", "credito_manual"] as const;

export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

/** Sem configuração salva, todas as formas ficam marcadas para não travar a loja. */
export const DEFAULT_ACCEPTED_PAYMENT_METHODS: readonly ManualPaymentMethod[] = MANUAL_PAYMENT_METHODS;

export const MANUAL_PAYMENT_METHOD_LABELS: Record<ManualPaymentMethod, string> = {
  cash: "Dinheiro",
  pix_manual: "PIX",
  debito_manual: "Débito",
  credito_manual: "Crédito",
};

export function isManualPaymentMethod(value: unknown): value is ManualPaymentMethod {
  return typeof value === "string" && (MANUAL_PAYMENT_METHODS as readonly string[]).includes(value);
}

/** Mantém a ordem fixa da lista e remove repetidos e valores desconhecidos. */
export function normalizeAcceptedPaymentMethods(value: unknown): ManualPaymentMethod[] {
  if (!Array.isArray(value)) return [...DEFAULT_ACCEPTED_PAYMENT_METHODS];
  const picked = new Set(value.filter(isManualPaymentMethod));
  const ordered = MANUAL_PAYMENT_METHODS.filter((method) => picked.has(method));
  return ordered.length > 0 ? ordered : [...DEFAULT_ACCEPTED_PAYMENT_METHODS];
}
