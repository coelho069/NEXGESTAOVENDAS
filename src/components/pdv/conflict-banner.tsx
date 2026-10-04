import { describeSaleProcessError } from "@/lib/domain/sale-process-error";
import type { LocalConflict } from "@/lib/offline/types";

export function ConflictBanner({
  conflicts,
  onReconcile,
}: {
  conflicts: LocalConflict[];
  onReconcile?: (clientMutationId: string) => Promise<unknown>;
}) {
  if (conflicts.length === 0) return null;

  return (
    <div role="alert" data-testid="sync-conflict" className="pdv-alert-error">
      <p className="font-semibold">Conflito de sincronização</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {conflicts.map((conflict) => (
          <li key={conflict.id}>
            {conflict.outcomeUnknown || conflict.message.startsWith("Resultado remoto incerto")
              ? "Pagamento desconhecido: reconcilie antes de tentar cobrar novamente."
              : `HTTP ${conflict.httpStatus}: ${describeSaleProcessError(conflict.message)}`}
            {conflict.outcomeUnknown && onReconcile ? (
              <button
                type="button"
                className="ml-2 rounded border border-destructive/50 px-2 py-1 text-xs font-medium text-red-200 hover:bg-destructive/10"
                onClick={() => void onReconcile(conflict.clientMutationId)}
              >
                Reconciliar
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
