import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import type {
  FiscalAdapterResult,
  FiscalOperationContext,
  FiscalSnapshot,
} from "@/lib/adapters/fiscal";
import { getFiscalAdapter } from "@/lib/server/fiscal-provider";

type AdminClient = SupabaseClient<Database>;

type FiscalOutboxCommand = {
  outbox_id: string;
  fiscal_document_id: string;
  sale_id: string;
  org_id: string;
  store_id: string;
  operation_id: string;
  operation_type: "issue" | "cancel" | "consult";
  provider: string;
  idempotency_key: string;
  attempt: number;
  snapshot: FiscalSnapshot;
  external_id: string | null;
};

export type FiscalOutboxProcessSummary = {
  claimed: number;
  completed: number;
  pending: number;
  unknown: number;
  failed: number;
  notConfigured: number;
  errors: string[];
};

export async function processFiscalOutbox(
  admin: AdminClient,
  options: { limit?: number; fiscalDocumentId?: string } = {}
): Promise<FiscalOutboxProcessSummary> {
  const { data, error } = await admin.rpc("claim_fiscal_outbox", {
    p_payload: {
      limit: options.limit ?? 10,
      ...(options.fiscalDocumentId ? { fiscal_document_id: options.fiscalDocumentId } : {}),
    },
  });
  if (error) throw error;

  const commands = parseClaimedCommands(data);
  const summary: FiscalOutboxProcessSummary = {
    claimed: commands.length,
    completed: 0,
    pending: 0,
    unknown: 0,
    failed: 0,
    notConfigured: 0,
    errors: [],
  };

  for (const command of commands) {
    const result = await executeFiscalCommand(command);
    const { data: recorded, error: recordError } = await admin.rpc("record_fiscal_result", {
      p_payload: {
        outbox_id: command.outbox_id,
        operation_id: command.operation_id,
        provider: command.provider,
        status: result.status,
        ...(result.externalId || result.providerReference
          ? { external_id: result.externalId ?? result.providerReference }
          : {}),
        ...(result.errorCode ? { error_code: safeErrorCode(result.errorCode) } : {}),
      },
    });

    if (recordError) {
      summary.errors.push(`record_fiscal_result:${command.outbox_id}`);
      continue;
    }

    const recordedStatus = readStringField(recorded, "status") ?? result.status;
    if (recordedStatus === "issued" || recordedStatus === "cancelled") {
      summary.completed += 1;
    } else if (recordedStatus === "pending") {
      summary.pending += 1;
    } else if (recordedStatus === "unknown") {
      summary.unknown += 1;
    } else if (recordedStatus === "not_configured") {
      summary.notConfigured += 1;
    } else {
      summary.failed += 1;
    }
  }

  return summary;
}

async function executeFiscalCommand(
  command: FiscalOutboxCommand
): Promise<FiscalAdapterResult> {
  const adapter = getFiscalAdapter(command.provider);
  const context: FiscalOperationContext = {
    documentId: command.fiscal_document_id,
    saleId: command.sale_id,
    storeId: command.store_id,
    operationId: command.operation_id,
    idempotencyKey: command.idempotency_key,
    snapshot: command.snapshot,
    externalId: command.external_id,
  };

  try {
    return await adapter[command.operation_type](context);
  } catch {
    // Once an external call may have started, the safe answer is UNKNOWN.
    return {
      status: "unknown",
      message: "Falha inesperada no worker fiscal; resultado desconhecido.",
      errorCode: "worker_unknown",
      retryable: true,
    };
  }
}

function parseClaimedCommands(value: Json): FiscalOutboxCommand[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const row = candidate as Record<string, Json | undefined>;
    const operationType = readStringField(row.operation_type);
    const required = [
      row.outbox_id,
      row.fiscal_document_id,
      row.sale_id,
      row.org_id,
      row.store_id,
      row.operation_id,
      row.provider,
      row.idempotency_key,
    ];
    if (
      required.some((field) => typeof field !== "string") ||
      (operationType !== "issue" && operationType !== "cancel" && operationType !== "consult")
    ) {
      return [];
    }

    return [
      {
        outbox_id: row.outbox_id as string,
        fiscal_document_id: row.fiscal_document_id as string,
        sale_id: row.sale_id as string,
        org_id: row.org_id as string,
        store_id: row.store_id as string,
        operation_id: row.operation_id as string,
        operation_type: operationType,
        provider: row.provider as string,
        idempotency_key: row.idempotency_key as string,
        attempt: typeof row.attempt === "number" ? row.attempt : 0,
        snapshot: isSnapshot(row.snapshot) ? (row.snapshot as FiscalSnapshot) : {},
        external_id: typeof row.external_id === "string" ? row.external_id : null,
      },
    ];
  });
}

function isSnapshot(value: Json | undefined): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readStringField(value: unknown, key?: string): string | undefined {
  const candidate = key && value && typeof value === "object" ? (value as Record<string, unknown>)[key] : value;
  return typeof candidate === "string" ? candidate : undefined;
}

function safeErrorCode(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120) || "provider_error";
}
