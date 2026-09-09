import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import type { PaymentOperationResult } from "@/lib/adapters/payment";
import { rpcFailureLogFields } from "@/lib/domain/sale-process-error";
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
import { rootLogger } from "@/lib/observability/logger";
import type { CardPaymentInput } from "@/lib/validation/schemas";

const cardLog = rootLogger.child({ component: "card-payment" });

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

/**
 * CARD_CHECKOUT_ENABLED must stay unset/false until migration
 * 20260906220000 (`process_card_sale`) is applied AND smoke Log2
 * (authorize → capture → sale confirmed) PASSES. Explicit opt-in only.
 */
function isCardCheckoutEnabled(): boolean {
  return process.env.CARD_CHECKOUT_ENABLED === "true";
}

const CARD_CHECKOUT_HOLD_MESSAGE =
  "Card checkout em hold operacional até opt-in explícito (CARD_CHECKOUT_ENABLED=true).";

const CARD_CONFIRMATION_UNAVAILABLE_MESSAGE =
  "Card checkout indisponível: capture não pode confirmar venda sem service role (apply_card_provider_status).";

function cardCheckoutHoldHealth(): {
  configured: false;
  testmode: false;
  message: string;
  reason: "card_checkout_hold";
} {
  return {
    configured: false,
    testmode: false,
    message: CARD_CHECKOUT_HOLD_MESSAGE,
    reason: "card_checkout_hold",
  };
}

function cardConfirmationUnavailableHealth(): {
  configured: false;
  testmode: false;
  message: string;
  reason: "card_confirmation_unavailable";
} {
  return {
    configured: false,
    testmode: false,
    message: CARD_CONFIRMATION_UNAVAILABLE_MESSAGE,
    reason: "card_confirmation_unavailable",
  };
}

function canApplyCardProviderStatus(): boolean {
  return Boolean(createAdminClient());
}

export async function getCardAdapterHealth(): Promise<{
  configured: boolean;
  testmode: boolean;
  message: string;
  reason?: string;
}> {
  if (!isCardCheckoutEnabled()) {
    return cardCheckoutHoldHealth();
  }
  if (!canApplyCardProviderStatus()) {
    return cardConfirmationUnavailableHealth();
  }
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
  if (!isCardCheckoutEnabled()) {
    return {
      status: "not_configured",
      message: CARD_CHECKOUT_HOLD_MESSAGE,
      configured: false,
    };
  }
  if (!canApplyCardProviderStatus()) {
    return {
      status: "not_configured",
      message: CARD_CONFIRMATION_UNAVAILABLE_MESSAGE,
      configured: false,
      sale_confirmed: false,
    };
  }
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
        return { ...result, configured: false, sale_confirmed: false };
      }
      if (result.providerReference && result.status !== "unknown") {
        const registered = await registerCardIntent(supabase, input, operatorId, result);
        if (!registered) {
          return {
            status: "unknown",
            message: "Autorização Stripe sem intent registrado. Venda não confirmada.",
            providerReference: result.providerReference,
            configured: true,
            sale_confirmed: false,
          };
        }
      }
      return { ...result, configured: true, sale_confirmed: false };
    }
    case "capture": {
      if (!canApplyCardProviderStatus()) {
        return {
          status: "not_configured",
          message: CARD_CONFIRMATION_UNAVAILABLE_MESSAGE,
          configured: false,
          sale_confirmed: false,
        };
      }
      const result = await adapter.capture(input.amount, context);
      if (result.status === "not_configured") {
        return { ...result, configured: false, sale_confirmed: false };
      }
      if (result.status !== "captured" || !result.providerReference) {
        if (result.providerReference) {
          await applyProviderStatus(result.providerReference, result.status === "failed" ? "failed" : "unknown");
        }
        return {
          ...result,
          configured: true,
          sale_confirmed: false,
          status: result.status === "captured" ? "unknown" : result.status,
        };
      }
      const applied = await applyProviderStatus(result.providerReference, "captured");
      if (!applied) {
        cardLog.error("card_provider_status_not_applied", {
          providerReference: result.providerReference,
          clientMutationId: input.client_mutation_id,
          storeId: input.store_id,
        });
        return {
          status: "unknown",
          message: "Stripe retornou succeeded sem status local captured. Venda não confirmada.",
          providerReference: result.providerReference,
          configured: true,
          sale_confirmed: false,
        };
      }
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
          : "Capture sem venda confirmada. Não trate como capturado; reconcilie.",
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
): Promise<boolean> {
  const status =
    result.status === "authorized" || result.status === "pending" || result.status === "failed"
      ? result.status
      : "unknown";
  const { error } = await supabase.rpc("register_card_payment_intent", {
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
  if (error) {
    cardLog.error("register_card_payment_intent_failed", {
      ...rpcFailureLogFields(error),
      clientMutationId: input.client_mutation_id,
      storeId: input.store_id,
    });
    return false;
  }
  return true;
}

async function applyProviderStatus(
  providerRef: string,
  status: "authorized" | "captured" | "failed" | "unknown" | "cancelled" | "refunded"
): Promise<boolean> {
  const admin = createAdminClient();
  if (!admin) {
    cardLog.error("card_provider_status_unavailable", { providerReference: providerRef, status });
    return false;
  }
  const { error } = await admin.rpc("apply_card_provider_status", {
    p_payload: asJson({
      provider_ref: providerRef,
      status,
    }),
  });
  if (error) {
    cardLog.error("apply_card_provider_status_failed", {
      ...rpcFailureLogFields(error),
      providerReference: providerRef,
      status,
    });
    return false;
  }
  return true;
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
    cardLog.error("process_card_sale_failed", {
      ...(error ? rpcFailureLogFields(error) : { rpcMessage: "empty_or_invalid_process_card_sale" }),
      clientMutationId: input.client_mutation_id,
      storeId: input.store_id,
      providerReference: providerRef,
    });
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
