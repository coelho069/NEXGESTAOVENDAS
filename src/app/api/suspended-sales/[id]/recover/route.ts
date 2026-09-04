import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { recoverSuspendedSaleInputSchema } from "@/lib/validation/schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

  const parsed = recoverSuspendedSaleInputSchema.safeParse({
    ...(body && typeof body === "object" ? body : {}),
    suspended_sale_id: id,
  });
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

  const { data, error } = await supabase.rpc("recover_suspended_sale", {
    p_payload: {
      suspended_sale_id: id,
      store_id: parsed.data.store_id,
      terminal_id: parsed.data.terminal_id,
      recovery_client_mutation_id: parsed.data.recovery_client_mutation_id,
    },
  });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("forbidden") || message.includes("scope_mismatch")) {
      return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
    }
    if (message.includes("not_found")) {
      return NextResponse.json({ error: "suspended_sale_not_found" }, { status: 404 });
    }
    if (
      message.includes("claimed") ||
      message.includes("completed") ||
      message.includes("conflict")
    ) {
      return NextResponse.json({ error: "suspended_sale_conflict" }, { status: 409 });
    }
    if (error.code === "22023") {
      return NextResponse.json({ error: "suspended_sale_validation_failed" }, { status: 422 });
    }
    return NextResponse.json({ error: "suspended_sale_unavailable" }, { status: 503 });
  }

  return NextResponse.json(data);
}
