import { Banknote, CreditCard, QrCode } from "lucide-react";
import { formatBRL } from "@/lib/money";
import type { SaleTotals } from "@/lib/domain/sale-ops";

type PaymentActionsProps = {
  disabled: boolean;
  cardSelectable?: boolean;
  /** Mapa de integração: PIX restrito (not_configured) até o health-check ser ligado. */
  pixSelectable?: boolean;
  onCash: () => void;
  onCard: () => void;
  onPixManual: () => void;
};

export function PaymentActions({
  disabled,
  cardSelectable = false,
  pixSelectable = false,
  onCash,
  onCard,
  onPixManual,
}: PaymentActionsProps) {
  const cardDisabled = disabled || !cardSelectable;
  const pixDisabled = disabled || !pixSelectable;
  const methodBase =
    "flex min-h-[44px] flex-col items-center gap-2 rounded-2xl border-2 p-4 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="grid grid-cols-2 gap-3">
      <button
        type="button"
        data-testid="checkout-cash"
        disabled={disabled}
        onClick={onCash}
        className={`${methodBase} border-success/40 bg-success/10 text-emerald-200 hover:border-success hover:bg-success/20`}
      >
        <Banknote size={24} aria-hidden="true" />
        <span>Dinheiro</span>
      </button>
      <button
        type="button"
        data-testid="checkout-pix-manual"
        disabled={pixDisabled}
        aria-label="PIX próprio"
        title="PIX próprio"
        onClick={onPixManual}
        className={`${methodBase} border-teal-500/30 bg-teal-500/10 text-teal-200 hover:border-teal-400 hover:bg-teal-500/20`}
      >
        <QrCode size={24} aria-hidden="true" />
        <span>PIX próprio</span>
        {!pixSelectable ? (
          <small className="font-normal text-muted-foreground">não configurado</small>
        ) : null}
      </button>
      <button
        type="button"
        data-testid="checkout-card"
        disabled={cardDisabled}
        onClick={onCard}
        className={`${methodBase} border-border bg-background/30 text-foreground hover:border-primary/50 hover:bg-primary/10`}
      >
        <CreditCard size={24} aria-hidden="true" />
        <span>Débito</span>
        {!cardSelectable ? (
          <small className="font-normal text-muted-foreground">não configurado</small>
        ) : null}
      </button>
      <button
        type="button"
        data-testid="checkout-card-credit"
        disabled={cardDisabled}
        onClick={onCard}
        className={`${methodBase} border-border bg-background/30 text-foreground hover:border-primary/50 hover:bg-primary/10`}
      >
        <CreditCard size={24} aria-hidden="true" />
        <span>Crédito</span>
        {!cardSelectable ? (
          <small className="font-normal text-muted-foreground">não configurado</small>
        ) : null}
      </button>
    </div>
  );
}

type SaleSummaryProps = {
  totals: SaleTotals;
  customerName: string | null;
  customerRequired?: boolean;
  discountLabel: string;
  checkoutDisabled: boolean;
  suspendDisabled: boolean;
  online: boolean;
  onCustomer: () => void;
  onDiscount: () => void;
  onOpenPayment: () => void;
  onSuspend: () => void;
  onOpenSuspended: () => void;
  onOpenSalesHistory: () => void;
};

export function SaleSummary({
  totals,
  customerName,
  customerRequired = false,
  discountLabel,
  checkoutDisabled,
  suspendDisabled,
  online,
  onCustomer,
  onDiscount,
  onOpenPayment,
  onSuspend,
  onOpenSuspended,
  onOpenSalesHistory,
}: SaleSummaryProps) {
  return (
    <aside
      data-testid="pdv-summary"
      className="flex h-full max-h-[calc(100vh-8rem)] min-h-0 flex-col rounded-2xl border border-border bg-card shadow-lg shadow-black/20 backdrop-blur-md lg:sticky lg:top-4"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <h2 className="text-lg font-semibold text-foreground">Resumo da venda</h2>
        <div className="mt-4 space-y-2 text-sm tabular-nums">
          <div className="flex justify-between text-muted-foreground">
            <span>Itens</span>
            <span>{totals.itemCount}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span>{formatBRL(totals.subtotal)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Desconto</span>
            <span>{formatBRL(discountLabel)}</span>
          </div>
        </div>
        <div className="mt-4 flex items-end justify-between gap-3 border-t border-border pt-4">
          <span className="text-base font-semibold text-foreground/80">Total</span>
          <span
            data-testid="sale-total"
            className="bg-gradient-to-r from-primary to-success bg-clip-text text-[clamp(1.75rem,4vw,2.25rem)] font-bold leading-none text-transparent tabular-nums"
            style={{ fontFamily: "var(--font-jakarta), system-ui, sans-serif" }}
          >
            {formatBRL(totals.total)}
          </span>
        </div>
        <div className="mt-4 space-y-2">
          <button
            type="button"
            data-testid="open-customer"
            onClick={onCustomer}
            className="pdv-btn-ghost w-full text-left"
          >
            Cliente (F6): {customerName ?? (customerRequired ? "Obrigatório" : "Não informado")}
          </button>
          <button type="button" data-testid="open-discount" onClick={onDiscount} className="pdv-btn-ghost w-full text-left">
            Desconto (F8)
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            data-testid="suspend-sale"
            disabled={suspendDisabled}
            onClick={onSuspend}
            className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm font-semibold text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Suspender venda
          </button>
          <button
            type="button"
            data-testid="open-suspended-sales"
            onClick={onOpenSuspended}
            className="rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold text-blue-200 hover:border-primary/60"
          >
            Vendas suspensas
          </button>
          <button
            type="button"
            data-testid="open-sales-history"
            onClick={onOpenSalesHistory}
            className="col-span-2 pdv-btn-ghost"
          >
            Consultar vendas
          </button>
        </div>
        {!online ? (
          <p data-testid="suspend-offline-message" className="mt-2 text-xs text-amber-300/90">
            Suspender venda exige conexão. O carrinho atual será preservado.
          </p>
        ) : null}
      </div>
      <div className="shrink-0 border-t border-border bg-card/80 p-4 backdrop-blur-sm">
        <button
          type="button"
          data-testid="open-payment"
          disabled={checkoutDisabled}
          onClick={onOpenPayment}
          className="pdv-btn-success flex min-h-[56px] w-full items-center justify-between px-4 py-4 text-lg disabled:bg-muted-foreground/30 disabled:text-muted-foreground"
        >
          <span>Finalizar venda (F12)</span>
          <span className="tabular-nums">{formatBRL(totals.total)}</span>
        </button>
      </div>
    </aside>
  );
}
