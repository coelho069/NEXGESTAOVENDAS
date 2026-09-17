"use client";

import { useMemo, useState } from "react";
import { CustomerForm } from "@/components/customers/customer-form";
import { CustomerSalesHistory } from "@/components/customers/customer-sales-history";
import { useCustomerSales } from "@/hooks/use-customer-sales";
import { useCustomers } from "@/hooks/use-customers";
import {
  EMPTY_CUSTOMER_DRAFT,
  customerDraftFrom,
  filterCustomers,
  type CustomerDraft,
} from "@/lib/domain/customer";
import type { CatalogCustomer } from "@/lib/domain/catalog";

type ScreenMode = "list" | "create" | "edit" | "detail";

export function CustomersScreen() {
  const { customers, error, createCustomer, updateCustomer } = useCustomers();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ScreenMode>("list");
  const [editing, setEditing] = useState<CatalogCustomer | null>(null);
  const [viewing, setViewing] = useState<CatalogCustomer | null>(null);
  const [draft, setDraft] = useState<CustomerDraft>(EMPTY_CUSTOMER_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const customerSales = useCustomerSales(mode === "detail" ? viewing?.id ?? null : null);

  const visible = useMemo(() => filterCustomers(customers, query), [customers, query]);

  const resetForm = () => {
    setMode("list");
    setEditing(null);
    setViewing(null);
    setDraft(EMPTY_CUSTOMER_DRAFT);
    setFormError(null);
    setSubmitting(false);
  };

  const submit = async () => {
    setSubmitting(true);
    setFormError(null);
    const result =
      mode === "edit" && editing
        ? await updateCustomer(editing.id, draft)
        : await createCustomer(draft);
    setSubmitting(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setMessage(mode === "edit" ? `Cliente ${result.customer.name} atualizado.` : `Cliente ${result.customer.name} criado.`);
    resetForm();
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="text-sm text-slate-500">
            Cadastro da organização. Nome obrigatório; documento e e-mail opcionais.
          </p>
        </div>
        {mode === "list" ? (
          <button
            type="button"
            data-testid="customers-new"
            className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white"
            onClick={() => {
              setMode("create");
              setEditing(null);
              setViewing(null);
              setDraft(EMPTY_CUSTOMER_DRAFT);
              setMessage(null);
            }}
          >
            Novo cliente
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">{error}</div>
      ) : null}
      {message ? (
        <div data-testid="customers-message" className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
          {message}
        </div>
      ) : null}

      {mode === "list" ? (
        <>
          <input
            data-testid="customers-search"
            className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Buscar por nome ou documento"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm" data-testid="customers-table">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2 font-medium">Nome</th>
                  <th className="px-4 py-2 font-medium">Documento</th>
                  <th className="px-4 py-2 font-medium">E-mail</th>
                  <th className="px-4 py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-slate-500" colSpan={4}>
                      Nenhum cliente encontrado.
                    </td>
                  </tr>
                ) : (
                  visible.map((customer) => (
                    <tr key={customer.id} className="border-t border-slate-100" data-testid={`customers-row-${customer.id}`}>
                      <td className="px-4 py-2 font-medium">{customer.name}</td>
                      <td className="px-4 py-2 text-slate-600">{customer.document ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-600">{customer.email ?? "—"}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            data-testid={`customers-view-${customer.id}`}
                            className="rounded-lg border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-800"
                            onClick={() => {
                              setMode("detail");
                              setViewing(customer);
                              setEditing(null);
                              setMessage(null);
                            }}
                          >
                            Ver
                          </button>
                          <button
                            type="button"
                            data-testid={`customers-edit-${customer.id}`}
                            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold"
                            onClick={() => {
                              setMode("edit");
                              setEditing(customer);
                              setViewing(null);
                              setDraft(customerDraftFrom(customer));
                              setMessage(null);
                            }}
                          >
                            Editar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : mode === "detail" && viewing ? (
        <div className="space-y-4" data-testid="customer-detail">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <button
                type="button"
                data-testid="customer-detail-back"
                className="text-sm font-medium text-indigo-700"
                onClick={resetForm}
              >
                ← Voltar à lista
              </button>
              <h2 className="mt-2 text-xl font-semibold">{viewing.name}</h2>
              <p className="text-sm text-slate-500">
                {viewing.document ? `Documento: ${viewing.document}` : "Sem documento"}
                {viewing.email ? ` · ${viewing.email}` : ""}
              </p>
            </div>
            <button
              type="button"
              data-testid="customer-detail-edit"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
              onClick={() => {
                setMode("edit");
                setEditing(viewing);
                setDraft(customerDraftFrom(viewing));
              }}
            >
              Editar cliente
            </button>
          </div>
          <CustomerSalesHistory
            summary={customerSales.summary}
            rows={customerSales.rows}
            loading={customerSales.loading}
            error={customerSales.error}
            hasMore={customerSales.hasMore}
            onLoadMore={() => void customerSales.loadMore()}
          />
        </div>
      ) : (
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold">{mode === "edit" ? "Editar cliente" : "Novo cliente"}</h2>
          <div className="mt-4">
            <CustomerForm
              draft={draft}
              submitting={submitting}
              error={formError}
              submitLabel={mode === "edit" ? "Salvar alterações" : "Criar cliente"}
              onChange={setDraft}
              onSubmit={() => void submit()}
              onCancel={resetForm}
            />
          </div>
        </div>
      )}
    </div>
  );
}
