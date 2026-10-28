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
import { AUTH_CSS } from "@/components/auth/login-form";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";

/** Tema de login (fundo escuro, cartões de vidro) aplicado às classes desta tela. */
const CUSTOMERS_CSS = `${AUTH_CSS}
.nx-cust-panel {
  border: 1px solid ${t.color.glassBorder};
  border-radius: ${t.radius.lg};
  background: ${t.color.glassBg};
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: ${t.shadow.card};
  color: ${t.color.textBody};
}
.nx-cust-ghost {
  border: 1px solid ${t.color.borderStrong};
  border-radius: ${t.radius.md};
  background: rgba(255, 255, 255, 0.04);
  color: ${t.color.text};
  cursor: pointer;
  font-family: ${t.font.body};
}
.nx-cust-view {
  border: 1px solid rgba(16, 185, 129, 0.35);
  border-radius: ${t.radius.md};
  background: rgba(16, 185, 129, 0.08);
  color: #6EE7B7;
  cursor: pointer;
  font-family: ${t.font.body};
}
.nx-cust-btn { width: auto; padding: 10px 18px; font-size: 14px; }
.nx-cust-muted { color: ${t.color.textMuted}; }
.nx-cust-strong { color: ${t.color.text}; }
.nx-cust-title { color: ${t.color.text}; font-family: ${t.font.heading}; }
.nx-cust-back { color: #93C5FD; background: none; border: none; cursor: pointer; }
.nx-cust-thead { background: rgba(255, 255, 255, 0.04); color: ${t.color.textMuted}; }
.nx-cust-row { border-top: 1px solid ${t.color.border}; }
`;

type ScreenMode = "list" | "create" | "edit" | "detail";

