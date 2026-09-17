import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import type { PaymentOperationResult } from "@/lib/adapters/payment";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createMercadoPagoPixGateway,
  getMercadoPagoEnv,
  isMercadoPagoCheckoutEnabled,
  mercadoPagoCheckoutHoldHealth,
  probeMercadoPagoPixHealth,
  resolveMercadoPagoPixPaymentAdapter,
} from "@/lib/server/mercadopago";
import {
  isMercadoPagoWebhookEventAllowed,
  reconcileMercadoPagoOrder,
  webhookActionToPaymentState,
  type MercadoPagoWebhookNotification,
} from "@/lib/domain/mercadopago";
import type { MercadoPagoPixPaymentInput } from "@/lib/validation/schemas";
import type { StripePixQr } from "@/lib/domain/stripe-pix";

type DbClient = SupabaseClient<Database>;

export type MercadoPagoPixPaymentApiResult = PaymentOperationResult & {
  configured: boolean;
  sale_id?: string;
  sale_status?: string;
  sale_confirmed?: boolean;
  qr?: StripePixQr | null;
  replay?: boolean;
  ignored?: boolean;
};

function asJson(value: unknown): Json {
  return value as Json;
}

const MERCADOPAGO_PIX_HOLD_MESSAGE =
  "Mercado Pago checkout em hold operacional até opt-in explícito (MERCADOPAGO_CHECKOUT_ENABLED=true).";

export async function getMercadoPagoPixAdapterHealth(): Promise<{
  configured: boolean;
  testmode: boolean;
  message: string;
  reason?: string;
}> {
  if (!isMercadoPagoCheckoutEnabled()) {
    return mercadoPagoCheckoutHoldHealth();
  }
  const health = await probeMercadoPagoPixHealth();
  return {
    configured: health.configured,
    testmode: health.testmode,
    message: health.message,
    reason: health.reason,
  };
}

export async function executeMercadoPagoPixPayment(
  supabase: DbClient,
  input: MercadoPagoPixPaymentInput,
  operatorId: string
): Promise<MercadoPagoPixPaymentApiResult> {
  if (!isMercadoPagoCheckoutEnabled()) {
    return {
      status: "not_configured",
      message: MERCADOPAGO_PIX_HOLD_MESSAGE,
      configured: false,
    };
  }

  const health = await probeMercadoPagoPixHealth();
  if (!health.configured) {
    return {
      status: "not_configured",
      message: "Adapter Mercado Pago PIX não configurado.",
      configured: false,
    };
  }

  const adapter = await resolveMercadoPagoPixPaymentAdapter();
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
        await registerMercadoPagoPixIntent(supabase, input, operatorId, result);
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

export async function reconcileMercadoPagoPix(input: {
  supabase: DbClient;
  storeId: string;
  clientMutationId?: string;
  amount: string;
  providerReference: string;
}): Promise<MercadoPagoPixPaymentApiResult> {
  const health = await probeMercadoPagoPixHealth();
  if (!health.configured) {
    return {
      status: "not_configured",
      message: "Adapter Mercado Pago PIX não configurado.",
      configured: false,
    };
  }

  const adapter = await resolveMercadoPagoPixPaymentAdapter();
  const result = await adapter.reconcile(input.amount, {
    clientMutationId: input.clientMutationId,
    storeId: input.storeId,
    providerReference: input.providerReference,
  });

  const env = getMercadoPagoEnv();
  if (env.configured) {
    const snapshot = await createMercadoPagoPixGateway(env).retrieve({
      providerReference: input.providerReference,
    });
    const decision = reconcileMercadoPagoOrder({
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

export async function applyMercadoPagoWebhookEvent(
  notification: MercadoPagoWebhookNotification
): Promise<MercadoPagoPixPaymentApiResult> {
  if (!isMercadoPagoWebhookEventAllowed(notification.action)) {
    return {
      status: "unknown",
      message: "Evento Mercado Pago fora da allowlist.",
      configured: true,
      ignored: true,
    };
  }

  const admin = createAdminClient();
  if (!admin) {
    return {
      status: "unknown",
      message: "Webhook sem service role; evento Mercado Pago não aplicado.",
      configured: true,
    };
  }

  const providerRef = notification.data.id?.trim() ?? "";
  if (!providerRef) {
    return {
      status: "unknown",
      message: "Evento Mercado Pago sem order id.",
      configured: true,
    };
  }

  const mapped = webhookActionToPaymentState(notification.action);
  if (mapped === "ignored") {
    return {
      status: "unknown",
      message: "Evento Mercado Pago ignorado.",
      configured: true,
      ignored: true,
    };
  }

  const applyStatus =
    mapped === "captured"
      ? "captured"
      : mapped === "failed"
        ? "failed"
        : mapped === "cancelled"
          ? "cancelled"
          : mapped === "refunded"
            ? "refunded"
            : "pending";

  const applied = await admin.rpc("apply_pix_provider_event", {
    p_payload: asJson({
      event_id: String(notification.id),
      event_type: notification.action,
      provider_ref: providerRef,
      status: applyStatus === "pending" ? "pending" : applyStatus,
    }),
  });

  const appliedRow =
    !applied.error && applied.data && typeof applied.data === "object" && !Array.isArray(applied.data)
      ? applied.data
      : null;

  if (appliedRow?.replay === true) {
    const saleId = typeof appliedRow.sale_id === "string" ? appliedRow.sale_id : undefined;
    return {
      status: saleId ? "captured" : applyStatus === "captured" ? "unknown" : mapped,
      message: "Webhook Mercado Pago replay (idempotente).",
      configured: true,
      providerReference: providerRef,
      sale_id: saleId,
      sale_confirmed: Boolean(saleId),
      replay: true,
    };
  }

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
      status: sale.sale_confirmed ? "captured" : "unknown",
      message: sale.sale_confirmed
        ? `Webhook ${notification.action} confirmou a venda PIX Mercado Pago.`
        : `Webhook ${notification.action} aplicado; venda ainda não confirmada.`,
      configured: true,
      providerReference: providerRef,
      sale_id: sale.sale_id,
      sale_status: sale.sale_status,
      sale_confirmed: sale.sale_confirmed,
    };
  }

  if (applyStatus === "captured") {
    return {
      status: "unknown",
      message: `Webhook ${notification.action} sem intent PIX casado; venda não confirmada.`,
      configured: true,
      providerReference: providerRef,
      sale_confirmed: false,
    };
  }

  return {
    status: mapped,
    message: `Webhook Mercado Pago ${notification.action} aplicado.`,
    configured: true,
    providerReference: providerRef,
    sale_confirmed: false,
  };
}

async function registerMercadoPagoPixIntent(
  supabase: DbClient,
  input: MercadoPagoPixPaymentInput,
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
    items?: MercadoPagoPixPaymentInput["items"];
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
