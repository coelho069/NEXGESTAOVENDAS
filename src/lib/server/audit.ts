/**
 * B28 — Server-side audit writer/reader.
 * Uses SECURITY DEFINER RPCs so authenticated clients never INSERT into audit_logs.
 */

import { createClient } from "@/lib/supabase/server";
import { rootLogger } from "@/lib/observability/logger";
import {
  fromAuditLogRow,
  normalizeAuditListFilters,
  toAuditPayload,
  type AuditEvent,
  type AuditListFilters,
  type AuditWriteInput,
} from "@/lib/observability/audit";
import type { Json } from "@/lib/db/types";

export type AuditWriteOutcome =
  | { ok: true; id: string; mode: "required" | "best_effort" }
  | { ok: false; error: string; mode: "required" | "best_effort" };

export type AuditListOutcome =
  | { ok: true; events: AuditEvent[]; total: number; limit: number; offset: number }
  | { ok: false; error: string; status: number };

export async function recordAuditEvent(input: AuditWriteInput): Promise<AuditWriteOutcome> {
  const mode = input.mode ?? "best_effort";
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("record_audit_event", {
      p_payload: {
        store_id: input.storeId,
        // org_id is derived server-side from the store; never trust client org.
        action: input.action,
        entity_type: input.resourceType,
        entity_id: input.resourceId,
        payload: toAuditPayload(input),
      },
    });
    if (error) {
      rootLogger.warn("audit_record_failed", {
        mode,
        action: input.action,
        error: error.message,
      });
      return { ok: false, error: error.message, mode };
    }
    const id =
      data && typeof data === "object" && "id" in data && typeof (data as { id: unknown }).id === "string"
        ? (data as { id: string }).id
        : typeof data === "string"
          ? data
          : "";
    if (!id) {
      return { ok: false, error: "audit_record_empty", mode };
    }
    return { ok: true, id, mode };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "audit_record_unavailable";
    rootLogger.warn("audit_record_unavailable", { mode, action: input.action, error: message });
    return { ok: false, error: message, mode };
  }
}

export async function listAuditEvents(filters: AuditListFilters): Promise<AuditListOutcome> {
  const normalized = normalizeAuditListFilters(filters);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error, status: 400 };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("list_audit_events", {
      p_payload: {
        store_id: normalized.value.storeId,
        action: normalized.value.action ?? null,
        entity_type: normalized.value.resourceType ?? null,
        entity_id: normalized.value.resourceId ?? null,
        actor_user_id: normalized.value.actorUserId ?? null,
        result: normalized.value.result ?? null,
        from: normalized.value.from ?? null,
        to: normalized.value.to ?? null,
        limit: normalized.value.limit,
        offset: normalized.value.offset,
      },
    });
    if (error) {
      const message = error.message ?? "";
      if (message.includes("forbidden_audit")) {
        return { ok: false, error: "forbidden_audit", status: 403 };
      }
      return { ok: false, error: "audit_list_unavailable", status: 503 };
    }

    const payload = data as {
      rows?: Array<{
        id: string;
        created_at: string;
        org_id: string;
        store_id: string;
        user_id: string | null;
        entity_type: string;
        entity_id: string;
        action: string;
        payload: Json;
      }>;
      total?: number;
    } | null;

    const rows = payload?.rows ?? [];
    return {
      ok: true,
      events: rows.map(fromAuditLogRow),
      total: typeof payload?.total === "number" ? payload.total : rows.length,
      limit: normalized.value.limit!,
      offset: normalized.value.offset!,
    };
  } catch {
    return { ok: false, error: "audit_list_unavailable", status: 503 };
  }
}
