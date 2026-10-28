import { NextResponse } from "next/server";
import { canViewReports, isClientRole } from "@/lib/domain/rbac";
import { loadDashboard } from "@/lib/server/dashboard-query";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { dashboardMetricsQuerySchema } from "@/lib/validation/schemas";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse, validationFailedResponse } from "@/lib/security/safe-error";
import { csvCell } from "@/lib/domain/csv-export";

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
    return validationFailedResponse(process.env.NODE_ENV === "production", parsed.error.flatten());
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.role || (!canViewReports(auth.role) && !isClientRole(auth.role))) {
    return NextResponse.json({ error: "forbidden_reports" }, { status: 403 });
  }

  const rate = consumeRateLimit({
    key: clientRateLimitKey(request, "dashboard-export", auth.userId),
    limit: 20,
    windowMs: 60_000,
  });
  if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSec);

  if (isClientRole(auth.role)) {
    const result = await loadDashboard({
      storeId: parsed.data.store_id,
      from: parsed.data.from,
      to: parsed.data.to,
      cursorSku: parsed.data.cursor_sku,
    });
    const rows = result.payload.rows;
    const csv = [
      [
        "sku",
        "product_name",
        "revenue",
        "discounts",
        "cogs",
        "gross_profit",
        "units_sold",
        "sell_through",
        "cogs_available",
      ].join(","),
      ...rows.map((row) =>
        [
          row.sku,
          row.product_name,
          row.revenue,
          row.discounts,
          row.cogs,
          row.gross_profit,
          row.units_sold,
          row.sell_through,
          row.cogs_available,
        ]
          .map(csvCell)
          .join(",")
      ),
    ].join("\r\n");

    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="dashboard-${parsed.data.from}-${parsed.data.to}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
    });
    if (typeof result.payload.next_cursor === "string") {
      headers.set("X-Next-Cursor", result.payload.next_cursor);
    }
    return new NextResponse(`${csv}\r\n`, { status: 200, headers });
  }

  try {
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
      return NextResponse.json({ error: "dashboard_unavailable" }, { status: 503 });
    }

    const payload = data as {
      rows?: Array<{
        sku?: string;
        product_name?: string;
        revenue?: string;
        discounts?: string;
        cogs?: string | null;
        gross_profit?: string | null;
        units_sold?: number;
        sell_through?: string | null;
        cogs_available?: boolean;
      }>;
      next_cursor?: string | null;
    };
    const rows = payload.rows ?? [];
    const csv = [
      [
        "sku",
        "product_name",
        "revenue",
        "discounts",
        "cogs",
        "gross_profit",
        "units_sold",
        "sell_through",
        "cogs_available",
      ].join(","),
      ...rows.map((row) =>
        [
          row.sku,
          row.product_name,
          row.revenue,
          row.discounts,
          row.cogs,
          row.gross_profit,
          row.units_sold,
          row.sell_through,
          row.cogs_available,
        ]
          .map(csvCell)
          .join(",")
      ),
    ].join("\r\n");

    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="dashboard-${parsed.data.from}-${parsed.data.to}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
    });
    if (typeof payload.next_cursor === "string") {
      headers.set("X-Next-Cursor", payload.next_cursor);
    }
    return new NextResponse(`${csv}\r\n`, { status: 200, headers });
  } catch {
    return NextResponse.json({ error: "dashboard_unavailable" }, { status: 503 });
  }
}
