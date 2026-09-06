import type { CatalogCustomer } from "@/lib/domain/catalog";

export type CustomerRecord = CatalogCustomer & {
  created_at?: string;
  updated_at?: string;
};

export type CustomerSaleHistoryItem = {
  sale_id: string;
  store_id: string;
  status: string;
  total: string;
  created_at: string;
  confirmed_at: string | null;
  payment_method: string | null;
};

export type CustomerDetailResponse = {
  customer: CustomerRecord;
  sales: CustomerSaleHistoryItem[];
  has_more: boolean;
  next_cursor: { after_created_at: string; after_id: string } | null;
};

export type CustomerSearchResponse = {
  rows: CustomerRecord[];
  has_more: boolean;
  next_cursor: { after_name: string; after_id: string } | null;
};

export function normalizeCustomerDocument(value: string | null | undefined): string | null {
  if (value == null) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length === 0 ? null : digits;
}

export function normalizeCustomerPhone(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[^\d+]/g, "");
  return cleaned.length === 0 ? null : cleaned;
}

export function normalizeCustomerEmail(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

export function normalizeCustomerName(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length === 0 ? null : trimmed;
}

export function validateCustomerFields(input: {
  name: string;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  requireDocument?: boolean;
}): { ok: true; value: CustomerRecord } | { ok: false; error: string } {
  const name = normalizeCustomerName(input.name);
  if (!name || name.length < 2 || name.length > 120) {
    return { ok: false, error: "Nome deve ter entre 2 e 120 caracteres" };
  }

  const document = normalizeCustomerDocument(input.document);
  if (input.requireDocument && !document) {
    return { ok: false, error: "Documento obrigatório pelas configurações da loja" };
  }
  if (document && !/^\d{11}$/.test(document) && !/^\d{14}$/.test(document)) {
    return { ok: false, error: "Documento deve ser CPF (11) ou CNPJ (14) numérico" };
  }

  const email = normalizeCustomerEmail(input.email);
  if (email && (email.length > 254 || !/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(email))) {
    return { ok: false, error: "E-mail inválido" };
  }

  const phone = normalizeCustomerPhone(input.phone);
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 13) {
      return { ok: false, error: "Telefone deve ter entre 10 e 13 dígitos" };
    }
  }

  return {
    ok: true,
    value: {
      id: "",
      name,
      document,
      email,
      phone,
    },
  };
}

export function filterCustomersLocal(
  customers: CustomerRecord[],
  query: string,
  limit = 20
): CustomerSearchResponse {
  const needle = query.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  const filtered = [...customers]
    .filter((customer) => {
      if (!needle) return true;
      const haystack = [customer.name, customer.document ?? "", customer.email ?? "", customer.phone ?? ""]
        .join(" ")
        .toLowerCase();
      if (haystack.includes(needle)) return true;
      if (digits && (customer.document ?? "").includes(digits)) return true;
      if (digits && (customer.phone ?? "").replace(/\D/g, "").includes(digits)) return true;
      return false;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id));

  const page = filtered.slice(0, limit + 1);
  const hasMore = page.length > limit;
  const rows = page.slice(0, limit);
  const last = rows.at(-1);
  return {
    rows,
    has_more: hasMore,
    next_cursor: hasMore && last ? { after_name: last.name, after_id: last.id } : null,
  };
}
