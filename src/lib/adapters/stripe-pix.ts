import type { Enums } from "@/lib/db/types";
import type { PaymentAdapter, PaymentOperationContext, PaymentOperationResult } from "@/lib/adapters/payment";
import {
  classifySilentPixHttpSuccess,
  mapStripePixIntentStatus,
  reconcileStripePixPaymentIntent,
  stripeAmountFromBrl,
  type StripePixIntentOperation,
  type StripePixIntentSnapshot,
  type StripePixQr,
} from "@/lib/domain/stripe-pix";

export type StripePixCreateInput = {
  amount: string;
  clientMutationId?: string;
  storeId?: string;
};

export type StripePixGateway = {
  health(): Promise<{ ok: boolean; testmode: boolean; message: string }>;
  create(input: StripePixCreateInput): Promise<StripePixIntentSnapshot>;
  cancel(input: { providerReference: string }): Promise<StripePixIntentSnapshot>;
  retrieve(input: { providerReference: string }): Promise<StripePixIntentSnapshot | null>;
};

export class StripePixPaymentAdapter implements PaymentAdapter {
  readonly method = "pix" as const satisfies Enums<"payment_method">;

  constructor(private readonly gateway: StripePixGateway) {}

  process(amount: string): { status: Enums<"adapter_status">; message: string } {
    void amount;
    return { status: "configured", message: "Adapter Stripe PIX configurado (testmode)." };
  }

  authorize(amount: string, context?: PaymentOperationContext): Promise<PaymentOperationResult> {
    return this.run("create", amount, context);
  }

  capture(amount: string, context?: PaymentOperationContext): Promise<PaymentOperationResult> {
    void amount;
    void context;
    return Promise.resolve({
      status: "unknown",
      message: "PIX não usa captura manual. Aguarde succeeded ou reconcilie.",
    });
  }

  cancel(amount: string, context?: PaymentOperationContext): Promise<PaymentOperationResult> {
    return this.run("cancel", amount, context);
  }

  reconcile(amount: string, context?: PaymentOperationContext): Promise<PaymentOperationResult> {
    return this.run("reconcile", amount, context);
  }

  private async run(
    operation: StripePixIntentOperation,
    amount: string,
    context?: PaymentOperationContext
  ): Promise<PaymentOperationResult> {
    try {
      stripeAmountFromBrl(amount);
    } catch {
      return { status: "failed", message: "Valor PIX inválido." };
    }

    try {
      const snapshot = await this.execute(operation, amount, context);
      return this.toResult(operation, amount, snapshot, true);
    } catch {
      return {
        status: "unknown",
        message: "Stripe não confirmou o PaymentIntent PIX. Pagamento permanece unknown.",
      };
    }
  }

  private async execute(
    operation: StripePixIntentOperation,
    amount: string,
    context?: PaymentOperationContext
  ): Promise<StripePixIntentSnapshot | null> {
    switch (operation) {
      case "create":
        return this.gateway.create({
          amount,
          clientMutationId: context?.clientMutationId,
          storeId: context?.storeId,
        });
      case "cancel":
        if (!context?.providerReference) {
          return { id: "", status: "", amount: 0, currency: "brl", livemode: false, received: false };
        }
        return this.gateway.cancel({ providerReference: context.providerReference });
      case "reconcile":
        if (!context?.providerReference) return null;
        return this.gateway.retrieve({ providerReference: context.providerReference });
      default: {
        const _exhaustive: never = operation;
        return _exhaustive;
      }
    }
  }

  private toResult(
    operation: StripePixIntentOperation,
    amount: string,
    snapshot: StripePixIntentSnapshot | null,
    httpOk: boolean
  ): PaymentOperationResult & { qr?: StripePixQr | null } {
    const silent = classifySilentPixHttpSuccess(httpOk, snapshot, operation);
    if (silent) {
      return {
        status: silent,
        message:
          "Resposta HTTP sem PaymentIntent PIX confirmado. Status local unknown; venda não confirmada.",
        providerReference: snapshot?.id || undefined,
      };
    }

    if (operation === "reconcile") {
      const decision = reconcileStripePixPaymentIntent({
        expectedProviderRef: snapshot!.id,
        expectedAmount: amount,
        snapshot,
      });
      return {
        status: decision.status,
        message: decision.message,
        providerReference: decision.providerReference,
        qr: snapshot?.qr,
      };
    }

    const status = mapStripePixIntentStatus(snapshot!.status);
    if (operation === "create") {
      return {
        status: status === "captured" ? "pending" : status,
        message:
          status === "pending" || status === "captured"
            ? "QR PIX gerado. Venda não confirmada até PaymentIntent succeeded."
            : `Stripe PIX create → ${status}.`,
        providerReference: snapshot!.id,
        qr: snapshot?.qr,
      };
    }

    return {
      status,
      message: `Stripe PIX ${operation} → ${status}.`,
      providerReference: snapshot!.id,
      qr: snapshot?.qr,
    };
  }
}
