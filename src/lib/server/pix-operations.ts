/**
 * Server-authoritative PIX operations.
 * Never trusts client-provided status/provider and never invents paid outcomes.
 */
import { getPixPaymentAdapter } from "@/lib/adapters/payment";
import {
  assertPixResultNotFakePaid,
  type PixChargeIntent,
  type PixOperationResult,
} from "@/lib/domain/payment";
import { getPublicPaymentProviderStatus } from "@/lib/server/payment-provider";

export type PixOperationKind = "create_charge" | "consult" | "cancel" | "refund";

export function isPixPubliclyConfigured(): boolean {
  const status = getPublicPaymentProviderStatus();
  return status.status === "configured" && status.methods.pix === "configured";
}

export function runPixOperation(
  kind: PixOperationKind,
  input: {
    intent?: PixChargeIntent;
    externalReference?: string;
    clientMutationId?: string;
  }
): PixOperationResult {
  // Public configured flag is authoritative for product readiness.
  // B22 keeps this false even when raw env credentials exist (no live client yet).
  if (!isPixPubliclyConfigured()) {
    const adapter = getPixPaymentAdapter();
    if (kind === "create_charge" && input.intent) {
      return adapter.createCharge(input.intent);
    }
    if (kind === "consult" && input.externalReference) {
      return adapter.consultStatus(input.externalReference, {
        clientMutationId: input.clientMutationId,
      });
    }
    if (kind === "cancel" && input.externalReference) {
      return adapter.cancelCharge(input.externalReference, {
        clientMutationId: input.clientMutationId,
      });
    }
    if (kind === "refund" && input.externalReference) {
      return adapter.refundCharge(input.externalReference, {
        clientMutationId: input.clientMutationId,
      });
    }
    return {
      status: "not_configured",
      provider: "not_configured",
      message: "PIX não configurado. Configure o provedor antes de cobrar.",
    };
  }

  // Future provider wiring lands here. Until then the branch above always wins.
  const adapter = getPixPaymentAdapter();
  const result =
    kind === "create_charge" && input.intent
      ? adapter.createCharge(input.intent)
      : kind === "consult" && input.externalReference
        ? adapter.consultStatus(input.externalReference, {
            clientMutationId: input.clientMutationId,
          })
        : kind === "cancel" && input.externalReference
          ? adapter.cancelCharge(input.externalReference, {
              clientMutationId: input.clientMutationId,
            })
          : kind === "refund" && input.externalReference
            ? adapter.refundCharge(input.externalReference, {
                clientMutationId: input.clientMutationId,
              })
            : ({
                status: "not_configured",
                provider: "not_configured",
                message: "PIX não configurado. Configure o provedor antes de cobrar.",
              } satisfies PixOperationResult);

  assertPixResultNotFakePaid(result.status);
  return result;
}
