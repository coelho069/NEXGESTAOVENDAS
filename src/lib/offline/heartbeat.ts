export type HeartbeatInfo = {
  at: string;
  online: boolean;
  tabId: string;
};

export type HeartbeatOptions = {
  intervalMs?: number;
  onBeat: (info: HeartbeatInfo) => void | Promise<void>;
  now?: () => Date;
  isOnline?: () => boolean;
  tabId?: string;
};

export function startHeartbeat(options: HeartbeatOptions): () => void {
  const tabId = options.tabId ?? (typeof crypto !== "undefined" ? crypto.randomUUID() : `tab-${Date.now()}`);
  const intervalMs = options.intervalMs ?? 15_000;

  const beat = () => {
    const info: HeartbeatInfo = {
      at: (options.now ?? (() => new Date()))().toISOString(),
      online: (options.isOnline ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine)))(),
      tabId,
    };
    void options.onBeat(info);
  };

  beat();
  const timer = setInterval(beat, intervalMs);
  return () => clearInterval(timer);
}
