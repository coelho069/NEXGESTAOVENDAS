import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { assertPixResultNotFakePaid } from "@/lib/domain/payment";
import { runPixOperation } from "@/lib/server/pix-operations";
import { storeIdSchema } from "@/lib/validation/schemas";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse, validationFailedResponse } from "@/lib/security/safe-error";
import {
  createRequestObservability,
  observeApiResult,
} from "@/lib/observability/request-context";

const pixChargeSchema = z.object({
  store_id: storeIdSchema,
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  client_mutation_id: z.string().uuid(),
  sale_id: z.string().uuid().optional(),
});

/**
 * Server-authoritative PIX charge entrypoint.
 * Never trusts client-provided payment status/provider.
 * With no live provider, always returns payment_method_not_configured (422).
 * Idempotency: retries with the same client_mutation_id do not create charges
 * while the provider is not_configured (no side effects / no paid rows).
 */
export async function POST(request: Request) {
  const obs = createRequestObservability(request, "payments.pix.charge");
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
    key: clientRateLimitKey(request, "pix-charge", user.id),
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

  const parsed = pixChargeSchema.safeParse(json);
  if (!parsed.success) {
    return validationFailedResponse(process.env.NODE_ENV === "production", parsed.error.flatten());
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role) {
    observeApiResult(obs, "rejected", { error: "forbidden_store" });
    return obs.withHeaders(NextResponse.json({ error: "forbidden_store" }, { status: 403 }));
  }

  // Amount/method/status from the client are not trusted as payment outcome.
  const result = runPixOperation("create_charge", {
    intent: {
      storeId: parsed.data.store_id,
      amount: parsed.data.amount,
      clientMutationId: parsed.data.client_mutation_id,
      saleId: parsed.data.sale_id,
      orgId: auth.orgId,
    },
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
    observeApiResult(obs, "rejected", { error: "payment_method_not_configured" });
    return obs.withHeaders(
      NextResponse.json(
        {
          error: "payment_method_not_configured",
          adapter_status: "not_configured",
          provider: result.provider,
          message: result.message,
        },
        { status: 422 }
      )
    );
  }

  observeApiResult(obs, "ok", { status: result.status });
  return obs.withHeaders(NextResponse.json(result));
}
