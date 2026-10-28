import { getAuthedContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canEditCustomers, type MemberRole } from "@/lib/domain/rbac";
import type { StoreOption } from "@/lib/auth/store-context";

export type CustomerRow = {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  age: number | null;
};

export type CustomersLoadResult = {
  role: MemberRole | null;
  storeId: string | null;
  stores: StoreOption[];
  canEdit: boolean;
  rows: CustomerRow[];
  orgId: string | null;
};

export async function loadCustomers(params: { storeId?: string }): Promise<CustomersLoadResult> {
  const auth = await getAuthedContext(params.storeId);
  const stores = auth?.stores.map(({ id, name }) => ({ id, name })) ?? [];

  if (!auth?.orgId) {
    return { role: null, storeId: null, stores, canEdit: false, rows: [], orgId: null };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, document, phone, email, age")
      .eq("org_id", auth.orgId)
      .order("name");

    if (error) {
      return { role: auth.role, storeId: auth.storeId, stores, canEdit: canEditCustomers(auth.role), rows: [], orgId: auth.orgId };
    }

    return {
      role: auth.role,
      storeId: auth.storeId,
      stores,
      canEdit: canEditCustomers(auth.role),
      rows: (data ?? []) as CustomerRow[],
      orgId: auth.orgId,
    };
  } catch {
    return { role: auth.role, storeId: auth.storeId, stores, canEdit: canEditCustomers(auth.role), rows: [], orgId: auth.orgId };
  }
}
