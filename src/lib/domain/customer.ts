import type { CatalogCustomer } from "@/lib/domain/catalog";

export type CustomerDraft = {
  name: string;
  document: string;
  email: string;
  /** Limite de desconto em R$ (texto livre do formulário, ex.: "30" ou "30,00"). */
  discountLimit: string;
  /** Idade do cliente como string do formulário (vazio = não informado). */
  age: string;
};

export const EMPTY_CUSTOMER_DRAFT: CustomerDraft = {
  name: "",
  document: "",
  email: "",
  discountLimit: "",
  age: "",
};

export function customerDraftFrom(customer: CatalogCustomer | null): CustomerDraft {
  if (!customer) return { ...EMPTY_CUSTOMER_DRAFT };
  return {
    name: customer.name,
    document: customer.document ?? "",
    email: customer.email ?? "",
    discountLimit: customer.discountLimit ?? "",
    age: customer.age != null ? String(customer.age) : "",
  };
}

export function filterCustomers(customers: CatalogCustomer[], query: string): CatalogCustomer[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return customers;
  return customers.filter((customer) => {
    return (
      customer.name.toLowerCase().includes(normalized) ||
      (customer.document ?? "").toLowerCase().includes(normalized)
    );
  });
}

export function upsertCustomer(
  customers: CatalogCustomer[],
  customer: CatalogCustomer
): CatalogCustomer[] {
  const next = customers.filter((item) => item.id !== customer.id);
  next.push(customer);
  return next.sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

export function canWriteCustomers(auth: { orgId: string | null; stores: readonly unknown[] } | null): boolean {
  return Boolean(auth?.orgId && auth.stores.length > 0);
}

export function parseCatalogCustomer(value: unknown): CatalogCustomer | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.name !== "string" || row.name.trim() === "") {
    return null;
  }
  const discountRaw = row.discount_limit ?? row.discountLimit;
  let discountLimit: string | null = null;
  if (typeof discountRaw === "number" && Number.isFinite(discountRaw) && discountRaw >= 0) {
    discountLimit = discountRaw.toFixed(2);
  } else if (typeof discountRaw === "string" && discountRaw.trim()) {
    const n = Number(discountRaw.trim().replace(",", "."));
    discountLimit = Number.isFinite(n) && n >= 0 ? n.toFixed(2) : null;
  }
  const ageRaw = row.age;
  let age: number | null = null;
  if (typeof ageRaw === "number" && Number.isInteger(ageRaw) && ageRaw >= 0 && ageRaw <= 120) {
    age = ageRaw;
  }
  return {
    id: row.id,
    name: row.name,
    document: typeof row.document === "string" ? row.document : null,
    email: typeof row.email === "string" ? row.email : null,
    discountLimit,
    age,
  };
}
