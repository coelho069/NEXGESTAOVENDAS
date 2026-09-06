import { DISCOUNT_LIMIT_PERCENT } from "@/lib/domain/sale-ops";
import type { MemberRole } from "@/lib/domain/rbac";
import type { ReceiptModel } from "@/lib/domain/receipt";
import { getPaymentAdapter } from "@/lib/adapters/payment";
import type { Enums } from "@/lib/db/types";
import {
  isPrintMode,
  normalizePaperWidthMm,
  normalizePrintMode,
  type PaperWidthMm,
  type PrintMode,
  type PrinterConfigView,
} from "@/lib/domain/printer";
import { resolvePrinterConfigView } from "@/lib/adapters/printer";

export type StoreSettingsRecord = {
  store_id: string;
  org_id: string;
  trade_name: string | null;
  document: string | null;
  phone: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  receipt_footer: string | null;
  auto_print_receipt: boolean;
  show_operator_on_receipt: boolean;
  beep_on_scan: boolean;
  require_customer_on_sale: boolean;
  require_open_cash_session: boolean;
  require_customer_document: boolean;
  /** Preferred print transport. Hardware modes stay not_configured without bridge. */
  print_mode: PrintMode;
  /** Thermal paper width in millimeters (58 or 80). */
  paper_width_mm: PaperWidthMm;
  updated_at: string | null;
  updated_by: string | null;
};

export type StoreSettingsStoreInfo = {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
};

export type StoreSettingsOrgInfo = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
};

export type PaymentIntegrationDetail = {
  status: "not_configured" | "configured";
  provider: string;
  message: string;
};

export type IntegrationStatusView = {
  payments: Record<Enums<"payment_method">, "configured" | "not_configured">;
  /** TEF is not a payment_method enum value; surface explicitly when absent. */
  tef: "configured" | "not_configured";
  /** Public PIX provider projection (never includes secrets). */
  pix: PaymentIntegrationDetail;
  /** Public credit card provider projection (never includes secrets). */
  credit_card: PaymentIntegrationDetail;
  /** Public debit card provider projection (never includes secrets). */
  debit_card: PaymentIntegrationDetail;
  /** Public TEF provider projection (never includes secrets). */
  tef_detail: PaymentIntegrationDetail;
  /** Aggregate fiscal projection (never includes secrets/certificates). */
  fiscal: PaymentIntegrationDetail;
  /** Public NFC-e projection (never includes certificate/private key). */
  nfce: PaymentIntegrationDetail;
  /** Public SAT/CF-e-SAT projection (never includes secrets). */
  sat: PaymentIntegrationDetail;
  /** Public printer projection (never includes host/port/secrets). */
  printer: PrinterConfigView;
};

export type StoreCommercialFlags = {
  require_customer_on_sale: boolean;
  require_open_cash_session: boolean;
  require_customer_document: boolean;
};

export type CommercialRuleViolation = {
  code:
    | "customer_required_on_sale"
    | "customer_document_required"
    | "cash_session_required";
  message: string;
};

export type StoreSettingsResponse = {
  settings: StoreSettingsRecord;
  store: StoreSettingsStoreInfo;
  organization: StoreSettingsOrgInfo;
  can_edit: boolean;
  role: MemberRole | null;
  integrations: IntegrationStatusView;
  discount_limits: Record<MemberRole, string>;
};

export type StoreSettingsWriteInput = {
  store_id: string;
  trade_name?: string | null;
  document?: string | null;
  phone?: string | null;
  address_line?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  receipt_footer?: string | null;
  auto_print_receipt?: boolean;
  show_operator_on_receipt?: boolean;
  beep_on_scan?: boolean;
  require_customer_on_sale?: boolean;
  require_open_cash_session?: boolean;
  require_customer_document?: boolean;
  print_mode?: PrintMode;
  paper_width_mm?: PaperWidthMm;
};

const BRAZIL_UFS = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);

export function defaultStoreSettings(storeId: string, orgId: string): StoreSettingsRecord {
  return {
    store_id: storeId,
    org_id: orgId,
    trade_name: null,
    document: null,
    phone: null,
    address_line: null,
    city: null,
    state: null,
    postal_code: null,
    receipt_footer: null,
    auto_print_receipt: false,
    show_operator_on_receipt: true,
    beep_on_scan: true,
    require_customer_on_sale: false,
    require_open_cash_session: false,
    require_customer_document: false,
    print_mode: "browser",
    paper_width_mm: 80,
    updated_at: null,
    updated_by: null,
  };
}

