import type { Json } from "@/lib/db/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { processFiscalOutbox } from "@/lib/server/fiscal-outbox";
import { getFiscalProviderConfig } from "@/lib/server/fiscal-provider";

type AuthenticatedSupabase = Awaited<
  ReturnType<typeof import("@/lib/supabase/server").createClient>
>;

export async function requestFiscalIssueAfterCommit(
  supabase: AuthenticatedSupabase,
  input: { storeId: string; saleId: string; operationId?: string }
): Promise<{ data: Json | null; error: { message: string } | null }> {
  const provider = getFiscalProviderConfig();
  const { data, error } = await supabase.rpc("request_fiscal_issue", {
    p_payload: {
      store_id: input.storeId,
      sale_id: input.saleId,
      ...(input.operationId ? { operation_id: input.operationId } : {}),
      provider: provider.configured ? provider.provider : "not_configured",
    },
  });

  if (error || !provider.configured || !isRecord(data) || data.status !== "pending") {
    return { data, error };
  }

  return settleFiscalOutbox(supabase, data);
}

export async function settleFiscalOutbox(
  supabase: AuthenticatedSupabase,
  response: Json
): Promise<{ data: Json; error: { message: string } | null }> {
  if (!isRecord(response)) return { data: response, error: null };
  const documentId = typeof response.fiscal_document_id === "string"
    ? response.fiscal_document_id
    : null;
  if (!documentId) return { data: response, error: null };

  const admin = createAdminClient();
  if (admin) {
    try {
      await processFiscalOutbox(admin, { limit: 1, fiscalDocumentId: documentId });
    } catch {
      // The durable outbox remains available for the worker. Do not turn a
      // confirmed commercial sale into a failed sale because fiscal dispatch
      // was unavailable.
    }
  }

  const { data: document, error } = await supabase
    .from("fiscal_documents")
    .select(
      "id, sale_id, status, adapter, external_id, operation_id, last_operation, attempt_count, last_error, unknown_at, reconciled_at"
    )
    .eq("id", documentId)
    .maybeSingle();

  if (error || !document) return { data: response, error };
  return {
    data: {
      ...response,
      fiscal_document_id: document.id,
      sale_id: document.sale_id,
      status: document.status,
      provider: document.adapter,
      external_id: document.external_id,
      operation_id: document.operation_id,
      last_operation: document.last_operation,
      attempt: document.attempt_count,
      last_error: document.last_error,
      unknown_at: document.unknown_at,
      reconciled_at: document.reconciled_at,
    },
    error: null,
  };
}

function isRecord(value: Json | null): value is Record<string, Json | undefined> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
