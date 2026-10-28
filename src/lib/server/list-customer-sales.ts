import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomerSalesResponse } from "@/lib/domain/customer-sales";

type ListCustomerSalesInput = {
  customerId: string;
  orgId: string;
  limit: number;
  afterCreatedAt?: string;
  afterId?: string;
};

function asMoney2(value: unknown): string {
  if (typeof value === "string" && /^\d+\.\d{2}$/.test(value)) return value;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

function isRpcMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "PGRST202" ||
    message.includes("Could not find the function") ||
    message.includes("schema cache")
  );
}

/**
 * Prefer the SECURITY DEFINER RPC when present; fall back to RLS-scoped
 * table queries when the migration was never applied to the cloud project.
 */
export async function listCustomerSales(
  supabase: SupabaseClient,
  input: ListCustomerSalesInput
): Promise<
  | { ok: true; data: CustomerSalesResponse }
  | { ok: false; error: string; status: number; detail?: string }
> {
  const payload = {
    customer_id: input.customerId,
    limit: input.limit,
    ...(input.afterCreatedAt && input.afterId
      ? { after_created_at: input.afterCreatedAt, after_id: input.afterId }
      : {}),
  };

  const { data, error } = await supabase.rpc("list_customer_sales", {
    p_payload: payload,
  });

  if (!error) {
    return { ok: true, data: data as CustomerSalesResponse };
  }

  const message = error.message ?? "";
  if (message.includes("customer_not_found") || error.code === "P0002") {
    return { ok: false, error: "customer_not_found", status: 404, detail: message };
  }
  if (message.includes("forbidden")) {
    return { ok: false, error: "forbidden_customers", status: 403, detail: message };
  }
  if (message.includes("invalid_customer_sales_query") || error.code === "22023") {
    return { ok: false, error: "Validation failed", status: 400, detail: message };
  }

  if (!isRpcMissing(error)) {
    return {
      ok: false,
      error: "customer_sales_unavailable",
      status: 503,
      detail: `${error.code ?? ""} ${message}`.trim(),
    };
  }

  return listCustomerSalesFallback(supabase, input);
}

async function listCustomerSalesFallback(
  supabase: SupabaseClient,
  input: ListCustomerSalesInput
): Promise<
  | { ok: true; data: CustomerSalesResponse }
  | { ok: false; error: string; status: number; detail?: string }
