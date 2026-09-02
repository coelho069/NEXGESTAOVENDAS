import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dashboardMetricsQuerySchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";
import { canViewReports } from "@/lib/domain/rbac";

export async function GET(request: Request) {
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

  const auth = await getAuthedContext(parsed.data.store_id);
  const role = auth?.role;
  if (!role || !canViewReports(role)) {
    return NextResponse.json({ error: "forbidden_reports" }, { status: 403 });
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
    return NextResponse.json({ error: status === 403 ? "forbidden_reports" : "dashboard_unavailable" }, { status });
  }

  return NextResponse.json(data);
}