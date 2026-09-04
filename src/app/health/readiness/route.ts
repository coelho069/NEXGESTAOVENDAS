import { NextResponse } from "next/server";
import { checkReadiness } from "@/lib/observability/health";
import { readCorrelationId, applyCorrelationHeaders } from "@/lib/observability/correlation";
import { rootLogger } from "@/lib/observability/logger";
import { incrementMetric } from "@/lib/observability/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const correlationId = readCorrelationId(request.headers);
  const logger = rootLogger.child({ correlationId, route: "health.readiness" });
  const body = await checkReadiness();
  const status = body.status === "ready" ? 200 : 503;
  incrementMetric("health_readiness_checks", { status: body.status });
  if (body.status !== "ready") {
    logger.warn("readiness_not_ready", { checks: body.checks });
  }
  const response = NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
  applyCorrelationHeaders(response.headers, correlationId);
  return response;
}
