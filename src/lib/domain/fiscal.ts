import type { Enums } from "@/lib/db/types";
import type { FiscalDocumentState } from "@/lib/domain/fiscal-state";

/** Adapter outcome labels mirrored without importing the adapter module (avoid cycles). */
type FiscalAdapterStatusLike =
  | "issued"
  | "failed"
  | "pending"
  | "unknown"
  | "not_configured"
  | "cancelled";

/**
 * Commercial fiscal document kinds for PDV/UX.
 * Persisted adapter name / provider string stays provider-specific.
 */
export const FISCAL_DOCUMENT_KINDS = ["nfce", "sat"] as const;
export type FiscalDocumentKind = (typeof FISCAL_DOCUMENT_KINDS)[number];

/**
 * Lifecycle vocabulary used in B24 docs.
 * Persisted statuses remain on FiscalDocumentState / fiscal_document_status.
 * `authorized` maps to issued; `rejected` to failed; `contingency` to pending
 * (never treated as issued without a real provider confirmation).
 */
export const FISCAL_LIFECYCLE_STATUSES = [
  "draft",
  "pending",
  "authorized",
  "rejected",
  "cancelled",
  "contingency",
  "not_configured",
] as const;

export type FiscalLifecycleStatus = (typeof FISCAL_LIFECYCLE_STATUSES)[number];

export type FiscalDocumentContract = {
  documentId: string;
  saleId: string;
  storeId: string;
  kind: FiscalDocumentKind;
  status: FiscalDocumentState;
  provider: string | null;
  externalId: string | null;
  accessKey: string | null;
  protocol: string | null;
  operationId: string | null;
  idempotencyKey: string;
  createdAt?: string;
  updatedAt?: string;
};

export type FiscalIssueIntent = {
  storeId: string;
  saleId: string;
  kind: FiscalDocumentKind;
  clientMutationId?: string;
  operationId?: string;
  orgId?: string;
};

export type FiscalOperationResult = {
  status: FiscalLifecycleStatus | FiscalAdapterStatusLike | "unknown";
  message: string;
  provider: string;
  kind: FiscalDocumentKind;
  externalId?: string;
  documentId?: string;
  /** Always false unless a live provider confirmed authorization. */
  authorized: boolean;
};

export function isFiscalDocumentKind(value: string): value is FiscalDocumentKind {
  return (FISCAL_DOCUMENT_KINDS as readonly string[]).includes(value);
}

export function toPersistedFiscalStatus(
  status: FiscalLifecycleStatus | FiscalDocumentState | FiscalAdapterStatusLike
): FiscalDocumentState | "not_configured" {
  if (status === "not_configured") return "not_configured";
  if (status === "authorized") return "issued";
  if (status === "rejected") return "failed";
  if (status === "draft" || status === "contingency") return "pending";
  if (
    status === "pending" ||
    status === "issued" ||
    status === "failed" ||
    status === "unknown" ||
    status === "cancelled"
  ) {
    return status;
  }
  return "unknown";
}

export function toLifecycleFiscalStatus(
  status: FiscalDocumentState
): FiscalLifecycleStatus | "unknown" {
  if (status === "issued") return "authorized";
  if (status === "failed") return "rejected";
  if (status === "pending") return "pending";
  if (status === "cancelled") return "cancelled";
  if (status === "not_configured") return "not_configured";
  return "unknown";
}

export function isFiscalAuthorized(status: FiscalDocumentState | FiscalAdapterStatusLike): boolean {
  return status === "issued";
}

export function fiscalNotConfiguredMessage(kind: FiscalDocumentKind = "nfce"): string {
  if (kind === "sat") {
    return "SAT não configurado. Configure o provedor/hardware antes de emitir CF-e-SAT.";
  }
  return "NFC-e não configurada. Configure o provedor fiscal antes de emitir.";
}

export function fiscalCancelNotConfiguredMessage(kind: FiscalDocumentKind = "nfce"): string {
  if (kind === "sat") {
    return "Cancelamento SAT indisponível: provedor/hardware não configurado.";
  }
  return "Cancelamento NFC-e indisponível: provedor fiscal não configurado.";
}

/**
 * B18 compatibility: commercial cancel/return ≠ authorized fiscal cancel.
 * Without a live provider, fiscal cancel stays pending_external.
 */
export function resolveFiscalExternalCancelOutcome(kind: FiscalDocumentKind = "nfce"): {
  status: "not_configured";
  fiscalCancelStatus: "pending_external";
  message: string;
} {
  return {
    status: "not_configured",
    fiscalCancelStatus: "pending_external",
    message:
      kind === "sat"
        ? "Cancelamento fiscal SAT externo indisponível: provedor não configurado."
        : "Cancelamento fiscal NFC-e externo indisponível: provedor não configurado.",
  };
}

/** Reject fabricated issued/authorized outcomes from non-provider paths. */
export function assertFiscalResultNotFakeIssued(
  status: FiscalLifecycleStatus | FiscalDocumentState | FiscalAdapterStatusLike | "unknown",
  label = "fiscal"
): void {
  if (status === "issued" || status === "authorized") {
    throw new Error(`${label}_illegal_issued_status`);
  }
}

/**
 * QR Code / DANFE fiscal only when a real authorization exists.
 * Never invent access keys or protocols for display.
 */
export function fiscalQrAvailability(input: {
  status: FiscalDocumentState | Enums<"fiscal_document_status">;
  accessKey?: string | null;
  protocol?: string | null;
}): { available: false; reason: string } | { available: true; accessKey: string } {
  if (input.status !== "issued" || !input.accessKey) {
    return {
      available: false,
      reason: "QR Code fiscal indisponível: documento não autorizado pelo provedor.",
    };
  }
  return { available: true, accessKey: input.accessKey };
}

export function buildFiscalDocumentContract(input: {
  documentId: string;
  saleId: string;
  storeId: string;
  kind?: FiscalDocumentKind;
  status: FiscalDocumentState;
  provider?: string | null;
  externalId?: string | null;
  accessKey?: string | null;
  protocol?: string | null;
  operationId?: string | null;
  idempotencyKey: string;
  createdAt?: string;
  updatedAt?: string;
}): FiscalDocumentContract {
  // Never accept client-forged access_key/protocol as authorization evidence.
  const authorized = isFiscalAuthorized(input.status);
  return {
    documentId: input.documentId,
    saleId: input.saleId,
    storeId: input.storeId,
    kind: input.kind ?? "nfce",
    status: input.status,
    provider: input.provider ?? null,
    externalId: input.externalId ?? null,
    accessKey: authorized ? input.accessKey ?? null : null,
    protocol: authorized ? input.protocol ?? null : null,
    operationId: input.operationId ?? null,
    idempotencyKey: input.idempotencyKey,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

/** Commercial receipt copy is never a substitute for an authorized fiscal document. */
export function commercialReceiptDisclaimer(
  fiscalStatus: FiscalDocumentState | Enums<"fiscal_document_status"> | undefined
): string {
  if (fiscalStatus === "issued") {
    return "Comprovante comercial acompanhado de documento fiscal autorizado.";
  }
  return "Comprovante comercial — não constitui NFC-e/SAT autorizada.";
}
