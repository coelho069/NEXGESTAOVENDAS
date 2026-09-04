import { createClient } from "@/lib/supabase";
import { filterActiveProducts, type ProductRow } from "@/lib/domain/product";

const DEFAULT_CACHE_TTL_MS = 60_000;

type CatalogCacheEntry = {
  fetchedAt: number;
  products: ProductRow[];
};

const catalogCache = new Map<string, CatalogCacheEntry>();
const pendingRequests = new Map<string, Promise<ProductRow[]>>();

function cacheKey(userId: string | null, scopeKey: string, storeId: string | null): string {
  return `${userId ?? "anonymous"}:${scopeKey}:${storeId ?? "no-store"}`;
}

export async function fetchProducts(options?: {
  scopeKey?: string;
  cacheTtlMs?: number;
  storeId?: string | null;
}): Promise<ProductRow[]> {
  const scopeKey = options?.scopeKey ?? "default";
  const cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const storeId = options?.storeId ?? null;
  const supabase = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  const key = cacheKey(user?.id ?? null, scopeKey, storeId);
  const cached = catalogCache.get(key);

  // Do not reuse data when the auth identity could not be resolved. This
  // prevents a transient auth failure from serving another user's catalog.
  if (!authError && cached && Date.now() - cached.fetchedAt < cacheTtlMs) {
    return cached.products;
  }

  if (!authError) {
    const pending = pendingRequests.get(key);
    if (pending) return pending;
  }

  const request = (async () => {
    const { data, error } = await supabase
      .from("products")
      .select("id, sku, name, unit_price, barcode, category_id, is_active")
      .eq("is_active", true)
      .order("name");

    if (error) throw error;

    const products = filterActiveProducts((data ?? []) as ProductRow[]);
    if (!authError) {
      catalogCache.set(key, { fetchedAt: Date.now(), products });
    }
    return products;
  })();

  if (!authError) pendingRequests.set(key, request);

  try {
    return await request;
  } finally {
    if (!authError) pendingRequests.delete(key);
  }
}

export function clearProductsCache(scopeKey?: string): void {
  if (!scopeKey) {
    catalogCache.clear();
    return;
  }

  for (const key of catalogCache.keys()) {
    if (key.includes(`:${scopeKey}:`)) catalogCache.delete(key);
  }
}
