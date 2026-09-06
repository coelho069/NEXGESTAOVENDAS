import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import {
  reconcilePaymentInputSchema,
  storeIdSchema,
} from "@/lib/validation/schemas";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse, validationFailedResponse } from "@/lib/security/safe-error";
import { reconcileCardAgainstStripe } from "@/lib/server/card-payment";
import { toMoneyString, money } from "@/lib/money";

export async function POST(request: Request) {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rate = consumeRateLimit({
    key: clientRateLimitKey(request, "payment-reconcile", user.id),
    limit: 60,
    windowMs: 60_000,
  });
  if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSec);

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

  const parsed = reconcilePaymentInputSchema.safeParse(json);
  if (!parsed.success) {
    return validationFailedResponse(process.env.NODE_ENV === "production", parsed.error.flatten());
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || !auth.role) {
    return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
  }

  const cardIntent = await supabase.rpc("get_card_payment_intent", {
    p_payload: parsed.data,
  });
  if (!cardIntent.error && cardIntent.data && typeof cardIntent.data === "object" && !Array.isArray(cardIntent.data)) {
    const intent = cardIntent.data;
    const providerRef = typeof intent.provider_ref === "string" ? intent.provider_ref : "";
    const amount =
      typeof intent.amount === "string"
        ? intent.amount
        : typeof intent.amount === "number"
          ? toMoneyString(money(intent.amount))
          : "";
    if (providerRef && amount) {
      const card = await reconcileCardAgainstStripe({
        supabase,
        storeId: parsed.data.store_id,
        clientMutationId:
          parsed.data.client_mutation_id ??
          (typeof intent.client_mutation_id === "string" ? intent.client_mutation_id : undefined),
        amount,
        providerReference: providerRef,
      });
      return NextResponse.json({
        status: card.status,
        method: "card",
        amount,
        provider_reference: card.providerReference,
        sale_id: card.sale_id,
        sale_status: card.sale_status,
        sale_confirmed: card.sale_confirmed === true,
        reconciled: card.status === "captured" && card.sale_confirmed === true,
        pending: card.status !== "captured",
        evidence: card.status !== "unknown",
      });
    }
  }

  const { data, error } = await supabase.rpc("reconcile_payment", {
    p_payload: parsed.data,
  });

  if (error) {
    if (error.message.includes("payment_not_found")) {
      return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
    }
    if (
      error.message.includes("payment_access_denied") ||
      error.message.includes("not_authenticated")
    ) {
      return NextResponse.json({ error: "forbidden_store" }, { status: 403 });
    }
    if (
      error.message.includes("payment_sale_state_conflict") ||
      error.message.includes("invalid_payment_status_transition")
    ) {
      return NextResponse.json({ error: "payment_reconciliation_conflict" }, { status: 409 });
    }
    if (error.message.includes("invalid_payment_reconciliation")) {
      return NextResponse.json({ error: "invalid_payment_reconciliation" }, { status: 400 });
    }
    return NextResponse.json({ error: "payment_reconciliation_unavailable" }, { status: 503 });
  }

  return NextResponse.json(data);
}
