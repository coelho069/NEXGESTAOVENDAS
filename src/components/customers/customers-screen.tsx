"use client";

import { useState } from "react";
import type { CustomerRow } from "@/lib/server/customers-query";

type CustomerFormData = {
  name: string;
  document: string;
  phone: string;
  email: string;
  age: string;
};

const emptyForm: CustomerFormData = { name: "", document: "", phone: "", email: "", age: "" };

type Props = {
  storeId: string | null;
  canEdit: boolean;
  initialRows: CustomerRow[];
};

export function CustomersScreen({ canEdit, initialRows }: Props) {
  const [rows, setRows] = useState<CustomerRow[]>(initialRows);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CustomerFormData>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function openNew() {
    setEditingId(null);
    setForm(emptyForm);
    setFieldErrors({});
    setGlobalError(null);
    setShowForm(true);
  }

  function openEdit(row: CustomerRow) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      document: row.document ?? "",
      phone: row.phone ?? "",
      email: row.email ?? "",
      age: row.age != null ? String(row.age) : "",
    });
    setFieldErrors({});
    setGlobalError(null);
    setShowForm(true);
  }

  function cancel() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setFieldErrors({});
    setGlobalError(null);
  }

  async function save() {
    setFieldErrors({});
    setGlobalError(null);

    const ageRaw = form.age.trim();
    let ageVal: number | null = null;
    if (ageRaw !== "") {
      const n = Number(ageRaw);
      if (!Number.isInteger(n) || n < 0 || n > 120) {
        setFieldErrors({ age: "Idade deve ser um número inteiro entre 0 e 120." });
        return;
      }
      ageVal = n;
    }

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      document: form.document.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      age: ageVal,
    };

    setSaving(true);
    try {
      const url = editingId ? `/api/customers/${editingId}` : "/api/customers";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        if (json.details && typeof json.details === "object") {
          const flat = json.details as { fieldErrors?: Record<string, string[]> };
          const errs: Record<string, string> = {};
          for (const [key, msgs] of Object.entries(flat.fieldErrors ?? {})) {
            errs[key] = Array.isArray(msgs) ? (msgs[0] ?? "") : String(msgs);
          }
          setFieldErrors(errs);
        } else {
          setGlobalError(String(json.error ?? "Erro ao salvar cliente."));
        }
        return;
      }

      const saved = json as CustomerRow;
      if (editingId) {
        setRows((prev) => prev.map((r) => (r.id === editingId ? saved : r)));
      } else {
        setRows((prev) => [...prev, saved].sort((a, b) => a.name.localeCompare(b.name)));
      }
      cancel();
    } catch {
      setGlobalError("Erro de rede. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Clientes</h1>
        {canEdit && (
          <button
            type="button"
            onClick={openNew}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Novo cliente
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold">{editingId ? "Editar cliente" : "Novo cliente"}</h2>

          {globalError && (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{globalError}</p>
          )}

          <div className="space-y-3">
            <Field label="Nome *" error={fieldErrors.name}>
              <input
                className={inputCls(!!fieldErrors.name)}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Nome completo"
              />
            </Field>
            <Field label="Documento (CPF/CNPJ)" error={fieldErrors.document}>
              <input
                className={inputCls(!!fieldErrors.document)}
                value={form.document}
                onChange={(e) => setForm((f) => ({ ...f, document: e.target.value }))}
                placeholder="000.000.000-00"
              />
            </Field>
            <Field label="Telefone" error={fieldErrors.phone}>
              <input
                className={inputCls(!!fieldErrors.phone)}
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="(11) 99999-9999"
              />
            </Field>
            <Field label="E-mail" error={fieldErrors.email}>
              <input
                type="email"
                className={inputCls(!!fieldErrors.email)}
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="email@exemplo.com"
              />
            </Field>
            <Field label="Idade" error={fieldErrors.age}>
              <input
                type="number"
                min={0}
                max={120}
                className={inputCls(!!fieldErrors.age)}
                value={form.age}
                onChange={(e) => setForm((f) => ({ ...f, age: e.target.value }))}
                placeholder="Deixe em branco se não souber"
              />
            </Field>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
            <button
              type="button"
              onClick={cancel}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum cliente cadastrado.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div>
                <div className="font-medium text-slate-800">{row.name}</div>
                <div className="text-xs text-slate-500">
                  {[row.document, row.phone, row.email].filter(Boolean).join(" · ")}
                  {row.age != null ? ` · ${row.age} anos` : ""}
                </div>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => openEdit(row)}
                  className="ml-4 rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Editar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function inputCls(hasError: boolean) {
  return `w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500 ${
    hasError ? "border-red-400 bg-red-50" : "border-slate-300"
  }`;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      {children}
      {error && <p className="mt-0.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}
