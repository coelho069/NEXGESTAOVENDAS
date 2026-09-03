export const MULTI_TAB_LOCK_TTL_MS = 15_000;
export const MULTI_TAB_LOCK_HEARTBEAT_MS = 5_000;

export type MultiTabLockOptions = {
  lockName: string;
  ttlMs?: number;
  heartbeatMs?: number;
};

export type MultiTabLockResult<T> =
  | { acquired: true; value: T }
  | { acquired: false; reason: "busy" };

export async function withMultiTabLock<T>(
  fn: () => Promise<T>,
  options: MultiTabLockOptions
): Promise<MultiTabLockResult<T>> {
  const lockName = options.lockName;
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

  return withLocalStorageLock(lockName, fn, options);
}

type LocalLockRecord = {
  owner: string;
  expiresAt: number;
};

async function withLocalStorageLock<T>(
  lockName: string,
  fn: () => Promise<T>,
  options?: MultiTabLockOptions
): Promise<MultiTabLockResult<T>> {
  if (typeof localStorage === "undefined") {
    return { acquired: true, value: await fn() };
  }

  const storageKey = `lock:${lockName}`;
  const now = Date.now();
  const ttlMs = Math.max(1, options?.ttlMs ?? MULTI_TAB_LOCK_TTL_MS);
  const heartbeatMs = Math.max(
    1,
    Math.min(options?.heartbeatMs ?? MULTI_TAB_LOCK_HEARTBEAT_MS, Math.floor(ttlMs / 2))
  );
  const existing = parseLockRecord(localStorage.getItem(storageKey));
  if (existing && existing.expiresAt > now) {
    return { acquired: false, reason: "busy" };
  }

  const owner = createLockOwner();
  const writeLease = () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ owner, expiresAt: Date.now() + ttlMs } satisfies LocalLockRecord)
    );
  };
  writeLease();
  if (parseLockRecord(localStorage.getItem(storageKey))?.owner !== owner) {
    return { acquired: false, reason: "busy" };
  }

  let leaseLost = false;
  const heartbeat = setInterval(() => {
    const current = parseLockRecord(localStorage.getItem(storageKey));
    if (current?.owner !== owner) {
      leaseLost = true;
      return;
    }
    writeLease();
  }, heartbeatMs);

  try {
    const value = await fn();
    if (leaseLost) {
      throw new Error(`Multi-tab lock lease lost: ${lockName}`);
    }
    return { acquired: true, value };
  } finally {
    clearInterval(heartbeat);
    if (parseLockRecord(localStorage.getItem(storageKey))?.owner === owner) {
      localStorage.removeItem(storageKey);
    }
  }
}

function createLockOwner(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseLockRecord(value: string | null): LocalLockRecord | null {
  if (!value) return null;
  const legacyTimestamp = Number(value);
  if (Number.isFinite(legacyTimestamp)) {
    return { owner: "legacy", expiresAt: legacyTimestamp + MULTI_TAB_LOCK_TTL_MS };
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as LocalLockRecord).owner === "string" &&
      Number.isFinite((parsed as LocalLockRecord).expiresAt)
    ) {
      return parsed as LocalLockRecord;
    }
  } catch {
    return null;
  }
  return null;
}