export function resolveFiscalIntegrationStatus(input?: {
  configured?: boolean;
  provider?: string;
  message?: string;
}): PaymentIntegrationDetail {
  if (input?.configured && input.provider) {
    return {
      status: "configured",
      provider: input.provider,
      message: input.message ?? `Provider fiscal ${input.provider} configurado.`,
    };
  }
  return {
    status: "not_configured",
    provider: "not_configured",
    message:
      input?.message ?? "Provider fiscal não configurado; nenhuma emissão será executada.",
  };
}

export function resolveNfceIntegrationStatus(input?: {
  configured?: boolean;
  provider?: string;
  message?: string;
}): PaymentIntegrationDetail {
  if (input?.configured && input.provider) {
    return {
      status: "configured",
      provider: input.provider,
      message: input.message ?? `Provedor NFC-e ${input.provider} configurado.`,
    };
  }
  return {
    status: "not_configured",
    provider: "not_configured",
    message:
      input?.message ??
      "NFC-e não configurada; nenhuma autorização fiscal será inventada.",
  };
}

export function resolveSatIntegrationStatus(input?: {
  configured?: boolean;
  provider?: string;
  message?: string;
}): PaymentIntegrationDetail {
  if (input?.configured && input.provider) {
    return {
      status: "configured",
      provider: input.provider,
      message: input.message ?? `Provedor SAT ${input.provider} configurado.`,
    };
  }
  return {
    status: "not_configured",
    provider: "not_configured",
    message:
      input?.message ??
      "SAT não configurado; nenhum CF-e-SAT será autorizado sem hardware/provedor.",
  };
}

export function resolvePixIntegrationStatus(input?: {
  configured?: boolean;
  provider?: string;
  message?: string;
}): PaymentIntegrationDetail {
  if (input?.configured && input.provider) {
    return {
      status: "configured",
      provider: input.provider,
      message: input.message ?? `Provedor PIX ${input.provider} configurado.`,
    };
  }
  return {
    status: "not_configured",
    provider: "not_configured",
    message:
      input?.message ?? "Provedor PIX não configurado; cobranças PIX não serão iniciadas.",
  };
}

export function resolveCardIntegrationStatus(
  kind: "credit_card" | "debit_card",
  input?: {
    configured?: boolean;
    provider?: string;
    message?: string;
  }
): PaymentIntegrationDetail {
  const label = kind === "debit_card" ? "débito" : "crédito";
  if (input?.configured && input.provider) {
    return {
      status: "configured",
      provider: input.provider,
      message: input.message ?? `Provedor cartão (${label}) ${input.provider} configurado.`,
    };
  }
  return {
    status: "not_configured",
    provider: "not_configured",
    message:
      input?.message ??
      `Provedor cartão (${label}) não configurado; autorizações não serão iniciadas.`,
  };
}

export function resolveTefIntegrationStatus(input?: {
  configured?: boolean;
  provider?: string;
  message?: string;
}): PaymentIntegrationDetail {
  if (input?.configured && input.provider) {
    return {
      status: "configured",
      provider: input.provider,
      message: input.message ?? `Provedor TEF ${input.provider} configurado.`,
    };
  }
  return {
    status: "not_configured",
    provider: "not_configured",
    message:
      input?.message ??
      "Provedor TEF não configurado; transações de terminal não serão iniciadas.",
  };
}

