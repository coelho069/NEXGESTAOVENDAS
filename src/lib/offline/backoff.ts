export const BACKOFF_SEQUENCE_SECONDS = [1, 2, 4, 8, 16] as const;
export const BACKOFF_CAP_SECONDS = 60;
export const MAX_TRANSIENT_FAILURES = 10;

export function backoffBaseSeconds(failureIndex: number): number {
  if (failureIndex < 0) return BACKOFF_SEQUENCE_SECONDS[0];
  if (failureIndex < BACKOFF_SEQUENCE_SECONDS.length) {
    return BACKOFF_SEQUENCE_SECONDS[failureIndex];
  }
  return Math.min(2 ** failureIndex, BACKOFF_CAP_SECONDS);
}

export function backoffDelayMs(failureIndex: number, random: () => number = Math.random): number {
  const base = backoffBaseSeconds(failureIndex);
  const jitterMultiplier = 0.5 + random() * 0.5;
  const seconds = Math.min(base * jitterMultiplier, BACKOFF_CAP_SECONDS);
  return seconds * 1000;
}

export function shouldMarkOutboxFailed(attemptCount: number): boolean {
  return attemptCount >= MAX_TRANSIENT_FAILURES;
}
