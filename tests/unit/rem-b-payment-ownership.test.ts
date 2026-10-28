import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardPaymentInput, MercadoPagoPixPaymentInput, PixPaymentInput } from "@/lib/validation/schemas";
import { executeCardPayment } from "@/lib/server/card-payment";
import { executePixPayment } from "@/lib/server/pix-payment";
import { executeMercadoPagoPixPayment } from "@/lib/server/mercadopago-pix-payment";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCardPaymentAdapter } from "@/lib/server/stripe-card";
import { resolvePixPaymentAdapter } from "@/lib/server/stripe-pix";
import { resolveMercadoPagoPixPaymentAdapter } from "@/lib/server/mercadopago";

// Regressão B3: capture/cancel no provedor só depois de provar que o intent pertence à loja.
// Adapters espiões (exigem zero chamadas quando a loja não é dona), banco mockado, sem rede.

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

vi.mock("@/lib/server/stripe-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/stripe-card")>();
  return {
    ...actual,
    probeStripeCardHealth: vi.fn(async () => ({ configured: true, testmode: true, message: "ok" })),
    resolveCardPaymentAdapter: vi.fn(),
  };
});

vi.mock("@/lib/server/stripe-pix", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/stripe-pix")>();
  return {
    ...actual,
    probeStripePixHealth: vi.fn(async () => ({ ok: true, configured: true, testmode: true, message: "ok" })),
    resolvePixPaymentAdapter: vi.fn(),
  };
});

vi.mock("@/lib/server/mercadopago", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/mercadopago")>();
  return {
    ...actual,
    isMercadoPagoCheckoutEnabled: vi.fn(() => true),
    probeMercadoPagoPixHealth: vi.fn(async () => ({ ok: true, configured: true, testmode: true, message: "ok" })),
    resolveMercadoPagoPixPaymentAdapter: vi.fn(),
  };
});

const STORE = "11111111-1111-4111-8111-111111111111";
const MUTATION = "22222222-2222-4222-8222-222222222222";
const OPERATOR = "33333333-3333-4333-8333-333333333333";
const CARD_REF = "pi_OWNEDCARD123";
const PIX_REF = "pi_OWNEDPIX123";
const MP_REF = "ORD01OWNEDMP123";

type Adapter = {
  authorize: ReturnType<typeof vi.fn>;
  capture: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  reconcile: ReturnType<typeof vi.fn>;
};

function spyAdapter(): Adapter {
  return {
    authorize: vi.fn(async () => ({ status: "unknown", message: "x", configured: true })),
    capture: vi.fn(async (_amount: string, context: { providerReference?: string }) => ({
      status: "failed",
      message: "capture spy",
      providerReference: context.providerReference,
      configured: true,
    })),
    cancel: vi.fn(async (_amount: string, context: { providerReference?: string }) => ({
      status: "failed",
      message: "cancel spy",
      providerReference: context.providerReference,
      configured: true,
    })),
    reconcile: vi.fn(async () => ({ status: "unknown", message: "x", configured: true })),
  };
}

/** User session client. get_*_payment_intent answers only when the intent belongs to the store. */
function userClient(ownedRefs: string[]) {
  return {
    rpc: vi.fn(async (name: string, args: { p_payload: { provider_ref: string; store_id: string } }) => {
      const ref = args.p_payload.provider_ref;
      if (
        (name === "get_card_payment_intent" || name === "get_pix_payment_intent") &&
        args.p_payload.store_id === STORE &&
        ownedRefs.includes(ref)
      ) {
        return { data: { provider_ref: ref, amount: "5.00", status: "authorized" }, error: null };
      }
      return { data: null, error: { message: "payment_access_denied_or_not_found" } };
    }),
  };
}

