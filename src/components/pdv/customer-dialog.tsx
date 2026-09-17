"use client";

import { useEffect, useMemo, useState } from "react";
import { CustomerForm } from "@/components/customers/customer-form";
import type { CatalogCustomer } from "@/lib/domain/catalog";
import {
  EMPTY_CUSTOMER_DRAFT,
  filterCustomers,
  type CustomerDraft,
} from "@/lib/domain/customer";
import type { CustomerWriteResult } from "@/hooks/use-customers";

type CustomerDialogProps = {
  open: boolean;
  customers: CatalogCustomer[];
  selectedId: string | null;
  requireCustomer?: boolean;
  onSelect: (customer: CatalogCustomer | null) => void;
  onCreate: (draft: CustomerDraft) => Promise<CustomerWriteResult>;
  onClose: () => void;
};

export function CustomerDialog({
  open,
  customers,
  selectedId,
  requireCustomer = false,
  onSelect,
  onCreate,
  onClose,
}: CustomerDialogProps) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<CustomerDraft>(EMPTY_CUSTOMER_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setCreating(false);
      setDraft(EMPTY_CUSTOMER_DRAFT);
      setSubmitting(false);
      setFormError(null);
    }
  }, [open]);

  const visible = useMemo(() => filterCustomers(customers, query), [customers, query]);

  if (!open) return null;

  const submitCreate = async () => {
    setSubmitting(true);
    setFormError(null);
    const result = await onCreate(draft);
    setSubmitting(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    onSelect(result.customer);
  };

  return (
    <div data-testid="customer-dialog" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Fechar cliente" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold">Associar cliente</h2>
        {requireCustomer ? (
          <p className="mt-1 text-sm text-amber-800">Esta loja exige um cliente em toda venda.</p>
        ) : null}

        {creating ? (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-slate-700">Novo cliente</h3>
            <p className="mt-1 text-xs text-slate-500">Nome obrigatório. Documento e e-mail opcionais.</p>
            <div className="mt-3">
              <CustomerForm
                draft={draft}
                submitting={submitting}
                error={formError}
                submitLabel="Criar e associar"
                onChange={setDraft}
                onSubmit={() => void submitCreate()}
                onCancel={() => {
                  setCreating(false);
                  setFormError(null);
                  setDraft(EMPTY_CUSTOMER_DRAFT);
                }}
              />
            </div>
          </div>
        ) : (
          <>
            <input
              data-testid="customer-search"
              className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Buscar por nome ou documento"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button
              type="button"
              data-testid="customer-new"
              className="mt-3 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
              onClick={() => setCreating(true)}
            >
              Novo cliente
            </button>
            <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto">
              {requireCustomer ? null : (
                <li>
                  <button
                    type="button"
                    data-testid="customer-walk-in"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left"
                    onClick={() => onSelect(null)}
                  >
                    Sem cliente
                  </button>
                </li>
              )}
              {visible.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    data-testid={`customer-${customer.id}`}
                    className={`w-full rounded-lg border px-3 py-2 text-left ${
                      selectedId === customer.id ? "border-emerald-500 bg-emerald-50" : "border-slate-200"
                    }`}
                    onClick={() => onSelect(customer)}
                  >
                    <div className="font-medium">{customer.name}</div>
                    <div className="text-xs text-slate-500">{customer.document ?? customer.email}</div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
