import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { processSaleInputSchema, storeIdSchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";
import { discountLimitHttpStatus, salePayloadExceedsDiscountCap } from "@/lib/domain/sale-ops";
import { mapProcessSaleRpcError, rpcFailureLogFields } from "@/lib/domain/sale-process-error";
import { loadStoreSalePolicy } from "@/lib/server/store-sale-policy";
import { requestFiscalIssueAfterCommit } from "@/lib/server/fiscal-operation";
import {
  createRequestObservability,
  observeApiResult,
} from "@/lib/observability/request-context";

export async function POST(request: Request) {
  const obs = createRequestObservability(request, "sales.process");
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    observeApiResult(obs, "server_error", { error: "auth_not_configured" });
    return obs.withHeaders(NextResponse.json({ error: "auth_not_configured" }, { status: 503 }));
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    observeApiResult(obs, "rejected", { error: "Unauthorized" });
    return obs.withHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const requestedStoreId =
    json && typeof json === "object" && "store_id" in json
      ? (json as { store_id?: unknown }).store_id
      : undefined;
  const storeIdResult = storeIdSchema.safeParse(requestedStoreId);
  if (!storeIdResult.success) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  const parsed = processSaleInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const hasNonCash = parsed.data.payments.some((payment) => payment.method !== "cash");
  if (hasNonCash) {
    return NextResponse.json(
      { error: "payment_method_not_configured", adapter_status: "not_configured" },
      { status: 422 }
    );
  }
  if (!parsed.data.cash_session_id || !parsed.data.terminal_id) {
    return NextResponse.json(
      {
        error: "cash_session_required",
        message: "Venda em dinheiro exige sessão de caixa aberta e terminal identificado.",
      },
      { status: 409 }
    );
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  if (salePayloadExceedsDiscountCap(parsed.data, auth.role)) {
    return NextResponse.json({ error: "discount_limit_exceeded" }, { status: discountLimitHttpStatus(true) });
  }

  const salePolicy = await loadStoreSalePolicy(supabase, parsed.data.store_id);
  if (salePolicy.requireCustomerOnSale && !parsed.data.customer_id) {
    observeApiResult(obs, "client_error", {
      error: "customer_required_on_sale",
      storeId: parsed.data.store_id,
      clientMutationId: parsed.data.client_mutation_id,
    });
    return obs.withHeaders(
      NextResponse.json({ error: "customer_required_on_sale" }, { status: 422 })
    );
  }

  const hasSuspensionContext = Boolean(
    parsed.data.suspended_sale_id || parsed.data.suspension_claim_id
  );
  if (
    hasSuspensionContext &&
    (!parsed.data.suspended_sale_id || !parsed.data.suspension_claim_id)
  ) {
    return NextResponse.json({ error: "suspended_sale_claim_conflict" }, { status: 409 });
  }
  if (hasSuspensionContext && !parsed.data.terminal_id) {
    return NextResponse.json({ error: "suspended_sale_claim_conflict" }, { status: 409 });
  }

  const rpc = hasSuspensionContext
    ? parsed.data.cash_session_id
      ? "complete_suspended_sale_with_cash"
      : "complete_suspended_sale"
    : parsed.data.cash_session_id
      ? "process_sale_with_cash"
      : "process_sale";
  const { data, error } = await supabase.rpc(rpc, {
    p_payload: parsed.data,
  });

  if (error) {
    const rpcFields = rpcFailureLogFields(error);
    const logContext = {
      ...rpcFields,
      clientMutationId: parsed.data.client_mutation_id,
      storeId: parsed.data.store_id,
      rpc: rpc,
    };
    if (
      error.message?.includes("suspended_sale_claimed") ||
      error.message?.includes("suspended_sale_completed") ||
      error.message?.includes("suspended_sale_claim_conflict") ||
      error.message?.includes("suspended_snapshot_conflict") ||
      error.message?.includes("suspended_sale_completion")
    ) {
      observeApiResult(obs, "client_error", { ...logContext, error: "suspended_sale_conflict" });
      return obs.withHeaders(NextResponse.json({ error: "suspended_sale_conflict" }, { status: 409 }));
    }
    if (error.message?.includes("suspended_sale_not_found")) {
      observeApiResult(obs, "client_error", { ...logContext, error: "suspended_sale_not_found" });
      return obs.withHeaders(NextResponse.json({ error: "suspended_sale_not_found" }, { status: 404 }));
    }
    const mapped = mapProcessSaleRpcError(error);
    if (mapped) {
      observeApiResult(obs, "client_error", { ...logContext, error: mapped.error });
      return obs.withHeaders(NextResponse.json({ error: mapped.error }, { status: mapped.status }));
    }
    observeApiResult(obs, "server_error", {
      ...logContext,
      error: "sale_processing_unavailable",
    });
    return obs.withHeaders(
      NextResponse.json({ error: "sale_processing_unavailable" }, { status: 503 })
    );
  }

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const saleId = (data as { sale_id?: unknown }).sale_id;
    if (typeof saleId === "string") {
      const fiscal = await requestFiscalIssueAfterCommit(supabase, {
        storeId: parsed.data.store_id,
        saleId,
      });
      observeApiResult(obs, "ok", {
        saleId,
        clientMutationId: parsed.data.client_mutation_id,
        storeId: parsed.data.store_id,
        replay: (data as { replay?: unknown }).replay === true,
      });
      return obs.withHeaders(
        NextResponse.json({
          ...(data as Record<string, unknown>),
          fiscal: fiscal.data ?? { status: "pending" },
        })
      );
    }
  }

  observeApiResult(obs, "ok", {
    clientMutationId: parsed.data.client_mutation_id,
    storeId: parsed.data.store_id,
  });
  return obs.withHeaders(NextResponse.json(data));
}
