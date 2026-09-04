type CounterKey = string;

const counters = new Map<CounterKey, number>();

export function incrementMetric(name: string, labels: Record<string, string> = {}, by = 1): void {
  const key = `${name}|${Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;
  counters.set(key, (counters.get(key) ?? 0) + by);
}

export function readMetricsSnapshot(): Array<{ name: string; labels: Record<string, string>; value: number }> {
  return [...counters.entries()].map(([key, value]) => {
    const [name, labelPart] = key.split("|");
    const labels: Record<string, string> = {};
    if (labelPart) {
      for (const pair of labelPart.split(",").filter(Boolean)) {
        const [k, v] = pair.split("=");
        if (k) labels[k] = v ?? "";
      }
    }
    return { name, labels, value };
  });
}

export function resetMetricsForTests(): void {
  counters.clear();
}
