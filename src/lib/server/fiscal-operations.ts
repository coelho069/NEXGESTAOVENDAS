/**
 * Server-authoritative fiscal operations for NFC-e / SAT.
 * Never trusts client-provided status/access_key/protocol as authorization.
 */
import type { FiscalAdapterResult } from "@/lib/adapters/fiscal";
import {
  assertFiscalResultNotFakeIssued,
  fiscalNotConfiguredMessage,
  type FiscalDocumentKind,
  type FiscalIssueIntent,
  type FiscalOperationResult,
} from "@/lib/domain/fiscal";
import {
  getKindFiscalAdapter,
  getPublicFiscalProviderStatus,
  isFiscalPubliclyConfigured,
} from "@/lib/server/fiscal-provider";

export type FiscalOperationKind = "issue" | "consult" | "cancel";

export function runFiscalKindOperation(
  operation: FiscalOperationKind,
  input: {
    kind: FiscalDocumentKind;
    intent?: FiscalIssueIntent;
    documentId?: string;
    externalId?: string;
    clientMutationId?: string;
  }
): FiscalOperationResult {
  const kind = input.kind;
  const adapter = getKindFiscalAdapter(kind);

  if (!isFiscalPubliclyConfigured(kind)) {
    const stubInput = input.documentId ?? input.intent?.saleId ?? "not_configured";
    const raw: FiscalAdapterResult =
      operation === "issue"
        ? (adapter.issue(stubInput) as FiscalAdapterResult)
        : operation === "cancel"
          ? (adapter.cancel(stubInput) as FiscalAdapterResult)
          : (adapter.consult(stubInput) as FiscalAdapterResult);

    assertFiscalResultNotFakeIssued(raw.status, kind);
    return {
      status: raw.status,
      message: raw.message || fiscalNotConfiguredMessage(kind),
      provider: "not_configured",
      kind,
      authorized: false,
      ...(raw.externalId ? { externalId: raw.externalId } : {}),
    };
  }

  // Future live provider wiring lands here. Public flag stays false in B24.
  void getPublicFiscalProviderStatus();
  const stubInput = input.documentId ?? input.intent?.saleId ?? "not_configured";
  const raw: FiscalAdapterResult =
    operation === "issue"
      ? (adapter.issue(stubInput) as FiscalAdapterResult)
      : operation === "cancel"
        ? (adapter.cancel(stubInput) as FiscalAdapterResult)
        : (adapter.consult(stubInput) as FiscalAdapterResult);

  assertFiscalResultNotFakeIssued(raw.status, kind);
  return {
    status: raw.status,
    message: raw.message,
    provider: adapter.name,
    kind,
    authorized: false,
    ...(raw.externalId ? { externalId: raw.externalId } : {}),
  };
}
