import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { processFiscalOutbox } from "@/lib/server/fiscal-outbox";
import { fiscalWorkerInputSchema } from "@/lib/validation/schemas";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse, validationFailedResponse } from "@/lib/security/safe-error";
import {
  createRequestObservability,
  observeApiResult,
} from "@/lib/observability/request-context";

export async function POST(request: Request) {
  const obs = createRequestObservability(request, "fiscal.outbox.process");
  const configuredSecret = process.env.FISCAL_WORKER_SECRET?.trim();
  if (!configuredSecret || configuredSecret.length < 32) {
    observeApiResult(obs, "server_error", { error: "fiscal_worker_not_configured" });
    return obs.withHeaders(
      NextResponse.json({ error: "fiscal_worker_not_configured" }, { status: 503 })
    );
  }

  const suppliedSecret = request.headers.get("x-fiscal-worker-secret") ?? "";
  if (!safeSecretEqual(configuredSecret, suppliedSecret)) {
    // Bound secret-guessing without trusting client IP headers.
    const denied = consumeRateLimit({
      key: clientRateLimitKey(request, "fiscal-worker-auth"),
      limit: 20,
      windowMs: 60_000,
    });
    if (!denied.allowed) {
      return obs.withHeaders(rateLimitedResponse(denied.retryAfterSec));
    }
    observeApiResult(obs, "rejected", { error: "Unauthorized" });
    return obs.withHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const rate = consumeRateLimit({
    key: clientRateLimitKey(request, "fiscal-worker", "worker"),
    limit: 30,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return obs.withHeaders(rateLimitedResponse(rate.retryAfterSec));
  }

  let json: unknown = {};
  try {
    json = await request.json();
  } catch {
    json = {};
  }
  const parsed = fiscalWorkerInputSchema.safeParse(json);
  if (!parsed.success) {
    return obs.withHeaders(
      validationFailedResponse(process.env.NODE_ENV === "production", parsed.error.flatten())
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    observeApiResult(obs, "server_error", { error: "fiscal_worker_not_configured" });
    return obs.withHeaders(
      NextResponse.json({ error: "fiscal_worker_not_configured" }, { status: 503 })
    );
  }

  try {
    const summary = await processFiscalOutbox(admin, {
      limit: parsed.data.limit,
      fiscalDocumentId: parsed.data.fiscal_document_id,
    });
    observeApiResult(obs, "ok", {
      claimed: summary.claimed,
      completed: summary.completed,
      failed: summary.failed,
      unknown: summary.unknown,
    });
    return obs.withHeaders(NextResponse.json(summary));
  } catch {
    observeApiResult(obs, "server_error", { error: "fiscal_worker_unavailable" });
    return obs.withHeaders(
      NextResponse.json({ error: "fiscal_worker_unavailable" }, { status: 503 })
    );
  }
}

function safeSecretEqual(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}
