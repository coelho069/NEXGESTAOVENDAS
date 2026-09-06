import type { Enums } from "@/lib/db/types";
import type { PaymentState } from "@/lib/domain/payment-state";
import type {
  CardChargeIntent,
  CardOperationResult,
  CardPaymentKind,
  PaymentMethodKind,
  PixChargeIntent,
  PixOperationResult,
  TefOperationResult,
  TefTransactionIntent,
} from "@/lib/domain/payment";
import { paymentNotConfiguredMessage, toDbPaymentMethod } from "@/lib/domain/payment";

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
  externalReference?: string;
  amount?: string;
  terminalId?: string;
};

export interface PaymentAdapter {
  readonly method: Enums<"payment_method">;
  process(amount: string): PaymentAdapterResult;
  authorize(amount: string, context?: PaymentOperationContext): PaymentOperationResult;
  capture(amount: string, context?: PaymentOperationContext): PaymentOperationResult;
  cancel(amount: string, context?: PaymentOperationContext): PaymentOperationResult;
  reconcile(amount: string, context?: PaymentOperationContext): PaymentOperationResult;
}

/**
 * PIX adapter surface for future provider wiring.
 * createCharge / consult / cancel / refund never invent a paid outcome.
 */
export interface PixPaymentPort extends PaymentAdapter {
  readonly method: "pix";
  createCharge(intent: PixChargeIntent): PixOperationResult;
  consultStatus(externalReference: string, context?: PaymentOperationContext): PixOperationResult;
  cancelCharge(externalReference: string, context?: PaymentOperationContext): PixOperationResult;
  refundCharge(externalReference: string, context?: PaymentOperationContext): PixOperationResult;
}

/**
 * Card adapter surface (credit/debit). Authorize/capture/cancel/refund never invent approval.
 */
export interface CardPaymentPort extends PaymentAdapter {
  readonly method: "card";
  readonly kind: CardPaymentKind;
  authorizeCard(intent: CardChargeIntent): CardOperationResult;
  captureCard(externalReference: string, context?: PaymentOperationContext): CardOperationResult;
  cancelCard(externalReference: string, context?: PaymentOperationContext): CardOperationResult;
  refundCard(externalReference: string, context?: PaymentOperationContext): CardOperationResult;
}

/**
 * TEF adapter surface. start/status/confirm/cancel never invent approval from the client.
 */
export interface TefPaymentPort extends PaymentAdapter {
  readonly method: "other";
  readonly kind: "tef";
  startTransaction(intent: TefTransactionIntent): TefOperationResult;
  getStatus(externalTransactionId: string, context?: PaymentOperationContext): TefOperationResult;
  confirm(externalTransactionId: string, context?: PaymentOperationContext): TefOperationResult;
  cancelTransaction(externalTransactionId: string, context?: PaymentOperationContext): TefOperationResult;
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
  constructor(readonly method: Exclude<Enums<"payment_method">, "cash" | "pix" | "card">) {}

  process(amount: string): PaymentAdapterResult {
    void amount;
    return {
      status: "not_configured",
      message: paymentNotConfiguredMessage(this.method),
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

/**
 * PIX adapter (client-safe). B22 keeps all charge paths on not_configured and
 * never returns paid/captured. Server modules decide public configured status
 * from env without exposing secrets to the browser.
 */
export class PixPaymentAdapter implements PixPaymentPort {
  readonly method = "pix" as const;

  private notConfigured(): PixOperationResult {
    return {
      status: "not_configured",
      provider: "not_configured",
      message: paymentNotConfiguredMessage("pix"),
    };
  }

  process(amount: string): PaymentAdapterResult {
    void amount;
    return {
      status: "not_configured",
      message: paymentNotConfiguredMessage("pix"),
    };
  }

  authorize(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: paymentNotConfiguredMessage("pix"),
    };
  }

  capture(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: paymentNotConfiguredMessage("pix"),
    };
  }

  cancel(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: "Cancelamento PIX indisponível: provedor não configurado.",
    };
  }

  reconcile(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: "Reconciliação PIX indisponível: provedor não configurado.",
    };
  }

  createCharge(intent: PixChargeIntent): PixOperationResult {
    void intent;
    return this.notConfigured();
  }

  consultStatus(externalReference: string, context?: PaymentOperationContext): PixOperationResult {
    void externalReference;
    void context;
    return this.notConfigured();
  }

  cancelCharge(externalReference: string, context?: PaymentOperationContext): PixOperationResult {
    void externalReference;
    void context;
    return this.notConfigured();
  }

  refundCharge(externalReference: string, context?: PaymentOperationContext): PixOperationResult {
    void externalReference;
    void context;
    return this.notConfigured();
  }
}

abstract class BaseCardPaymentAdapter implements CardPaymentPort {
  readonly method = "card" as const;
  abstract readonly kind: CardPaymentKind;

  protected notConfigured(kind: CardPaymentKind = this.kind): CardOperationResult {
    return {
      status: "not_configured",
      provider: "not_configured",
      kind,
      message: paymentNotConfiguredMessage(kind),
    };
  }

  process(amount: string): PaymentAdapterResult {
    void amount;
    return {
      status: "not_configured",
      message: paymentNotConfiguredMessage(this.kind),
    };
  }

