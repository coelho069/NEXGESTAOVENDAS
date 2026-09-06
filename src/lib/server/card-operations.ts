/**
 * Server-authoritative card (credit/debit) operations.
 * Never trusts client-provided status/provider/auth codes and never invents capture.
 */
import { getCardPaymentAdapter } from "@/lib/adapters/payment";
import {
  assertCardResultNotFakePaid,
  type CardChargeIntent,
  type CardOperationResult,
  type CardPaymentKind,
} from "@/lib/domain/payment";
import { getPublicPaymentProviderStatus } from "@/lib/server/payment-provider";

export type CardOperationKind = "authorize" | "capture" | "cancel" | "refund";

export function isCardPubliclyConfigured(kind: CardPaymentKind = "credit_card"): boolean {
  const status = getPublicPaymentProviderStatus();
  const methodStatus = kind === "debit_card" ? status.methods.debit_card : status.methods.credit_card;
  return status.status === "configured" && methodStatus === "configured";
}

export function runCardOperation(
  kind: CardOperationKind,
  input: {
    intent?: CardChargeIntent;
    cardKind?: CardPaymentKind;
    externalReference?: string;
    clientMutationId?: string;
  }
): CardOperationResult {
  const cardKind = input.intent?.kind ?? input.cardKind ?? "credit_card";
  const adapter = getCardPaymentAdapter(cardKind);

  // Public configured flag is authoritative. B23 keeps this false (no live client).
  if (!isCardPubliclyConfigured(cardKind)) {
    if (kind === "authorize" && input.intent) {
      return adapter.authorizeCard(input.intent);
    }
    if (kind === "capture" && input.externalReference) {
      return adapter.captureCard(input.externalReference, {
        clientMutationId: input.clientMutationId,
      });
    }
    if (kind === "cancel" && input.externalReference) {
      return adapter.cancelCard(input.externalReference, {
        clientMutationId: input.clientMutationId,
      });
    }
    if (kind === "refund" && input.externalReference) {
      return adapter.refundCard(input.externalReference, {
        clientMutationId: input.clientMutationId,
      });
    }
    return {
      status: "not_configured",
      provider: "not_configured",
      kind: cardKind,
      message:
        cardKind === "debit_card"
          ? "Cartão de débito não configurado. Configure o provedor antes de usar."
          : "Cartão de crédito não configurado. Configure o provedor antes de usar.",
    };
  }

  // Future provider wiring lands here. Until then the branch above always wins.
  const result =
    kind === "authorize" && input.intent
      ? adapter.authorizeCard(input.intent)
      : kind === "capture" && input.externalReference
        ? adapter.captureCard(input.externalReference, {
            clientMutationId: input.clientMutationId,
          })
        : kind === "cancel" && input.externalReference
          ? adapter.cancelCard(input.externalReference, {
              clientMutationId: input.clientMutationId,
            })
          : kind === "refund" && input.externalReference
            ? adapter.refundCard(input.externalReference, {
                clientMutationId: input.clientMutationId,
              })
            : ({
                status: "not_configured",
                provider: "not_configured",
                kind: cardKind,
                message: "Cartão não configurado. Configure o provedor antes de usar.",
              } satisfies CardOperationResult);

  assertCardResultNotFakePaid(result.status);
  return result;
}
