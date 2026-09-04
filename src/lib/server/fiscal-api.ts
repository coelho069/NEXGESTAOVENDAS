import { NextResponse } from "next/server";

export function fiscalRpcErrorResponse(error: { message: string }) {
  const message = error.message;
  if (message.includes("not_authenticated")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (message.includes("access_denied") || message.includes("forbidden")) {
    return NextResponse.json({ error: "fiscal_forbidden" }, { status: 403 });
  }
  if (message.includes("not_found")) {
    return NextResponse.json({ error: "fiscal_not_found" }, { status: 404 });
  }
  if (
    message.includes("operation_pending") ||
    message.includes("requires_issued") ||
    message.includes("reconciliation_required") ||
    message.includes("not_confirmed") ||
    message.includes("payment_not_confirmed") ||
    message.includes("status_transition")
  ) {
    return NextResponse.json({ error: "fiscal_operation_conflict" }, { status: 409 });
  }
  if (message.includes("invalid_") || message.includes("provider_mismatch")) {
    return NextResponse.json({ error: "invalid_fiscal_operation" }, { status: 400 });
  }
  return NextResponse.json({ error: "fiscal_operation_unavailable" }, { status: 503 });
}
