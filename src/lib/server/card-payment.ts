import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import type { PaymentOperationResult } from "@/lib/adapters/payment";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createStripeCardGateway,
  createStripeClient,
  getStripeCardEnv,
  probeStripeCardHealth,
  resolveCardPaymentAdapter,
} from "@/lib/server/stripe-card";
import {
  cardRefundStatusPendingExternal,
  isStripeWebhookEventAllowed,
  reconcileStripePaymentIntent,
  webhookEventToPaymentState,
  type StripeWebhookEventType,
} from "@/lib/domain/stripe-card";
import type { CardPaymentInput } from "@/lib/validation/schemas";

type DbClient = SupabaseClient<Database>;

export type CardPaymentApiResult = PaymentOperationResult & {
  configured: boolean;
  sale_id?: string;
  sale_status?: string;
  sale_confirmed?: boolean;
  refund_status?: "pending_external" | "completed";
};

function asJson(value: unknown): Json {
  return value as Json;
}

export async function getCardAdapterHealth(): Promise<{
  configured: boolean;
  testmode: boolean;
  message: string;
  reason?: string;
}> {
  const health = await probeStripeCardHealth();
  return {
    configured: health.configured,
    testmode: health.testmode,
    message: health.message,
    reason: health.reason,
  };
}

export async function executeCardPayment(
  supabase: DbClient,
  input: CardPaymentInput,
  operatorId: string
): Promise<CardPaymentApiResult> {
  const health = await probeStripeCardHealth();
  if (!health.configured) {
    return {
      status: "not_configured",
      message: "Adapter card não configurado.",
      configured: false,
    };
  }

  const adapter = await resolveCardPaymentAdapter();
  const context = {
    clientMutationId: input.client_mutation_id,
    storeId: input.store_id,
    providerReference: input.provider_reference,
  };

  switch (input.action) {
    case "authorize": {
      const result = await adapter.authorize(input.amount, context);
      if (result.status === "not_configured") {
        return { ...result, configured: false };
      }
      if (result.providerReference && result.status !== "unknown") {
        await registerCardIntent(supabase, input, operatorId, result);
      }
      return { ...result, configured: true, sale_confirmed: false };
    }
    case "capture": {
      const result = await adapter.capture(input.amount, context);
      if (result.status === "not_configured") {
        return { ...result, configured: false };
      }
      if (result.status !== "captured" || !result.providerReference) {
        if (result.providerReference) {
          await applyProviderStatus(result.providerReference, result.status === "failed" ? "failed" : "unknown");
        }
        return { ...result, configured: true, sale_confirmed: false };
      }
      await applyProviderStatus(result.providerReference, "captured");
      const sale = await confirmCardSale(supabase, input, result.providerReference);
      return {
        ...result,
        configured: true,
        sale_id: sale.sale_id,
        sale_status: sale.sale_status,
        sale_confirmed: sale.sale_confirmed,
        status: sale.sale_confirmed ? "captured" : "unknown",
        message: sale.sale_confirmed
          ? result.message
          : "HTTP/Stripe captured sem venda confirmada. Reconcilie antes de confirmar.",
      };
    }
    case "cancel": {
      const result = await adapter.cancel(input.amount, context);
      if (result.providerReference && (result.status === "cancelled" || result.status === "failed")) {
        await applyProviderStatus(result.providerReference, result.status);
      }
      return { ...result, configured: result.status !== "not_configured", sale_confirmed: false };
    }
    default: {
      const _exhaustive: never = input.action;
      return _exhaustive;
    }
  }
}

export async function reconcileCardAgainstStripe(input: {
  supabase: DbClient;
  storeId: string;
  clientMutationId?: string;
  paymentId?: string;
  amount: string;
  providerReference: string;
}): Promise<CardPaymentApiResult> {
  const health = await probeStripeCardHealth();
  if (!health.configured) {
    return {
      status: "not_configured",
      message: "Adapter card não configurado.",
      configured: false,
    };
  }

  const adapter = await resolveCardPaymentAdapter();
  const result = await adapter.reconcile(input.amount, {
    clientMutationId: input.clientMutationId,
    storeId: input.storeId,
    providerReference: input.providerReference,
  });

  const env = getStripeCardEnv();
  if (env.configured) {
    const stripe = createStripeClient(env.secretKey, env.timeoutMs);
    const snapshot = await createStripeCardGateway(stripe).retrieve({
      providerReference: input.providerReference,
    });
    const decision = reconcileStripePaymentIntent({
      expectedProviderRef: input.providerReference,
      expectedAmount: input.amount,
      snapshot,
    });
    await applyProviderStatus(
      input.providerReference,
      decision.status === "captured"
        ? "captured"
        : decision.status === "cancelled"
          ? "cancelled"
          : decision.status === "failed"
            ? "failed"
            : "unknown"
    );
    if (decision.status === "captured" && input.clientMutationId) {
      const sale = await confirmCardSale(
        input.supabase,
        {
          store_id: input.storeId,
          amount: input.amount,
          client_mutation_id: input.clientMutationId,
        },
        input.providerReference
      );
      return {
        status: sale.sale_confirmed ? "captured" : "unknown",
        message: decision.message,
        providerReference: input.providerReference,
        configured: true,
        sale_id: sale.sale_id,
        sale_status: sale.sale_status,
        sale_confirmed: sale.sale_confirmed,
      };
    }
    return {
      status: decision.status,
      message: decision.message,
      providerReference: input.providerReference,
      configured: true,
      sale_confirmed: false,
    };
  }

  return { ...result, configured: true, sale_confirmed: false };
}

