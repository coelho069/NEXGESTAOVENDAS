import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { canViewAuditLogs } from "@/lib/domain/rbac";
import {
  AUDIT_PAGE_SIZE_MAX,
  AUDIT_RETENTION_POLICY,
  isAuditResult,
} from "@/lib/observability/audit";
import { createRequestObservability, observeApiResult } from "@/lib/observability/request-context";
import { listAuditEvents, recordAuditEvent } from "@/lib/server/audit";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { storeIdSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * B28 — List audit events for an authorized store.
 * Scope comes from session + store membership; client cannot pass org_id.
 */
export async function GET(request: Request) {
  const obs = createRequestObservability(request, "admin.audit");

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    observeApiResult(obs, "server_error", { error: "auth_not_configured" });
    return obs.withHeaders(
      NextResponse.json({ error: "auth_not_configured" }, { status: 503 })
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    observeApiResult(obs, "rejected", { error: "Unauthorized" });
    return obs.withHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const url = new URL(request.url);
  // Reject tenant/actor authority spoofing query params.
  // actor / actor_user_id may filter rows later — never redefine session identity.
  if (url.searchParams.has("organization_id") || url.searchParams.has("org_id")) {
    observeApiResult(obs, "rejected", { error: "invalid_scope" });
    return obs.withHeaders(NextResponse.json({ error: "invalid_scope" }, { status: 400 }));
  }

  const storeParsed = storeIdSchema.safeParse(url.searchParams.get("store_id"));
  if (!storeParsed.success) {
    observeApiResult(obs, "client_error", { error: "store_id_required" });
    return obs.withHeaders(NextResponse.json({ error: "store_id_required" }, { status: 400 }));
  }

  const auth = await getAuthedContext(storeParsed.data);
  if (!auth?.orgId || !auth.role || !auth.storeId || auth.storeId !== storeParsed.data) {
    observeApiResult(obs, "rejected", { error: "forbidden_audit" });
    return obs.withHeaders(NextResponse.json({ error: "forbidden_audit" }, { status: 403 }));
  }

  const rate = consumeRateLimit({
    key: clientRateLimitKey(request, "admin.audit", auth.userId),
    limit: 60,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    observeApiResult(obs, "rejected", { error: "rate_limited" });
    return obs.withHeaders(
      NextResponse.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: { "Retry-After": String(rate.retryAfterSec), "Cache-Control": "no-store" },
        }
      )
    );
  }

  if (!canViewAuditLogs(auth.role)) {
    void recordAuditEvent({
      storeId: auth.storeId,
      orgId: auth.orgId,
      actorUserId: auth.userId,
      actorRole: auth.role,
      action: "security.access_denied",
      resourceType: "audit_logs",
      resourceId: auth.storeId,
      result: "denied",
      correlationId: obs.correlationId,
      metadata: { route: "admin.audit", reason: "rbac" },
      mode: "best_effort",
    });
    observeApiResult(obs, "rejected", { error: "forbidden_audit" });
    return obs.withHeaders(NextResponse.json({ error: "forbidden_audit" }, { status: 403 }));
  }

  const resultParam = url.searchParams.get("result");
  const result = resultParam && isAuditResult(resultParam) ? resultParam : undefined;
  if (resultParam && !result) {
    return obs.withHeaders(NextResponse.json({ error: "invalid_result_filter" }, { status: 400 }));
  }

  // actor / actor_user_id are row filters only — session actor remains auth.userId.
  const actorFilter =
    url.searchParams.get("actor") ?? url.searchParams.get("actor_user_id") ?? undefined;

  const listed = await listAuditEvents({
    storeId: auth.storeId,
    action: url.searchParams.get("action") ?? undefined,
    resourceType: url.searchParams.get("resource_type") ?? undefined,
    resourceId: url.searchParams.get("resource_id") ?? undefined,
    actorUserId: actorFilter,
    result,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
    offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
  });

  if (!listed.ok) {
    observeApiResult(obs, listed.status >= 500 ? "server_error" : "rejected", {
      error: listed.error,
    });
    return obs.withHeaders(
      NextResponse.json({ error: listed.error }, { status: listed.status })
    );
  }

  void recordAuditEvent({
    storeId: auth.storeId,
    orgId: auth.orgId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: "audit.listed",
    resourceType: "audit_logs",
    resourceId: auth.storeId,
    result: "success",
    correlationId: obs.correlationId,
    metadata: {
      route: "admin.audit",
      returned: listed.events.length,
      limit: listed.limit,
      // Cap advertised in API contract.
      max_page_size: AUDIT_PAGE_SIZE_MAX,
    },
    mode: "best_effort",
  });

  observeApiResult(obs, "ok", { total: listed.total });
  return obs.withHeaders(
    NextResponse.json({
      events: listed.events,
      total: listed.total,
      limit: listed.limit,
      offset: listed.offset,
      retention_policy: AUDIT_RETENTION_POLICY,
      integrity: {
        mechanism: "append_only_rls",
        hash_chaining: false,
      },
    })
  );
}
