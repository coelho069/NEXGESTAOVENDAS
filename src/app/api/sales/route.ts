import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { saleHistoryListQuerySchema } from "@/lib/validation/schemas";

export async function GET(request: Request) {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = saleHistoryListQuerySchema.safeParse(
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

  const { data, error } = await supabase.rpc("list_sales", {
    p_payload: parsed.data,
  });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("forbidden")) {
      return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
    }
    if (message.includes("invalid_sale_query") || error.code === "22023") {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }
    return NextResponse.json({ error: "sale_history_unavailable" }, { status: 503 });
  }

  return NextResponse.json(data);
}