export function buildIntegrationStatusView(
  fiscalOverride?: IntegrationStatusView["fiscal"],
  pixOverride?: IntegrationStatusView["pix"],
  cardOverrides?: {
    credit_card?: PaymentIntegrationDetail;
    debit_card?: PaymentIntegrationDetail;
    tef?: PaymentIntegrationDetail;
    nfce?: PaymentIntegrationDetail;
    sat?: PaymentIntegrationDetail;
  },
  printerOverride?: PrinterConfigView,
  printerSettings?: { print_mode?: PrintMode; paper_width_mm?: PaperWidthMm; auto_print_receipt?: boolean }
): IntegrationStatusView {
  const methods: Enums<"payment_method">[] = ["cash", "card", "pix", "voucher", "other"];
  const payments = methods.reduce(
    (acc, method) => {
      const adapter = getPaymentAdapter(method);
      const result = adapter.process("0.00");
      acc[method] = result.status === "configured" ? "configured" : "not_configured";
      return acc;
    },
    {} as Record<Enums<"payment_method">, "configured" | "not_configured">
  );

  const pix = pixOverride ?? resolvePixIntegrationStatus();
  const credit_card = cardOverrides?.credit_card ?? resolveCardIntegrationStatus("credit_card");
  const debit_card = cardOverrides?.debit_card ?? resolveCardIntegrationStatus("debit_card");
  const tef_detail = cardOverrides?.tef ?? resolveTefIntegrationStatus();
  const nfce = cardOverrides?.nfce ?? resolveNfceIntegrationStatus();
  const sat = cardOverrides?.sat ?? resolveSatIntegrationStatus();
  const fiscal =
    fiscalOverride ??
    resolveFiscalIntegrationStatus({
      configured: nfce.status === "configured" || sat.status === "configured",
      provider:
        nfce.status === "configured"
          ? nfce.provider
          : sat.status === "configured"
            ? sat.provider
            : "not_configured",
      message:
        nfce.status === "configured" || sat.status === "configured"
          ? "Provedor fiscal configurado."
          : "Provider fiscal não configurado; nenhuma emissão será executada.",
    });

  // Keep DB payment projections aligned with public electronic readiness.
  payments.pix = pix.status;
  payments.card =
    credit_card.status === "configured" || debit_card.status === "configured"
      ? "configured"
      : "not_configured";
  payments.other = tef_detail.status;

  const printer =
    printerOverride ??
    resolvePrinterConfigView({
      mode: printerSettings?.print_mode,
      paperWidthMm: printerSettings?.paper_width_mm,
      autoPrintReceipt: printerSettings?.auto_print_receipt,
    });

  return {
    payments,
    tef: tef_detail.status,
    pix,
    credit_card,
    debit_card,
    tef_detail,
    fiscal,
    nfce,
    sat,
    printer,
  };
}

export function attachSettingsMeta(
  payload: {
    settings: StoreSettingsRecord;
    store: StoreSettingsStoreInfo;
    organization: StoreSettingsOrgInfo;
    can_edit: boolean;
    role: MemberRole | string | null;
  },
  options?: {
    fiscal?: IntegrationStatusView["fiscal"];
    pix?: IntegrationStatusView["pix"];
    credit_card?: PaymentIntegrationDetail;
    debit_card?: PaymentIntegrationDetail;
    tef?: PaymentIntegrationDetail;
    nfce?: PaymentIntegrationDetail;
    sat?: PaymentIntegrationDetail;
    printer?: PrinterConfigView;
  }
): StoreSettingsResponse {
  const role =
    payload.role === "admin" || payload.role === "manager" || payload.role === "cashier"
      ? payload.role
      : null;
  const settings = {
    ...payload.settings,
    print_mode: normalizePrintMode(payload.settings.print_mode),
    paper_width_mm: normalizePaperWidthMm(payload.settings.paper_width_mm),
  };
  return {
    ...payload,
    settings,
    role,
    integrations: buildIntegrationStatusView(
      options?.fiscal,
      options?.pix,
      {
        credit_card: options?.credit_card,
        debit_card: options?.debit_card,
        tef: options?.tef,
        nfce: options?.nfce,
        sat: options?.sat,
      },
      options?.printer,
      {
        print_mode: settings.print_mode,
        paper_width_mm: settings.paper_width_mm,
        auto_print_receipt: settings.auto_print_receipt,
      }
    ),
    discount_limits: { ...DISCOUNT_LIMIT_PERCENT },
  };
}

