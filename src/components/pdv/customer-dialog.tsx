import { useEffect, useMemo, useState } from "react";
import type { CatalogCustomer } from "@/lib/domain/catalog";
import type { CustomerDetailResponse, CustomerRecord } from "@/lib/domain/customer";
import { validateCustomerFields } from "@/lib/domain/customer";
import { formatBRL } from "@/lib/money";
import { formatSaoPauloDate } from "@/lib/domain/receipt";
import { saleStatusLabel, paymentMethodLabel } from "@/lib/domain/sale-history";

type CustomerDialogProps = {
  open: boolean;
  customers: CatalogCustomer[];
  selectedId: string | null;
  canManage: boolean;
  requireDocument?: boolean;
  loading?: boolean;
  mutating?: boolean;
  error?: string | null;
  detail?: CustomerDetailResponse | null;
  detailLoading?: boolean;
  onSearch: (query: string) => void;
  onSelect: (customer: CatalogCustomer | null) => void;
  onSave: (input: {
    customerId?: string;
    name: string;
    document?: string | null;
    email?: string | null;
    phone?: string | null;
    requireDocument?: boolean;
  }) => Promise<CustomerRecord>;
  onOpenDetail: (customerId: string) => void;
  onLoadMoreDetail: () => void;
  onClearDetail: () => void;
  onClose: () => void;
};

type FormState = {
  name: string;
  document: string;
  phone: string;
  email: string;
};

const emptyForm: FormState = { name: "", document: "", phone: "", email: "" };