  authorize(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: paymentNotConfiguredMessage(this.kind),
    };
  }

  capture(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: paymentNotConfiguredMessage(this.kind),
    };
  }

  cancel(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: `Cancelamento ${this.kind} indisponível: provedor não configurado.`,
    };
  }

  reconcile(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: `Reconciliação ${this.kind} indisponível: provedor não configurado.`,
    };
  }

  authorizeCard(intent: CardChargeIntent): CardOperationResult {
    void intent;
    return this.notConfigured(intent.kind);
  }

  captureCard(externalReference: string, context?: PaymentOperationContext): CardOperationResult {
    void externalReference;
    void context;
    return this.notConfigured();
  }

  cancelCard(externalReference: string, context?: PaymentOperationContext): CardOperationResult {
    void externalReference;
    void context;
    return this.notConfigured();
  }

  refundCard(externalReference: string, context?: PaymentOperationContext): CardOperationResult {
    void externalReference;
    void context;
    return this.notConfigured();
  }
}

export class CreditCardPaymentAdapter extends BaseCardPaymentAdapter {
  readonly kind = "credit_card" as const;
}

export class DebitCardPaymentAdapter extends BaseCardPaymentAdapter {
  readonly kind = "debit_card" as const;
}

/**
 * TEF adapter (client-safe). B23 keeps all TEF paths on not_configured and never
 * invents approval, NSU, or authorization codes.
 */
export class TefPaymentAdapter implements TefPaymentPort {
  readonly method = "other" as const;
  readonly kind = "tef" as const;

  private notConfigured(intent?: Partial<TefTransactionIntent>): TefOperationResult {
    return {
      status: "not_configured",
      provider: "not_configured",
      method: "tef",
      terminalId: intent?.terminalId,
      amount: intent?.amount,
      message: paymentNotConfiguredMessage("tef"),
    };
  }

  process(amount: string): PaymentAdapterResult {
    void amount;
    return {
      status: "not_configured",
      message: paymentNotConfiguredMessage("tef"),
    };
  }

  authorize(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: paymentNotConfiguredMessage("tef"),
    };
  }

  capture(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: paymentNotConfiguredMessage("tef"),
    };
  }

  cancel(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: "Cancelamento TEF indisponível: provedor/terminal não configurado.",
    };
  }

  reconcile(amount: string, context?: PaymentOperationContext): PaymentOperationResult {
    void amount;
    void context;
    return {
      status: "not_configured",
      message: "Reconciliação TEF indisponível: provedor/terminal não configurado.",
    };
  }

  startTransaction(intent: TefTransactionIntent): TefOperationResult {
    return this.notConfigured(intent);
  }

  getStatus(externalTransactionId: string, context?: PaymentOperationContext): TefOperationResult {
    void externalTransactionId;
    void context;
    return this.notConfigured();
  }

  confirm(externalTransactionId: string, context?: PaymentOperationContext): TefOperationResult {
    void externalTransactionId;
    void context;
    return this.notConfigured();
  }

  cancelTransaction(externalTransactionId: string, context?: PaymentOperationContext): TefOperationResult {
    void externalTransactionId;
    void context;
    return this.notConfigured();
  }
}

export function getPaymentAdapter(method: Enums<"payment_method">): PaymentAdapter {
  if (method === "cash") return new CashPaymentAdapter();
  if (method === "pix") return new PixPaymentAdapter();
  if (method === "card") return new CreditCardPaymentAdapter();
  if (method === "other") return new TefPaymentAdapter();
  return new NotConfiguredPaymentAdapter(method);
}

/** Resolve adapter by commercial PDV kind (credit/debit/tef/pix/cash). */
export function getCommercialPaymentAdapter(
  kind: PaymentMethodKind | Enums<"payment_method">
): PaymentAdapter {
  if (kind === "cash") return new CashPaymentAdapter();
  if (kind === "pix") return new PixPaymentAdapter();
  if (kind === "credit_card") return new CreditCardPaymentAdapter();
  if (kind === "debit_card") return new DebitCardPaymentAdapter();
  if (kind === "tef") return new TefPaymentAdapter();
  return getPaymentAdapter(toDbPaymentMethod(kind));
}

export function getPixPaymentAdapter(): PixPaymentPort {
  return new PixPaymentAdapter();
}

export function getCreditCardPaymentAdapter(): CardPaymentPort {
  return new CreditCardPaymentAdapter();
}

export function getDebitCardPaymentAdapter(): CardPaymentPort {
  return new DebitCardPaymentAdapter();
}

export function getCardPaymentAdapter(kind: CardPaymentKind = "credit_card"): CardPaymentPort {
  return kind === "debit_card" ? new DebitCardPaymentAdapter() : new CreditCardPaymentAdapter();
}

export function getTefPaymentAdapter(): TefPaymentPort {
  return new TefPaymentAdapter();
}

export function isPixAdapter(adapter: PaymentAdapter): adapter is PixPaymentPort {
  return adapter.method === "pix" && "createCharge" in adapter;
}

export function isCardAdapter(adapter: PaymentAdapter): adapter is CardPaymentPort {
  return adapter.method === "card" && "authorizeCard" in adapter;
}

export function isTefAdapter(adapter: PaymentAdapter): adapter is TefPaymentPort {
  return "kind" in adapter && (adapter as TefPaymentPort).kind === "tef" && "startTransaction" in adapter;
}
