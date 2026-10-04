"use client";

import { useState } from "react";
import { formatBRL } from "@/lib/money";
import { useCashSession } from "@/hooks/use-cash-session";

type CashController = ReturnType<typeof useCashSession>;

export function CashRegisterPanel({
  storeId,
  cash,
}: {
  storeId: string | null;
  cash: CashController;
}) {
  const [openingAmount, setOpeningAmount] = useState("0.00");
  const [movementType, setMovementType] = useState<"supply" | "withdrawal">("supply");
  const [movementAmount, setMovementAmount] = useState("10.00");
  const [movementReason, setMovementReason] = useState("");
  const [countedAmount, setCountedAmount] = useState("0.00");

  const session = cash.session;
  const isOpen = session?.status === "open";

  return (
    <section
      aria-labelledby="cash-register-title"
      data-testid="cash-register-panel"
      className="pdv-glass-bar"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="cash-register-title" className="font-semibold text-foreground">
            Caixa
          </h2>
          <p className="text-xs text-muted-foreground">
            Terminal: {cash.terminalId ? cash.terminalId.slice(0, 8) : "identificando..."}
          </p>
        </div>
        <span
          data-testid="cash-status"
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            isOpen
              ? "border border-success/30 bg-success/15 text-emerald-200"
              : session?.status === "closed"
                ? "border border-border bg-background/50 text-muted-foreground"
                : "border border-warning/30 bg-warning/15 text-amber-200"
          }`}
        >
          {isOpen ? "ABERTO" : session?.status === "closed" ? "FECHADO" : "SEM CAIXA"}
        </span>
      </div>

      {cash.loading ? <p className="mt-3 text-sm text-muted-foreground">Consultando caixa...</p> : null}
      {cash.offline ? (
        <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-amber-200">
          Sem conexão: operações do caixa ficam indisponíveis. Vendas de uma sessão já aberta podem sincronizar depois.
        </p>
      ) : null}
      {cash.error ? (
        <p role="alert" data-testid="cash-error" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-red-200">
          {cash.error}
        </p>
      ) : null}

      {session ? (
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <span className="block text-xs text-muted-foreground">Abertura</span>
            <strong>{formatBRL(session.opening_amount)}</strong>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">Saldo esperado</span>
            <strong data-testid="cash-expected">{formatBRL(cash.expectedAmount)}</strong>
          </div>
          {session.status === "closed" ? (
            <div>
              <span className="block text-xs text-muted-foreground">Diferença</span>
              <strong data-testid="cash-difference">{formatBRL(session.difference ?? "0.00")}</strong>
            </div>
          ) : null}
        </div>
      ) : null}

      {!isOpen ? (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-sm text-foreground">
            Saldo inicial
            <input
              data-testid="cash-opening-amount"
              className="mt-1 block w-32 rounded-lg border border-input px-3 py-2"
              value={openingAmount}
              onChange={(event) => setOpeningAmount(event.target.value)}
              inputMode="decimal"
              disabled={!storeId || !cash.terminalId || cash.mutating || cash.offline}
            />
          </label>
          <button
            type="button"
            data-testid="cash-open"
            className="pdv-btn-primary disabled:cursor-not-allowed"
            disabled={!storeId || !cash.terminalId || cash.mutating || cash.offline}
            onClick={() => void cash.openSession(openingAmount).catch(() => undefined)}
          >
            {cash.mutating ? "Processando..." : "Abrir caixa"}
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm text-foreground">
              Operação
              <select
                data-testid="cash-movement-type"
                className="mt-1 block rounded-lg border border-input px-3 py-2"
                value={movementType}
                onChange={(event) => setMovementType(event.target.value as "supply" | "withdrawal")}
                disabled={cash.mutating}
              >
                <option value="supply">Suprimento</option>
                <option value="withdrawal">Sangria</option>
              </select>
            </label>
            <label className="text-sm text-foreground">
              Valor
              <input
                data-testid="cash-movement-amount"
                className="mt-1 block w-28 rounded-lg border border-input px-3 py-2"
                value={movementAmount}
                onChange={(event) => setMovementAmount(event.target.value)}
                inputMode="decimal"
                disabled={cash.mutating}
              />
            </label>
            <label className="min-w-44 flex-1 text-sm text-foreground">
              Motivo
              <input
                data-testid="cash-movement-reason"
                className="mt-1 block w-full rounded-lg border border-input px-3 py-2"
                value={movementReason}
                onChange={(event) => setMovementReason(event.target.value)}
                placeholder="Obrigatório"
                disabled={cash.mutating}
              />
            </label>
            <button
              type="button"
              data-testid="cash-record-movement"
              className="rounded-lg border border-primary/40 px-4 py-2 text-sm font-semibold text-blue-200 disabled:opacity-50"
              disabled={cash.mutating || cash.offline || movementReason.trim().length === 0}
              onClick={() =>
                void cash.recordMovement(movementType, movementAmount, movementReason).then(
                  () => setMovementReason(""),
                  () => undefined
                )
              }
            >
              Registrar
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <label className="text-sm text-foreground">
              Conferência para fechar
              <input
                data-testid="cash-counted-amount"
                className="mt-1 block w-32 rounded-lg border border-input px-3 py-2"
                value={countedAmount}
                onChange={(event) => setCountedAmount(event.target.value)}
                inputMode="decimal"
                disabled={cash.mutating || cash.offline}
              />
            </label>
            <button
              type="button"
              data-testid="cash-close"
              className="rounded-lg border border-border bg-background/60 px-4 py-2 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              disabled={cash.mutating || cash.offline}
              onClick={() => void cash.closeSession(countedAmount).catch(() => undefined)}
            >
              Fechar caixa
            </button>
          </div>
        </div>
      )}

      {cash.movements.length > 0 ? (
        <div className="mt-4 border-t border-border pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Histórico</h3>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {cash.movements.slice(-5).map((movement) => (
              <li key={movement.cash_movement_id} className="flex justify-between gap-3">
                <span>{movement.reason}</span>
                <span className="font-medium">{formatBRL(movement.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
