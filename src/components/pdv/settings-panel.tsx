"use client";

import { useEffect, useState } from "react";
import type { StoreSettingsRecord, StoreSettingsResponse } from "@/lib/domain/store-settings";
import type { PaperWidthMm, PrintMode } from "@/lib/domain/printer";
import { normalizePaperWidthMm, normalizePrintMode } from "@/lib/domain/printer";

type SettingsFormState = {
  trade_name: string;
  document: string;
  phone: string;
  address_line: string;
  city: string;
  state: string;
  postal_code: string;
  receipt_footer: string;
  auto_print_receipt: boolean;
  show_operator_on_receipt: boolean;
  beep_on_scan: boolean;
  require_customer_on_sale: boolean;
  require_open_cash_session: boolean;
  require_customer_document: boolean;
  print_mode: PrintMode;
  paper_width_mm: PaperWidthMm;
};

function toForm(settings: StoreSettingsRecord | null | undefined): SettingsFormState {
  return {
    trade_name: settings?.trade_name ?? "",
    document: settings?.document ?? "",
    phone: settings?.phone ?? "",
    address_line: settings?.address_line ?? "",
    city: settings?.city ?? "",
    state: settings?.state ?? "",
    postal_code: settings?.postal_code ?? "",
    receipt_footer: settings?.receipt_footer ?? "",
    auto_print_receipt: Boolean(settings?.auto_print_receipt),
    show_operator_on_receipt: settings?.show_operator_on_receipt !== false,
    beep_on_scan: settings?.beep_on_scan !== false,
    require_customer_on_sale: Boolean(settings?.require_customer_on_sale),
    require_open_cash_session: Boolean(settings?.require_open_cash_session),
    require_customer_document: Boolean(settings?.require_customer_document),
    print_mode: normalizePrintMode(settings?.print_mode),
    paper_width_mm: normalizePaperWidthMm(settings?.paper_width_mm),
  };
}

type SettingsPanelProps = {
  open: boolean;
  data: StoreSettingsResponse | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  savedAt: string | null;
  onSave: (input: SettingsFormState) => Promise<unknown>;
  onRefresh: () => void;
  onClose: () => void;
};

