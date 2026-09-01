export const QUOTA_EXCEEDED_CODE = "QUOTA_EXCEEDED" as const;

export class IndexedDbQuotaError extends Error {
  readonly code = QUOTA_EXCEEDED_CODE;
  override readonly name = "QuotaExceededError";

  constructor(message = "IndexedDB quota exceeded") {
    super(message);
  }
}

export function isQuotaExceededError(error: unknown): boolean {
  if (error instanceof IndexedDbQuotaError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; code?: string | number; message?: string };
  if (candidate.name === "QuotaExceededError") return true;
  if (candidate.code === 22 || candidate.code === QUOTA_EXCEEDED_CODE) return true;
  return typeof candidate.message === "string" && /quota/i.test(candidate.message);
}

export function rethrowIfQuotaExceeded(error: unknown): never {
  if (isQuotaExceededError(error)) {
    throw new IndexedDbQuotaError(
      error instanceof Error ? error.message : "IndexedDB quota exceeded"
    );
  }
  throw error;
}
