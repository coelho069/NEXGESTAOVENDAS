import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { saleHistoryDetailQuerySchema, storeIdSchema } from "@/lib/validation/schemas";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
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

  const { id } = await context.params;
  const storeId = new URL(request.url).searchParams.get("store_id");
  const parsed = saleHistoryDetailQuerySchema.safeParse({
    store_id: storeId,
    sale_id: id,
  });
  if (!parsed.success || !storeIdSchema.safeParse(storeId).success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error?.flatten() },
      { status: 400 }
    );
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  const { data, error } = await supabase.rpc("get_sale_detail", {
    p_payload: parsed.data,
  });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("forbidden")) {
      return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
    }
    if (message.includes("sale_not_found") || error.code === "P0002") {
      return NextResponse.json({ error: "sale_not_found" }, { status: 404 });
    }
    if (message.includes("invalid_sale_query") || error.code === "22023") {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }
    return NextResponse.json({ error: "sale_history_unavailable" }, { status: 503 });
  }

  return NextResponse.json(data);
}
