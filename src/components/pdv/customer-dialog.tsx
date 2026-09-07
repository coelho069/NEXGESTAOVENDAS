import type { CatalogCustomer } from "@/lib/domain/catalog";

type CustomerDialogProps = {
  open: boolean;
  customers: CatalogCustomer[];
  selectedId: string | null;
  onSelect: (customer: CatalogCustomer | null) => void;
  onClose: () => void;
};

export function CustomerDialog({ open, customers, selectedId, onSelect, onClose }: CustomerDialogProps) {
  if (!open) return null;

  return (
    <div data-testid="customer-dialog" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" aria-label="Fechar cliente" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold tracking-tight">Associar cliente</h2>
        <ul className="mt-4 space-y-2">
          <li>
            <button
              type="button"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-left outline-none transition hover:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
              onClick={() => onSelect(null)}
            >
              Sem cliente
            </button>
          </li>
          {customers.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                data-testid={`customer-${customer.id}`}
                className={`w-full rounded-xl border px-3 py-2.5 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-200 ${
                  selectedId === customer.id ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-indigo-300"
                }`}
                onClick={() => onSelect(customer)}
              >
                <div className="font-medium">{customer.name}</div>
                <div className="text-xs text-slate-500">{customer.document ?? customer.email}</div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}