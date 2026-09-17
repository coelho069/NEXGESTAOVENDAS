import type { Enums } from "@/lib/db/types";
import type { PaymentAdapter, PaymentOperationContext, PaymentOperationResult } from "@/lib/adapters/payment";
import {
  classifySilentMercadoPagoHttpSuccess,
  mapMercadoPagoOrderStatus,
  normalizeMercadoPagoAmount,
  reconcileMercadoPagoOrder,
  type MercadoPagoOrderOperation,
  type MercadoPagoOrderSnapshot,
  type MercadoPagoPixQr,
} from "@/lib/domain/mercadopago";

export type MercadoPagoPixCreateInput = {
  amount: string;
  clientMutationId?: string;
  storeId?: string;
};

export type MercadoPagoPixGateway = {
  health(): Promise<{ ok: boolean; testmode: boolean; message: string }>;
  create(input: MercadoPagoPixCreateInput): Promise<MercadoPagoOrderSnapshot>;
  cancel(input: { providerReference: string }): Promise<MercadoPagoOrderSnapshot>;
  retrieve(input: { providerReference: string }): Promise<MercadoPagoOrderSnapshot | null>;
};

export class MercadoPagoPixPaymentAdapter implements PaymentAdapter {
  readonly method = "pix" as const satisfies Enums<"payment_method">;

  constructor(private readonly gateway: MercadoPagoPixGateway) {}

  process(amount: string): { status: Enums<"adapter_status">; message: string } {
    void amount;
    return { status: "configured", message: "Adapter Mercado Pago PIX configurado (Orders API)." };
  }

  authorize(amount: string, context?: PaymentOperationContext): Promise<PaymentOperationResult> {
    return this.run("create", amount, context);
  }

  capture(amount: string, context?: PaymentOperationContext): Promise<PaymentOperationResult> {
    void amount;
    void context;
    return Promise.resolve({
      status: "unknown",
      message: "PIX Mercado Pago não usa captura manual. Aguarde processed ou reconcilie.",
    });
  }

  cancel(amount: string, context?: PaymentOperationContext): Promise<PaymentOperationResult> {
    return this.run("cancel", amount, context);
  }

  reconcile(amount: string, context?: PaymentOperationContext): Promise<PaymentOperationResult> {
    return this.run("reconcile", amount, context);
  }

  private async run(
    operation: MercadoPagoOrderOperation,
    amount: string,
    context?: PaymentOperationContext
  ): Promise<PaymentOperationResult> {
    try {
      normalizeMercadoPagoAmount(amount);
    } catch {
      return { status: "failed", message: "Valor PIX Mercado Pago inválido." };
    }

    try {
      const snapshot = await this.execute(operation, amount, context);
      return this.toResult(operation, amount, snapshot, true);
    } catch {
      return {
        status: "unknown",
        message: "Mercado Pago não confirmou a ordem PIX. Pagamento permanece unknown.",
      };
    }
  }

  private async execute(
    operation: MercadoPagoOrderOperation,
    amount: string,
    context?: PaymentOperationContext
  ): Promise<MercadoPagoOrderSnapshot | null> {
    switch (operation) {
      case "create":
        return this.gateway.create({
          amount,
          clientMutationId: context?.clientMutationId,
          storeId: context?.storeId,
        });
      case "cancel":
        if (!context?.providerReference) {
          return {
            id: "",
            status: "",
            statusDetail: "",
            amount: "0.00",
            currency: "BRL",
            livemode: false,
            received: false,
          };
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
    operation: MercadoPagoOrderOperation,
    amount: string,
    snapshot: MercadoPagoOrderSnapshot | null,
    httpOk: boolean
  ): PaymentOperationResult & { qr?: MercadoPagoPixQr | null } {
    const silent = classifySilentMercadoPagoHttpSuccess(httpOk, snapshot, operation);
    if (silent) {
      return {
        status: silent,
        message:
          "Resposta HTTP sem ordem Mercado Pago confirmada. Status local unknown; venda não confirmada.",
        providerReference: snapshot?.id || undefined,
      };
    }

    if (operation === "reconcile") {
      const decision = reconcileMercadoPagoOrder({
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

    const status = mapMercadoPagoOrderStatus(snapshot!.status, snapshot!.statusDetail, operation);
    if (operation === "create") {
      return {
        status: status === "captured" ? "pending" : status,
        message:
          status === "pending" || status === "captured"
            ? "QR PIX Mercado Pago gerado. Venda não confirmada até ordem processed."
            : `Mercado Pago PIX create → ${status}.`,
        providerReference: snapshot!.id,
        qr: snapshot?.qr,
      };
    }

    return {
      status,
      message: `Mercado Pago PIX ${operation} → ${status}.`,
      providerReference: snapshot!.id,
      qr: snapshot?.qr,
    };
  }
}