function Toggle({
  checked,
  disabled,
  label,
  testId,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  testId: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
      <span>{label}</span>
      <input
        type="checkbox"
        data-testid={testId}
        className="h-4 w-4"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export function SettingsPanel({
  open,
  data,
  loading,
  saving,
  error,
  savedAt,
  onSave,
  onRefresh,
  onClose,
}: SettingsPanelProps) {
  const [form, setForm] = useState<SettingsFormState>(() => toForm(data?.settings));
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(toForm(data?.settings));
    setLocalError(null);
  }, [open, data?.settings]);

  if (!open) return null;

  const canEdit = Boolean(data?.can_edit);
  const readOnly = !canEdit;

  return (
    <div data-testid="settings-panel" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="Fechar configurações"
        onClick={onClose}
      />
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Configurações do PDV</h2>
            <p className="text-xs text-slate-500">
              {data?.store.name ?? "Loja"} · {data?.organization.name ?? "Organização"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="settings-refresh"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
              onClick={onRefresh}
            >
              Atualizar
            </button>
            <button
              type="button"
              data-testid="settings-close"
              className="text-sm text-slate-500"
              onClick={onClose}
            >
              Fechar
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {loading && !data ? (
            <p data-testid="settings-loading" className="text-sm text-slate-500">
              Carregando configurações...
            </p>
          ) : null}

          {!loading && !data && error ? (
            <p data-testid="settings-error" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          {data ? (
            <>
              {readOnly ? (
                <p
                  data-testid="settings-readonly"
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                >
                  Visualização apenas. Alterações exigem perfil gerente ou admin.
                </p>
              ) : null}

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-800">Dados comerciais da loja</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-slate-600">
                    Nome fantasia
                    <input
                      data-testid="settings-trade-name"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={form.trade_name}
                      disabled={readOnly || saving}
                      onChange={(event) => setForm((current) => ({ ...current, trade_name: event.target.value }))}
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    CPF/CNPJ
                    <input
                      data-testid="settings-document"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={form.document}
                      disabled={readOnly || saving}
                      onChange={(event) => setForm((current) => ({ ...current, document: event.target.value }))}
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    Telefone
                    <input
                      data-testid="settings-phone"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={form.phone}
                      disabled={readOnly || saving}
                      onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    Endereço
                    <input
                      data-testid="settings-address"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={form.address_line}
                      disabled={readOnly || saving}
                      onChange={(event) => setForm((current) => ({ ...current, address_line: event.target.value }))}
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    Cidade
                    <input
                      data-testid="settings-city"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={form.city}
                      disabled={readOnly || saving}
                      onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-sm text-slate-600">
                      UF
                      <input
                        data-testid="settings-state"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 uppercase"
                        maxLength={2}
                        value={form.state}
                        disabled={readOnly || saving}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, state: event.target.value.toUpperCase() }))
                        }
                      />
                    </label>
                    <label className="text-sm text-slate-600">
                      CEP
                      <input
                        data-testid="settings-postal-code"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                        value={form.postal_code}
                        disabled={readOnly || saving}
                        onChange={(event) => setForm((current) => ({ ...current, postal_code: event.target.value }))}
                      />
                    </label>
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Moeda {data.organization.currency} · fuso {data.organization.timezone} (fixos da organização)
                </p>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-800">Preferências do PDV e impressão</h3>
                <label className="block text-sm text-slate-600">
                  Rodapé do recibo
                  <textarea
                    data-testid="settings-receipt-footer"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    rows={2}
                    value={form.receipt_footer}
                    disabled={readOnly || saving}
                    onChange={(event) => setForm((current) => ({ ...current, receipt_footer: event.target.value }))}
                  />
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-sm text-slate-600">
                    Modo de impressão
                    <select
                      data-testid="settings-print-mode"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={form.print_mode}
                      disabled={readOnly || saving}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          print_mode: normalizePrintMode(event.target.value),
                        }))
                      }
                    >
                      <option value="browser">Navegador</option>
                      <option value="escpos">ESC/POS (USB/bridge)</option>
                      <option value="network">Rede (bridge local)</option>
                      <option value="native">Nativo (Electron/Tauri)</option>
                    </select>
                  </label>
                  <label className="block text-sm text-slate-600">
                    Largura do papel
                    <select
                      data-testid="settings-paper-width"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={form.paper_width_mm}
                      disabled={readOnly || saving}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          paper_width_mm: normalizePaperWidthMm(Number(event.target.value)),
                        }))
                      }
                    >
                      <option value={58}>58mm</option>
                      <option value={80}>80mm</option>
                    </select>
                  </label>
                </div>
                <div
                  data-testid="settings-printer-status"
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
                >
                  Impressora configurada:{" "}
                  <strong>{data.integrations.printer.printerConfigured ? "sim" : "não"}</strong>
                  {" · "}
                  status: <strong>{data.integrations.printer.status}</strong>
                  {" · "}
                  {data.integrations.printer.message}
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <Toggle
                    label="Imprimir recibo automaticamente"
                    testId="settings-auto-print"
                    checked={form.auto_print_receipt}
                    disabled={readOnly || saving}
                    onChange={(value) => setForm((current) => ({ ...current, auto_print_receipt: value }))}
                  />
                  <Toggle
                    label="Exibir operador no recibo"
                    testId="settings-show-operator"
                    checked={form.show_operator_on_receipt}
                    disabled={readOnly || saving}
                    onChange={(value) => setForm((current) => ({ ...current, show_operator_on_receipt: value }))}
                  />
                  <Toggle
                    label="Beep ao escanear"
                    testId="settings-beep-on-scan"
                    checked={form.beep_on_scan}
                    disabled={readOnly || saving}
                    onChange={(value) => setForm((current) => ({ ...current, beep_on_scan: value }))}
                  />
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-800">Venda, caixa e clientes</h3>
                <div className="grid gap-2 md:grid-cols-2">
                  <Toggle
                    label="Exigir cliente na venda"
                    testId="settings-require-customer"
                    checked={form.require_customer_on_sale}
                    disabled={readOnly || saving}
                    onChange={(value) => setForm((current) => ({ ...current, require_customer_on_sale: value }))}
                  />
                  <Toggle
                    label="Exigir caixa aberto"
                    testId="settings-require-cash"
                    checked={form.require_open_cash_session}
                    disabled={readOnly || saving}
                    onChange={(value) => setForm((current) => ({ ...current, require_open_cash_session: value }))}
                  />
                  <Toggle
                    label="Exigir documento no cadastro de cliente"
                    testId="settings-require-customer-document"
                    checked={form.require_customer_document}
                    disabled={readOnly || saving}
                    onChange={(value) => setForm((current) => ({ ...current, require_customer_document: value }))}
                  />
                </div>
                <div
                  data-testid="settings-discount-limits"
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
                >
                  Limites de desconto (fixos do sistema): caixa {data.discount_limits.cashier}% · gerente{" "}
                  {data.discount_limits.manager}% · admin {data.discount_limits.admin}%
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-800">Integrações</h3>
                <div
                  data-testid="settings-integrations"
                  className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700"
                >
                  <p>
                    Pagamentos: dinheiro <strong>{data.integrations.payments.cash}</strong> · cartão{" "}
                    <strong>{data.integrations.payments.card}</strong> · pix{" "}
                    <strong>{data.integrations.payments.pix}</strong> · TEF{" "}
                    <strong>{data.integrations.tef}</strong>
                  </p>
                  <p data-testid="settings-pix-provider">
                    PIX ({data.integrations.pix.provider}):{" "}
                    <strong>{data.integrations.pix.status}</strong>
                  </p>
                  <p className="text-xs text-slate-500">{data.integrations.pix.message}</p>
                  <p data-testid="settings-credit-card-provider">
                    Crédito ({data.integrations.credit_card.provider}):{" "}
                    <strong>{data.integrations.credit_card.status}</strong>
                  </p>
                  <p className="text-xs text-slate-500">{data.integrations.credit_card.message}</p>
                  <p data-testid="settings-debit-card-provider">
                    Débito ({data.integrations.debit_card.provider}):{" "}
                    <strong>{data.integrations.debit_card.status}</strong>
                  </p>
                  <p className="text-xs text-slate-500">{data.integrations.debit_card.message}</p>
                  <p data-testid="settings-tef-provider">
                    TEF ({data.integrations.tef_detail.provider}):{" "}
                    <strong>{data.integrations.tef_detail.status}</strong>
                  </p>
                  <p className="text-xs text-slate-500">{data.integrations.tef_detail.message}</p>
                  <p data-testid="settings-fiscal-provider">
                    Fiscal ({data.integrations.fiscal.provider}):{" "}
                    <strong>{data.integrations.fiscal.status}</strong>
                  </p>
                  <p className="text-xs text-slate-500">{data.integrations.fiscal.message}</p>
                  <p data-testid="settings-nfce-provider">
                    NFC-e ({data.integrations.nfce.provider}):{" "}
                    <strong>{data.integrations.nfce.status}</strong>
                  </p>
                  <p className="text-xs text-slate-500">{data.integrations.nfce.message}</p>
                  <p data-testid="settings-sat-provider">
                    SAT ({data.integrations.sat.provider}):{" "}
                    <strong>{data.integrations.sat.status}</strong>
                  </p>
                  <p className="text-xs text-slate-500">{data.integrations.sat.message}</p>
                  <p className="text-xs text-amber-800">
                    Provedores externos permanecem indisponíveis até configuração real. Nenhum segredo,
                    certificado ou private key é armazenado nesta tela.
                  </p>
                </div>
              </section>
            </>
          ) : null}

          {localError || error ? (
            <p data-testid="settings-form-error" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {localError ?? error}
            </p>
          ) : null}
          {savedAt ? (
            <p data-testid="settings-saved" className="text-sm text-emerald-700">
              Configurações salvas.
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            data-testid="settings-save"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={readOnly || saving || !data}
            onClick={() => {
              setLocalError(null);
              void onSave(form).catch((cause: unknown) => {
                setLocalError(cause instanceof Error ? cause.message : "Falha ao salvar");
              });
            }}
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
