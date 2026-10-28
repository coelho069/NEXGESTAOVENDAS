import type { Enums } from "@/lib/db/types";
import type { PaymentState } from "@/lib/domain/payment-state";
import type { StripePixQr } from "@/lib/domain/stripe-pix";

export type PaymentAdapterResult = {
  status: Enums<"adapter_status">;
  message: string;
};

export type PaymentOperationResult = {
  status: PaymentState | "not_configured";
  message: string;
  providerReference?: string;
  qr?: StripePixQr | null;
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

export class VoucherPaymentAdapter implements PaymentAdapter {
  readonly method = "voucher" as const;

  process(amount: string): PaymentAdapterResult {
    void amount;
    return { status: "configured", message: "Vale registrado." };
  }

  authorize(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return { status: "captured", message: "Vale confirmado no servidor." };
  }

  capture(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return { status: "captured", message: "Vale confirmado no servidor." };
  }

  cancel(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: "Cancelamento de vale exige o fluxo de estorno do caixa.",
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

/** Cartão na maquininha da própria loja: só registra a forma, sem cobrança online. */
export class ManualCardPaymentAdapter implements PaymentAdapter {
  constructor(readonly method: "debito_manual" | "credito_manual") {}

  process(amount: string): PaymentAdapterResult {
    void amount;
    return { status: "configured", message: "Cartão (maquininha própria) registrado." };
  }

  authorize(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return { status: "captured", message: "Cartão (maquininha própria) registrado." };
  }

  capture(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return { status: "captured", message: "Cartão (maquininha própria) registrado." };
  }

  cancel(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: "Cancelamento de cartão próprio exige o fluxo de estorno do caixa.",
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

export class PixManualPaymentAdapter implements PaymentAdapter {
  readonly method = "pix_manual" as const;

  process(amount: string): PaymentAdapterResult {
    void amount;
    return { status: "configured", message: "PIX próprio registrado." };
  }

  authorize(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return { status: "captured", message: "PIX próprio confirmado no servidor." };
  }

  capture(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return { status: "captured", message: "PIX próprio confirmado no servidor." };
  }

  cancel(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: "Cancelamento de PIX próprio exige o fluxo de estorno do caixa.",
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
  constructor(
    readonly method: Exclude<Enums<"payment_method">, "cash" | "pix_manual" | "debito_manual" | "credito_manual" | "voucher">
  ) {}

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
let boundStripePixAdapter: PaymentAdapter | null = null;
let boundMercadoPagoPixAdapter: PaymentAdapter | null = null;

export function bindStripeCardAdapter(adapter: PaymentAdapter | null): void {
  boundStripeCardAdapter = adapter;
}

export function bindStripePixAdapter(adapter: PaymentAdapter | null): void {
  boundStripePixAdapter = adapter;
}

export function bindMercadoPagoPixAdapter(adapter: PaymentAdapter | null): void {
  boundMercadoPagoPixAdapter = adapter;
}

export function getPaymentAdapter(method: Enums<"payment_method">): PaymentAdapter {
  if (method === "cash") return new CashPaymentAdapter();
  if (method === "pix_manual") return new PixManualPaymentAdapter();
  if (method === "debito_manual" || method === "credito_manual") return new ManualCardPaymentAdapter(method);
  if (method === "voucher") return new VoucherPaymentAdapter();
  if (method === "card" && boundStripeCardAdapter) return boundStripeCardAdapter;
  if (method === "pix" && boundMercadoPagoPixAdapter) return boundMercadoPagoPixAdapter;
  if (method === "pix" && boundStripePixAdapter) return boundStripePixAdapter;
  return new NotConfiguredPaymentAdapter(method);
}

export const ELECTRONIC_PAYMENT_METHODS = ["card", "pix", "other"] as const;

export type ElectronicPaymentMethod = (typeof ELECTRONIC_PAYMENT_METHODS)[number];

/** Formas realmente vendidas no PDV: só marcação, sem integração (ver store-payment-methods). */
export const PDV_PAYMENT_METHODS = ["cash", "pix_manual", "debito_manual", "credito_manual"] as const;

export type PdvPaymentMethod = (typeof PDV_PAYMENT_METHODS)[number];

export type PaymentAdapterAlert = {
  method: PdvPaymentMethod;
  adapterStatus: Enums<"adapter_status">;
  operationStatus: PaymentState | "not_configured";
};

function syncAuthorizeStatus(
  result: PaymentOperationResultOrPromise
): PaymentState | "not_configured" {
  if (result instanceof Promise) {
    return "unknown";
  }
  return result.status;
}

export function getPdvPaymentAdapterAlerts(): PaymentAdapterAlert[] {
  return PDV_PAYMENT_METHODS.map((method) => {
    const adapter = getPaymentAdapter(method);
    return {
      method,
      adapterStatus: adapter.process("0.00").status,
      operationStatus: syncAuthorizeStatus(adapter.authorize("0.00")),
    };
  });
}

/** Compat: o dashboard só alerta sobre as formas do PDV, não sobre adapters eletrônicos legados. */
export function getElectronicPaymentAdapterAlerts(): PaymentAdapterAlert[] {
  return getPdvPaymentAdapterAlerts();
}
