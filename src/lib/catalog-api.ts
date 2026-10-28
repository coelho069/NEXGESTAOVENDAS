import { filterActiveProducts, type ProductRow } from "@/lib/domain/product";

const DEFAULT_CACHE_TTL_MS = 60_000;

type CatalogCacheEntry = {
  fetchedAt: number;
  products: ProductRow[];
};

const catalogCache = new Map<string, CatalogCacheEntry>();
const pendingRequests = new Map<string, Promise<ProductRow[]>>();

// Cache é por escopo/loja (sem usuário: o navegador não tem JWT). Quem troca de sessão
// deve chamar clearProductsCache() (feito em useProducts no evento de auth).
function cacheKey(scopeKey: string, storeId: string | null): string {
  return `${scopeKey}:${storeId ?? "no-store"}`;
}

/** Busca produtos ativos pela API do servidor (sessão httpOnly). */
export async function requestCatalogProducts(): Promise<ProductRow[]> {
  const response = await fetch("/api/products", { cache: "no-store" });
  if (!response.ok) {
    throw Object.assign(new Error("catalog_read_failed"), { code: String(response.status) });
  }
  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("catalog_invalid_response");
  }
  return filterActiveProducts(data as ProductRow[]);
}

export async function fetchProducts(options?: {
  scopeKey?: string;
  cacheTtlMs?: number;
  storeId?: string | null;
}): Promise<ProductRow[]> {
  const scopeKey = options?.scopeKey ?? "default";
  const cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const storeId = options?.storeId ?? null;
  const key = cacheKey(scopeKey, storeId);
  const cached = catalogCache.get(key);

  if (cached && Date.now() - cached.fetchedAt < cacheTtlMs) {
    return cached.products;
  }

  const pending = pendingRequests.get(key);
  if (pending) return pending;

  const request = (async () => {
    const products = await requestCatalogProducts();
    catalogCache.set(key, { fetchedAt: Date.now(), products });
    return products;
  })();

  pendingRequests.set(key, request);

  try {
    return await request;
  } finally {
    pendingRequests.delete(key);
  }
}

export function clearProductsCache(scopeKey?: string): void {
  if (!scopeKey) {
    catalogCache.clear();
    return;
  }

  for (const key of catalogCache.keys()) {
    if (key.startsWith(`${scopeKey}:`)) catalogCache.delete(key);
  }
}
