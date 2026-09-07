import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import type { PaymentOperationResult } from "@/lib/adapters/payment";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient, getStripeCardEnv } from "@/lib/server/stripe-card";
import {
  probeStripePixHealth,
  resolvePixPaymentAdapter,
  createStripePixGateway,
} from "@/lib/server/stripe-pix";
import {
  isPixStripeObject,
  pixRefundStatusPendingExternal,
  reconcileStripePixPaymentIntent,
  type StripePixQr,
} from "@/lib/domain/stripe-pix";
import {
  isStripeWebhookEventAllowed,
  webhookEventToPaymentState,
  type StripeWebhookEventType,
} from "@/lib/domain/stripe-card";
import type { PixPaymentInput } from "@/lib/validation/schemas";
import { applyStripeWebhookEvent as applyCardStripeWebhookEvent } from "@/lib/server/card-payment";

type DbClient = SupabaseClient<Database>;

export type PixPaymentApiResult = PaymentOperationResult & {
  configured: boolean;
  sale_id?: string;
  sale_status?: string;
  sale_confirmed?: boolean;
  refund_status?: "pending_external" | "completed";
  qr?: StripePixQr | null;
  replay?: boolean;
  ignored?: boolean;
};

function asJson(value: unknown): Json {
  return value as Json;
}

/**
 * PIX_CHECKOUT_ENABLED must stay unset/false until migration
 * `process_pix_sale` is applied AND smoke Log2
 * (create QR ≠ sale; PI succeeded → confirmed) PASSES. Explicit opt-in only.
 */
function isPixCheckoutEnabled(): boolean {
  return process.env.PIX_CHECKOUT_ENABLED === "true";
}

const PIX_CHECKOUT_HOLD_MESSAGE =
  "PIX checkout em hold operacional até opt-in explícito (PIX_CHECKOUT_ENABLED=true).";

function pixCheckoutHoldHealth(): {
  configured: false;
  testmode: false;
  message: string;
  reason: "pix_checkout_hold";
} {
  return {
    configured: false,
    testmode: false,
    message: PIX_CHECKOUT_HOLD_MESSAGE,
    reason: "pix_checkout_hold",
  };
}

export async function getPixAdapterHealth(): Promise<{
  configured: boolean;
  testmode: boolean;
  message: string;
  reason?: string;
}> {
  if (!isPixCheckoutEnabled()) {
    return pixCheckoutHoldHealth();
  }
  const health = await probeStripePixHealth();
  return {
    configured: health.configured,
    testmode: health.testmode,
    message: health.message,
    reason: health.reason,
  };
}

export async function executePixPayment(
  supabase: DbClient,
  input: PixPaymentInput,
  operatorId: string
): Promise<PixPaymentApiResult> {
  if (!isPixCheckoutEnabled()) {
    return {
      status: "not_configured",
      message: PIX_CHECKOUT_HOLD_MESSAGE,
      configured: false,
    };
  }
  const health = await probeStripePixHealth();
  if (!health.configured) {
    return {
      status: "not_configured",
      message: "Adapter PIX não configurado.",
      configured: false,
    };
  }

  const adapter = await resolvePixPaymentAdapter();
  const context = {
    clientMutationId: input.client_mutation_id,
    storeId: input.store_id,
    providerReference: input.provider_reference,
  };

  switch (input.action) {
    case "create": {
      const result = await adapter.authorize(input.amount, context);
      if (result.status === "not_configured") {
        return { ...result, configured: false, sale_confirmed: false };
      }
      if (result.providerReference && result.status !== "unknown") {
        await registerPixIntent(supabase, input, operatorId, result);
      }
      return {
        ...result,
        configured: true,
        sale_confirmed: false,
        qr: result.qr,
      };
    }
    case "cancel": {
      const result = await adapter.cancel(input.amount, context);
      if (result.providerReference && (result.status === "cancelled" || result.status === "failed")) {
        await applyPixProviderStatus(result.providerReference, result.status);
      }
      return { ...result, configured: result.status !== "not_configured", sale_confirmed: false };
    }
    default: {
      const _exhaustive: never = input.action;
      return _exhaustive;
    }
  }
}

export async function reconcilePixAgainstStripe(input: {
  supabase: DbClient;
  storeId: string;
  clientMutationId?: string;
  amount: string;
  providerReference: string;
}): Promise<PixPaymentApiResult> {
  const health = await probeStripePixHealth();
  if (!health.configured) {
    return {
      status: "not_configured",
      message: "Adapter PIX não configurado.",
      configured: false,
    };
  }

  const adapter = await resolvePixPaymentAdapter();
  const result = await adapter.reconcile(input.amount, {
    clientMutationId: input.clientMutationId,
    storeId: input.storeId,
    providerReference: input.providerReference,
  });

  const env = getStripeCardEnv();
  if (env.configured) {
    const stripe = createStripeClient(env.secretKey, env.timeoutMs);
    const snapshot = await createStripePixGateway(stripe).retrieve({
      providerReference: input.providerReference,
    });
    const decision = reconcileStripePixPaymentIntent({
      expectedProviderRef: input.providerReference,
      expectedAmount: input.amount,
      snapshot,
    });
    await applyPixProviderStatus(
      input.providerReference,
      decision.status === "captured"
        ? "captured"
        : decision.status === "cancelled"
          ? "cancelled"
          : decision.status === "failed"
            ? "failed"
            : decision.status === "pending"
              ? "pending"
              : "unknown"
    );
    if (decision.status === "captured" && input.clientMutationId) {
      const sale = await confirmPixSale(
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
        qr: snapshot?.qr,
      };
    }
    return {
      status: decision.status,
      message: decision.message,
      providerReference: input.providerReference,
      configured: true,
      sale_confirmed: false,
      qr: snapshot?.qr,
    };
  }

  return { ...result, configured: true, sale_confirmed: false };
}

