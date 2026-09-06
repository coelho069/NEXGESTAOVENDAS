import { DEMO_STORE_CENTRO, DEMO_STORE_SHOPPING } from "@/lib/domain/catalog";
import {
  attachSettingsMeta,
  defaultStoreSettings,
  validateStoreSettingsWrite,
  type StoreSettingsRecord,
  type StoreSettingsResponse,
  type StoreSettingsWriteInput,
} from "@/lib/domain/store-settings";
import { normalizePaperWidthMm, normalizePrintMode } from "@/lib/domain/printer";
import type { MemberRole } from "@/lib/domain/rbac";
import { canManageStoreSettings } from "@/lib/domain/rbac";

const DEMO_ORG_ID = "11111111-1111-4111-8111-111111111111";
const FIXTURE_SETTINGS_KEY = "nex-pdv-store-settings-fixture-v1";

const STORE_META: Record<string, { name: string; code: string }> = {
  [DEMO_STORE_CENTRO]: { name: "Loja Centro", code: "CENTRO" },
  [DEMO_STORE_SHOPPING]: { name: "Loja Shopping", code: "SHOP" },
};

function readStore(): Record<string, StoreSettingsRecord> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FIXTURE_SETTINGS_KEY) ?? "{}");
    if (!raw || typeof raw !== "object") return {};
    return raw as Record<string, StoreSettingsRecord>;
  } catch {
    return {};
  }
}

function writeStore(rows: Record<string, StoreSettingsRecord>): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(FIXTURE_SETTINGS_KEY, JSON.stringify(rows));
}

function orgInfo() {
  return {
    id: DEMO_ORG_ID,
    name: "Nex Demo",
    currency: "BRL",
    timezone: "America/Sao_Paulo",
  };
}

export function getFixtureStoreSettings(
  storeId: string,
  role: MemberRole | null
): StoreSettingsResponse {
  const meta = STORE_META[storeId] ?? { name: "Loja", code: "LOJA" };
  const rows = readStore();
  const raw = rows[storeId];
  const settings: StoreSettingsRecord = {
    ...defaultStoreSettings(storeId, DEMO_ORG_ID),
    ...raw,
    print_mode: normalizePrintMode(raw?.print_mode),
    paper_width_mm: normalizePaperWidthMm(raw?.paper_width_mm),
  };
  return attachSettingsMeta({
    settings,
    store: {
      id: storeId,
      name: meta.name,
      code: meta.code,
      is_active: true,
    },
    organization: orgInfo(),
    can_edit: canManageStoreSettings(role),
    role,
  });
}

export function upsertFixtureStoreSettings(
  input: StoreSettingsWriteInput,
  role: MemberRole | null
): StoreSettingsResponse {
  if (!canManageStoreSettings(role)) {
    throw new Error("forbidden_settings");
  }
  const validated = validateStoreSettingsWrite(input);
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  const rows = readStore();
  const current = rows[input.store_id] ?? defaultStoreSettings(input.store_id, DEMO_ORG_ID);
  const next: StoreSettingsRecord = {
    ...current,
    ...validated.value,
    store_id: input.store_id,
    org_id: DEMO_ORG_ID,
    updated_at: new Date().toISOString(),
    updated_by: "fixture-user",
  };
  rows[input.store_id] = next;
  writeStore(rows);
  return getFixtureStoreSettings(input.store_id, role);
}

export function resetFixtureStoreSettings() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(FIXTURE_SETTINGS_KEY);
}
