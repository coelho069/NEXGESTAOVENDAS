import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { assertPixResultNotFakePaid, resolvePixExternalRefundOutcome } from "@/lib/domain/payment";
import { runPixOperation } from "@/lib/server/pix-operations";
import { storeIdSchema } from "@/lib/validation/schemas";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse, validationFailedResponse } from "@/lib/security/safe-error";
import {
  createRequestObservability,
  observeApiResult,
} from "@/lib/observability/request-context";

const pixRefundSchema = z.object({
  store_id: storeIdSchema,
  external_reference: z.string().min(1).max(200),
  client_mutation_id: z.string().uuid(),
});

/**
 * Server-authoritative PIX refund entrypoint (B18 compatibility).
 * Without a live provider: not_configured + pending_external — never invents cash-out.
 */
export async function POST(request: Request) {
  const obs = createRequestObservability(request, "payments.pix.refund");
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
    key: clientRateLimitKey(request, "pix-refund", user.id),
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

  const parsed = pixRefundSchema.safeParse(json);
  if (!parsed.success) {
    return validationFailedResponse(process.env.NODE_ENV === "production", parsed.error.flatten());
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role) {
    observeApiResult(obs, "rejected", { error: "forbidden_store" });
    return obs.withHeaders(NextResponse.json({ error: "forbidden_store" }, { status: 403 }));
  }

  // Manager/admin cancel-return path; cashiers should use B18 cash flows only.
  if (auth.role === "cashier") {
    observeApiResult(obs, "rejected", { error: "forbidden_role" });
    return obs.withHeaders(NextResponse.json({ error: "forbidden_role" }, { status: 403 }));
  }

  const result = runPixOperation("refund", {
    externalReference: parsed.data.external_reference,
    clientMutationId: parsed.data.client_mutation_id,
  });

  try {
    assertPixResultNotFakePaid(result.status);
  } catch {
    observeApiResult(obs, "server_error", { error: "pix_illegal_paid_status" });
    return obs.withHeaders(
      NextResponse.json(
        { error: "payment_method_not_configured", adapter_status: "not_configured" },
        { status: 422 }
      )
    );
  }

  if (result.status === "not_configured") {
    const outcome = resolvePixExternalRefundOutcome();
    observeApiResult(obs, "rejected", { error: "payment_method_not_configured" });
    return obs.withHeaders(
      NextResponse.json(
        {
          error: "payment_method_not_configured",
          adapter_status: "not_configured",
          provider: result.provider,
          payment_refund_status: outcome.paymentRefundStatus,
          message: outcome.message,
        },
        { status: 422 }
      )
    );
  }

  observeApiResult(obs, "ok", { status: result.status });
  return obs.withHeaders(NextResponse.json(result));
}
