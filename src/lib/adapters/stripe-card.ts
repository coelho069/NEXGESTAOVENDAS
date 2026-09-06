import type { Enums } from "@/lib/db/types";
import type { PaymentAdapter, PaymentOperationContext, PaymentOperationResult } from "@/lib/adapters/payment";
import {
  classifySilentHttpSuccess,
  mapStripeIntentStatus,
  reconcileStripePaymentIntent,
  stripeAmountFromBrl,
  type StripeCardIntentSnapshot,
  type StripeIntentOperation,
} from "@/lib/domain/stripe-card";

export type StripeCardAuthorizeInput = {
  amount: string;
  clientMutationId?: string;
  storeId?: string;
  paymentMethod?: string;
};

export type StripeCardGateway = {
  health(): Promise<{ ok: boolean; testmode: boolean; message: string }>;
  authorize(input: StripeCardAuthorizeInput): Promise<StripeCardIntentSnapshot>;
  capture(input: { providerReference: string; amount: string }): Promise<StripeCardIntentSnapshot>;
  cancel(input: { providerReference: string }): Promise<StripeCardIntentSnapshot>;
  retrieve(input: { providerReference: string }): Promise<StripeCardIntentSnapshot | null>;
};

export class StripeCardPaymentAdapter implements PaymentAdapter {
  readonly method = "card" as const satisfies Enums<"payment_method">;

  constructor(private readonly gateway: StripeCardGateway) {}

  process(amount: string): { status: Enums<"adapter_status">; message: string } {
    void amount;
    return { status: "configured", message: "Adapter Stripe card configurado (testmode)." };
  }

  authorize(amount: string, context?: PaymentOperationContext): Promise<PaymentOperationResult> {
    return this.run("authorize", amount, context);
  }

  capture(amount: string, context?: PaymentOperationContext): Promise<PaymentOperationResult> {
    return this.run("capture", amount, context);
  }

  cancel(amount: string, context?: PaymentOperationContext): Promise<PaymentOperationResult> {
    return this.run("cancel", amount, context);
  }

  reconcile(amount: string, context?: PaymentOperationContext): Promise<PaymentOperationResult> {
    return this.run("reconcile", amount, context);
  }

  private async run(
    operation: StripeIntentOperation,
    amount: string,
    context?: PaymentOperationContext
  ): Promise<PaymentOperationResult> {
    try {
      stripeAmountFromBrl(amount);
    } catch {
      return { status: "failed", message: "Valor de cartão inválido." };
    }

    try {
      const snapshot = await this.execute(operation, amount, context);
      return this.toResult(operation, amount, snapshot, true);
    } catch {
      return {
        status: "unknown",
        message: "Stripe não confirmou o PaymentIntent. Pagamento permanece unknown.",
      };
    }
  }

  private async execute(
    operation: StripeIntentOperation,
    amount: string,
    context?: PaymentOperationContext
  ): Promise<StripeCardIntentSnapshot | null> {
    switch (operation) {
      case "authorize":
        return this.gateway.authorize({
          amount,
          clientMutationId: context?.clientMutationId,
          storeId: context?.storeId,
        });
      case "capture":
        if (!context?.providerReference) {
          return { id: "", status: "", amount: 0, currency: "brl", livemode: false, received: false };
        }
        return this.gateway.capture({
          providerReference: context.providerReference,
          amount,
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
    operation: StripeIntentOperation,
    amount: string,
    snapshot: StripeCardIntentSnapshot | null,
    httpOk: boolean
  ): PaymentOperationResult {
    const silent = classifySilentHttpSuccess(httpOk, snapshot, operation);
    if (silent) {
      return {
        status: silent,
        message:
          "Resposta HTTP sem PaymentIntent succeeded. Status local unknown; venda não confirmada.",
        providerReference: snapshot?.id || undefined,
      };
    }

    if (operation === "reconcile") {
      const decision = reconcileStripePaymentIntent({
        expectedProviderRef: snapshot!.id,
        expectedAmount: amount,
        snapshot,
      });
      return {
        status: decision.status,
        message: decision.message,
        providerReference: decision.providerReference,
      };
    }

    const status = mapStripeIntentStatus(snapshot!.status, operation);
    if (operation === "authorize" && status === "captured") {
      return {
        status: "authorized",
        message: "Autorização Stripe não confirma a venda.",
        providerReference: snapshot!.id,
      };
    }
    if (operation === "capture" && status !== "captured") {
      return {
        status: "unknown",
        message: "Capture sem PaymentIntent succeeded. Status local unknown.",
        providerReference: snapshot!.id,
      };
    }

    return {
      status,
      message: `Stripe ${operation} → ${status}.`,
      providerReference: snapshot!.id,
    };
  }
}
