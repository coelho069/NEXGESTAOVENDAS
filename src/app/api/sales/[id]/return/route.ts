import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import {
  canCancelSale,
  canReturnSale,
  evaluateCashRefundSession,
  isSaleCancellableStatus,
  isSaleReturnableStatus,
} from "@/lib/domain/sale-return";
import { saleCancelInputSchema, saleReturnInputSchema } from "@/lib/validation/schemas";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type SaleRow = {
  id: string;
  org_id: string;
  store_id: string;
  status: string;
  cash_session_id: string | null;
};

type PaymentRow = {
  method: string;
  cash_session_id: string | null;
};

type CashSessionRow = {
  id: string;
  status: string;
  terminal_id: string;
  store_id: string;
};

function mapReturnError(error: { message?: string; code?: string }) {
  const message = error.message ?? "";
  if (message.includes("forbidden_sale_cancel") || message.includes("forbidden_sale_return")) {
    return NextResponse.json({ error: "forbidden_sale_return" }, { status: 403 });
  }
  if (message.includes("sale_not_found") || message.includes("sale_item_not_found")) {
    return NextResponse.json({ error: "sale_not_found" }, { status: 404 });
  }
  if (message.includes("idempotency_payload_mismatch")) {
    return NextResponse.json({ error: "idempotency_payload_mismatch" }, { status: 409 });
  }
  if (message.includes("cash_session_closed_for_refund")) {
    return NextResponse.json(
      {
        error: "cash_session_closed_for_refund",
        message,
      },
      { status: 422 }
    );
  }
  if (
    message.includes("sale_not_cancellable") ||
    message.includes("sale_not_returnable") ||
    message.includes("sale_return_quantity_exceeded") ||
    message.includes("sale_return_amount_exceeded") ||
    message.includes("sale_cancel_requires_all_items") ||
    message.includes("cash_session") ||
    message.includes("invalid_sale_return") ||
    message.includes("duplicate_sale_return_item")
  ) {
    return NextResponse.json(
      {
        error: message.includes("cash_session")
          ? "cash_session_required"
          : message.includes("quantity_exceeded")
            ? "sale_return_quantity_exceeded"
            : message.includes("not_cancellable") || message.includes("not_returnable")
              ? "sale_not_returnable"
              : "sale_return_validation_failed",
        message,
      },
      { status: 422 }
    );
  }
  return NextResponse.json({ error: "sale_return_unavailable" }, { status: 503 });
}

async function loadSaleContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: { saleId: string; storeId: string; orgId: string; clientMutationId: string }
): Promise<
  | { ok: true; sale: SaleRow; payment: PaymentRow | null; replay: boolean }
  | { ok: false; response: NextResponse }
> {
  const { data: sale, error: saleError } = await supabase
    .from("sales")
    .select("id, org_id, store_id, status, cash_session_id")
    .eq("id", input.saleId)
    .eq("store_id", input.storeId)
    .maybeSingle();

  if (saleError) {
    return { ok: false, response: NextResponse.json({ error: "sale_return_unavailable" }, { status: 503 }) };
  }
  if (!sale || sale.org_id !== input.orgId) {
    return { ok: false, response: NextResponse.json({ error: "sale_not_found" }, { status: 404 }) };
  }

  const { data: existingReturn } = await supabase
    .from("sale_returns")
    .select("id")
    .eq("store_id", input.storeId)
    .eq("org_id", input.orgId)
    .eq("client_mutation_id", input.clientMutationId)
    .maybeSingle();

  const { data: payment } = await supabase
    .from("payments")
    .select("method, cash_session_id")
    .eq("sale_id", sale.id)
    .eq("store_id", input.storeId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    ok: true,
    sale,
    payment,
    replay: Boolean(existingReturn),
  };
}

