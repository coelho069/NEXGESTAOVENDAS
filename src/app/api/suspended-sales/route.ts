import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import {
  suspendSaleInputSchema,
  suspendedSaleListQuerySchema,
} from "@/lib/validation/schemas";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = suspendedSaleListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  const { data, error } = await supabase.rpc("list_suspended_sales", {
    p_payload: parsed.data,
  });
  if (error) return suspendedSaleError(error);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = suspendSaleInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  const { data, error } = await supabase.rpc("suspend_sale", {
    p_payload: parsed.data,
  });
  if (error) return suspendedSaleError(error);
  return NextResponse.json(data, { status: 201 });
}

function suspendedSaleError(error: { message?: string; code?: string }) {
  const message = error.message ?? "";
  if (message.includes("forbidden") || message.includes("scope_mismatch")) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }
  if (message.includes("not_found")) {
    return NextResponse.json({ error: "suspended_sale_not_found" }, { status: 404 });
  }
  if (
    message.includes("idempotency_payload_mismatch") ||
    message.includes("claimed") ||
    message.includes("completed") ||
    message.includes("claim_conflict") ||
    message.includes("snapshot_conflict") ||
    message.includes("completion_race")
  ) {
    return NextResponse.json(
      {
        error: message.includes("idempotency")
          ? "idempotency_payload_mismatch"
          : "suspended_sale_conflict",
      },
      { status: 409 }
    );
  }
  if (error.code === "22023" || error.code === "23514") {
    return NextResponse.json({ error: "suspended_sale_validation_failed" }, { status: 422 });
  }
  return NextResponse.json({ error: "suspended_sale_unavailable" }, { status: 503 });
}