describe("B3 provider action only after store ownership", () => {
  let adminRpc: ReturnType<typeof vi.fn>;
  let cardAdapter: Adapter;
  let pixAdapter: Adapter;
  let mpAdapter: Adapter;

  beforeEach(() => {
    vi.stubEnv("CARD_CHECKOUT_ENABLED", "true");
    vi.stubEnv("STRIPE_PIX_ENABLED", "true");
    vi.stubEnv("PIX_CHECKOUT_ENABLED", "true");
    adminRpc = vi.fn(async () => ({ data: null, error: null }));
    vi.mocked(createAdminClient).mockReturnValue({ rpc: adminRpc } as unknown as ReturnType<typeof createAdminClient>);
    cardAdapter = spyAdapter();
    pixAdapter = spyAdapter();
    mpAdapter = spyAdapter();
    vi.mocked(resolveCardPaymentAdapter).mockResolvedValue(cardAdapter as never);
    vi.mocked(resolvePixPaymentAdapter).mockResolvedValue(pixAdapter as never);
    vi.mocked(resolveMercadoPagoPixPaymentAdapter).mockResolvedValue(mpAdapter as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  const cardCapture = (ref: string): CardPaymentInput =>
    ({ action: "capture", store_id: STORE, amount: "5.00", client_mutation_id: MUTATION, provider_reference: ref }) as CardPaymentInput;
  const cardCancel = (ref: string): CardPaymentInput =>
    ({ action: "cancel", store_id: STORE, amount: "5.00", client_mutation_id: MUTATION, provider_reference: ref }) as CardPaymentInput;
  const pixCancel = (ref: string): PixPaymentInput =>
    ({ action: "cancel", store_id: STORE, amount: "5.00", client_mutation_id: MUTATION, provider_reference: ref }) as PixPaymentInput;
  const mpCancel = (ref: string): MercadoPagoPixPaymentInput =>
    ({ action: "cancel", store_id: STORE, amount: "5.00", client_mutation_id: MUTATION, provider_reference: ref }) as MercadoPagoPixPaymentInput;

  it("card capture of an intent from another store does not reach the provider", async () => {
    const supabase = userClient([]);
    const result = await executeCardPayment(supabase as never, cardCapture("pi_OTHERSTORE1"), OPERATOR);
    expect(result.status).toBe("failed");
    expect(cardAdapter.capture).toHaveBeenCalledTimes(0);
    expect(adminRpc).not.toHaveBeenCalledWith("apply_card_provider_status", expect.anything());
  });

  it("card cancel of an intent from another store does not reach the provider", async () => {
    const supabase = userClient([]);
    const result = await executeCardPayment(supabase as never, cardCancel("pi_OTHERSTORE1"), OPERATOR);
    expect(result.status).toBe("failed");
    expect(cardAdapter.cancel).toHaveBeenCalledTimes(0);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("card capture of an owned intent queries ownership first, then calls the provider once", async () => {
    const supabase = userClient([CARD_REF]);
    await executeCardPayment(supabase as never, cardCapture(CARD_REF), OPERATOR);
    expect(supabase.rpc).toHaveBeenCalledWith("get_card_payment_intent", {
      p_payload: { store_id: STORE, provider_ref: CARD_REF },
    });
    expect(cardAdapter.capture).toHaveBeenCalledTimes(1);
    expect(cardAdapter.capture.mock.invocationCallOrder[0]).toBeGreaterThan(
      supabase.rpc.mock.invocationCallOrder[0]!
    );
  });

  it("card cancel of an owned intent calls the provider once", async () => {
    const supabase = userClient([CARD_REF]);
    await executeCardPayment(supabase as never, cardCancel(CARD_REF), OPERATOR);
    expect(cardAdapter.cancel).toHaveBeenCalledTimes(1);
  });

  it("stripe pix cancel of an intent from another store does not reach the provider", async () => {
    const supabase = userClient([]);
    const result = await executePixPayment(supabase as never, pixCancel("pi_OTHERSTORE1"), OPERATOR);
    expect(result.status).toBe("failed");
    expect(pixAdapter.cancel).toHaveBeenCalledTimes(0);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("stripe pix cancel of an owned intent calls the provider once", async () => {
    const supabase = userClient([PIX_REF]);
    await executePixPayment(supabase as never, pixCancel(PIX_REF), OPERATOR);
    expect(pixAdapter.cancel).toHaveBeenCalledTimes(1);
  });

  it("mercado pago pix cancel of an order from another store does not reach the provider", async () => {
    const supabase = userClient([]);
    const result = await executeMercadoPagoPixPayment(supabase as never, mpCancel("ORD01OTHERSTORE"), OPERATOR);
    expect(result.status).toBe("failed");
    expect(mpAdapter.cancel).toHaveBeenCalledTimes(0);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("mercado pago pix cancel of an owned order calls the provider once", async () => {
    const supabase = userClient([MP_REF]);
    await executeMercadoPagoPixPayment(supabase as never, mpCancel(MP_REF), OPERATOR);
    expect(mpAdapter.cancel).toHaveBeenCalledTimes(1);
  });

  it("an ownership lookup that throws is treated as not owned (fail closed, no provider call)", async () => {
    const supabase = {
      rpc: vi.fn(async () => {
        throw new Error("network");
      }),
    };
    const result = await executeCardPayment(supabase as never, cardCapture(CARD_REF), OPERATOR);
    expect(result.status).toBe("failed");
    expect(cardAdapter.capture).toHaveBeenCalledTimes(0);
  });
});
