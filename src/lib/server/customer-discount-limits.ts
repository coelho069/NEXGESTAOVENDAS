import { createClient } from "@supabase/supabase-js";

const BUCKET = "nex-app-data";

export type CustomerDiscountLimitMap = Record<string, string>;

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function objectPath(orgId: string): string {
  return `orgs/${orgId}/customer-discount-limits.json`;
}

function asMoney2(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value.toFixed(2);
  }
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
    if (!normalized) return null;
    const n = Number(normalized);
    if (!Number.isFinite(n) || n < 0) return null;
    return n.toFixed(2);
  }
  return null;
}

export async function loadCustomerDiscountLimits(orgId: string): Promise<CustomerDiscountLimitMap> {
  const supabase = adminClient();
  if (!supabase) return {};
  const { data, error } = await supabase.storage.from(BUCKET).download(objectPath(orgId));
  if (error || !data) return {};
  try {
    const raw = JSON.parse(await data.text()) as unknown;
    if (!raw || typeof raw !== "object") return {};
    const out: CustomerDiscountLimitMap = {};
    for (const [customerId, value] of Object.entries(raw as Record<string, unknown>)) {
      const money = asMoney2(value);
      if (money != null) out[customerId] = money;
    }
    return out;
  } catch {
    return {};
  }
}

export async function saveCustomerDiscountLimit(
  orgId: string,
  customerId: string,
  discountLimit: string | null
): Promise<void> {
  const supabase = adminClient();
  if (!supabase) return;
  const current = await loadCustomerDiscountLimits(orgId);
  if (discountLimit == null || discountLimit === "") {
    delete current[customerId];
  } else {
    const money = asMoney2(discountLimit);
    if (money == null) return;
    current[customerId] = money;
  }
  const body = JSON.stringify(current);
  const { error } = await supabase.storage.from(BUCKET).upload(objectPath(orgId), body, {
    contentType: "application/json",
    upsert: true,
  });
  if (error) {
    console.error("customer_discount_limit_save_failed", error.message);
  }
}

export function suggestDiscountLimitFromHistory(lifetimeRevenue: string, salesCount: number): string | null {
  const total = Number(lifetimeRevenue);
  if (!Number.isFinite(total) || total <= 0 || salesCount <= 0) return null;
  // Sugestão: 5% do histórico, arredondado, piso R$ 5 e teto R$ 500
  const suggested = Math.min(500, Math.max(5, Math.round(total * 0.05)));
  return suggested.toFixed(2);
}
