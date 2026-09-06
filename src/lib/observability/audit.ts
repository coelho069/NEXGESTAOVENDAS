/**
 * B28 — Operational audit / governance contract.
 *
 * Maps onto existing `public.audit_logs` (append-only via SECURITY DEFINER RPCs).
 * Actors and tenants are always server-derived — never trust client-supplied
 * actor_user_id / role / org_id / store_id / result.
 */

import { stripSecrets } from "@/lib/offline/secrets";
import type { MemberRole } from "@/lib/domain/rbac";
import type { Json } from "@/lib/db/types";

export const AUDIT_RESULTS = ["success", "failure", "rejected", "denied"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export const AUDIT_ACTIONS = [
  "sale.created",
  "sale.cancelled",
  "sale.returned",
  "payment.created",
  "payment.refunded",
  "cash.opened",
  "cash.closed",
  "cash.movement",
  "inventory.adjusted",
  "customer.created",
  "customer.updated",
  "customer.deleted",
  "settings.updated",
  "fiscal.issue_requested",
  "fiscal.cancel_requested",
  "printer.configuration_updated",
  "backup.attestation_updated",
  "security.access_denied",
  "security.auth_failed",
  "audit.listed",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number] | (string & {});

/**
 * Real domain action names already persisted by SECURITY DEFINER RPCs.
 * Contract names map onto these — we do not invent duplicate writers.
 */
export const DOMAIN_AUDIT_ACTION_ALIASES: Record<string, string> = {
  "sale.confirmed": "sale.created",
  adjust_inventory: "inventory.adjusted",
  "cash.movement_recorded": "cash.movement",
  "cash.sale_captured": "cash.movement",
  "store_settings.updated": "settings.updated",
  "fiscal.issue.requested": "fiscal.issue_requested",
  "fiscal.cancel.requested": "fiscal.cancel_requested",
  "payment.refunded": "payment.refunded",
};

/** Coverage of critical operations against this codebase (no invented writers). */
export const AUDIT_OPERATION_COVERAGE = {
  "sale.created": { status: "covered", persisted_as: "sale.confirmed" },
  "sale.cancelled": { status: "covered", persisted_as: "sale.cancelled" },
  "sale.returned": { status: "covered", persisted_as: "sale.returned" },
  "payment.created": { status: "covered", persisted_as: "payment.created" },
  "payment.refunded": { status: "covered", persisted_as: "payment.refunded" },
  "cash.opened": { status: "covered", persisted_as: "cash.opened" },
  "cash.closed": { status: "covered", persisted_as: "cash.closed" },
  "cash.movement": { status: "covered", persisted_as: "cash.movement_recorded" },
  "inventory.adjusted": { status: "covered", persisted_as: "adjust_inventory" },
  "customer.created": { status: "covered", persisted_as: "customer.created" },
  "customer.updated": { status: "covered", persisted_as: "customer.updated" },
  "customer.deleted": { status: "not_applicable", persisted_as: null },
  "settings.updated": { status: "covered", persisted_as: "settings.updated|store_settings.updated" },
  "fiscal.issue_requested": {
    status: "covered",
    persisted_as: "fiscal.issue_requested|fiscal.issue.requested",
  },
  "fiscal.cancel_requested": {
    status: "covered",
    persisted_as: "fiscal.cancel_requested|fiscal.cancel.requested",
  },
  "printer.configuration_updated": {
    status: "covered",
    persisted_as: "printer.configuration_updated",
  },
  "backup.attestation_updated": { status: "not_applicable", persisted_as: null },
  "security.access_denied": { status: "covered", persisted_as: "security.access_denied" },
  "security.auth_failed": { status: "covered", persisted_as: "security.auth_failed" },
  "audit.listed": { status: "covered", persisted_as: "audit.listed" },
} as const;

export function normalizeAuditAction(action: string): string {
  return DOMAIN_AUDIT_ACTION_ALIASES[action] ?? action;
}

/** Persisted action names that should match a contract/filter action (RPC also mirrors this). */
export function expandAuditActionFilter(action: string | undefined): string[] {
  if (!action) return [];
  const matched = new Set<string>([action]);
  for (const [persisted, contract] of Object.entries(DOMAIN_AUDIT_ACTION_ALIASES)) {
    if (action === contract || action === persisted) {
      matched.add(persisted);
      matched.add(contract);
    }
  }
  return [...matched];
}

export type AuditEvent = {
  id: string;
  occurred_at: string;
  organization_id: string;
  store_id: string;
  actor_user_id: string | null;
  actor_role: MemberRole | string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  operation_id: string | null;
  correlation_id: string | null;
  result: AuditResult;
  metadata: Record<string, unknown>;
};

export type AuditWriteInput = {
  storeId: string;
  orgId: string;
  actorUserId: string | null;
  actorRole: MemberRole | string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  result: AuditResult;
  operationId?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * required → caller should surface audit persistence failure.
   * best_effort → log and continue (default for non-governance paths).
   */
  mode?: "required" | "best_effort";
};

export type AuditListFilters = {
  storeId: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  actorUserId?: string;
  result?: AuditResult;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export const AUDIT_PAGE_SIZE_MAX = 100;
export const AUDIT_PAGE_SIZE_DEFAULT = 25;

/** Retention is an operational concern — not invented as a legal claim. */
export const AUDIT_RETENTION_POLICY = "not_defined" as const;

export const AUDIT_INTEGRITY_MODEL = {
  mechanism: "append_only_rls",
  hashChaining: false,
  limitations: [
    "Trusted writers are SECURITY DEFINER RPCs / service role only.",
    "Authenticated clients cannot INSERT/UPDATE/DELETE audit_logs.",
    "No cryptographic hash chain is claimed; integrity relies on DB privileges + RLS.",
  ],
} as const;

const FORBIDDEN_META_KEY =
  /^(password|secret|token|authorization|api[_-]?key|service[_-]?role|jwt|refresh[_-]?token|access[_-]?token|webhook|cvv|cvc|pan|card[_-]?number|private[_-]?key|cpf|cnpj|document|phone|address|email)$/i;

const CPF_LIKE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/;
const CNPJ_LIKE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/;

export function isAuditResult(value: unknown): value is AuditResult {
  return typeof value === "string" && (AUDIT_RESULTS as readonly string[]).includes(value);
}

export function sanitizeAuditMetadata(
  metadata?: Record<string, unknown>
): Record<string, unknown> {
  if (!metadata) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stripSecrets(metadata) as Record<string, unknown>)) {
    if (FORBIDDEN_META_KEY.test(key)) continue;
    if (/password|secret|token|api[_-]?key|service[_-]?role|webhook|cvv|pan/i.test(key)) {
      if (!key.toLowerCase().includes("mutation")) continue;
    }
    if (/cpf|cnpj|document|phone|address|email/i.test(key)) continue;
    out[key] = sanitizeAuditValue(value);
  }
  return out;
}

function sanitizeAuditValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (CPF_LIKE.test(value) || CNPJ_LIKE.test(value)) return "[redacted_document]";
    if (value.length > 240) return `${value.slice(0, 240)}…[truncated]`;
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(sanitizeAuditValue);
  }
  if (typeof value === "object") {
    return sanitizeAuditMetadata(value as Record<string, unknown>);
  }
  return String(value);
}

/** Safe settings diff: field names only for sensitive fields; values for booleans/enums. */
export function buildSettingsAuditDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>
): Array<{ field: string; changed: true; old_safe?: unknown; new_safe?: unknown }> {
  const sensitive = new Set([
    "document",
    "phone",
    "address_line",
    "postal_code",
    "receipt_footer",
  ]);
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  const diff: Array<{ field: string; changed: true; old_safe?: unknown; new_safe?: unknown }> = [];
  for (const key of keys) {
    const prev = before?.[key];
    const next = after[key];
    if (Object.is(prev, next)) continue;
    if (JSON.stringify(prev) === JSON.stringify(next)) continue;
    if (sensitive.has(key) || FORBIDDEN_META_KEY.test(key)) {
      diff.push({ field: key, changed: true });
    } else {
      diff.push({
        field: key,
        changed: true,
        old_safe: sanitizeAuditValue(prev),
        new_safe: sanitizeAuditValue(next),
      });
    }
  }
  return diff;
}

