"use client";

import { useCallback, useEffect, useState } from "react";
import { DEMO_CUSTOMERS, type CatalogCustomer } from "@/lib/domain/catalog";
import {
  parseCatalogCustomer,
  upsertCustomer,
  type CustomerDraft,
} from "@/lib/domain/customer";
import { pdvFixturesEnabled } from "@/lib/pdv/fixtures";
import { createClient } from "@/lib/supabase/client";
import { customerWriteSchema } from "@/lib/validation/schemas";

export type CustomerWriteResult =
  | { ok: true; customer: CatalogCustomer }
  | { ok: false; error: string };

function localCustomer(draft: CustomerDraft, id?: string): CatalogCustomer {
  return {
    id: id ?? crypto.randomUUID(),
    name: draft.name.trim(),
    document: draft.document.trim() || null,
    email: draft.email.trim() || null,
  };
}

function writeErrorMessage(status: number): string {
  if (status === 400) return "Dados inválidos. Nome é obrigatório.";
  if (status === 401 || status === 403) return "Sem permissão para cadastrar clientes.";
  if (status === 404) return "Cliente não encontrado.";
  return "Falha ao salvar cliente.";
}

export function useCustomers() {
  const [customers, setCustomers] = useState<CatalogCustomer[]>(() =>
    pdvFixturesEnabled() ? DEMO_CUSTOMERS : []
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error: queryError } = await supabase
        .from("customers")
        .select("id, name, document, email")
        .order("name");

      if (queryError || !data) {
        setCustomers(pdvFixturesEnabled() ? DEMO_CUSTOMERS : []);
        setError(queryError ? "Clientes indisponíveis." : null);
        return;
      }

      setCustomers(data as CatalogCustomer[]);
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

  return { customers, error, reload: load, createCustomer, updateCustomer };
}
