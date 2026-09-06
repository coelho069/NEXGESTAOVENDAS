import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import {
  assertCardResultNotFakePaid,
  resolveCardExternalRefundOutcome,
} from "@/lib/domain/payment";
import { runCardOperation } from "@/lib/server/card-operations";
import { storeIdSchema } from "@/lib/validation/schemas";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse, validationFailedResponse } from "@/lib/security/safe-error";
import {
  createRequestObservability,
  observeApiResult,
} from "@/lib/observability/request-context";

const cardOperationSchema = z.object({
  operation: z.enum(["authorize", "capture", "cancel", "refund"]),
  kind: z.enum(["credit_card", "debit_card"]).default("credit_card"),
  store_id: storeIdSchema,
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  client_mutation_id: z.string().uuid(),
  sale_id: z.string().uuid().optional(),
  external_reference: z.string().min(1).max(200).optional(),
  // Client-supplied approval fields are intentionally ignored as authority.
  authorization_code: z.string().max(100).optional(),
  status: z.string().max(40).optional(),
  provider: z.string().max(80).optional(),
});

/**
 * Server-authoritative card (credit/debit) entrypoint.
 * Never trusts client status/provider/authorization_code as payment outcome.
 * Without a live provider: always payment_method_not_configured (422).
 */
export async function POST(request: Request) {
  const obs = createRequestObservability(request, "payments.card");
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
    key: clientRateLimitKey(request, "card-ops", user.id),
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

  const parsed = cardOperationSchema.safeParse(json);
  if (!parsed.success) {
    return validationFailedResponse(process.env.NODE_ENV === "production", parsed.error.flatten());
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role) {
    observeApiResult(obs, "rejected", { error: "forbidden_store" });
    return obs.withHeaders(NextResponse.json({ error: "forbidden_store" }, { status: 403 }));
  }

  if (parsed.data.operation === "refund" && auth.role === "cashier") {
    observeApiResult(obs, "rejected", { error: "forbidden_role" });
    return obs.withHeaders(NextResponse.json({ error: "forbidden_role" }, { status: 403 }));
  }

  if (parsed.data.operation === "authorize" && !parsed.data.amount) {
    return validationFailedResponse(process.env.NODE_ENV === "production", {
      formErrors: [],
      fieldErrors: { amount: ["Required for authorize"] },
    });
  }

  if (
    (parsed.data.operation === "capture" ||
      parsed.data.operation === "cancel" ||
      parsed.data.operation === "refund") &&
    !parsed.data.external_reference
  ) {
    return validationFailedResponse(process.env.NODE_ENV === "production", {
      formErrors: [],
      fieldErrors: { external_reference: ["Required for capture/cancel/refund"] },
    });
  }

  // Ignore client status/provider/authorization_code — server adapter is authority.
  const result = runCardOperation(parsed.data.operation, {
    cardKind: parsed.data.kind,
    clientMutationId: parsed.data.client_mutation_id,
    externalReference: parsed.data.external_reference,
    intent:
      parsed.data.operation === "authorize" && parsed.data.amount
        ? {
            storeId: parsed.data.store_id,
            amount: parsed.data.amount,
            clientMutationId: parsed.data.client_mutation_id,
            kind: parsed.data.kind,
            saleId: parsed.data.sale_id,
            orgId: auth.orgId,
          }
        : undefined,
  });

  try {
    assertCardResultNotFakePaid(result.status);
  } catch {
    observeApiResult(obs, "server_error", { error: "card_illegal_paid_status" });
    return obs.withHeaders(
      NextResponse.json(
        { error: "payment_method_not_configured", adapter_status: "not_configured" },
        { status: 422 }
      )
    );
  }

  if (result.status === "not_configured") {
    const body: Record<string, unknown> = {
      error: "payment_method_not_configured",
      adapter_status: "not_configured",
      provider: result.provider,
      kind: result.kind,
      operation: parsed.data.operation,
      message: result.message,
    };
    if (parsed.data.operation === "refund") {
      const outcome = resolveCardExternalRefundOutcome(parsed.data.kind);
      body.payment_refund_status = outcome.paymentRefundStatus;
      body.message = outcome.message;
    }
    observeApiResult(obs, "rejected", { error: "payment_method_not_configured" });
    return obs.withHeaders(NextResponse.json(body, { status: 422 }));
  }

  observeApiResult(obs, "ok", { status: result.status, operation: parsed.data.operation });
  return obs.withHeaders(NextResponse.json(result));
}
