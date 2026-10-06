import {
  validateRefundEligibility,
  type BuiltRefundRequest,
  type MercadoPagoRefundAdapter,
  type NormalizedRefundResponse,
  type PersistedCheckoutPayment,
  type RefundEligibility,
  type RefundProcessingRequest,
} from "@/lib/domain/mercadopago-refund";

/**
 * Separate from Checkout Pro charge calls.
 * Live refund execution is refused before any network I/O.
 */
export function createMercadoPagoRefundAdapter(mode: "dry_run" | "live"): MercadoPagoRefundAdapter {
  if (mode === "live") {
    throw new Error("provider_refund_not_enabled");
  }
  return dryRunMercadoPagoRefundAdapter;
}

export const dryRunMercadoPagoRefundAdapter: MercadoPagoRefundAdapter = {
  validateRefundEligibility(input: {
    request: RefundProcessingRequest;
    payment: PersistedCheckoutPayment;
    actorUserId: string;
  }): RefundEligibility {
    return validateRefundEligibility(input);
  },
  buildRefundRequest(eligibility, payment): BuiltRefundRequest {
    return {
      idempotencyKey: eligibility.idempotencyKey,
      mpPaymentId: payment.mpPaymentId,
      amount: eligibility.amount,
      currency: "BRL",
    };
  },
  async executeRefund(request): Promise<NormalizedRefundResponse> {
    return normalizeDryRunRefund(request);
  },
  normalizeRefundResponse(raw: unknown): NormalizedRefundResponse | null {
    if (!raw || typeof raw !== "object") return null;
    const record = raw as Record<string, unknown>;
    if (record.mode !== "dry_run") return null;
    if (record.financial_effect !== false) return null;
    if (record.provider_refund_id != null) return null;
    return {
      mode: "dry_run",
      status: "processing_simulated",
      financialEffect: false,
      providerRefundId: null,
      providerRefundStatus: "not_sent",
      failure: null,
    };
  },
};

export function normalizeDryRunRefund(request: BuiltRefundRequest): NormalizedRefundResponse {
  if (!request.idempotencyKey.startsWith("mercadopago:refund:")) {
    return {
      mode: "provider_failed",
      status: "failed",
      financialEffect: false,
      providerRefundId: null,
      providerRefundStatus: "not_sent",
      failure: "provider_error",
    };
  }
  return {
    mode: "dry_run",
    status: "processing_simulated",
    financialEffect: false,
    providerRefundId: null,
    providerRefundStatus: "not_sent",
    failure: null,
  };
}
