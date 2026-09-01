import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dashboardMetricsQuerySchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";
import { canViewReports } from "@/lib/domain/rbac";

export async function GET(request: Request) {
  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canViewReports(auth.role)) {
    return NextResponse.json({ error: "forbidden_reports" }, { status: 403 });
  }

  const url = new URL(request.url);
  const parsed = dashboardMetricsQuerySchema.safeParse({
    store_id: url.searchParams.get("store_id") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    cursor_sku: url.searchParams.get("cursor_sku") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_dashboard_metrics", {
    p_payload: {
      store_id: parsed.data.store_id,
      from: parsed.data.from,
      to: parsed.data.to,
      cursor_sku: parsed.data.cursor_sku,
      limit: parsed.data.limit,
    },
  });

  if (error) {
    const status = error.message.includes("forbidden") ? 403 : 422;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json(data);
}