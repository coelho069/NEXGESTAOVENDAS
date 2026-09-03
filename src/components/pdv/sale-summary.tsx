import { formatBRL } from "@/lib/money";
import type { SaleTotals } from "@/lib/domain/sale-ops";

type PaymentActionsProps = {
  disabled: boolean;
  onCash: () => void;
  onCard: () => void;
};

export function PaymentActions({ disabled, onCash, onCard }: PaymentActionsProps) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        data-testid="checkout-cash"
        disabled={disabled}
        onClick={onCash}
        className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        Dinheiro
      </button>
      <button
        type="button"
        data-testid="checkout-card"
        disabled={disabled}
        onClick={onCard}
        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Cartão (não configurado)
      </button>
    </div>
  );
}

type SaleSummaryProps = {
  totals: SaleTotals;
  customerName: string | null;
  discountLabel: string;
  checkoutDisabled: boolean;
  onCustomer: () => void;
  onDiscount: () => void;
  onCash: () => void;
  onCard: () => void;
  onOpenPayment: () => void;
};

export function SaleSummary({
  totals,
  customerName,
  discountLabel,
  checkoutDisabled,
  onCustomer,
  onDiscount,
  onCash,
  onCard,
  onOpenPayment,
}: SaleSummaryProps) {
  return (
    <aside
      data-testid="pdv-summary"
      className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-slate-900">Resumo</h2>
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
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left text-sm"
        >
          Cliente (F4): {customerName ?? "Não informado"}
        </button>
        <button
          type="button"
          data-testid="open-discount"
          onClick={onDiscount}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left text-sm"
        >
          Desconto (F6)
        </button>
      </div>
      <div className="mt-auto pt-4">
        <div className="hidden lg:block">
          <PaymentActions disabled={checkoutDisabled} onCash={onCash} onCard={onCard} />
        </div>
        <button
          type="button"
          data-testid="open-payment"
          disabled={checkoutDisabled}
          onClick={onOpenPayment}
          className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 lg:hidden"
        >
          Pagamento (F8)
        </button>
      </div>
    </aside>
  );
}