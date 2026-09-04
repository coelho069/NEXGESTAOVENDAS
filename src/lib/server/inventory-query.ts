import { getAuthedContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DEMO_PRODUCTS, demoStockForStore } from "@/lib/domain/catalog";
import { parseUnitPrice } from "@/lib/domain/sale";
import { fixtureStoreOptions, pdvFixturesEnabled } from "@/lib/pdv/fixtures";
import type { MemberRole } from "@/lib/domain/rbac";
import { storeIdSchema } from "@/lib/validation/schemas";
import type { StoreOption } from "@/lib/auth/store-context";
import { toInventoryQuantity } from "@/lib/domain/quantity";

export type InventoryRow = {
  product_id: string;
  sku: string;
  name: string;
  is_active: boolean;
  unit_price: string;
  cost_price: string | null;
  quantity: string;
};

export type InventoryLoadResult = {
  degraded: boolean;
  role: MemberRole | null;
  storeId: string | null;
  stores: StoreOption[];
  canAdjust: boolean;
  rows: InventoryRow[];
  nextCursor: string | null;
  message: string | null;
};

export async function loadInventory(params: {
  storeId?: string;
  cursorSku?: string;
}): Promise<InventoryLoadResult> {
  const auth = await getAuthedContext(params.storeId);
  const fixtureMode = !auth && pdvFixturesEnabled();
  const stores = auth?.stores.map(({ id, name }) => ({ id, name })) ?? (fixtureMode ? fixtureStoreOptions() : []);
  const fixtureRequestedStoreIsValid =
    params.storeId === undefined ||
    (storeIdSchema.safeParse(params.storeId).success && stores.some((store) => store.id === params.storeId));
  const storeId = auth?.storeId
    ?? (fixtureMode && fixtureRequestedStoreIsValid
      ? params.storeId ?? stores[0]?.id ?? null
      : null);
  const role = auth?.role ?? (fixtureMode && storeId ? "cashier" : null);

  if (!storeId || !role) {
    return {
      degraded: false,
      role,
      storeId,
      stores,
      canAdjust: false,
      rows: [],
      nextCursor: null,
      message: auth?.stores.length ? "Selecione uma loja autorizada." : "Acesso à loja negado.",
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_inventory_page", {
      p_payload: {
        store_id: storeId,
        cursor_sku: params.cursorSku,
        limit: 20,
      },
    });
    if (error) {
      return {
        degraded: true,
        role,
        storeId,
        stores,
        canAdjust: false,
        rows: [],
        nextCursor: null,
        message: "Inventário indisponível.",
      };
    }
    const payload = data as { rows?: InventoryRow[]; next_cursor?: string | null; can_adjust?: boolean };
    return {
      degraded: false,
      role,
      storeId,
      stores,
      canAdjust: Boolean(payload.can_adjust),
      rows: payload.rows ?? [],
      nextCursor: payload.next_cursor ?? null,
      message: null,
    };
  } catch {
    if (!pdvFixturesEnabled()) {
      return {
        degraded: true,
        role,
        storeId,
        stores,
        canAdjust: false,
        rows: [],
        nextCursor: null,
        message: "Inventário indisponível.",
      };
    }

    const stock = demoStockForStore(storeId);
    return {
      degraded: true,
      role,
      storeId,
      stores,
      canAdjust: role === "admin" || role === "manager",
      rows: DEMO_PRODUCTS.map((product) => ({
        product_id: product.id,
        sku: product.sku,
        name: product.name,
        is_active: product.is_active,
        unit_price: parseUnitPrice(product.unit_price),
        cost_price: role === "cashier" ? null : "0.00",
        quantity: toInventoryQuantity(stock[product.id] ?? 0),
      })),
      nextCursor: null,
      message: "Inventário local de demonstração (Supabase indisponível).",
    };
  }
}