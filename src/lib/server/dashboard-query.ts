import { canViewReports, type MemberRole } from "@/lib/domain/rbac";
import { EMPTY_DASHBOARD, type DashboardSummary } from "@/lib/domain/dashboard";
import { getAuthedContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type DashboardRow = {
  product_id: string;
  sku: string;
  product_name: string;
  revenue: string;
  cogs: string;
  gross_profit: string;
  units_sold: number;
  on_hand: number;
  sell_through: string;
};

export type DashboardPayload = {
  summary: DashboardSummary;
  rows: DashboardRow[];
  next_cursor: string | null;
  from: string;
  to: string;
};

export type DashboardLoadResult = {
  degraded: boolean;
  forbidden: boolean;
  role: MemberRole;
  payload: DashboardPayload;
  message: string | null;
};

function todaySaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export async function loadDashboard(params: {
  storeId: string;
  from?: string;
  to?: string;
  cursorSku?: string;
}): Promise<DashboardLoadResult> {
  const from = params.from ?? todaySaoPaulo();
  const to = params.to ?? from;
  const empty: DashboardPayload = {
    summary: EMPTY_DASHBOARD,
    rows: [],
    next_cursor: null,
    from,
    to,
  };

  const auth = await getAuthedContext();
  const role = auth?.role ?? "cashier";

  if (auth && !canViewReports(role)) {
    return { degraded: false, forbidden: true, role, payload: empty, message: "Caixa não pode ver relatórios." };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_dashboard_metrics", {
      p_payload: {
        store_id: params.storeId,
        from,
        to,
        cursor_sku: params.cursorSku,
        limit: 20,
      },
    });
    if (error) {
      return { degraded: true, forbidden: false, role, payload: empty, message: error.message };
    }
    const payload = data as DashboardPayload;
    return { degraded: false, forbidden: false, role, payload, message: null };
  } catch {
    return {
      degraded: true,
      forbidden: false,
      role,
      payload: empty,
      message: "Dashboard indisponível (servidor/Supabase). Estado degradado.",
    };
  }
}