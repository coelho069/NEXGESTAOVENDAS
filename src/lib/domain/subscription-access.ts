/**
 * Tenant subscription access for operational routes (PDV, dashboard, inventory).
 *
 * `unavailable` is infrastructural (missing schema/tables or query failure).
 * It must never be rewritten to a recorded `none` / `expired` / `canceled`.
 * Real absence or lapse of a subscription still blocks.
 */

export const SUBSCRIPTION_EFFECTIVE_STATES = [
  "active",
  "expired",
  "canceled",
  "none",
  "unavailable",
] as const;

export type SubscriptionEffectiveState = (typeof SUBSCRIPTION_EFFECTIVE_STATES)[number];

export const SUBSCRIPTION_RECORDED_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "expired",
  "canceled",
  "cancelled",
  "none",
] as const;

export type SubscriptionRecordedStatus = (typeof SUBSCRIPTION_RECORDED_STATUSES)[number];

export const SUBSCRIPTION_CHECK_REASONS = [
  "ok",
  "unavailable",
  "expired",
  "canceled",
  "none",
] as const;

export type SubscriptionCheckReason = (typeof SUBSCRIPTION_CHECK_REASONS)[number];

export type SubscriptionCheck = {
  /** Recorded row status when the schema answered; never inferred from errors. */
  recordedStatus: SubscriptionRecordedStatus | null;
  effectiveState: SubscriptionEffectiveState;
  reason: SubscriptionCheckReason;
};

export type SubscriptionGateDecision = {
  allowed: boolean;
  showAdminValidationAlert: boolean;
  effectiveState: SubscriptionEffectiveState;
  reason: SubscriptionCheckReason;
  recordedStatus: SubscriptionRecordedStatus | null;
};

export type SubscriptionQueryOutcome =
  | { kind: "unavailable"; detail: string }
  | { kind: "success"; recordedStatus: string | null };

export type SubscriptionLookupRow = {
  status?: unknown;
};

export type SubscriptionLookupResult = {
  data: SubscriptionLookupRow[] | null;
  error: { code?: string; message?: string; details?: string | null } | null;
};

/** Classify a PostgREST lookup. Errors are never a recorded `none`. */
export function outcomeFromSubscriptionLookup(result: SubscriptionLookupResult): SubscriptionQueryOutcome {
  if (result.error) {
    const detail = result.error.message ?? result.error.code ?? "subscription_query_error";
    if (isSubscriptionSchemaMissingError(result.error)) {
      return { kind: "unavailable", detail: `schema_missing:${detail}` };
    }
    return { kind: "unavailable", detail };
  }

  const status = result.data?.[0]?.status;
  return {
    kind: "success",
    recordedStatus: typeof status === "string" ? status : null,
  };
}

const SCHEMA_MISSING_CODES = new Set(["PGRST205", "PGRST204", "42P01", "42703"]);

export function isSubscriptionSchemaMissingError(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}): boolean {
  const code = error.code ?? "";
  if (SCHEMA_MISSING_CODES.has(code)) return true;
  const haystack = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return (
    haystack.includes("schema cache") ||
    haystack.includes("could not find the table") ||
    haystack.includes("does not exist") ||
    haystack.includes("undefined_table")
  );
}

export function normalizeRecordedSubscriptionStatus(
  value: string | null | undefined
): SubscriptionRecordedStatus | null {
  if (value == null || value.trim() === "") return null;
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "active":
    case "trialing":
    case "past_due":
    case "expired":
    case "canceled":
    case "none":
      return normalized;
    case "cancelled":
      return "canceled";
    default:
      return null;
  }
}

/**
 * Map a DB/query outcome onto a check.
 * Query/schema failures stay `unavailable` — they are not a real `none`.
 */
export function resolveSubscriptionCheck(outcome: SubscriptionQueryOutcome): SubscriptionCheck {
  if (outcome.kind === "unavailable") {
    return {
      recordedStatus: null,
      effectiveState: "unavailable",
      reason: "unavailable",
    };
  }

  const recordedStatus = normalizeRecordedSubscriptionStatus(outcome.recordedStatus);
  if (recordedStatus == null) {
    return {
      recordedStatus: "none",
      effectiveState: "none",
      reason: "none",
    };
  }

  switch (recordedStatus) {
    case "active":
    case "trialing":
    case "past_due":
      return {
        recordedStatus,
        effectiveState: "active",
        reason: "ok",
      };
    case "expired":
      return {
        recordedStatus: "expired",
        effectiveState: "expired",
        reason: "expired",
      };
    case "canceled":
    case "cancelled":
      return {
        recordedStatus: "canceled",
        effectiveState: "canceled",
        reason: "canceled",
      };
    case "none":
      return {
        recordedStatus: "none",
        effectiveState: "none",
        reason: "none",
      };
    default: {
      const _never: never = recordedStatus;
      return _never;
    }
  }
}

/** Fail-open only for infrastructural `unavailable`. Real lapses stay blocked. */
export function gateTenantSubscriptionAccess(check: SubscriptionCheck): SubscriptionGateDecision {
  switch (check.effectiveState) {
    case "unavailable":
      return {
        allowed: true,
        showAdminValidationAlert: true,
        effectiveState: "unavailable",
        reason: "unavailable",
        recordedStatus: check.recordedStatus,
      };
    case "active":
      return {
        allowed: true,
        showAdminValidationAlert: false,
        effectiveState: "active",
        reason: "ok",
        recordedStatus: check.recordedStatus,
      };
    case "expired":
      return {
        allowed: false,
        showAdminValidationAlert: false,
        effectiveState: "expired",
        reason: "expired",
        recordedStatus: check.recordedStatus,
      };
    case "canceled":
      return {
        allowed: false,
        showAdminValidationAlert: false,
        effectiveState: "canceled",
        reason: "canceled",
        recordedStatus: check.recordedStatus,
      };
    case "none":
      return {
        allowed: false,
        showAdminValidationAlert: false,
        effectiveState: "none",
        reason: "none",
        recordedStatus: check.recordedStatus,
      };
    default: {
      const _never: never = check.effectiveState;
      return _never;
    }
  }
}

export function subscriptionBlockTitle(state: SubscriptionEffectiveState): string {
  switch (state) {
    case "expired":
      return "Assinatura expirada";
    case "canceled":
      return "Assinatura cancelada";
    case "none":
      return "Nenhuma assinatura ativa";
    case "unavailable":
      return "Não foi possível validar a assinatura";
    case "active":
      return "Assinatura ativa";
    default: {
      const _never: never = state;
      return _never;
    }
  }
}