export function normalizeOptionalText(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function normalizeSettingsDocument(value: string | null | undefined): string | null {
  if (value == null) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length === 0 ? null : digits;
}

export function normalizeSettingsPhone(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = value.trim().replace(/[^\d+]/g, "");
  return cleaned.length === 0 ? null : cleaned;
}

export function normalizeSettingsState(value: string | null | undefined): string | null {
  if (value == null) return null;
  const uf = value.trim().toUpperCase();
  return uf.length === 0 ? null : uf;
}

export function normalizeSettingsPostalCode(value: string | null | undefined): string | null {
  if (value == null) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length === 0 ? null : digits;
}

export function validateStoreSettingsWrite(
  input: StoreSettingsWriteInput
): { ok: true; value: StoreSettingsWriteInput } | { ok: false; error: string } {
  const trade_name = normalizeOptionalText(input.trade_name, 120);
  const document = normalizeSettingsDocument(input.document);
  const phone = normalizeSettingsPhone(input.phone);
  const address_line = normalizeOptionalText(input.address_line, 200);
  const city = normalizeOptionalText(input.city, 80);
  const state = normalizeSettingsState(input.state);
  const postal_code = normalizeSettingsPostalCode(input.postal_code);
  const receipt_footer = normalizeOptionalText(input.receipt_footer, 240);
  const print_mode = normalizePrintMode(input.print_mode);
  const paper_width_mm = normalizePaperWidthMm(input.paper_width_mm);

  if (document && !/^\d{11}$/.test(document) && !/^\d{14}$/.test(document)) {
    return { ok: false, error: "Documento deve ser CPF (11) ou CNPJ (14) numérico" };
  }
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 13) {
      return { ok: false, error: "Telefone deve ter entre 10 e 13 dígitos" };
    }
  }
  if (state && !BRAZIL_UFS.has(state)) {
    return { ok: false, error: "UF inválida" };
  }
  if (postal_code && !/^\d{8}$/.test(postal_code)) {
    return { ok: false, error: "CEP deve ter 8 dígitos" };
  }
  if (input.print_mode != null && !isPrintMode(input.print_mode)) {
    return { ok: false, error: "Modo de impressão inválido" };
  }
  if (
    input.paper_width_mm != null &&
    input.paper_width_mm !== 58 &&
    input.paper_width_mm !== 80
  ) {
    return { ok: false, error: "Largura de papel deve ser 58 ou 80 mm" };
  }

  return {
    ok: true,
    value: {
      store_id: input.store_id,
      trade_name,
      document,
      phone,
      address_line,
      city,
      state,
      postal_code,
      receipt_footer,
      auto_print_receipt: Boolean(input.auto_print_receipt),
      show_operator_on_receipt: input.show_operator_on_receipt !== false,
      beep_on_scan: input.beep_on_scan !== false,
      require_customer_on_sale: Boolean(input.require_customer_on_sale),
      require_open_cash_session: Boolean(input.require_open_cash_session),
      require_customer_document: Boolean(input.require_customer_document),
      print_mode,
      paper_width_mm,
    },
  };
}

export function formatStoreAddress(settings: StoreSettingsRecord): string | null {
  const parts = [
    settings.address_line,
    settings.city,
    settings.state,
    settings.postal_code
      ? `${settings.postal_code.slice(0, 5)}-${settings.postal_code.slice(5)}`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function enrichReceiptWithSettings(
  receipt: ReceiptModel,
  settings: StoreSettingsRecord | null | undefined
): ReceiptModel {
  if (!settings) return receipt;
  return {
    ...receipt,
    storeName: settings.trade_name?.trim() || receipt.storeName,
    storeDocument: settings.document,
    storePhone: settings.phone,
    storeAddress: formatStoreAddress(settings),
    receiptFooter: settings.receipt_footer,
    operatorName: settings.show_operator_on_receipt ? receipt.operatorName : null,
    paperWidthMm: normalizePaperWidthMm(settings.paper_width_mm),
  };
}

export function evaluateSaleCommercialRules(input: {
  settings: StoreCommercialFlags | null | undefined;
  customerId: string | null | undefined;
  customerDocument?: string | null | undefined;
  cashSessionOpen: boolean;
}): CommercialRuleViolation | null {
  if (!input.settings) return null;
  if (input.settings.require_customer_on_sale && !input.customerId) {
    return {
      code: "customer_required_on_sale",
      message: "Esta loja exige cliente associado antes de fechar a venda.",
    };
  }
  if (
    input.settings.require_customer_document &&
    input.customerId &&
    !normalizeSettingsDocument(input.customerDocument)
  ) {
    return {
      code: "customer_document_required",
      message: "O cliente associado precisa de documento pelas configurações da loja.",
    };
  }
  if (input.settings.require_open_cash_session && !input.cashSessionOpen) {
    return {
      code: "cash_session_required",
      message: "Abra o caixa desta loja antes de fechar a venda.",
    };
  }
  return null;
}

export function saleBlockedBySettings(input: {
  settings: StoreSettingsRecord | null | undefined;
  customerId: string | null | undefined;
  customerDocument?: string | null | undefined;
  cashSessionOpen: boolean;
}): string | null {
  return evaluateSaleCommercialRules(input)?.message ?? null;
}

/**
 * Normalize partial/missing commercial flags into a complete StoreCommercialFlags.
 * Undefined/null fields become false (explicitly disabled), never left undefined.
 */
export function commercialFlagsFromSettings(
  settings: Partial<StoreCommercialFlags> | null | undefined
): StoreCommercialFlags {
  return {
    require_customer_on_sale: settings?.require_customer_on_sale === true,
    require_open_cash_session: settings?.require_open_cash_session === true,
    require_customer_document: settings?.require_customer_document === true,
  };
}
