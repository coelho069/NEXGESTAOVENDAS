import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { canManageFiscal } from "@/lib/domain/rbac";
import {
  assertFiscalResultNotFakeIssued,
  resolveFiscalExternalCancelOutcome,
} from "@/lib/domain/fiscal";
import { runFiscalKindOperation } from "@/lib/server/fiscal-operations";
import { storeIdSchema } from "@/lib/validation/schemas";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse, validationFailedResponse } from "@/lib/security/safe-error";
import {
  createRequestObservability,
  observeApiResult,
} from "@/lib/observability/request-context";

const fiscalKindOperationSchema = z.object({
  operation: z.enum(["issue", "consult", "cancel"]),
  kind: z.enum(["nfce", "sat"]).default("nfce"),
  store_id: storeIdSchema,
  sale_id: z.string().uuid().optional(),
  document_id: z.string().uuid().optional(),
  client_mutation_id: z.string().uuid(),
  // Client-forged authorization fields are intentionally ignored as authority.
  status: z.string().max(40).optional(),
  access_key: z.string().max(80).optional(),
  protocol: z.string().max(80).optional(),
  authorization_code: z.string().max(80).optional(),
  provider: z.string().max(80).optional(),
});

/**
 * Server-authoritative NFC-e / SAT operation entrypoint (B24).
 * Never trusts client status/access_key/protocol as fiscal authorization.
 * Without certificate vault + live provider: always not_configured (422).
 */
export async function POST(request: Request) {
  const obs = createRequestObservability(request, "fiscal.documents");
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    observeApiResult(obs, "server_error", { error: "auth_not_configured" });
    return obs.withHeaders(NextResponse.json({ error: "auth_not_configured" }, { status: 503 }));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    observeApiResult(obs, "rejected", { error: "Unauthorized" });
    return obs.withHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const rate = consumeRateLimit({
    key: clientRateLimitKey(request, "fiscal-kind-ops", user.id),
    limit: 30,
    windowMs: 60_000,
  });
  if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSec);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = fiscalKindOperationSchema.safeParse(json);
  if (!parsed.success) {
    return validationFailedResponse(process.env.NODE_ENV === "production", parsed.error.flatten());
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role) {
    observeApiResult(obs, "rejected", { error: "fiscal_forbidden" });
    return obs.withHeaders(NextResponse.json({ error: "fiscal_forbidden" }, { status: 403 }));
  }

  if (parsed.data.operation === "cancel" && !canManageFiscal(auth.role)) {
    observeApiResult(obs, "rejected", { error: "fiscal_forbidden" });
    return obs.withHeaders(NextResponse.json({ error: "fiscal_forbidden" }, { status: 403 }));
  }

  if (parsed.data.operation === "issue" && !parsed.data.sale_id) {
    return validationFailedResponse(process.env.NODE_ENV === "production", {
      formErrors: [],
      fieldErrors: { sale_id: ["Required for issue"] },
    });
  }

  const result = runFiscalKindOperation(parsed.data.operation, {
    kind: parsed.data.kind,
    documentId: parsed.data.document_id,
    clientMutationId: parsed.data.client_mutation_id,
    intent:
      parsed.data.operation === "issue" && parsed.data.sale_id
        ? {
            storeId: parsed.data.store_id,
            saleId: parsed.data.sale_id,
            kind: parsed.data.kind,
            clientMutationId: parsed.data.client_mutation_id,
            orgId: auth.orgId,
          }
        : undefined,
  });

  try {
    assertFiscalResultNotFakeIssued(result.status, parsed.data.kind);
  } catch {
    observeApiResult(obs, "server_error", { error: "fiscal_illegal_issued_status" });
    return obs.withHeaders(
      NextResponse.json(
        { error: "fiscal_not_configured", adapter_status: "not_configured" },
        { status: 422 }
      )
    );
  }

  if (result.status === "not_configured") {
    const body: Record<string, unknown> = {
      error: "fiscal_not_configured",
      adapter_status: "not_configured",
      provider: result.provider,
      kind: result.kind,
      operation: parsed.data.operation,
      authorized: false,
      message: result.message,
    };
    if (parsed.data.operation === "cancel") {
      const outcome = resolveFiscalExternalCancelOutcome(parsed.data.kind);
      body.fiscal_cancel_status = outcome.fiscalCancelStatus;
      body.message = outcome.message;
    }
    observeApiResult(obs, "rejected", { error: "fiscal_not_configured" });
    return obs.withHeaders(NextResponse.json(body, { status: 422 }));
  }

  observeApiResult(obs, "ok", { status: result.status, operation: parsed.data.operation });
  return obs.withHeaders(NextResponse.json(result));
}
