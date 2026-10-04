import { resolveSyncBadge } from "@/stores/sync-store";

type SyncStatusBadgeProps = {
  online: boolean;
  pendingCount: number;
  failedCount?: number;
  syncing: boolean;
  conflictCount?: number;
};

const labels = {
  offline: "Offline",
  pending: "Pendente sync",
  synced: "Sincronizado",
  processing: "Sincronizando",
  failed: "Falha sync",
  conflict: "Conflito",
} as const;

export function SyncStatusBadge({
  online,
  pendingCount,
  failedCount = 0,
  syncing,
  conflictCount = 0,
}: SyncStatusBadgeProps) {
  const status = syncing
    ? "processing"
    : resolveSyncBadge(online, pendingCount, { conflictCount, failed: failedCount > 0 });
  const tone =
    status === "synced"
      ? "border border-success/30 bg-success/15 text-emerald-200"
      : status === "offline"
        ? "border border-border bg-background/50 text-muted-foreground"
        : status === "processing"
          ? "border border-primary/30 bg-primary/15 text-blue-200"
          : status === "conflict"
            ? "border border-destructive/30 bg-destructive/15 text-red-200"
            : "border border-warning/30 bg-warning/15 text-amber-200";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>
      {labels[status as keyof typeof labels] ?? status}
    </span>
  );
}
