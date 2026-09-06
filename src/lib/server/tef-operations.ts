/**
 * Server-authoritative TEF operations.
 * Never trusts client-provided approval/NSU/auth codes and never invents capture.
 *
 * Terminal hardware is not persisted in B23. When a terminal_id is supplied it is
 * treated only as request correlation — cross-store/org membership is enforced by
 * the API auth context, but no physical TEF device registry exists yet.
 */
import { getTefPaymentAdapter } from "@/lib/adapters/payment";
import {
  assertTefResultNotFakePaid,
  type TefOperationResult,
  type TefTransactionIntent,
} from "@/lib/domain/payment";
import { getPublicPaymentProviderStatus } from "@/lib/server/payment-provider";

export type TefOperationKind = "start" | "status" | "confirm" | "cancel";

export function isTefPubliclyConfigured(): boolean {
  const status = getPublicPaymentProviderStatus();
  return status.status === "configured" && status.methods.tef === "configured";
}

export function runTefOperation(
  kind: TefOperationKind,
  input: {
    intent?: TefTransactionIntent;
    externalTransactionId?: string;
    clientMutationId?: string;
    terminalId?: string;
  }
): TefOperationResult {
  const adapter = getTefPaymentAdapter();

  if (!isTefPubliclyConfigured()) {
    if (kind === "start" && input.intent) {
      return adapter.startTransaction(input.intent);
    }
    if (kind === "status" && input.externalTransactionId) {
      return adapter.getStatus(input.externalTransactionId, {
        clientMutationId: input.clientMutationId,
        terminalId: input.terminalId,
      });
    }
    if (kind === "confirm" && input.externalTransactionId) {
      return adapter.confirm(input.externalTransactionId, {
        clientMutationId: input.clientMutationId,
        terminalId: input.terminalId,
      });
    }
    if (kind === "cancel" && input.externalTransactionId) {
      return adapter.cancelTransaction(input.externalTransactionId, {
        clientMutationId: input.clientMutationId,
        terminalId: input.terminalId,
      });
    }
    return {
      status: "not_configured",
      provider: "not_configured",
      method: "tef",
      terminalId: input.intent?.terminalId ?? input.terminalId,
      message: "TEF não configurado. Configure o provedor/terminal antes de usar.",
    };
  }

  // Future TEF provider/hardware wiring lands here.
  const result =
    kind === "start" && input.intent
      ? adapter.startTransaction(input.intent)
      : kind === "status" && input.externalTransactionId
        ? adapter.getStatus(input.externalTransactionId, {
            clientMutationId: input.clientMutationId,
            terminalId: input.terminalId,
          })
        : kind === "confirm" && input.externalTransactionId
          ? adapter.confirm(input.externalTransactionId, {
              clientMutationId: input.clientMutationId,
              terminalId: input.terminalId,
            })
          : kind === "cancel" && input.externalTransactionId
            ? adapter.cancelTransaction(input.externalTransactionId, {
                clientMutationId: input.clientMutationId,
                terminalId: input.terminalId,
              })
            : ({
                status: "not_configured",
                provider: "not_configured",
                method: "tef",
                message: "TEF não configurado. Configure o provedor/terminal antes de usar.",
              } satisfies TefOperationResult);

  assertTefResultNotFakePaid(result.status);
  return result;
}
