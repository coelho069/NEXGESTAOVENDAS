import { NextResponse } from "next/server";
import {
  applyCorrelationHeaders,
  readCorrelationId,
} from "@/lib/observability/correlation";
import { createLogger, type StructuredLogger } from "@/lib/observability/logger";
import { incrementMetric } from "@/lib/observability/metrics";

export type RequestObservability = {
  correlationId: string;
  route: string;
  logger: StructuredLogger;
  withHeaders: (response: NextResponse) => NextResponse;
};

export function createRequestObservability(
  request: Request,
  route: string
): RequestObservability {
  const correlationId = readCorrelationId(request.headers);
  const logger = createLogger({
    service: "nexgestaovendas",
    correlationId,
    route,
    method: request.method,
  });

  return {
    correlationId,
    route,
    logger,
    withHeaders(response) {
      applyCorrelationHeaders(response.headers, correlationId);
      return response;
    },
  };
}

export function observeApiResult(
  obs: RequestObservability,
  outcome: "ok" | "client_error" | "server_error" | "rejected",
  fields?: Record<string, unknown>
): void {
  incrementMetric("api_requests", { route: obs.route, outcome });
  if (outcome === "server_error") {
    obs.logger.error("api_server_error", fields);
    return;
  }
  if (outcome === "rejected" || outcome === "client_error") {
    obs.logger.warn("api_rejected", { outcome, ...fields });
    return;
  }
  obs.logger.info("api_ok", fields);
}
