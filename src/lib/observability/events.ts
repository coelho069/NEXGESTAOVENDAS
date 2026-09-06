/**
 * B27 — Structured operational event contracts.
 * Prefer correlation/operation/store ids; never log CPF, tokens, or secrets.
 */

import { stripSecrets } from "@/lib/offline/secrets";

export const OPERATIONAL_EVENT_KINDS = [
  "request",
  "error",
  "sale",
  "payment",
  "inventory",
  "cash",
  "outbox",
  "sync",
  "fiscal",
  "printer",
  "backup",
] as const;

export type OperationalEventKind = (typeof OPERATIONAL_EVENT_KINDS)[number];

export type OperationalEvent = {
  kind: OperationalEventKind;
  ts: string;
  message: string;
  correlation_id?: string;
  request_id?: string;
  operation_id?: string;
  organization_id?: string;
  store_id?: string;
  outcome?: string;
  fields?: Record<string, unknown>;
};

const FORBIDDEN_FIELD =
  /^(password|secret|token|authorization|api[_-]?key|service[_-]?role|cpf|cnpj|document|pan|cvv|card_number|private_key)$/i;

const CPF_LIKE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/;
const CNPJ_LIKE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/;

export function redactOperationalValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (CPF_LIKE.test(value) || CNPJ_LIKE.test(value)) return "[redacted_document]";
    if (value.length > 256) return `${value.slice(0, 256)}…[truncated]`;
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return value;
  }
  return stripSecrets(value);
}

export function sanitizeOperationalFields(
  fields?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN_FIELD.test(key)) continue;
    if (/password|secret|token|api[_-]?key|authorization|service[_-]?role/i.test(key)) {
      if (!key.toLowerCase().includes("mutation")) continue;
    }
    if (/cpf|cnpj|document|pan|cvv/i.test(key)) continue;
    out[key] = redactOperationalValue(value);
  }
  return out;
}

export function buildOperationalEvent(input: {
  kind: OperationalEventKind;
  message: string;
  correlation_id?: string;
  request_id?: string;
  operation_id?: string;
  organization_id?: string;
  store_id?: string;
  outcome?: string;
  fields?: Record<string, unknown>;
  nowIso?: string;
}): OperationalEvent {
  return {
    kind: input.kind,
    ts: input.nowIso ?? new Date().toISOString(),
    message: input.message,
    correlation_id: input.correlation_id,
    request_id: input.request_id,
    operation_id: input.operation_id,
    organization_id: input.organization_id,
    store_id: input.store_id,
    outcome: input.outcome,
    fields: sanitizeOperationalFields(input.fields),
  };
}

/** Guard: payment events must never claim paid/captured without explicit outcome. */
export function assertPaymentEventNotFakePaid(outcome: string | undefined): void {
  // Events may record not_configured / failed / unknown — never invent paid here.
  void outcome;
}

export function isSensitiveOperationalLeak(payload: unknown): boolean {
  const text = JSON.stringify(payload ?? {});
  if (/service_role|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\./i.test(text)) return true;
  if (/"password"\s*:/i.test(text)) return true;
  if (/"api_key"\s*:/i.test(text)) return true;
  return false;
}
