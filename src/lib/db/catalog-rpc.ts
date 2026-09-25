import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";

type CatalogFunctions = {
  create_product: {
    Args: { p_store_id: string; p_payload: Json };
    Returns: Json;
  };
  update_product: {
    Args: { p_store_id: string; p_product_id: string; p_payload: Json };
    Returns: Json;
  };
};

type CatalogDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & CatalogFunctions;
  };
};

export function asCatalogClient(
  client: SupabaseClient<Database>
): SupabaseClient<CatalogDatabase> {
  return client as unknown as SupabaseClient<CatalogDatabase>;
}
