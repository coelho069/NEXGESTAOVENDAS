"use client";

import { useState } from "react";
import { formatBRL } from "@/lib/money";
import type {
  SuspendedCartContext,
  SuspendedSaleSummary,
} from "@/lib/domain/suspended-sale";

type SuspendedSalesPanelProps = {
  open: boolean;
  rows: SuspendedSaleSummary[];
  loading: boolean;
  mutating: boolean;
  error: string | null;
  cartHasItems: boolean;
  activeContext: SuspendedCartContext | null;
  onRefresh: () => void;
  onRecover: (suspendedSaleId: string) => Promise<void>;
  onReleaseActive: () => Promise<void>;
  onClose: () => void;
};

export function SuspendedSalesPanel({
  open,
  rows,
  loading,
  mutating,
  error,
  cartHasItems,
  activeContext,
  onRefresh,
  onRecover,
  onReleaseActive,
  onClose,
}: SuspendedSalesPanelProps) {
  const [pendingRecovery, setPendingRecovery] = useState<string | null>(null);

  if (!open) return null;

  const requestRecovery = (id: string) => {
    if (cartHasItems) {
      setPendingRecovery(id);
      return;
    }
    void onRecover(id);
  };

  return (
    <div
      data-testid="suspended-sales-panel"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4"
    >
      <div className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Vendas suspensas</h2>
            <p className="text-xs text-muted-foreground">
              A lista vem do servidor e a recuperação tem consumo único.
            </p>
          </div>
          <button
            type="button"
            aria-label="Fechar vendas suspensas"
            className="rounded-lg px-3 py-2 text-muted-foreground hover:bg-background/50"
            onClick={onClose}
          >
            Fechar
          </button>
        </div>

        {activeContext ? (
          <div className="mx-5 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-amber-200">
            <span>Existe uma venda suspensa recuperada neste carrinho.</span>
            <button
              type="button"
              data-testid="release-suspended-sale"
              disabled={mutating}
              className="rounded-lg border border-warning/40 px-3 py-1.5 font-semibold disabled:opacity-50"
              onClick={() => void onReleaseActive()}
            >
              Liberar venda
            </button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mx-5 mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {loading ? <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p> : null}
          {!loading && rows.length === 0 ? (
            <p data-testid="suspended-sales-empty" className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma venda suspensa nesta loja.
            </p>
          ) : null}
          <ul className="space-y-3">
            {rows.map((row) => (
              <li
                key={row.suspended_sale_id}
                className="rounded-xl border border-border p-4"
                data-testid={`suspended-sale-${row.suspended_sale_id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">
                      {row.customer_name ?? "Cliente não informado"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.item_count} item(ns) · {formatDate(row.created_at)}
                    </p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold uppercase text-blue-200">
                    {row.status}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Total preservado</span>
                  <strong>{formatBRL(row.total)}</strong>
                </div>
                <button
                  type="button"
                  data-testid={`recover-suspended-sale-${row.suspended_sale_id}`}
                  disabled={mutating || row.status !== "suspended"}
                  className="mt-3 w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => requestRecovery(row.suspended_sale_id)}
                >
                  {row.status === "suspended" ? "Recuperar venda" : "Venda em uso"}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {pendingRecovery ? (
          <div className="border-t border-warning/30 bg-warning/10 px-5 py-4">
            <p className="text-sm font-medium text-amber-200">
              O carrinho atual tem itens. Substituí-lo pelo snapshot recuperado?
            </p>
            <p className="mt-1 text-xs text-amber-800">
              A troca exige confirmação explícita; nada será apagado sem sua confirmação.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-input bg-card px-3 py-2 text-sm"
                onClick={() => setPendingRecovery(null)}
              >
                Manter carrinho
              </button>
              <button
                type="button"
                data-testid="confirm-recover-suspended-sale"
                disabled={mutating}
                className="rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={() => {
                  const id = pendingRecovery;
                  setPendingRecovery(null);
                  void onRecover(id);
                }}
              >
                Substituir e recuperar
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex justify-end border-t border-border px-5 py-3">
          <button
            type="button"
            data-testid="refresh-suspended-sales"
            disabled={loading || mutating}
            className="rounded-lg border border-input px-3 py-2 text-sm font-semibold disabled:opacity-50"
            onClick={() => void onRefresh()}
          >
            Atualizar lista
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}
