import type { Enums } from "@/lib/db/types";
import type { PaymentState } from "@/lib/domain/payment-state";

export type PaymentAdapterResult = {
  status: Enums<"adapter_status">;
  message: string;
};

export type PaymentOperationResult = {
  status: PaymentState | "not_configured";
  message: string;
  providerReference?: string;
};

export type PaymentOperationContext = {
  clientMutationId?: string;
};

export interface PaymentAdapter {
  readonly method: Enums<"payment_method">;
  process(amount: string): PaymentAdapterResult;
  authorize(amount: string, context?: PaymentOperationContext): PaymentOperationResult;
  capture(amount: string, context?: PaymentOperationContext): PaymentOperationResult;
  cancel(amount: string, context?: PaymentOperationContext): PaymentOperationResult;
  reconcile(amount: string, context?: PaymentOperationContext): PaymentOperationResult;
}

export class CashPaymentAdapter implements PaymentAdapter {
  readonly method = "cash" as const;

  process(amount: string): PaymentAdapterResult {
    void amount;
    return { status: "configured", message: "Pagamento em dinheiro registrado." };
  }

  authorize(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return { status: "captured", message: "Pagamento em dinheiro confirmado no servidor." };
  }

  capture(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return { status: "captured", message: "Pagamento em dinheiro confirmado no servidor." };
  }

  cancel(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: "Cancelamento de pagamento em dinheiro exige o fluxo de estorno do caixa.",
    };
  }

  reconcile(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "unknown",
      message: "A reconciliação deve consultar o registro server-side do pagamento.",
    };
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

  authorize(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: `Adapter ${this.method} não configurado.`,
    };
  }

  capture(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: `Adapter ${this.method} não configurado.`,
    };
  }

  cancel(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: `Adapter ${this.method} não configurado.`,
    };
  }

  reconcile(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: `Adapter ${this.method} não configurado.`,
    };
  }
}

export function getPaymentAdapter(method: Enums<"payment_method">): PaymentAdapter {
  if (method === "cash") return new CashPaymentAdapter();
  return new NotConfiguredPaymentAdapter(method);
}
