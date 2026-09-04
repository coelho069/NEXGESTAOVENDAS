import { NextResponse } from "next/server";
import { buildLiveness } from "@/lib/observability/health";
import { readCorrelationId, applyCorrelationHeaders } from "@/lib/observability/correlation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const correlationId = readCorrelationId(request.headers);
  const body = buildLiveness();
  const response = NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
  applyCorrelationHeaders(response.headers, correlationId);
  return response;
}
