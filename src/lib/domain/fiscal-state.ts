export const FISCAL_DOCUMENT_STATES = [
  "not_configured",
  "pending",
  "issued",
  "failed",
  "unknown",
  "cancelled",
] as const;

export type FiscalDocumentState = (typeof FISCAL_DOCUMENT_STATES)[number];

const FISCAL_TRANSITIONS: Record<
  FiscalDocumentState,
  readonly FiscalDocumentState[]
> = {
  not_configured: ["pending"],
  pending: ["issued", "failed", "unknown", "cancelled", "not_configured"],
  issued: ["pending", "cancelled"],
  failed: ["pending"],
  unknown: ["pending", "issued", "failed", "cancelled", "not_configured"],
  cancelled: ["pending"],
};

export function canTransitionFiscal(
  from: FiscalDocumentState,
  to: FiscalDocumentState
): boolean {
  return from === to || FISCAL_TRANSITIONS[from].includes(to);
}

export function assertFiscalTransition(
  from: FiscalDocumentState,
  to: FiscalDocumentState
): void {
  if (!canTransitionFiscal(from, to)) {
    throw new Error(`Invalid fiscal status transition: ${from} -> ${to}`);
  }
}

export function isFiscalOutcomeUnknown(status: FiscalDocumentState): boolean {
  return status === "unknown";
}

export function isFiscalTerminal(status: FiscalDocumentState): boolean {
  return status === "issued" || status === "failed" || status === "cancelled";
}