export function toAuditPayload(input: AuditWriteInput): Json {
  // actor_role/user/org are server-authoritative in record_audit_event.
  void input.actorRole;
  void input.actorUserId;
  void input.orgId;
  return {
    result: input.result,
    correlation_id: input.correlationId ?? null,
    operation_id: input.operationId ?? null,
    metadata: sanitizeAuditMetadata(input.metadata) as Json,
  };
}

export function fromAuditLogRow(row: {
  id: string;
  created_at: string;
  org_id: string;
  store_id: string;
  user_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  payload: Json;
}): AuditEvent {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {};
  const result = isAuditResult(payload.result) ? payload.result : "success";
  const metadata =
    payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? sanitizeAuditMetadata(payload.metadata as Record<string, unknown>)
      : sanitizeAuditMetadata(
          Object.fromEntries(
            Object.entries(payload).filter(
              ([key]) =>
                !["result", "actor_role", "correlation_id", "operation_id", "metadata"].includes(
                  key
                )
            )
          )
        );

  return {
    id: row.id,
    occurred_at: row.created_at,
    organization_id: row.org_id,
    store_id: row.store_id,
    actor_user_id: row.user_id,
    actor_role: typeof payload.actor_role === "string" ? payload.actor_role : null,
    action: normalizeAuditAction(row.action),
    resource_type: row.entity_type,
    resource_id: row.entity_id,
    operation_id: typeof payload.operation_id === "string" ? payload.operation_id : null,
    correlation_id: typeof payload.correlation_id === "string" ? payload.correlation_id : null,
    result,
    metadata,
  };
}

export function normalizeAuditListFilters(input: AuditListFilters): {
  ok: true;
  value: Required<Pick<AuditListFilters, "storeId" | "limit" | "offset">> & AuditListFilters;
} | {
  ok: false;
  error: string;
} {
  if (!input.storeId || typeof input.storeId !== "string") {
    return { ok: false, error: "store_id_required" };
  }
  if (input.result != null && !isAuditResult(input.result)) {
    return { ok: false, error: "invalid_result_filter" };
  }
  const limit = Math.min(
    AUDIT_PAGE_SIZE_MAX,
    Math.max(1, Math.floor(input.limit ?? AUDIT_PAGE_SIZE_DEFAULT))
  );
  const offset = Math.max(0, Math.floor(input.offset ?? 0));
  if (input.from && Number.isNaN(Date.parse(input.from))) {
    return { ok: false, error: "invalid_from" };
  }
  if (input.to && Number.isNaN(Date.parse(input.to))) {
    return { ok: false, error: "invalid_to" };
  }
  return {
    ok: true,
    value: {
      ...input,
      limit,
      offset,
    },
  };
}

/** Reject client attempts to override tenant/actor fields. */
export function assertServerDerivedAuditAuthority(input: {
  clientOrgId?: unknown;
  clientStoreId?: unknown;
  clientActorUserId?: unknown;
  clientActorRole?: unknown;
  clientResult?: unknown;
}): { ok: true } | { ok: false; code: "client_authority_rejected" } {
  // Presence of these keys in a client body for audit write is always rejected.
  if (
    input.clientOrgId !== undefined ||
    input.clientActorUserId !== undefined ||
    input.clientActorRole !== undefined ||
    input.clientResult !== undefined
  ) {
    return { ok: false, code: "client_authority_rejected" };
  }
  void input.clientStoreId;
  return { ok: true };
}
