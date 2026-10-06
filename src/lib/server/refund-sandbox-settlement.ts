import type { SupabaseClient } from "@supabase/supabase-js";
import { SANDBOX_PROVIDER_REFUND_ID, redactRefundError } from "@/lib/domain/mercadopago-refund-sandbox";
import { isExactRefundMoney } from "@/lib/domain/mercadopago-refund";
import type { Database } from "@/lib/db/types";

type AdminClient = SupabaseClient<Database>;

type RpcError = { code?: string | null; message?: string | null } | null;

type UntypedRpcClient = {
  rpc(functionName: string, args: Record<string, unknown>): Promise<{ data: unknown; error: RpcError }>;
};

function asRpc(admin: AdminClient): UntypedRpcClient {
  return admin as unknown as UntypedRpcClient;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function withoutFinancialEffect(data: unknown, error: RpcError): Record<string, unknown> {
  if (error) return { ok: false, error: "database", financial_effect: false };
  const record = asRecord(data);
  if (record.financial_effect !== false) {
    return { ok: false, error: "financial_effect_refused", financial_effect: false };
  }
  return { ...record, financial_effect: false };
}

/** Persists a sandbox dispatch. The caller has already validated the snapshot. */
export async function dispatchPersistedSandboxRefund(input: {
  admin: AdminClient;
  refundRequestId: string;
  actorUserId: string;
}): Promise<Record<string, unknown>> {
  const { data, error } = await asRpc(input.admin).rpc("dispatch_sandbox_refund", {
    p_refund_request_id: input.refundRequestId,
    p_actor_user_id: input.actorUserId,
  });
  return withoutFinancialEffect(data, error);
}

/** Stores a mock confirmation. A non-sandbox id never reaches the database. */
export async function completePersistedSandboxRefund(input: {
  admin: AdminClient;
  refundRequestId: string;
  actorUserId: string;
  providerRefundId: string;
  amount: string;
  currency: string;
}): Promise<Record<string, unknown>> {
  if (!SANDBOX_PROVIDER_REFUND_ID.test(input.providerRefundId)) {
    return { ok: false, error: "untrusted_provider_refund_id", financial_effect: false };
  }
  if (input.currency !== "BRL" || !isExactRefundMoney(input.amount)) {
    return { ok: false, error: "snapshot_amount_mismatch", financial_effect: false };
  }
  const { data, error } = await asRpc(input.admin).rpc("complete_sandbox_refund", {
    p_refund_request_id: input.refundRequestId,
    p_actor_user_id: input.actorUserId,
    p_provider_refund_id: input.providerRefundId,
    p_amount: input.amount,
    p_currency: "BRL",
  });
  return withoutFinancialEffect(data, error);
}

export async function failPersistedSandboxRefund(input: {
  admin: AdminClient;
  refundRequestId: string;
  actorUserId: string;
  error: string;
  errorClass: "temporary" | "permanent";
}): Promise<Record<string, unknown>> {
  const { data, error } = await asRpc(input.admin).rpc("fail_sandbox_refund", {
    p_refund_request_id: input.refundRequestId,
    p_actor_user_id: input.actorUserId,
    p_error: redactRefundError(input.error),
    p_error_class: input.errorClass,
  });
  return withoutFinancialEffect(data, error);
}

export async function timeoutPersistedSandboxRefund(input: {
  admin: AdminClient;
  refundRequestId: string;
  actorUserId: string;
}): Promise<Record<string, unknown>> {
  const { data, error } = await asRpc(input.admin).rpc("timeout_sandbox_refund", {
    p_refund_request_id: input.refundRequestId,
    p_actor_user_id: input.actorUserId,
  });
  return withoutFinancialEffect(data, error);
}

export async function retryPersistedSandboxRefund(input: {
  admin: AdminClient;
  refundRequestId: string;
  actorUserId: string;
}): Promise<Record<string, unknown>> {
  const { data, error } = await asRpc(input.admin).rpc("retry_sandbox_refund", {
    p_refund_request_id: input.refundRequestId,
    p_actor_user_id: input.actorUserId,
  });
  return withoutFinancialEffect(data, error);
}
