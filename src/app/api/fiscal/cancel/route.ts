import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { canManageFiscal } from "@/lib/domain/rbac";
import { fiscalCancelInputSchema } from "@/lib/validation/schemas";
import { fiscalRpcErrorResponse } from "@/lib/server/fiscal-api";
import { settleFiscalOutbox } from "@/lib/server/fiscal-operation";
import { getFiscalProviderConfig } from "@/lib/server/fiscal-provider";
import { validationFailedResponse } from "@/lib/security/safe-error";
import { recordAuditEvent } from "@/lib/server/audit";
import { readCorrelationId } from "@/lib/observability/correlation";

export async function POST(request: Request) {
  const supabase = await createClient();
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

  const parsed = fiscalCancelInputSchema.safeParse(json);
  if (!parsed.success) {
    return validationFailedResponse(process.env.NODE_ENV === "production", parsed.error.flatten());
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  const correlationId = readCorrelationId(request.headers);
  if (!auth?.orgId || !auth.role || !canManageFiscal(auth.role)) {
    if (auth?.orgId && auth.storeId) {
      void recordAuditEvent({
        storeId: auth.storeId,
        orgId: auth.orgId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: "security.access_denied",
        resourceType: "fiscal_document",
        resourceId:
          parsed.data.fiscal_document_id ?? parsed.data.sale_id ?? auth.storeId,
        result: "denied",
        correlationId,
        metadata: { route: "fiscal.cancel", reason: "rbac" },
        mode: "best_effort",
      });
    }
    return NextResponse.json({ error: "fiscal_forbidden" }, { status: 403 });
  }

  const provider = getFiscalProviderConfig();
  const { data, error } = await supabase.rpc("request_fiscal_cancel", {
    p_payload: {
      ...parsed.data,
      provider: provider.configured ? provider.provider : "not_configured",
    },
  });

  void recordAuditEvent({
    storeId: parsed.data.store_id,
    orgId: auth.orgId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: "fiscal.cancel_requested",
    resourceType: "fiscal_document",
    resourceId:
      parsed.data.fiscal_document_id ?? parsed.data.sale_id ?? parsed.data.store_id,
    result: error ? "failure" : "success",
    correlationId,
    operationId: parsed.data.operation_id,
    metadata: {
      route: "fiscal.cancel",
      authorization: "not_claimed",
      ...(error ? { error: "rpc_error" } : {}),
    },
    mode: "best_effort",
  });

  if (error) return fiscalRpcErrorResponse(error);

  if (provider.configured && data && typeof data === "object" && !Array.isArray(data)) {
    const settled = await settleFiscalOutbox(supabase, data);
    if (settled.error) return fiscalRpcErrorResponse(settled.error);
    return NextResponse.json(settled.data);
  }

  return NextResponse.json(data ?? {});
}