export async function applyStripeWebhookEvent(event: {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}): Promise<CardPaymentApiResult & { replay?: boolean; ignored?: boolean }> {
  if (!isStripeWebhookEventAllowed(event.type)) {
    return {
      status: "unknown",
      message: "Evento Stripe fora da allowlist.",
      configured: true,
      ignored: true,
    };
  }

  const admin = createAdminClient();
  if (!admin) {
    return {
      status: "unknown",
      message: "Webhook sem service role; evento não aplicado.",
      configured: true,
    };
  }

  const object = event.data.object;
  const providerRef = webhookProviderRef(event.type, object);
  if (!providerRef) {
    return {
      status: "unknown",
      message: "Evento sem PaymentIntent id.",
      configured: true,
    };
  }

  const mapped = webhookEventToPaymentState(event.type as StripeWebhookEventType);
  if (mapped === "pending_external") {
    const { data } = await admin.rpc("complete_card_refund", {
      p_payload: asJson({
        event_id: event.id,
        event_type: event.type,
        provider_ref: providerRef,
        refund_status: cardRefundStatusPendingExternal(),
      }),
    });
    const completed =
      data && typeof data === "object" && !Array.isArray(data) && data.payment_refund_status === "completed";
    return {
      status: "refunded",
      message: completed
        ? "Estorno de cartão confirmado pelo webhook."
        : "Estorno de cartão permanece pending_external.",
      configured: true,
      providerReference: providerRef,
      refund_status: completed ? "completed" : "pending_external",
    };
  }

  const applyStatus =
    mapped === "captured"
      ? "captured"
      : mapped === "failed"
        ? "failed"
        : mapped === "cancelled"
          ? "cancelled"
          : "unknown";

  await admin.rpc("apply_card_provider_event", {
    p_payload: asJson({
      event_id: event.id,
      event_type: event.type,
      provider_ref: providerRef,
      status: applyStatus,
    }),
  });

  return {
    status: mapped,
    message: `Webhook ${event.type} aplicado.`,
    configured: true,
    providerReference: providerRef,
  };
}

async function registerCardIntent(
  supabase: DbClient,
  input: CardPaymentInput,
  operatorId: string,
  result: PaymentOperationResult
): Promise<void> {
  const status =
    result.status === "authorized" || result.status === "pending" || result.status === "failed"
      ? result.status
      : "unknown";
  await supabase.rpc("register_card_payment_intent", {
    p_payload: asJson({
      store_id: input.store_id,
      client_mutation_id: input.client_mutation_id,
      provider_ref: result.providerReference,
      amount: input.amount,
      currency: "brl",
      status,
      operator_id: operatorId,
      sale_payload: {
        store_id: input.store_id,
        client_mutation_id: input.client_mutation_id,
        customer_id: input.customer_id,
        discount: input.discount,
        items: input.items,
        payments: [{ method: "card", amount: input.amount }],
      },
    }),
  });
}

async function applyProviderStatus(
  providerRef: string,
  status: "authorized" | "captured" | "failed" | "unknown" | "cancelled" | "refunded"
): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;
  await admin.rpc("apply_card_provider_status", {
    p_payload: asJson({
      provider_ref: providerRef,
      status,
    }),
  });
}

async function confirmCardSale(
  supabase: DbClient,
  input: {
    store_id: string;
    client_mutation_id: string;
    amount: string;
    customer_id?: string;
    discount?: string;
    items?: CardPaymentInput["items"];
  },
  providerRef: string
): Promise<{ sale_id?: string; sale_status?: string; sale_confirmed: boolean }> {
  const { data, error } = await supabase.rpc("process_card_sale", {
    p_payload: asJson({
      store_id: input.store_id,
      client_mutation_id: input.client_mutation_id,
      customer_id: input.customer_id,
      discount: input.discount ?? "0.00",
      items: input.items,
      payments: [{ method: "card", amount: input.amount }],
      provider_ref: providerRef,
    }),
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return { sale_confirmed: false };
  }
  const saleId = typeof data.sale_id === "string" ? data.sale_id : undefined;
  const saleStatus = typeof data.status === "string" ? data.status : undefined;
  return {
    sale_id: saleId,
    sale_status: saleStatus,
    sale_confirmed: saleStatus === "confirmed" && Boolean(saleId),
  };
}

function webhookProviderRef(type: string, object: Record<string, unknown>): string | null {
  if (type.startsWith("payment_intent.")) {
    return typeof object.id === "string" ? object.id : null;
  }
  if (typeof object.payment_intent === "string") {
    return object.payment_intent;
  }
  if (object.payment_intent && typeof object.payment_intent === "object") {
    const nested = object.payment_intent as { id?: unknown };
    return typeof nested.id === "string" ? nested.id : null;
  }
  return null;
}
