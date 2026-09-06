import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import {
  assertTefResultNotFakePaid,
  resolveTefExternalRefundOutcome,
} from "@/lib/domain/payment";
import { runTefOperation } from "@/lib/server/tef-operations";
import { storeIdSchema } from "@/lib/validation/schemas";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse, validationFailedResponse } from "@/lib/security/safe-error";
import {
  createRequestObservability,
  observeApiResult,
} from "@/lib/observability/request-context";

const tefOperationSchema = z.object({
  operation: z.enum(["start", "status", "confirm", "cancel"]),
  store_id: storeIdSchema,
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  client_mutation_id: z.string().uuid(),
  sale_id: z.string().uuid().optional(),
  terminal_id: z.string().min(1).max(120).optional(),
  external_transaction_id: z.string().min(1).max(200).optional(),
  // Client-supplied approval fields are intentionally ignored as authority.
  authorization_code: z.string().max(100).optional(),
  nsu: z.string().max(100).optional(),
  status: z.string().max(40).optional(),
  provider: z.string().max(80).optional(),
});

/**
 * Server-authoritative TEF entrypoint.
 * Never trusts client status/provider/NSU/authorization_code as payment outcome.
 * Without a live TEF provider/hardware: always payment_method_not_configured (422).
 *
 * Note: B23 does not persist a physical TEF device registry. terminal_id is
 * accepted for correlation only; store/org scope is enforced via auth context.
 */
export async function POST(request: Request) {
  const obs = createRequestObservability(request, "payments.tef");
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
    key: clientRateLimitKey(request, "tef-ops", user.id),
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

  const parsed = tefOperationSchema.safeParse(json);
  if (!parsed.success) {
    return validationFailedResponse(process.env.NODE_ENV === "production", parsed.error.flatten());
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role) {
    observeApiResult(obs, "rejected", { error: "forbidden_store" });
    return obs.withHeaders(NextResponse.json({ error: "forbidden_store" }, { status: 403 }));
  }

  if (parsed.data.operation === "cancel" && auth.role === "cashier") {
    observeApiResult(obs, "rejected", { error: "forbidden_role" });
    return obs.withHeaders(NextResponse.json({ error: "forbidden_role" }, { status: 403 }));
  }

  if (parsed.data.operation === "start" && !parsed.data.amount) {
    return validationFailedResponse(process.env.NODE_ENV === "production", {
      formErrors: [],
      fieldErrors: { amount: ["Required for start"] },
    });
  }

  if (
    (parsed.data.operation === "status" ||
      parsed.data.operation === "confirm" ||
      parsed.data.operation === "cancel") &&
    !parsed.data.external_transaction_id
  ) {
    return validationFailedResponse(process.env.NODE_ENV === "production", {
      formErrors: [],
      fieldErrors: { external_transaction_id: ["Required for status/confirm/cancel"] },
    });
  }

  const result = runTefOperation(parsed.data.operation, {
    clientMutationId: parsed.data.client_mutation_id,
    terminalId: parsed.data.terminal_id,
    externalTransactionId: parsed.data.external_transaction_id,
    intent:
      parsed.data.operation === "start" && parsed.data.amount
        ? {
            storeId: parsed.data.store_id,
            amount: parsed.data.amount,
            clientMutationId: parsed.data.client_mutation_id,
            terminalId: parsed.data.terminal_id,
            saleId: parsed.data.sale_id,
            orgId: auth.orgId,
          }
        : undefined,
  });

  try {
    assertTefResultNotFakePaid(result.status);
  } catch {
    observeApiResult(obs, "server_error", { error: "tef_illegal_paid_status" });
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
      method: "tef",
      operation: parsed.data.operation,
      message: result.message,
    };
    if (parsed.data.operation === "cancel") {
      const outcome = resolveTefExternalRefundOutcome();
      body.payment_refund_status = outcome.paymentRefundStatus;
      body.message = outcome.message;
    }
    observeApiResult(obs, "rejected", { error: "payment_method_not_configured" });
    return obs.withHeaders(NextResponse.json(body, { status: 422 }));
  }

  observeApiResult(obs, "ok", { status: result.status, operation: parsed.data.operation });
  return obs.withHeaders(NextResponse.json(result));
}
