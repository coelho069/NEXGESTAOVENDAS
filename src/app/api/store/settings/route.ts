import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { storeIdSchema } from "@/lib/validation/schemas";
import { DEFAULT_STORE_SALE_POLICY } from "@/lib/domain/store-sale-policy";
import { loadStoreSalePolicy } from "@/lib/server/store-sale-policy";

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
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storeId = new URL(request.url).searchParams.get("store_id");
  const parsedStoreId = storeIdSchema.safeParse(storeId);
  if (!parsedStoreId.success) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  const auth = await getAuthedContext(parsedStoreId.data);
  if (!auth?.orgId || !auth.role) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  const policy = await loadStoreSalePolicy(supabase, parsedStoreId.data);
  return NextResponse.json({
    store_id: parsedStoreId.data,
    require_customer_on_sale: policy.requireCustomerOnSale,
    require_customer_document: policy.requireCustomerDocument,
    require_open_cash_session: policy.requireOpenCashSession,
    defaults: DEFAULT_STORE_SALE_POLICY,
  });
}
