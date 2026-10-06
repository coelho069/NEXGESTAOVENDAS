import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

type AdminClient = SupabaseClient<Database>;

type RpcError = { code?: string | null; message?: string | null } | null;

type UntypedRpcClient = {
  rpc(
    functionName: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: RpcError }>;
};

function asRpc(admin: AdminClient): UntypedRpcClient {
  return admin as unknown as UntypedRpcClient;
}

export type PersistedRefundClaim = {
  acquired: boolean;
  reason: string;
  idempotencyKey: string | null;
  processingState: string | null;
  processingAttempts: number | null;
  providerRefundStatus: "not_sent" | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readClaim(data: unknown): PersistedRefundClaim {
  const record = asRecord(data);
  const providerStatus = record.provider_refund_status;
  return {
    acquired: record.acquired === true,
    reason: typeof record.reason === "string" ? record.reason : "unknown",
    idempotencyKey: typeof record.idempotency_key === "string" ? record.idempotency_key : null,
    processingState: typeof record.processing_state === "string" ? record.processing_state : null,
    processingAttempts:
      typeof record.processing_attempts === "number" ? record.processing_attempts : null,
    providerRefundStatus: providerStatus === "not_sent" ? "not_sent" : null,
  };
}

/** The database assigns the key. A browser-supplied key is not an argument. */
export async function claimPersistedRefundProcessing(input: {
  admin: AdminClient;
  refundRequestId: string;
  retry?: boolean;
}): Promise<PersistedRefundClaim> {
  const { data, error } = await asRpc(input.admin).rpc("claim_refund_processing", {
    p_refund_request_id: input.refundRequestId,
    p_retry: input.retry === true,
  });
  if (error) {
    return {
      acquired: false,
      reason: "database",
      idempotencyKey: null,
      processingState: null,
      processingAttempts: null,
      providerRefundStatus: null,
    };
  }
  return readClaim(data);
}

export async function completePersistedRefundDryRun(input: {
  admin: AdminClient;
  refundRequestId: string;
}): Promise<Record<string, unknown>> {
  const { data, error } = await asRpc(input.admin).rpc("complete_refund_processing_dry_run", {
    p_refund_request_id: input.refundRequestId,
  });
  if (error) return { ok: false, error: "database" };
  return asRecord(data);
}

export async function failPersistedRefundProcessing(input: {
  admin: AdminClient;
  refundRequestId: string;
  error: string;
}): Promise<Record<string, unknown>> {
  const { data, error } = await asRpc(input.admin).rpc("fail_refund_processing", {
    p_refund_request_id: input.refundRequestId,
    p_error: input.error,
  });
  if (error) return { ok: false, error: "database" };
  return asRecord(data);
}
