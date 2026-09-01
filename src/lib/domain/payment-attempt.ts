export type PaymentAttemptResult = {
  status: string;
  message: string;
};

export type PaymentAttemptDecision =
  | { kind: "capture" }
  | { kind: "keep_draft"; message: string };

export function resolvePaymentAttempt(result: PaymentAttemptResult): PaymentAttemptDecision {
  if (result.status === "configured") {
    return { kind: "capture" };
  }
  return {
    kind: "keep_draft",
    message: result.message || "Pagamento não configurado. Venda permanece como rascunho local.",
  };
}