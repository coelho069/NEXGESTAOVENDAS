import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import {
  DEFAULT_STORE_SALE_POLICY,
  parseStoreSalePolicy,
  type StoreSalePolicy,
} from "@/lib/domain/store-sale-policy";

type SettingsClient = {
  rpc: (
    fn: string,
    args: { p_payload: { store_id: string } }
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

export async function loadStoreSalePolicy(
  supabase: SupabaseClient<Database>,
  storeId: string
): Promise<StoreSalePolicy> {
  const client = supabase as unknown as SettingsClient;
  try {
    const { data, error } = await client.rpc("get_store_settings", {
      p_payload: { store_id: storeId },
    });
    if (error || !data) {
      return DEFAULT_STORE_SALE_POLICY;
    }
    return parseStoreSalePolicy(data);
  } catch {
    return DEFAULT_STORE_SALE_POLICY;
  }
}
