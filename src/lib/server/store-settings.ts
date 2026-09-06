import type { SupabaseClient } from "@supabase/supabase-js";
import {
  commercialFlagsFromSettings,
  evaluateSaleCommercialRules,
  type StoreCommercialFlags,
} from "@/lib/domain/store-settings";

type SettingsRpcRow = {
  settings?: Partial<StoreCommercialFlags> | null;
};

export type LoadStoreCommercialFlagsResult =
  | { ok: true; flags: StoreCommercialFlags; source: "row" | "defaults" }
  | { ok: false; error: "settings_unavailable"; message: string };

/**
 * Load commercial flags for a store.
 * - Row present → normalize booleans from the row.
 * - Row absent / empty settings → defaults (all false) = rules not configured.
 * - RPC/transport failure or malformed payload → fail-closed (ok: false).
 */
export async function loadStoreCommercialFlags(
  supabase: SupabaseClient,
  storeId: string
): Promise<LoadStoreCommercialFlagsResult> {
  const { data, error } = await supabase.rpc("get_store_settings", {
    p_payload: { store_id: storeId },
  });

  if (error) {
    return {
      ok: false,
      error: "settings_unavailable",
      message: error.message || "Falha ao carregar configurações comerciais da loja.",
    };
  }

  if (data == null) {
    return { ok: true, flags: commercialFlagsFromSettings(null), source: "defaults" };
  }

  if (typeof data !== "object" || Array.isArray(data)) {
    return {
      ok: false,
      error: "settings_unavailable",
      message: "Resposta inválida ao carregar configurações comerciais da loja.",
    };
  }

  const settings = (data as SettingsRpcRow).settings;
  if (settings == null) {
    return { ok: true, flags: commercialFlagsFromSettings(null), source: "defaults" };
  }

  if (typeof settings !== "object" || Array.isArray(settings)) {
    return {
      ok: false,
      error: "settings_unavailable",
      message: "Configurações comerciais da loja em formato inválido.",
    };
  }

  return {
    ok: true,
    flags: commercialFlagsFromSettings(settings),
    source: "row",
  };
}

export function rejectSaleByCommercialRules(input: {
  settings: StoreCommercialFlags;
  customerId: string | null | undefined;
  customerDocument?: string | null;
  cashSessionOpen: boolean;
}): { code: string; message: string } | null {
  const violation = evaluateSaleCommercialRules(input);
  if (!violation) return null;
  return { code: violation.code, message: violation.message };
}
