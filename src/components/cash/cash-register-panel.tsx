"use client";

import { useMemo, useState } from "react";
import { formatBRL } from "@/lib/money";
import { useCashSession } from "@/hooks/use-cash-session";
import {
  cashMovementTypeLabel,
  normalizeCashMoneyInput,
} from "@/lib/domain/cash-errors";
import { calculateCashDifference } from "@/lib/domain/cash";

type CashController = ReturnType<typeof useCashSession>;

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function CashRegisterPanel({
  storeId,
  cash,
}: {
  storeId: string | null;
  cash: CashController;
}) {
  const [openingAmount, setOpeningAmount] = useState("0,00");
  const [movementType, setMovementType] = useState<"supply" | "withdrawal">("supply");
  const [movementAmount, setMovementAmount] = useState("10,00");
  const [movementReason, setMovementReason] = useState("");
  const [countedAmount, setCountedAmount] = useState("0,00");
  const [localHint, setLocalHint] = useState<string | null>(null);

  const session = cash.session;
  const isOpen = session?.status === "open";

  const previewDifference = useMemo(() => {
    if (!isOpen) return null;
    const normalized = normalizeCashMoneyInput(countedAmount);
    if (!normalized) return null;
    return calculateCashDifference(normalized, cash.expectedAmount);
  }, [countedAmount, cash.expectedAmount, isOpen]);

  const summary = useMemo(() => {
    let supply = 0;
    let withdrawal = 0;
    let saleCash = 0;
    let other = 0;
    for (const m of cash.movements) {
      const value = Number(m.amount);
      if (!Number.isFinite(value)) continue;
      if (m.movement_type === "supply") supply += value;
      else if (m.movement_type === "withdrawal") withdrawal += value;
      else if (m.movement_type === "sale_cash") saleCash += value;
      else other += value;
    }
    return { supply, withdrawal, saleCash, other };
  }, [cash.movements]);

  const runOpen = async () => {
    setLocalHint(null);
    const amount = normalizeCashMoneyInput(openingAmount);
    if (!amount) {
      setLocalHint("Informe um saldo inicial válido (ex.: 100,00).");
      return;
    }
    try {
      await cash.openSession(amount);
    } catch {
      /* error already on cash.error */
    }
  };

  const runMovement = async () => {
    setLocalHint(null);
    const amount = normalizeCashMoneyInput(movementAmount);
    if (!amount || Number(amount) <= 0) {
      setLocalHint("Informe um valor maior que zero (ex.: 50,00).");
      return;
    }
    if (movementReason.trim().length === 0) {
      setLocalHint("Informe o motivo da sangria ou do suprimento.");
      return;
    }
    try {
      await cash.recordMovement(movementType, amount, movementReason.trim());
      setMovementReason("");
    } catch {
      /* error on cash.error */
    }
  };

  const runClose = async () => {
    setLocalHint(null);
    const amount = normalizeCashMoneyInput(countedAmount);
    if (!amount) {
      setLocalHint("Informe a contagem do caixa para fechar (ex.: 350,00).");
      return;
    }
    try {
      await cash.closeSession(amount);
    } catch {
      /* error on cash.error */
    }
  };

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
            {session?.opened_at ? ` · Aberto em ${formatWhen(session.opened_at)}` : null}
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
        <p
          role="alert"
          data-testid="cash-error"
          className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-red-200"
        >
          {cash.error}
        </p>
      ) : null}
      {localHint ? (
        <p role="status" className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-amber-200">
          {localHint}
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
          ) : (
            <div>
              <span className="block text-xs text-muted-foreground">Movimentos</span>
              <strong>{cash.movements.length}</strong>
            </div>
          )}
        </div>
      ) : null}

      {isOpen || session?.status === "closed" ? (
        <div
          data-testid="cash-turn-report"
          className="mt-3 grid gap-2 rounded-lg border border-border/60 bg-background/40 p-3 text-xs sm:grid-cols-4"
        >
          <div>
            <span className="text-muted-foreground">Suprimentos</span>
            <div className="font-semibold text-emerald-200">{formatBRL(summary.supply.toFixed(2))}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Sangrias</span>
            <div className="font-semibold text-amber-200">{formatBRL(summary.withdrawal.toFixed(2))}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Vendas (dinheiro)</span>
            <div className="font-semibold">{formatBRL(summary.saleCash.toFixed(2))}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Outros</span>
            <div className="font-semibold">{formatBRL(summary.other.toFixed(2))}</div>
          </div>
        </div>
      ) : null}

      {!isOpen ? (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-sm text-foreground">
            Saldo inicial (R$)
            <input
              data-testid="cash-opening-amount"
              className="mt-1 block w-32 rounded-lg border border-input px-3 py-2"
              value={openingAmount}
              onChange={(event) => setOpeningAmount(event.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              disabled={!storeId || !cash.terminalId || cash.mutating || cash.offline}
            />
          </label>
          <button
            type="button"
            data-testid="cash-open"
            className="pdv-btn-primary disabled:cursor-not-allowed"
            disabled={!storeId || !cash.terminalId || cash.mutating || cash.offline}
            onClick={() => void runOpen()}
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
              Valor (R$)
              <input
                data-testid="cash-movement-amount"
                className="mt-1 block w-28 rounded-lg border border-input px-3 py-2"
                value={movementAmount}
                onChange={(event) => setMovementAmount(event.target.value)}
                inputMode="decimal"
                placeholder="10,00"
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
              onClick={() => void runMovement()}
            >
              Registrar
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <label className="text-sm text-foreground">
              Conferência para fechar (R$)
              <input
                data-testid="cash-counted-amount"
                className="mt-1 block w-32 rounded-lg border border-input px-3 py-2"
                value={countedAmount}
                onChange={(event) => setCountedAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                disabled={cash.mutating || cash.offline}
              />
            </label>
            {previewDifference != null ? (
              <div className="text-sm" data-testid="cash-difference-preview">
                <span className="block text-xs text-muted-foreground">Diferença prevista</span>
                <strong
                  className={
                    Number(previewDifference) === 0
                      ? "text-emerald-200"
                      : Number(previewDifference) > 0
                        ? "text-amber-200"
                        : "text-red-200"
                  }
                >
                  {formatBRL(previewDifference)}
                </strong>
              </div>
            ) : null}
            <button
              type="button"
              data-testid="cash-close"
              className="rounded-lg border border-border bg-background/60 px-4 py-2 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              disabled={cash.mutating || cash.offline}
              onClick={() => void runClose()}
            >
              Fechar caixa
            </button>
          </div>
        </div>
      )}

      {cash.movements.length > 0 ? (
        <div className="mt-4 border-t border-border pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Histórico do turno
          </h3>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-muted-foreground">
            {[...cash.movements].reverse().map((movement) => (
              <li key={movement.cash_movement_id} className="flex justify-between gap-3">
                <span>
                  <span className="font-medium text-foreground/90">
                    {cashMovementTypeLabel(movement.movement_type)}
                  </span>
                  {" · "}
                  {movement.reason || "—"}
                  <span className="text-muted-foreground/70"> · {formatWhen(movement.created_at)}</span>
                </span>
                <span className="shrink-0 font-medium">{formatBRL(movement.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
