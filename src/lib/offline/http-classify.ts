export type SyncHttpClass = "success" | "end_session" | "transient" | "conflict" | "fatal";

export function classifySyncHttpStatus(status: number): SyncHttpClass {
  if (status >= 200 && status < 300) return "success";
  if (status === 401) return "end_session";
  if (status === 408 || status === 429 || (status >= 500 && status <= 599)) return "transient";
  if (status === 409 || status === 422) return "conflict";
  return "fatal";
}

export function classifyFetchFailure(error: unknown, status?: number): SyncHttpClass {
  if (typeof status === "number") return classifySyncHttpStatus(status);
  if (isTimeoutError(error)) return "transient";
  return "transient";
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; code?: string };
  return candidate.name === "TimeoutError" || candidate.name === "AbortError" || candidate.code === "ETIMEDOUT";
}