> {
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id, name")
    .eq("id", input.customerId)
    .eq("org_id", input.orgId)
    .maybeSingle();

  if (customerError) {
    return {
      ok: false,
      error: "customer_sales_unavailable",
      status: 503,
      detail: customerError.message,
    };
  }
  if (!customer) {
    return { ok: false, error: "customer_not_found", status: 404 };
  }

  let salesQuery = supabase
    .from("sales")
    .select(
      "id, store_id, status, sync_status, total, discount, subtotal, cashier_id, created_at, confirmed_at, customer_id"
    )
    .eq("customer_id", input.customerId)
    .eq("org_id", input.orgId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(input.limit + 1);

  if (input.afterCreatedAt && input.afterId) {
    salesQuery = salesQuery.or(
      `created_at.lt.${input.afterCreatedAt},and(created_at.eq.${input.afterCreatedAt},id.lt.${input.afterId})`
    );
  }

  const { data: salesRows, error: salesError } = await salesQuery;
  if (salesError) {
    return {
      ok: false,
      error: "customer_sales_unavailable",
      status: 503,
      detail: salesError.message,
    };
  }

  const rowsRaw = salesRows ?? [];
  const hasMore = rowsRaw.length > input.limit;
  const page = hasMore ? rowsRaw.slice(0, input.limit) : rowsRaw;

  const storeIds = [...new Set(page.map((row) => row.store_id).filter(Boolean))];
  const cashierIds = [...new Set(page.map((row) => row.cashier_id).filter(Boolean))];
  const saleIds = page.map((row) => row.id);

  const storeNameById = new Map<string, string | null>();
  if (storeIds.length > 0) {
    const { data: stores } = await supabase.from("stores").select("id, name").in("id", storeIds);
    for (const store of stores ?? []) {
      storeNameById.set(store.id, typeof store.name === "string" ? store.name : null);
    }
  }

  const operatorNameById = new Map<string, string | null>();
  if (cashierIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", cashierIds);
    for (const profile of profiles ?? []) {
      operatorNameById.set(
        profile.id,
        typeof profile.full_name === "string" ? profile.full_name : null
      );
    }
  }

  const paymentBySaleId = new Map<string, { method: string | null; status: string | null }>();
  if (saleIds.length > 0) {
    const { data: payments } = await supabase
      .from("payments")
      .select("id, sale_id, method, status, created_at")
      .in("sale_id", saleIds)
      .eq("org_id", input.orgId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    for (const payment of payments ?? []) {
      if (!paymentBySaleId.has(payment.sale_id)) {
        paymentBySaleId.set(payment.sale_id, {
          method: typeof payment.method === "string" ? payment.method : null,
          status: typeof payment.status === "string" ? payment.status : null,
        });
      }
    }
  }

  const { data: confirmedSales, error: confirmedError } = await supabase
    .from("sales")
    .select("id, total, created_at")
    .eq("customer_id", input.customerId)
    .eq("org_id", input.orgId)
    .eq("status", "confirmed");

  if (confirmedError) {
    return {
      ok: false,
      error: "customer_sales_unavailable",
      status: 503,
      detail: confirmedError.message,
    };
  }

  let lifetimeRevenue = 0;
  let salesCount = 0;
  let lastSaleAt: string | null = null;
  const confirmed = confirmedSales ?? [];
  if (confirmed.length > 0) {
    const confirmedIds = confirmed.map((row) => row.id);
    const { data: capturedPayments } = await supabase
      .from("payments")
      .select("sale_id, amount, status")
      .in("sale_id", confirmedIds)
      .eq("org_id", input.orgId)
      .eq("status", "captured");

    const eligibleSaleIds = new Set<string>();
    for (const payment of capturedPayments ?? []) {
      const amount = Number(payment.amount);
      if (!Number.isFinite(amount)) continue;
      const sale = confirmed.find((row) => row.id === payment.sale_id);
      if (!sale) continue;
      const total = Number(sale.total);
      if (!Number.isFinite(total)) continue;
      if (amount === total) eligibleSaleIds.add(sale.id);
    }

    for (const sale of confirmed) {
      if (!eligibleSaleIds.has(sale.id)) continue;
      const total = Number(sale.total);
      if (!Number.isFinite(total)) continue;
      lifetimeRevenue += total;
      salesCount += 1;
      if (!lastSaleAt || sale.created_at > lastSaleAt) {
        lastSaleAt = sale.created_at;
      }
    }
  }

  const customerName = typeof customer.name === "string" ? customer.name : null;
  const rows = page.map((sale) => {
    const payment = paymentBySaleId.get(sale.id);
    return {
      sale_id: sale.id,
      store_id: sale.store_id,
      store_name: storeNameById.get(sale.store_id) ?? null,
      status: String(sale.status),
      sync_status: String(sale.sync_status),
      total: asMoney2(sale.total),
      discount: asMoney2(sale.discount),
      subtotal: asMoney2(sale.subtotal),
      customer_name: customerName,
      cashier_id: sale.cashier_id ?? null,
      operator_name: sale.cashier_id ? operatorNameById.get(sale.cashier_id) ?? null : null,
      payment_method: payment?.method ?? null,
      payment_status: payment?.status ?? null,
      created_at: sale.created_at,
      confirmed_at: sale.confirmed_at ?? null,
    };
  });

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? { after_created_at: last.created_at, after_id: last.id }
      : null;

  return {
    ok: true,
    data: {
      summary: {
        lifetime_revenue: asMoney2(lifetimeRevenue),
        sales_count: salesCount,
        last_sale_at: lastSaleAt,
      },
      rows,
      has_more: hasMore,
      next_cursor: nextCursor,
    },
  };
}
