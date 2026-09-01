import type { LocalConflict } from "@/lib/offline/types";

export function ConflictBanner({ conflicts }: { conflicts: LocalConflict[] }) {
  if (conflicts.length === 0) return null;

  return (
    <div
      role="alert"
      data-testid="sync-conflict"
      className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
    >
      <p className="font-semibold">Conflito de sincronização</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {conflicts.map((conflict) => (
          <li key={conflict.id}>
            HTTP {conflict.httpStatus}: {conflict.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