async function enforceCashRefundSession(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  sale: SaleRow;
  payment: PaymentRow | null;
  storeId: string;
  terminalId: string;
  requestedCashSessionId?: string;
}): Promise<{ ok: true; cashSessionId?: string } | { ok: false; response: NextResponse }> {
  const paymentMethod = input.payment?.method ?? "cash";
  let originalSession: CashSessionRow | null = null;
  const originalSessionId = input.sale.cash_session_id ?? input.payment?.cash_session_id ?? null;

  if (paymentMethod === "cash" && originalSessionId) {
    const { data } = await input.supabase
      .from("cash_sessions")
      .select("id, status, terminal_id, store_id")
      .eq("id", originalSessionId)
      .maybeSingle();
    originalSession = data;
  }

  const evaluated = evaluateCashRefundSession({
    paymentMethod,
    saleCashSessionId: originalSessionId,
    requestedCashSessionId: input.requestedCashSessionId,
    originalSession: originalSession
      ? {
          status: originalSession.status,
          terminalId: originalSession.terminal_id,
          storeId: originalSession.store_id,
        }
      : null,
    requestTerminalId: input.terminalId,
    requestStoreId: input.storeId,
  });

  if (!evaluated.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: evaluated.error, message: evaluated.message },
        { status: 422 }
      ),
    };
  }

  return { ok: true, cashSessionId: evaluated.cashSessionId };
}

export async function POST(request: Request, context: RouteContext) {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: saleId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const withSaleId =
    body && typeof body === "object" ? { ...(body as Record<string, unknown>), sale_id: saleId } : body;

  const isCancel =
    withSaleId &&
    typeof withSaleId === "object" &&
    "operation" in withSaleId &&
    (withSaleId as { operation?: unknown }).operation === "cancel";

  if (isCancel) {
    const parsed = saleCancelInputSchema.safeParse(withSaleId);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const auth = await getAuthedContext(parsed.data.store_id);
    if (!auth?.orgId || !auth.role || !canCancelSale(auth.role)) {
      return NextResponse.json({ error: "forbidden_sale_return" }, { status: 403 });
    }

    const loaded = await loadSaleContext(supabase, {
      saleId: parsed.data.sale_id,
      storeId: parsed.data.store_id,
      orgId: auth.orgId,
      clientMutationId: parsed.data.client_mutation_id,
    });
    if (!loaded.ok) return loaded.response;
    if (!loaded.replay) {
      if (!isSaleCancellableStatus(loaded.sale.status)) {
        return NextResponse.json(
          { error: "sale_not_returnable", message: "sale_not_cancellable" },
          { status: 422 }
        );
      }
      const cashGuard = await enforceCashRefundSession({
        supabase,
        sale: loaded.sale,
        payment: loaded.payment,
        storeId: parsed.data.store_id,
        terminalId: parsed.data.terminal_id,
        requestedCashSessionId: parsed.data.cash_session_id,
      });
      if (!cashGuard.ok) return cashGuard.response;
      parsed.data.cash_session_id = cashGuard.cashSessionId;
    }

    const { data, error } = await supabase.rpc("cancel_sale", {
      p_payload: parsed.data,
    });
    if (error) return mapReturnError(error);
    return NextResponse.json(data, { status: 201 });
  }

  const parsed = saleReturnInputSchema.safeParse(withSaleId);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role || !canReturnSale(auth.role)) {
    return NextResponse.json({ error: "forbidden_sale_return" }, { status: 403 });
  }

  const loaded = await loadSaleContext(supabase, {
    saleId: parsed.data.sale_id,
    storeId: parsed.data.store_id,
    orgId: auth.orgId,
    clientMutationId: parsed.data.client_mutation_id,
  });
  if (!loaded.ok) return loaded.response;
  if (!loaded.replay) {
    if (!isSaleReturnableStatus(loaded.sale.status)) {
      return NextResponse.json(
        { error: "sale_not_returnable", message: "sale_not_returnable" },
        { status: 422 }
      );
    }
    const cashGuard = await enforceCashRefundSession({
      supabase,
      sale: loaded.sale,
      payment: loaded.payment,
      storeId: parsed.data.store_id,
      terminalId: parsed.data.terminal_id,
      requestedCashSessionId: parsed.data.cash_session_id,
    });
    if (!cashGuard.ok) return cashGuard.response;
    parsed.data.cash_session_id = cashGuard.cashSessionId;
  }

  const { data, error } = await supabase.rpc("process_sale_return", {
    p_payload: parsed.data,
  });
  if (error) return mapReturnError(error);
  return NextResponse.json(data, { status: 201 });
}
