import { v4 as uuidv4 } from "uuid";
import { DEMO_CUSTOMERS, type CatalogCustomer } from "@/lib/domain/catalog";
import {
  filterCustomersLocal,
  validateCustomerFields,
  type CustomerDetailResponse,
  type CustomerRecord,
  type CustomerSearchResponse,
} from "@/lib/domain/customer";

const FIXTURE_CUSTOMERS_KEY = "nex-pdv-customers-fixture-v1";

function readStore(): CustomerRecord[] {
  if (typeof localStorage === "undefined") return [...DEMO_CUSTOMERS];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FIXTURE_CUSTOMERS_KEY) ?? "null");
    if (!Array.isArray(raw) || raw.length === 0) {
      writeStore(DEMO_CUSTOMERS);
      return [...DEMO_CUSTOMERS];
    }
    return raw as CustomerRecord[];
  } catch {
    return [...DEMO_CUSTOMERS];
  }
}

function writeStore(rows: CustomerRecord[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(FIXTURE_CUSTOMERS_KEY, JSON.stringify(rows));
}

export function listFixtureCustomers(): CustomerRecord[] {
  return readStore();
}

export function searchFixtureCustomers(query: string, limit = 20): CustomerSearchResponse {
  return filterCustomersLocal(readStore(), query, limit);
}

export function upsertFixtureCustomer(input: {
  customerId?: string;
  name: string;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  requireDocument?: boolean;
}): CustomerRecord {
  const validated = validateCustomerFields(input);
  if (!validated.ok) throw new Error(validated.error);

  const rows = readStore();
  if (validated.value.document) {
    const conflict = rows.find(
      (row) =>
        row.document === validated.value.document &&
        row.id !== input.customerId
    );
    if (conflict) throw new Error("Já existe cliente com este documento");
  }

  const now = new Date().toISOString();
  if (input.customerId) {
    const index = rows.findIndex((row) => row.id === input.customerId);
    if (index < 0) throw new Error("Cliente não encontrado");
    const next: CustomerRecord = {
      ...rows[index]!,
      name: validated.value.name,
      document: validated.value.document,
      email: validated.value.email,
      phone: validated.value.phone,
      updated_at: now,
    };
    rows[index] = next;
    writeStore(rows);
    return next;
  }

  const created: CustomerRecord = {
    id: uuidv4(),
    name: validated.value.name,
    document: validated.value.document,
    email: validated.value.email,
    phone: validated.value.phone,
    created_at: now,
    updated_at: now,
  };
  writeStore([created, ...rows]);
  return created;
}

export function getFixtureCustomerDetail(customerId: string): CustomerDetailResponse {
  const customer = readStore().find((row) => row.id === customerId);
  if (!customer) throw new Error("Cliente não encontrado");
  return {
    customer,
    sales: [],
    has_more: false,
    next_cursor: null,
  };
}

export function asCatalogCustomers(rows: CustomerRecord[]): CatalogCustomer[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    document: row.document,
    email: row.email,
    phone: row.phone,
  }));
}
