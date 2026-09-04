import { NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  cashActionSchema,
  cashSessionQuerySchema,
} from "@/lib/validation/schemas";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function mapCashError(error: { message?: string; code?: string }) {
  const message = error.message ?? "";
  if (message.includes("forbidden_cash")) {
    return errorResponse("forbidden_cash", 403);
  }
  if (
    message.includes("cash_session_already_open") ||
    message.includes("cash_idempotency_payload_mismatch") ||
    message.includes("cash_session_closed") ||
    message.includes("cash_sale_session_mismatch")
  ) {
    return errorResponse(
      message.includes("cash_idempotency_payload_mismatch")
        ? "cash_idempotency_payload_mismatch"
        : message.includes("cash_session_closed")
          ? "cash_session_closed"
          : "cash_session_conflict",
      409
    );
  }
  if (
    message.includes("invalid_cash") ||
    message.includes("cash_amount") ||
    message.includes("cash_negative")
  ) {
    return errorResponse("invalid_cash_operation", 422);
  }
  if (error.code === "23505") {
    return errorResponse("cash_session_conflict", 409);
  }
  return errorResponse("cash_operation_failed", 422);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = cashSessionQuerySchema.safeParse({
    store_id: url.searchParams.get("store_id"),
    terminal_id: url.searchParams.get("terminal_id"),
  });
  if (!parsed.success) {
    return errorResponse("invalid_cash_query", 400);
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role) {
    return errorResponse("forbidden_cash", 403);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_cash_session", {
    p_payload: parsed.data,
  });
  if (error) return mapCashError(error);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return errorResponse("invalid_json", 400);
  }

  const parsed = cashActionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_cash_payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role) {
    return errorResponse("forbidden_cash", 403);
  }

  const supabase = await createClient();
  const rpc =
    parsed.data.action === "open"
      ? "open_cash_session"
      : parsed.data.action === "movement"
        ? "record_cash_movement"
        : "close_cash_session";
  const { action: _action, ...payload } = parsed.data;
  void _action;
  const { data, error } = await supabase.rpc(rpc, {
    p_payload: payload,
  });
  if (error) return mapCashError(error);
  return NextResponse.json(data);
}
