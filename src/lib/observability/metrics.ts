type CounterKey = string;

const counters = new Map<CounterKey, number>();
/** Absolute gauges (outbox/offline observations). Last write wins per key. */
const gauges = new Map<CounterKey, number>();

function labelKey(name: string, labels: Record<string, string> = {}): CounterKey {
  return `${name}|${Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;
}

export function incrementMetric(name: string, labels: Record<string, string> = {}, by = 1): void {
  const key = labelKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + by);
}

/**
 * Set an absolute gauge value (B27 outbox/offline). Does not mutate business state.
 */
export function setMetricGauge(name: string, value: number, labels: Record<string, string> = {}): void {
  if (!Number.isFinite(value)) return;
  gauges.set(labelKey(name, labels), value);
}

export function readMetricsSnapshot(): Array<{ name: string; labels: Record<string, string>; value: number }> {
  const parse = (key: string, value: number) => {
    const [name, labelPart] = key.split("|");
    const labels: Record<string, string> = {};
    if (labelPart) {
      for (const pair of labelPart.split(",").filter(Boolean)) {
        const [k, v] = pair.split("=");
        if (k) labels[k] = v ?? "";
      }
    }
    return { name: name ?? key, labels, value };
  };
  return [
    ...[...counters.entries()].map(([key, value]) => parse(key, value)),
    ...[...gauges.entries()].map(([key, value]) => parse(key, value)),
  ];
}

/** Record lightweight outbox observation for health (in-process only). */
export function observeOutboxHealth(input: {
  pending?: number;
  processing?: number;
  failed?: number;
  stuck?: number;
  oldestPendingAgeSec?: number;
}): void {
  if (input.pending != null) setMetricGauge("outbox_pending", input.pending);
  if (input.processing != null) setMetricGauge("outbox_processing", input.processing);
  if (input.failed != null) setMetricGauge("outbox_failed", input.failed);
  if (input.stuck != null) setMetricGauge("outbox_stuck", input.stuck);
  if (input.oldestPendingAgeSec != null) {
    setMetricGauge("outbox_oldest_pending_age_sec", input.oldestPendingAgeSec);
  }
}

export function observeOfflineHealth(input: {
  pendingOps?: number;
  conflicts?: number;
  lastSyncAgeSec?: number;
}): void {
  if (input.pendingOps != null) setMetricGauge("offline_pending_ops", input.pendingOps);
  if (input.conflicts != null) setMetricGauge("offline_conflicts", input.conflicts);
  if (input.lastSyncAgeSec != null) setMetricGauge("offline_last_sync_age_sec", input.lastSyncAgeSec);
}

export function resetMetricsForTests(): void {
  counters.clear();
  gauges.clear();
}
