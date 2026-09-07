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
  storeId?: string;
  providerReference?: string;
};

export type PaymentOperationResultOrPromise = PaymentOperationResult | Promise<PaymentOperationResult>;

export interface PaymentAdapter {
  readonly method: Enums<"payment_method">;
  process(amount: string): PaymentAdapterResult;
  authorize(amount: string, context?: PaymentOperationContext): PaymentOperationResultOrPromise;
  capture(amount: string, context?: PaymentOperationContext): PaymentOperationResultOrPromise;
  cancel(amount: string, context?: PaymentOperationContext): PaymentOperationResultOrPromise;
  reconcile(amount: string, context?: PaymentOperationContext): PaymentOperationResultOrPromise;
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

let boundStripeCardAdapter: PaymentAdapter | null = null;

export function bindStripeCardAdapter(adapter: PaymentAdapter | null): void {
  boundStripeCardAdapter = adapter;
}

export function getPaymentAdapter(method: Enums<"payment_method">): PaymentAdapter {
  if (method === "cash") return new CashPaymentAdapter();
  if (method === "card" && boundStripeCardAdapter) return boundStripeCardAdapter;
  return new NotConfiguredPaymentAdapter(method);
}

export const ELECTRONIC_PAYMENT_METHODS = ["card", "pix", "voucher", "other"] as const;

export type ElectronicPaymentMethod = (typeof ELECTRONIC_PAYMENT_METHODS)[number];

export type PaymentAdapterAlert = {
  method: ElectronicPaymentMethod;
  adapterStatus: Enums<"adapter_status">;
  operationStatus: PaymentState | "not_configured";
};

export function getElectronicPaymentAdapterAlerts(): PaymentAdapterAlert[] {
  return ELECTRONIC_PAYMENT_METHODS.map((method) => {
    const adapter = getPaymentAdapter(method);
    return {
      method,
      adapterStatus: adapter.process("0.00").status,
      operationStatus: adapter.authorize("0.00").status,
    };
  });
}
