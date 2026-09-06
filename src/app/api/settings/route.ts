import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { canManageStoreSettings, canViewStoreSettings } from "@/lib/domain/rbac";
import {
  attachSettingsMeta,
  resolveCardIntegrationStatus,
  resolveFiscalIntegrationStatus,
  resolveNfceIntegrationStatus,
  resolvePixIntegrationStatus,
  resolveSatIntegrationStatus,
  resolveTefIntegrationStatus,
  validateStoreSettingsWrite,
  type StoreSettingsRecord,
  type StoreSettingsOrgInfo,
  type StoreSettingsStoreInfo,
} from "@/lib/domain/store-settings";
import { getPublicFiscalProviderStatus } from "@/lib/server/fiscal-provider";
import { getPublicPaymentProviderStatus } from "@/lib/server/payment-provider";
import {
  storeSettingsQuerySchema,
  storeSettingsWriteSchema,
} from "@/lib/validation/schemas";
import { recordAuditEvent } from "@/lib/server/audit";
import { buildSettingsAuditDiff } from "@/lib/observability/audit";
import { readCorrelationId } from "@/lib/observability/correlation";

function fiscalIntegrationsFromEnv() {
  // Public status only — never forwards URL/API key/certificate to the client.
  // B24 keeps NFC-e/SAT not_configured until certificate vault + live readiness exist.
  const publicStatus = getPublicFiscalProviderStatus();
  const nfce = resolveNfceIntegrationStatus({
    configured: publicStatus.status === "configured" && publicStatus.methods.nfce === "configured",
    provider: publicStatus.provider,
    message: "NFC-e não configurada; nenhuma autorização fiscal será inventada.",
  });
  const sat = resolveSatIntegrationStatus({
    configured: publicStatus.status === "configured" && publicStatus.methods.sat === "configured",
    provider: publicStatus.provider,
    message: "SAT não configurado; nenhum CF-e-SAT será autorizado sem hardware/provedor.",
  });
  const fiscal = resolveFiscalIntegrationStatus({
    configured: publicStatus.status === "configured",
    provider: publicStatus.provider,
    message: publicStatus.message,
  });
  return { fiscal, nfce, sat };
}

function pixIntegrationFromEnv() {
  // Public status only — never forwards URL/API key to the client.
  const publicStatus = getPublicPaymentProviderStatus();
  return resolvePixIntegrationStatus({
    configured: publicStatus.status === "configured" && publicStatus.methods.pix === "configured",
    provider: publicStatus.provider,
    message: publicStatus.message,
  });
}

function cardIntegrationsFromEnv() {
  const publicStatus = getPublicPaymentProviderStatus();
  return {
    credit_card: resolveCardIntegrationStatus("credit_card", {
      configured:
        publicStatus.status === "configured" && publicStatus.methods.credit_card === "configured",
      provider: publicStatus.provider,
      message: "Provedor cartão (crédito) não configurado; autorizações não serão iniciadas.",
    }),
    debit_card: resolveCardIntegrationStatus("debit_card", {
      configured:
        publicStatus.status === "configured" && publicStatus.methods.debit_card === "configured",
      provider: publicStatus.provider,
      message: "Provedor cartão (débito) não configurado; autorizações não serão iniciadas.",
    }),
    tef: resolveTefIntegrationStatus({
      configured: publicStatus.status === "configured" && publicStatus.methods.tef === "configured",
      provider: publicStatus.provider,
      message: "Provedor TEF não configurado; transações de terminal não serão iniciadas.",
    }),
  };
}

function readError(error: { message?: string }, fallback: string) {
  const message = error.message ?? "";
  if (message.includes("forbidden_settings")) {
    return NextResponse.json({ error: "forbidden_settings" }, { status: 403 });
  }
  if (
    message.includes("invalid_settings") ||
    message.includes("invalid_settings_trade_name") ||
    message.includes("invalid_settings_document") ||
    message.includes("invalid_settings_phone") ||
    message.includes("invalid_settings_address") ||
    message.includes("invalid_settings_city") ||
    message.includes("invalid_settings_state") ||
    message.includes("invalid_settings_postal_code") ||
    message.includes("invalid_settings_footer") ||
    message.includes("invalid_settings_print_mode") ||
    message.includes("invalid_settings_paper_width")
  ) {
    return NextResponse.json({ error: "settings_validation_failed", message }, { status: 422 });
  }
  return NextResponse.json({ error: fallback }, { status: 503 });
}

function asResponsePayload(data: unknown) {
  if (!data || typeof data !== "object") {
    return null;
  }
  const raw = data as {
    settings?: StoreSettingsRecord;
    store?: StoreSettingsStoreInfo;
    organization?: StoreSettingsOrgInfo;
    can_edit?: boolean;
    role?: string | null;
  };
  if (!raw.settings || !raw.store || !raw.organization) return null;
  const cards = cardIntegrationsFromEnv();
  const fiscal = fiscalIntegrationsFromEnv();
  return attachSettingsMeta(
    {
      settings: raw.settings,
      store: raw.store,
      organization: raw.organization,
      can_edit: Boolean(raw.can_edit),
      role: raw.role ?? null,
    },
    {
      fiscal: fiscal.fiscal,
      nfce: fiscal.nfce,
      sat: fiscal.sat,
      pix: pixIntegrationFromEnv(),
      credit_card: cards.credit_card,
      debit_card: cards.debit_card,
      tef: cards.tef,
    }
  );
}