export function CustomerDialog({
  open,
  customers,
  selectedId,
  canManage,
  requireDocument = false,
  loading = false,
  mutating = false,
  error = null,
  detail = null,
  detailLoading = false,
  onSearch,
  onSelect,
  onSave,
  onOpenDetail,
  onLoadMoreDetail,
  onClearDetail,
  onClose,
}: CustomerDialogProps) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"list" | "form" | "detail">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setMode("list");
      setEditingId(null);
      setForm(emptyForm);
      setLocalError(null);
      onClearDetail();
    }
  }, [open, onClearDetail]);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => onSearch(query), 200);
    return () => window.clearTimeout(handle);
  }, [onSearch, open, query]);

  const title = useMemo(() => {
    if (mode === "form") return editingId ? "Editar cliente" : "Novo cliente";
    if (mode === "detail") return "Cliente";
    return "Associar cliente";
  }, [editingId, mode]);

  if (!open) return null;

  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setLocalError(null);
    setMode("form");
  };

  const startEdit = (customer: CatalogCustomer) => {
    setEditingId(customer.id);
    setForm({
      name: customer.name,
      document: customer.document ?? "",
      phone: customer.phone ?? "",
      email: customer.email ?? "",
    });
    setLocalError(null);
    setMode("form");
  };

  const submitForm = async () => {
    setLocalError(null);
    const validated = validateCustomerFields({
      name: form.name,
      document: form.document || null,
      phone: form.phone || null,
      email: form.email || null,
      requireDocument,
    });
    if (!validated.ok) {
      setLocalError(validated.error);
      return;
    }
    try {
      const saved = await onSave({
        customerId: editingId ?? undefined,
        name: form.name,
        document: form.document || null,
        phone: form.phone || null,
        email: form.email || null,
        requireDocument,
      });
      onSelect(saved);
      setMode("list");
      setEditingId(null);
      setForm(emptyForm);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "Falha ao salvar cliente");
    }
  };

  return (
    <div data-testid="customer-dialog" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Fechar cliente" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
              <p className="mt-1 text-xs text-slate-500">
                A associação não altera totais financeiros da venda.
              </p>
            </div>
            <button type="button" className="text-sm text-slate-500" onClick={onClose}>
              Fechar
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {mode === "list" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <input
                  data-testid="customer-search"
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Buscar por nome, CPF/CNPJ, telefone ou e-mail"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {canManage ? (
                  <button
                    type="button"
                    data-testid="customer-new"
                    className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white"
                    onClick={startCreate}
                  >
                    Novo
                  </button>
                ) : null}
              </div>
              {loading ? <p className="text-xs text-slate-500">Buscando...</p> : null}
              {error ? (
                <p role="alert" data-testid="customer-error" className="text-sm text-amber-800">
                  {error}
                </p>
              ) : null}
              <ul className="space-y-2">
                <li>
                  <button
                    type="button"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left"
                    onClick={() => onSelect(null)}
                  >
                    Sem cliente
                  </button>
                </li>
                {customers.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
                    Nenhum cliente encontrado.
                  </li>
                ) : (
                  customers.map((customer) => (
                    <li key={customer.id} className="rounded-lg border border-slate-200">
                      <button
                        type="button"
                        data-testid={`customer-${customer.id}`}
                        className={`w-full px-3 py-2 text-left ${
                          selectedId === customer.id ? "bg-emerald-50" : "bg-white"
                        }`}
                        onClick={() => onSelect(customer)}
                      >
                        <div className="font-medium text-slate-900">{customer.name}</div>
                        <div className="text-xs text-slate-500">
                          {customer.document ?? customer.phone ?? customer.email ?? "Sem documento"}
                        </div>
                      </button>
                      <div className="flex gap-2 border-t border-slate-100 px-3 py-2">
                        <button
                          type="button"
                          data-testid={`customer-view-${customer.id}`}
                          className="text-xs font-medium text-indigo-700"
                          onClick={() => {
                            setMode("detail");
                            onOpenDetail(customer.id);
                          }}
                        >
                          Ver
                        </button>
                        {canManage ? (
                          <button
                            type="button"
                            data-testid={`customer-edit-${customer.id}`}
                            className="text-xs font-medium text-slate-700"
                            onClick={() => startEdit(customer)}
                          >
                            Editar
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}

          {mode === "form" ? (
            <div className="space-y-3" data-testid="customer-form">
              <label className="block text-sm text-slate-700">
                Nome
                <input
                  data-testid="customer-form-name"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  disabled={mutating}
                />
              </label>
              <label className="block text-sm text-slate-700">
                Documento
                <input
                  data-testid="customer-form-document"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.document}
                  onChange={(event) => setForm((current) => ({ ...current, document: event.target.value }))}
                  disabled={mutating}
                  placeholder="CPF ou CNPJ"
                />
              </label>
              <label className="block text-sm text-slate-700">
                Telefone
                <input
                  data-testid="customer-form-phone"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.phone}
                  onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                  disabled={mutating}
                />
              </label>
              <label className="block text-sm text-slate-700">
                E-mail
                <input
                  data-testid="customer-form-email"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.email}
                  onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                  disabled={mutating}
                />
              </label>
              {localError || error ? (
                <p role="alert" data-testid="customer-form-error" className="text-sm text-red-700">
                  {localError ?? error}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  onClick={() => {
                    setMode("list");
                    setLocalError(null);
                  }}
                  disabled={mutating}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  data-testid="customer-form-save"
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={() => void submitForm()}
                  disabled={mutating}
                >
                  {mutating ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          ) : null}

          {mode === "detail" ? (
            <div className="space-y-4" data-testid="customer-detail">
              <button
                type="button"
                className="text-sm font-medium text-indigo-700"
                onClick={() => {
                  setMode("list");
                  onClearDetail();
                }}
              >
                ← Voltar
              </button>
              {detailLoading ? <p className="text-sm text-slate-500">Carregando...</p> : null}
              {error && !detailLoading ? (
                <p role="alert" data-testid="customer-detail-error" className="text-sm text-red-700">
                  {error}
                </p>
              ) : null}
              {detail ? (
                <>
                  <div className="rounded-xl border border-slate-200 p-4 text-sm">
                    <div className="font-semibold text-slate-900">{detail.customer.name}</div>
                    <div className="mt-1 text-slate-600">Documento: {detail.customer.document ?? "—"}</div>
                    <div className="text-slate-600">Telefone: {detail.customer.phone ?? "—"}</div>
                    <div className="text-slate-600">E-mail: {detail.customer.email ?? "—"}</div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Histórico de vendas</h3>
                    {detail.sales.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-500">Nenhuma venda encontrada para este cliente.</p>
                    ) : (
                      <ul className="mt-2 space-y-2" data-testid="customer-sale-history">
                        {detail.sales.map((sale) => (
                          <li
                            key={sale.sale_id}
                            className="rounded-lg border border-slate-100 px-3 py-2 text-sm"
                          >
                            <div className="font-medium text-slate-900">
                              {saleStatusLabel(sale.status)} · {formatBRL(sale.total)}
                            </div>
                            <div className="text-xs text-slate-500">
                              {formatSaoPauloDate(sale.created_at)} ·{" "}
                              {paymentMethodLabel(sale.payment_method)}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    {detail.has_more ? (
                      <button
                        type="button"
                        data-testid="customer-detail-load-more"
                        className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                        onClick={onLoadMoreDetail}
                        disabled={detailLoading}
                      >
                        {detailLoading ? "Carregando..." : "Carregar mais"}
                      </button>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    data-testid="customer-detail-select"
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
                    onClick={() => onSelect(detail.customer)}
                  >
                    Associar à venda
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
