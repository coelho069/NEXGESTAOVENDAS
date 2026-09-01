export const MULTI_TAB_LOCK_NAME = "nex-pdv-multi-tab-sync";

export type MultiTabLockResult<T> =
  | { acquired: true; value: T }
  | { acquired: false; reason: "busy" };

export async function withMultiTabLock<T>(
  fn: () => Promise<T>,
  options?: { lockName?: string }
): Promise<MultiTabLockResult<T>> {
  const lockName = options?.lockName ?? MULTI_TAB_LOCK_NAME;
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;

  if (locks?.request) {
    let acquired = false;
    const value = await locks.request(lockName, { ifAvailable: true }, async (lock) => {
      if (!lock) return undefined;
      acquired = true;
      return fn();
    });
    if (!acquired) return { acquired: false, reason: "busy" };
    return { acquired: true, value: value as T };
  }

  return withLocalStorageLock(lockName, fn);
}

async function withLocalStorageLock<T>(lockName: string, fn: () => Promise<T>): Promise<MultiTabLockResult<T>> {
  if (typeof localStorage === "undefined") {
    return { acquired: true, value: await fn() };
  }

  const storageKey = `lock:${lockName}`;
  const now = Date.now();
  const existing = localStorage.getItem(storageKey);
  if (existing) {
    const parsed = Number(existing);
    if (Number.isFinite(parsed) && now - parsed < 15_000) {
      return { acquired: false, reason: "busy" };
    }
  }

  localStorage.setItem(storageKey, String(now));
  try {
    return { acquired: true, value: await fn() };
  } finally {
    localStorage.removeItem(storageKey);
  }
}
