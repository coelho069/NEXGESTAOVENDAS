import type { StoreSettingsResponse } from "@/lib/domain/store-settings";

const DEFAULT_CACHE_TTL_MS = 60_000;

type CacheEntry = {
  fetchedAt: number;
  data: StoreSettingsResponse;
};

const settingsCache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, Promise<StoreSettingsResponse>>();

function cacheKey(storeId: string): string {
  return storeId;
}

export async function fetchStoreSettings(
  storeId: string,
  options?: { cacheTtlMs?: number; force?: boolean }
): Promise<StoreSettingsResponse> {
  const cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const key = cacheKey(storeId);
  const cached = settingsCache.get(key);

  if (!options?.force && cached && Date.now() - cached.fetchedAt < cacheTtlMs) {
    return cached.data;
  }

  const pending = pendingRequests.get(key);
  if (pending && !options?.force) {
    return pending;
  }

  const request = (async () => {
    const params = new URLSearchParams({ store_id: storeId });
    const response = await fetch(`/api/settings?${params.toString()}`, {
      method: "GET",
      credentials: "same-origin",
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error
          : "Não foi possível carregar configurações";
      throw new Error(message);
    }
    const payload = body as StoreSettingsResponse;
    settingsCache.set(key, { fetchedAt: Date.now(), data: payload });
    return payload;
  })();

  pendingRequests.set(key, request);
  try {
    return await request;
  } finally {
    pendingRequests.delete(key);
  }
}

export function writeStoreSettingsCache(storeId: string, data: StoreSettingsResponse): void {
  settingsCache.set(cacheKey(storeId), { fetchedAt: Date.now(), data });
}

export function clearStoreSettingsCache(storeId?: string): void {
  if (!storeId) {
    settingsCache.clear();
    pendingRequests.clear();
    return;
  }
  settingsCache.delete(cacheKey(storeId));
  pendingRequests.delete(cacheKey(storeId));
}