export async function applyPixStripeWebhookEvent(event: {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}): Promise<PixPaymentApiResult> {
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
      message: "Webhook sem service role; evento PIX não aplicado.",
      configured: true,
    };
  }

  const object = event.data.object;
  const providerRef = webhookProviderRef(event.type, object);
  if (!providerRef) {
    return {
      status: "unknown",
      message: "Evento PIX sem PaymentIntent id.",
      configured: true,
    };
  }

  const mapped = webhookEventToPaymentState(event.type as StripeWebhookEventType);
  if (mapped === "pending_external") {
    const { data } = await admin.rpc("complete_pix_refund", {
      p_payload: asJson({
        event_id: event.id,
        event_type: event.type,
        provider_ref: providerRef,
        refund_status: pixRefundStatusPendingExternal(),
      }),
    });
    const completed =
      data && typeof data === "object" && !Array.isArray(data) && data.payment_refund_status === "completed";
    return {
      status: "refunded",
      message: completed
        ? "Estorno PIX confirmado pelo webhook."
        : "Estorno PIX permanece pending_external.",
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

  const applied = await admin.rpc("apply_pix_provider_event", {
    p_payload: asJson({
      event_id: event.id,
      event_type: event.type,
      provider_ref: providerRef,
      status: applyStatus,
    }),
  });
  const appliedRow =
    !applied.error && applied.data && typeof applied.data === "object" && !Array.isArray(applied.data)
      ? applied.data
      : null;
  const storeId = appliedRow && typeof appliedRow.store_id === "string" ? appliedRow.store_id : "";
  const clientMutationId =
    appliedRow && typeof appliedRow.client_mutation_id === "string"
      ? appliedRow.client_mutation_id
      : "";

  if (applyStatus === "captured" && storeId && clientMutationId) {
    const sale = await confirmPixSale(
      admin,
      { store_id: storeId, client_mutation_id: clientMutationId, amount: "0.00" },
      providerRef
    );
    return {
      status: sale.sale_confirmed ? "captured" : applyStatus,
      message: sale.sale_confirmed
        ? `Webhook ${event.type} confirmou a venda PIX.`
        : `Webhook ${event.type} aplicado; venda ainda não confirmada.`,
      configured: true,
      providerReference: providerRef,
      sale_id: sale.sale_id,
      sale_status: sale.sale_status,
      sale_confirmed: sale.sale_confirmed,
    };
  }

  return {
    status: mapped,
    message: `Webhook PIX ${event.type} aplicado.`,
    configured: true,
    providerReference: providerRef,
  };
}

export async function applyStripeWebhookEventBranched(event: {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}): Promise<PixPaymentApiResult> {
  const object = event.data.object;
  if (isPixStripeObject(object) || (await pixIntentExists(webhookProviderRef(event.type, object)))) {
    return applyPixStripeWebhookEvent(event);
  }
  const card = await applyCardStripeWebhookEvent(event);
  return card;
}

async function pixIntentExists(providerRef: string | null): Promise<boolean> {
  if (!providerRef) return false;
  const admin = createAdminClient();
  if (!admin) return false;
  const { data, error } = await admin
    .from("pix_payment_intents")
    .select("id")
    .eq("provider_ref", providerRef)
    .maybeSingle();
  return !error && Boolean(data);
}

async function registerPixIntent(
  supabase: DbClient,
  input: PixPaymentInput,
  operatorId: string,
  result: PaymentOperationResult
): Promise<void> {
  const status =
    result.status === "pending" || result.status === "failed" || result.status === "cancelled"
      ? result.status
      : "unknown";
  await supabase.rpc("register_pix_payment_intent", {
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
        payments: [{ method: "pix", amount: input.amount }],
      },
    }),
  });
}

async function applyPixProviderStatus(
  providerRef: string,
  status: "pending" | "authorized" | "captured" | "failed" | "unknown" | "cancelled" | "refunded"
): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;
  await admin.rpc("apply_pix_provider_status", {
    p_payload: asJson({
      provider_ref: providerRef,
      status,
    }),
  });
}

async function confirmPixSale(
  supabase: DbClient,
  input: {
    store_id: string;
    client_mutation_id: string;
    amount: string;
    customer_id?: string;
    discount?: string;
    items?: PixPaymentInput["items"];
  },
  providerRef: string
): Promise<{ sale_id?: string; sale_status?: string; sale_confirmed: boolean }> {
  const { data, error } = await supabase.rpc("process_pix_sale", {
    p_payload: asJson({
      store_id: input.store_id,
      client_mutation_id: input.client_mutation_id,
      customer_id: input.customer_id,
      discount: input.discount ?? "0.00",
      items: input.items,
      payments: [{ method: "pix", amount: input.amount }],
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

