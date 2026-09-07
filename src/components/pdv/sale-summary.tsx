import { Banknote, CreditCard, QrCode } from "lucide-react";
import { formatBRL } from "@/lib/money";
import type { SaleTotals } from "@/lib/domain/sale-ops";

type PaymentActionsProps = {
  disabled: boolean;
  cardSelectable?: boolean;
  pixSelectable?: boolean;
  onCash: () => void;
  onCard: () => void;
  onPix?: () => void;
};

export function PaymentActions({
  disabled,
  cardSelectable = false,
  onCash,
  onCard,
}: PaymentActionsProps) {
  const cardDisabled = disabled || !cardSelectable;

  return (
    <div className="grid grid-cols-3 gap-3">
      <button
        type="button"
        data-testid="checkout-cash"
        disabled={disabled}
        onClick={onCash}
        className="flex flex-col items-center gap-2 rounded-2xl border-2 border-emerald-100 bg-emerald-50 p-4 font-semibold text-emerald-800 transition hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Banknote size={24} aria-hidden="true" />
        <span>Dinheiro</span>
      </button>
      <button
        type="button"
        data-testid="checkout-card"
        disabled={cardDisabled}
        onClick={onCard}
        className="flex flex-col items-center gap-2 rounded-2xl border-2 border-slate-100 bg-white p-4 font-semibold text-slate-700 transition hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <CreditCard size={24} aria-hidden="true" />
        <span>Cartão</span>
        {!cardSelectable ? (
          <small className="font-normal text-slate-400">não configurado</small>
        ) : null}
      </button>
      <button
        type="button"
        data-testid="checkout-pix"
        disabled
        aria-label="PIX — não configurado"
        title="PIX — não configurado"
        className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-teal-300 bg-teal-50 p-4 font-semibold text-teal-800 disabled:cursor-not-allowed"
      >
        <QrCode size={24} aria-hidden="true" />
        <span>PIX</span>
        <small className="font-normal text-teal-700">não configurado</small>
      </button>
    </div>
  );
}

type SaleSummaryProps = {
  totals: SaleTotals;
  customerName: string | null;
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
      className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-slate-900">Resumo da venda</h2>
      <div className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between text-slate-600">
          <span>Itens</span>
          <span>{totals.itemCount}</span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>Subtotal</span>
          <span>{formatBRL(totals.subtotal)}</span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>Desconto</span>
          <span>{formatBRL(discountLabel)}</span>
        </div>
        <div className="flex justify-between text-lg font-bold text-slate-900">
          <span>Total</span>
          <span data-testid="sale-total">{formatBRL(totals.total)}</span>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <button
          type="button"
          data-testid="open-customer"
          onClick={onCustomer}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-sm transition hover:border-indigo-300"
        >
          Cliente (F4): {customerName ?? "Não informado"}
        </button>
        <button
          type="button"
          data-testid="open-discount"
          onClick={onDiscount}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-sm transition hover:border-indigo-300"
        >
          Desconto (F6)
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          data-testid="suspend-sale"
          disabled={suspendDisabled}
          onClick={onSuspend}
          className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Suspender venda
        </button>
        <button
          type="button"
          data-testid="open-suspended-sales"
          onClick={onOpenSuspended}
          className="rounded-xl border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-700 hover:border-indigo-400"
        >
          Vendas suspensas
        </button>
        <button
          type="button"
          data-testid="open-sales-history"
          onClick={onOpenSalesHistory}
          className="col-span-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-indigo-300"
        >
          Consultar vendas
        </button>
      </div>
      {!online ? (
        <p data-testid="suspend-offline-message" className="mt-2 text-xs text-amber-700">
          Suspender venda exige conexão. O carrinho atual será preservado.
        </p>
      ) : null}
      <div className="mt-auto border-t border-slate-100 pt-4">
        <button
          type="button"
          data-testid="open-payment"
          disabled={checkoutDisabled}
          onClick={onOpenPayment}
          className="flex w-full items-center justify-between rounded-2xl bg-indigo-600 px-4 py-4 text-lg font-bold text-white shadow-lg shadow-indigo-100 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
        >
          <span>Finalizar venda</span>
          <span>{formatBRL(totals.total)}</span>
        </button>
      </div>
    </aside>
  );
}