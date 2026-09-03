import type { Enums } from "@/lib/db/types";

export type PaymentAdapterResult = {
  status: Enums<"adapter_status">;
  message: string;
};

export interface PaymentAdapter {
  readonly method: Enums<"payment_method">;
  process(amount: string): PaymentAdapterResult;
}

export class CashPaymentAdapter implements PaymentAdapter {
  readonly method = "cash" as const;

  process(amount: string): PaymentAdapterResult {
    void amount;
    return { status: "configured", message: "Pagamento em dinheiro registrado." };
  }
}

export class NotConfiguredPaymentAdapter implements PaymentAdapter {
  constructor(readonly method: Exclude<Enums<"payment_method">, "cash">) {}

  process(amount: string): PaymentAdapterResult {
    void amount;
    return {
      status: "not_configured",
      message: `Adapter ${this.method} não configurado no Sprint 1.`,
    };
  }
}

export function getPaymentAdapter(method: Enums<"payment_method">): PaymentAdapter {
  if (method === "cash") return new CashPaymentAdapter();
  return new NotConfiguredPaymentAdapter(method);
}
