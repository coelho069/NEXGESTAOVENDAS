import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { canManageFiscal } from "@/lib/domain/rbac";
import { fiscalIssueInputSchema } from "@/lib/validation/schemas";
import { fiscalRpcErrorResponse } from "@/lib/server/fiscal-api";
import { requestFiscalIssueAfterCommit } from "@/lib/server/fiscal-operation";
import { recordAuditEvent } from "@/lib/server/audit";
import { readCorrelationId } from "@/lib/observability/correlation";

export async function POST(request: Request) {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = fiscalIssueInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Reject client-forged fiscal authorization fields — server/adapter is authority.
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const forged = json as Record<string, unknown>;
    if (
      forged.status === "issued" ||
      forged.status === "authorized" ||
      forged.status === "approved" ||
      typeof forged.access_key === "string" ||
      typeof forged.protocol === "string" ||
      typeof forged.authorization_code === "string"
    ) {
      return NextResponse.json(
        {
          error: "fiscal_client_authority_rejected",
          message:
            "Status, chave de acesso e protocolo fiscais não podem ser enviados pelo cliente.",
        },
        { status: 400 }
      );
    }
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  const correlationId = readCorrelationId(request.headers);
  if (!auth?.orgId || !auth.role) {
    return NextResponse.json({ error: "fiscal_forbidden" }, { status: 403 });
  }
  if (!canManageFiscal(auth.role)) {
    void recordAuditEvent({
      storeId: parsed.data.store_id,
      orgId: auth.orgId,
      actorUserId: auth.userId,
      actorRole: auth.role,
      action: "security.access_denied",
      resourceType: "fiscal_document",
      resourceId: parsed.data.sale_id,
      result: "denied",
      correlationId,
      metadata: { route: "fiscal.issue", reason: "rbac" },
      mode: "best_effort",
    });
    return NextResponse.json({ error: "fiscal_forbidden" }, { status: 403 });
  }

  const result = await requestFiscalIssueAfterCommit(supabase, {
    storeId: parsed.data.store_id,
    saleId: parsed.data.sale_id,
    operationId: parsed.data.operation_id,
  });
  const errorMessage = result.error?.message ?? "";
  const denied =
    /forbidden|denied|not_authorized|42501/i.test(errorMessage) ||
    errorMessage.includes("fiscal_cancel_forbidden") ||
    errorMessage.includes("fiscal_forbidden");
  void recordAuditEvent({
    storeId: parsed.data.store_id,
    orgId: auth.orgId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: "fiscal.issue_requested",
    resourceType: "fiscal_document",
    resourceId: parsed.data.sale_id,
    result: result.error ? (denied ? "denied" : "failure") : "success",
    correlationId,
    operationId: parsed.data.operation_id,
    metadata: {
      route: "fiscal.issue",
      // Request accepted by API ≠ SEFAZ authorization.
      authorization: "not_claimed",
      ...(result.error ? { error: denied ? "forbidden" : "rpc_error" } : {}),
    },
    mode: "best_effort",
  });
  if (result.error) return fiscalRpcErrorResponse(result.error);
  return NextResponse.json(result.data ?? {});
}
