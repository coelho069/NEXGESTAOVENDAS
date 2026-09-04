import { NextResponse } from "next/server";

/**
 * Stable client-facing errors. Never forward stack traces, SQL, paths, or
 * provider secrets to the browser.
 */
export function safeJsonError(
  status: number,
  error: string,
  extras?: Record<string, unknown>
): NextResponse {
  return NextResponse.json(
    {
      error,
      ...(extras ?? {}),
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

export function validationFailedResponse(isProduction: boolean, flatten: unknown): NextResponse {
  if (isProduction) {
    return safeJsonError(400, "Validation failed");
  }
  return safeJsonError(400, "Validation failed", { details: flatten });
}

export function rateLimitedResponse(retryAfterSec: number): NextResponse {
  const response = safeJsonError(429, "rate_limited");
  response.headers.set("Retry-After", String(retryAfterSec));
  return response;
}
