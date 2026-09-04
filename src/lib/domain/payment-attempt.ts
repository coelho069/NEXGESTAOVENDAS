import type { Enums } from "@/lib/db/types";
import type { PaymentState } from "@/lib/domain/payment-state";

export type PaymentAttemptResult = {
  status: Enums<"adapter_status"> | PaymentState;
  message: string;
  providerReference?: string;
};

export type PaymentAttemptDecision =
  | { kind: "capture" }
  | { kind: "unknown"; message: string }
  | { kind: "keep_draft"; message: string };

export function resolvePaymentAttempt(result: PaymentAttemptResult): PaymentAttemptDecision {
  if (result.status === "configured" || result.status === "captured") {
    return { kind: "capture" };
  }
  if (result.status === "unknown") {
    return {
      kind: "unknown",
      message: result.message || "Pagamento sem resposta confirmada. Reconcilie antes de tentar novamente.",
    };
  }
  return {
    kind: "keep_draft",
    message: result.message || "Pagamento não configurado. Venda permanece como rascunho local.",
  };
}

export function unifyCheckoutPayment(
  method: Enums<"payment_method">,
  amount: string
): { method: Enums<"payment_method">; amount: string } {
  return { method, amount };
}