export function CustomersScreen() {
  const { customers, error, createCustomer, updateCustomer, anonymizeCustomer } = useCustomers();
  const [lgpdBusy, setLgpdBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ScreenMode>("list");
  const [editing, setEditing] = useState<CatalogCustomer | null>(null);
  const [viewing, setViewing] = useState<CatalogCustomer | null>(null);
  const [draft, setDraft] = useState<CustomerDraft>(EMPTY_CUSTOMER_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const customerSales = useCustomerSales(
    mode === "detail" || mode === "edit" ? (viewing?.id ?? editing?.id ?? null) : null
  );

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


  const exportCustomerLgpd = async (customer: CatalogCustomer) => {
    setLgpdBusy(true);
    setFormError(null);
    try {
      const response = await fetch(`/api/customers/${customer.id}/export`, { cache: "no-store" });
      if (!response.ok) {
        setFormError(
          response.status === 401 || response.status === 403
            ? "Sem permissão para exportar dados."
            : "Falha ao exportar dados do cliente."
        );
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `cliente-${customer.id}-lgpd-export.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage(`Exportação LGPD de ${customer.name} baixada.`);
    } catch {
      setFormError("Falha ao exportar dados do cliente.");
    } finally {
      setLgpdBusy(false);
    }
  };

  const anonymizeCustomerLgpd = async (customer: CatalogCustomer) => {
    const confirmed = window.confirm(
      `Anonimizar o cadastro de "${customer.name}"? Nome, documento e e-mail serão removidos. O histórico de vendas permanece.`
    );
    if (!confirmed) return;
    setLgpdBusy(true);
    setFormError(null);
    const result = await anonymizeCustomer(customer.id);
    setLgpdBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setMessage(`Cadastro anonimizado (LGPD): ${result.customer.name}.`);
    setViewing(result.customer);
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 lg:p-6">
      <style>{CUSTOMERS_CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold nx-cust-title">Clientes</h1>
          <p className="text-sm nx-cust-muted">
            Cadastro da organização. Nome obrigatório; documento e e-mail opcionais.
          </p>
        </div>
        {mode === "list" ? (
          <button
            type="button"
            data-testid="customers-new"
            className="nx-login-submit nx-cust-btn"
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
        <div data-testid="customers-message" className="nx-cust-panel px-4 py-3 text-sm">
          {message}
        </div>
      ) : null}
      {formError && mode === "detail" ? (
        <div
          data-testid="customers-lgpd-error"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          {formError}
        </div>
      ) : null}

      {mode === "list" ? (
        <>
          <input
            data-testid="customers-search"
            className="nx-login-input w-full max-w-md text-sm"
            placeholder="Buscar por nome ou documento"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="nx-cust-panel overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="customers-table">
              <thead className="nx-cust-thead">
                <tr>
                  <th className="px-4 py-2 font-medium">Nome</th>
                  <th className="px-4 py-2 font-medium">Documento</th>
                  <th className="px-4 py-2 font-medium">E-mail</th>
                  <th className="px-4 py-2 font-medium">Idade</th>
                  <th className="px-4 py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td className="nx-cust-muted px-4 py-6" colSpan={5}>
                      Nenhum cliente encontrado.
                    </td>
                  </tr>
                ) : (
                  visible.map((customer) => (
                    <tr key={customer.id} className="nx-cust-row" data-testid={`customers-row-${customer.id}`}>
                      <td className="px-4 py-2 font-medium nx-cust-strong">{customer.name}</td>
                      <td className="px-4 py-2">{customer.document ?? "—"}</td>
                      <td className="px-4 py-2">{customer.email ?? "—"}</td>
                      <td className="px-4 py-2">{customer.age != null ? `${customer.age} anos` : "—"}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            data-testid={`customers-view-${customer.id}`}
                            className="nx-cust-view px-3 py-1 text-xs font-semibold"
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
                            className="nx-cust-ghost px-3 py-1 text-xs font-semibold"
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
                className="text-sm font-medium nx-cust-back"
                onClick={resetForm}
              >
                ← Voltar à lista
              </button>
              <h2 className="mt-2 text-xl font-semibold nx-cust-title">{viewing.name}</h2>
              <p className="text-sm nx-cust-muted">
                {viewing.document ? `Documento: ${viewing.document}` : "Sem documento"}
                {viewing.email ? ` · ${viewing.email}` : ""}
                {viewing.age != null ? ` · ${viewing.age} anos` : ""}
              <div className="mt-1 text-sm nx-cust-muted">
                {viewing.discountLimit
                  ? `Limite de desconto: até ${Number(viewing.discountLimit).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
                  : "Limite de desconto: não definido"}
              </div>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="customer-detail-edit"
                className="nx-cust-ghost px-3 py-2 text-sm font-semibold"
                disabled={lgpdBusy}
                onClick={() => {
                  setMode("edit");
                  setEditing(viewing);
                  setDraft(customerDraftFrom(viewing));
                }}
              >
                Editar cliente
              </button>
              <button
                type="button"
                data-testid="customer-detail-export-lgpd"
                className="nx-cust-view px-3 py-2 text-sm font-semibold"
                disabled={lgpdBusy}
                onClick={() => void exportCustomerLgpd(viewing)}
              >
                Exportar dados (LGPD)
              </button>
              <button
                type="button"
                data-testid="customer-detail-anonymize-lgpd"
                className="nx-cust-ghost px-3 py-2 text-sm font-semibold"
                disabled={lgpdBusy}
                onClick={() => void anonymizeCustomerLgpd(viewing)}
              >
                Anonimizar cadastro
              </button>
            </div>
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
        <div className="nx-cust-panel max-w-md p-4">
          <h2 className="text-lg font-semibold nx-cust-title">{mode === "edit" ? "Editar cliente" : "Novo cliente"}</h2>
          <div className="mt-4">
            {mode === "edit" && customerSales.summary.sales_count > 0 && !draft.discountLimit.trim() ? (
              <button
                type="button"
                className="nx-cust-ghost nx-cust-btn mb-3 text-sm"
                onClick={() => {
                  const total = Number(customerSales.summary.lifetime_revenue);
                  if (!Number.isFinite(total) || total <= 0) return;
                  const suggested = Math.min(500, Math.max(5, Math.round(total * 0.05)));
                  setDraft({ ...draft, discountLimit: suggested.toFixed(2).replace(".", ",") });
                }}
              >
                Sugerir limite pelo histórico (5%)
              </button>
            ) : null}
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
