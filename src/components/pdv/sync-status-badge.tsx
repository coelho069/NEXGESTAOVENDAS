import { resolveSyncBadge } from "@/stores/sync-store";

type SyncStatusBadgeProps = {
  online: boolean;
  pendingCount: number;
  syncing: boolean;
};

const labels = {
  offline: "Offline",
  pending: "Pendente sync",
  synced: "Sincronizado",
  processing: "Sincronizando",
  failed: "Falha sync",
  conflict: "Conflito",
} as const;

export function SyncStatusBadge({ online, pendingCount, syncing }: SyncStatusBadgeProps) {
  const status = syncing ? "processing" : resolveSyncBadge(online, pendingCount);
  const tone =
    status === "synced"
      ? "bg-emerald-100 text-emerald-800"
      : status === "offline"
        ? "bg-slate-200 text-slate-700"
        : status === "processing"
          ? "bg-blue-100 text-blue-800"
          : "bg-amber-100 text-amber-800";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>
      {labels[status as keyof typeof labels] ?? status}
    </span>
  );
}