export async function GET(request: Request) {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const parsed = storeSettingsQuerySchema.safeParse({
    store_id: url.searchParams.get("store_id"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role || !canViewStoreSettings(auth.role)) {
    return NextResponse.json({ error: "forbidden_settings" }, { status: 403 });
  }

  const { data, error } = await supabase.rpc("get_store_settings", {
    p_payload: { store_id: parsed.data.store_id },
  });
  if (error) return readError(error, "settings_unavailable");

  const payload = asResponsePayload(data);
  if (!payload) {
    return NextResponse.json({ error: "settings_unavailable" }, { status: 503 });
  }
  return NextResponse.json(payload);
}

export async function PUT(request: Request) {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = storeSettingsWriteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const authEarly = await getAuthedContext(parsed.data.store_id);
  const correlationIdEarly = readCorrelationId(request.headers);

  const domain = validateStoreSettingsWrite(parsed.data);
  if (!domain.ok) {
    if (authEarly?.orgId && authEarly.storeId && canManageStoreSettings(authEarly.role)) {
      void recordAuditEvent({
        storeId: authEarly.storeId,
        orgId: authEarly.orgId,
        actorUserId: authEarly.userId,
        actorRole: authEarly.role,
        action: "settings.updated",
        resourceType: "store_settings",
        resourceId: authEarly.storeId,
        result: "rejected",
        correlationId: correlationIdEarly,
        metadata: { route: "settings.put", reason: "validation", code: domain.error },
        mode: "best_effort",
      });
    }
    return NextResponse.json(
      { error: "settings_validation_failed", message: domain.error },
      { status: 422 }
    );
  }

  const auth = authEarly;
  if (!auth?.orgId || !auth.role || !canManageStoreSettings(auth.role)) {
    if (auth?.orgId && auth.storeId) {
      void recordAuditEvent({
        storeId: auth.storeId,
        orgId: auth.orgId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: "security.access_denied",
        resourceType: "store_settings",
        resourceId: auth.storeId,
        result: "denied",
        correlationId: correlationIdEarly,
        metadata: { route: "settings.put", reason: "rbac" },
        mode: "best_effort",
      });
    }
    return NextResponse.json({ error: "forbidden_settings" }, { status: 403 });
  }

  const correlationId = correlationIdEarly;
  const { data, error } = await supabase.rpc("upsert_store_settings", {
    p_payload: {
      store_id: domain.value.store_id,
      trade_name: domain.value.trade_name,
      document: domain.value.document,
      phone: domain.value.phone,
      address_line: domain.value.address_line,
      city: domain.value.city,
      state: domain.value.state,
      postal_code: domain.value.postal_code,
      receipt_footer: domain.value.receipt_footer,
      auto_print_receipt: domain.value.auto_print_receipt,
      show_operator_on_receipt: domain.value.show_operator_on_receipt,
      beep_on_scan: domain.value.beep_on_scan,
      require_customer_on_sale: domain.value.require_customer_on_sale,
      require_open_cash_session: domain.value.require_open_cash_session,
      require_customer_document: domain.value.require_customer_document,
      print_mode: domain.value.print_mode,
      paper_width_mm: domain.value.paper_width_mm,
    },
  });
  const storeId = auth.storeId ?? domain.value.store_id;
  if (error) {
    void recordAuditEvent({
      storeId,
      orgId: auth.orgId,
      actorUserId: auth.userId,
      actorRole: auth.role,
      action: "settings.updated",
      resourceType: "store_settings",
      resourceId: storeId,
      result: "failure",
      correlationId,
      metadata: { route: "settings.put", reason: "rpc_error" },
      mode: "best_effort",
    });
    return readError(error, "settings_write_unavailable");
  }

  const payload = asResponsePayload(data);
  if (!payload) {
    return NextResponse.json({ error: "settings_write_unavailable" }, { status: 503 });
  }

  const diff = buildSettingsAuditDiff(null, {
    trade_name: domain.value.trade_name,
    auto_print_receipt: domain.value.auto_print_receipt,
    show_operator_on_receipt: domain.value.show_operator_on_receipt,
    beep_on_scan: domain.value.beep_on_scan,
    require_customer_on_sale: domain.value.require_customer_on_sale,
    require_open_cash_session: domain.value.require_open_cash_session,
    require_customer_document: domain.value.require_customer_document,
    print_mode: domain.value.print_mode,
    paper_width_mm: domain.value.paper_width_mm,
    // Sensitive commercial fields: names only via buildSettingsAuditDiff.
    document: domain.value.document,
    phone: domain.value.phone,
    address_line: domain.value.address_line,
  });
  void recordAuditEvent({
    storeId,
    orgId: auth.orgId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: "settings.updated",
    resourceType: "store_settings",
    resourceId: storeId,
    result: "success",
    correlationId,
    metadata: {
      route: "settings.put",
      fields: diff.map((entry) => entry.field),
      changes: diff,
    },
    mode: "best_effort",
  });

  const printerFields = diff.filter((entry) =>
    entry.field === "print_mode" || entry.field === "paper_width_mm"
  );
  if (printerFields.length > 0) {
    void recordAuditEvent({
      storeId,
      orgId: auth.orgId,
      actorUserId: auth.userId,
      actorRole: auth.role,
      action: "printer.configuration_updated",
      resourceType: "store_settings",
      resourceId: storeId,
      result: "success",
      correlationId,
      metadata: {
        route: "settings.put",
        fields: printerFields.map((entry) => entry.field),
        changes: printerFields,
      },
      mode: "best_effort",
    });
  }

  return NextResponse.json(payload);
}
