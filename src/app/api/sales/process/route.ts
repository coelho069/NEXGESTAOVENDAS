import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPaymentAdapter } from "@/lib/adapters/payment";
import { processSaleInputSchema, storeIdSchema } from "@/lib/validation/schemas";
import { getAuthedContext } from "@/lib/auth/session";
import { discountLimitHttpStatus, salePayloadExceedsDiscountCap } from "@/lib/domain/sale-ops";
import { requestFiscalIssueAfterCommit } from "@/lib/server/fiscal-operation";
import {
  loadStoreCommercialFlags,
  rejectSaleByCommercialRules,
} from "@/lib/server/store-settings";
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

  // Server authority: adapter decides configured methods. Never trust client status/provider.
  for (const payment of parsed.data.payments) {
    const adapter = getPaymentAdapter(payment.method);
    const decision = adapter.process(payment.amount);
    if (decision.status !== "configured") {
      return NextResponse.json(
        {
          error: "payment_method_not_configured",
          adapter_status: "not_configured",
          method: payment.method,
          message: decision.message,
        },
        { status: 422 }
      );
    }
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  if (salePayloadExceedsDiscountCap(parsed.data, auth.role)) {
    return NextResponse.json({ error: "discount_limit_exceeded" }, { status: discountLimitHttpStatus(true) });
  }

  const loaded = await loadStoreCommercialFlags(supabase, parsed.data.store_id);
  if (!loaded.ok) {
    return NextResponse.json(
      { error: "settings_unavailable", message: loaded.message },
      { status: 503 }
    );
  }
  const commercialFlags = loaded.flags;

  // Commercial rule: open cash session required by store policy.
  if (commercialFlags.require_open_cash_session) {
    if (!parsed.data.cash_session_id || !parsed.data.terminal_id) {
      return NextResponse.json(
        {
          error: "cash_session_required",
          message: "Abra o caixa desta loja antes de fechar a venda.",
        },
        { status: 422 }
      );
    }
  }

  // Optional cash-drawer path: if the client links a session, terminal is mandatory.
  if (parsed.data.cash_session_id && !parsed.data.terminal_id) {
    return NextResponse.json(
      {
        error: "cash_session_required",
        message: "Venda vinculada ao caixa exige terminal identificado.",
      },
      { status: 409 }
    );
  }

  let customerDocument: string | null = null;
  if (parsed.data.customer_id && commercialFlags.require_customer_document) {
    const { data: customerRow } = await supabase
      .from("customers")
      .select("document, org_id")
      .eq("id", parsed.data.customer_id)
      .maybeSingle();
    if (!customerRow || customerRow.org_id !== auth.orgId) {
      return NextResponse.json(
        { error: "customer_store_scope_mismatch", message: "Cliente fora do escopo da organização." },
        { status: 403 }
      );
    }
    customerDocument = customerRow.document ?? null;
  }

  const commercialReject = rejectSaleByCommercialRules({
    settings: commercialFlags,
    customerId: parsed.data.customer_id ?? null,
    customerDocument,
    cashSessionOpen: Boolean(parsed.data.cash_session_id),
  });
  if (commercialReject) {
    return NextResponse.json(
      { error: commercialReject.code, message: commercialReject.message },
      { status: 422 }
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
    if (error.message.includes("idempotency_payload_mismatch")) {
      return NextResponse.json({ error: "idempotency_payload_mismatch" }, { status: 409 });
    }
    if (
      error.message.includes("suspended_sale_claimed") ||
      error.message.includes("suspended_sale_completed") ||
      error.message.includes("suspended_sale_claim_conflict") ||
      error.message.includes("suspended_snapshot_conflict") ||
      error.message.includes("suspended_sale_completion")
    ) {
      return NextResponse.json({ error: "suspended_sale_conflict" }, { status: 409 });
    }
    if (error.message.includes("suspended_sale_not_found")) {
      return NextResponse.json({ error: "suspended_sale_not_found" }, { status: 404 });
    }
    if (error.message.includes("discount_limit_exceeded")) {
      return NextResponse.json({ error: "discount_limit_exceeded" }, { status: 403 });
    }
    if (error.message.includes("customer_required_on_sale")) {
      return NextResponse.json({ error: "customer_required_on_sale" }, { status: 422 });
    }
    if (error.message.includes("customer_document_required")) {
      return NextResponse.json({ error: "customer_document_required" }, { status: 422 });
    }
    if (error.message.includes("customer_store_scope_mismatch")) {
      return NextResponse.json({ error: "customer_store_scope_mismatch" }, { status: 403 });
    }
    if (error.message.includes("cash_session_required")) {
      return NextResponse.json({ error: "cash_session_required" }, { status: 422 });
    }
    if (error.message.includes("forbidden") || error.message.includes("access_denied")) {
      return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
    }
    if (error.message.includes("cash_session_closed")) {
      return NextResponse.json({ error: "cash_session_closed" }, { status: 409 });
    }
    if (
      error.message.includes("cash_session_already_open") ||
      error.message.includes("cash_sale_session_mismatch") ||
      error.message.includes("cash_idempotency_payload_mismatch")
    ) {
      return NextResponse.json({ error: "cash_session_conflict" }, { status: 409 });
    }
    if (error.code === "22023" || error.code === "23514") {
      return NextResponse.json({ error: "sale_processing_failed" }, { status: 422 });
    }
    observeApiResult(obs, "server_error", {
      error: "sale_processing_unavailable",
      clientMutationId: parsed.data.client_mutation_id,
      storeId: parsed.data.store_id,
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
