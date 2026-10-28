"use client";

import { useCallback, useEffect, useState } from "react";
import { DEMO_CUSTOMERS, type CatalogCustomer } from "@/lib/domain/catalog";
import {
  parseCatalogCustomer,
  upsertCustomer,
  type CustomerDraft,
} from "@/lib/domain/customer";
import { pdvFixturesEnabled } from "@/lib/pdv/fixtures";
import { customerWriteSchema } from "@/lib/validation/schemas";

export type CustomerWriteResult =
  | { ok: true; customer: CatalogCustomer }
  | { ok: false; error: string };

function normalizeDiscountLimit(raw: string): string | null {
  const cleaned = raw.trim().replace(",", ".");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return n.toFixed(2);
}

function localCustomer(draft: CustomerDraft, id?: string): CatalogCustomer {
  const ageStr = draft.age.trim();
  const ageNum = ageStr ? Number(ageStr) : NaN;
  return {
    id: id ?? crypto.randomUUID(),
    name: draft.name.trim(),
    document: draft.document.trim() || null,
    email: draft.email.trim() || null,
    discountLimit: normalizeDiscountLimit(draft.discountLimit),
    age: Number.isInteger(ageNum) && ageNum >= 0 && ageNum <= 120 ? ageNum : null,
  };
}

function writeErrorMessage(status: number): string {
  if (status === 400) return "Dados inválidos. Nome é obrigatório.";
  if (status === 401 || status === 403) return "Sem permissão para cadastrar clientes.";
  if (status === 404) return "Cliente não encontrado.";
  if (status === 503) return "Serviço temporariamente indisponível.";
  return "Falha ao salvar cliente.";
}

export function useCustomers() {
  const [customers, setCustomers] = useState<CatalogCustomer[]>(() =>
    pdvFixturesEnabled() ? DEMO_CUSTOMERS : []
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/customers", { cache: "no-store" });
      if (!response.ok) {
        setCustomers(pdvFixturesEnabled() ? DEMO_CUSTOMERS : []);
        setError(response.status === 401 ? null : "Clientes indisponíveis.");
        return;
      }

      const data: unknown = await response.json();
      if (!Array.isArray(data)) {
        setCustomers(pdvFixturesEnabled() ? DEMO_CUSTOMERS : []);
        setError("Clientes indisponíveis.");
        return;
      }

      const parsed = data
        .map((row) => parseCatalogCustomer(row))
        .filter((row): row is CatalogCustomer => row != null);
      setCustomers(parsed);
      setError(null);
    } catch {
      setCustomers(pdvFixturesEnabled() ? DEMO_CUSTOMERS : []);
      setError("Clientes indisponíveis.");
    }
  }, []);

  useEffect(() => {
    // Initial catalog loading synchronizes this client with Supabase.
    void load();
  }, [load]);

  const persistLocal = useCallback((customer: CatalogCustomer) => {
    setCustomers((current) => upsertCustomer(current, customer));
    setError(null);
    return customer;
  }, []);

  const createCustomer = useCallback(
    async (draft: CustomerDraft): Promise<CustomerWriteResult> => {
      const parsed = customerWriteSchema.safeParse({
        name: draft.name,
        document: draft.document,
        email: draft.email,
        discount_limit: draft.discountLimit.trim() ? draft.discountLimit : null,
        age: draft.age.trim() || null,
      });
      if (!parsed.success) {
        return { ok: false, error: "Nome é obrigatório." };
      }

      try {
        const response = await fetch("/api/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        });
        if (response.ok) {
          const customer = parseCatalogCustomer(await response.json());
          if (!customer) return { ok: false, error: "Falha ao salvar cliente." };
          await load();
          persistLocal(customer);
          return { ok: true, customer };
        }
        if (pdvFixturesEnabled() && (response.status === 401 || response.status === 503)) {
          return { ok: true, customer: persistLocal(localCustomer(draft)) };
        }
        return { ok: false, error: writeErrorMessage(response.status) };
      } catch {
        if (pdvFixturesEnabled()) {
          return { ok: true, customer: persistLocal(localCustomer(draft)) };
        }
        return { ok: false, error: "Falha ao salvar cliente." };
      }
    },
    [load, persistLocal]
  );

  const updateCustomer = useCallback(
    async (id: string, draft: CustomerDraft): Promise<CustomerWriteResult> => {
      const parsed = customerWriteSchema.safeParse({
        name: draft.name,
        document: draft.document,
        email: draft.email,
        discount_limit: draft.discountLimit.trim() ? draft.discountLimit : null,
        age: draft.age.trim() || null,
      });
      if (!parsed.success) {
        return { ok: false, error: "Nome é obrigatório." };
      }

      try {
        const response = await fetch(`/api/customers/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        });
        if (response.ok) {
          const customer = parseCatalogCustomer(await response.json());
          if (!customer) return { ok: false, error: "Falha ao salvar cliente." };
          await load();
          persistLocal(customer);
          return { ok: true, customer };
        }
        if (pdvFixturesEnabled() && (response.status === 401 || response.status === 503)) {
          return { ok: true, customer: persistLocal(localCustomer(draft, id)) };
        }
        return { ok: false, error: writeErrorMessage(response.status) };
      } catch {
        if (pdvFixturesEnabled()) {
          return { ok: true, customer: persistLocal(localCustomer(draft, id)) };
        }
        return { ok: false, error: "Falha ao salvar cliente." };
      }
    },
    [load, persistLocal]
  );


  const anonymizeCustomer = useCallback(
    async (id: string): Promise<CustomerWriteResult> => {
      try {
        const response = await fetch(`/api/customers/${id}/anonymize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (response.ok) {
          const body: unknown = await response.json();
          const customer = parseCatalogCustomer(
            body && typeof body === "object" && "customer" in body
              ? (body as { customer: unknown }).customer
              : null
          );
          if (!customer) return { ok: false, error: "Falha ao anonimizar cliente." };
          await load();
          persistLocal(customer);
          return { ok: true, customer };
        }
        return { ok: false, error: writeErrorMessage(response.status) };
      } catch {
        return { ok: false, error: "Falha ao anonimizar cliente." };
      }
    },
    [load, persistLocal]
  );

  return { customers, error, reload: load, createCustomer, updateCustomer, anonymizeCustomer };


}
