import { afterEach, describe, expect, it, vi } from "vitest";
import { executeCardPayment } from "@/lib/server/card-payment";
import { probeStripeCardHealth, resolveCardPaymentAdapter } from "@/lib/server/stripe-card";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CardPaymentInput } from "@/lib/validation/schemas";

vi.mock("@/lib/server/stripe-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/stripe-card")>();
  return {
    ...actual,
    probeStripeCardHealth: vi.fn(),
    resolveCardPaymentAdapter: vi.fn(),
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

const probeStripeCardHealthMock = vi.mocked(probeStripeCardHealth);
const resolveCardPaymentAdapterMock = vi.mocked(resolveCardPaymentAdapter);
const createAdminClientMock = vi.mocked(createAdminClient);

const STORE = "11111111-1111-4111-8111-111111111111";
const MUTATION = "22222222-2222-4222-8222-222222222222";
const OPERATOR = "33333333-3333-4333-8333-333333333333";
const PRODUCT = "55555555-5555-4555-8555-555555555555";

function captureInput(): CardPaymentInput {
  return {
    action: "capture",
    store_id: STORE,
    amount: "10.00",
    client_mutation_id: MUTATION,
    provider_reference: "pi_test_123",
    discount: "0.00",
    items: [{ product_id: PRODUCT, quantity: 1, unit_price: "10.00", discount: "0.00" }],
  };
}

function authorizeInput(): CardPaymentInput {
  return {
    action: "authorize",
    store_id: STORE,
    amount: "10.00",
    client_mutation_id: MUTATION,
    discount: "0.00",
    items: [{ product_id: PRODUCT, quantity: 1, unit_price: "10.00", discount: "0.00" }],
  };
}

describe("card capture fail-closed", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    probeStripeCardHealthMock.mockReset();
    resolveCardPaymentAdapterMock.mockReset();
    createAdminClientMock.mockReset();
  });

  it("does not capture or claim success when service role is missing", async () => {
    vi.stubEnv("CARD_CHECKOUT_ENABLED", "true");
    createAdminClientMock.mockReturnValue(null);
    const capture = vi.fn();
    resolveCardPaymentAdapterMock.mockResolvedValue({
      capture,
    } as never);

    const result = await executeCardPayment({} as never, captureInput(), OPERATOR);
    expect(result).toMatchObject({
      status: "not_configured",
      configured: false,
      sale_confirmed: false,
    });
    expect(result.status).not.toBe("captured");
    expect(capture).not.toHaveBeenCalled();
    expect(probeStripeCardHealthMock).not.toHaveBeenCalled();
  });

  it("never returns captured when Stripe succeeded but process_card_sale did not confirm", async () => {
    vi.stubEnv("CARD_CHECKOUT_ENABLED", "true");
    const adminRpc = vi.fn().mockResolvedValue({ data: { status: "captured" }, error: null });
    createAdminClientMock.mockReturnValue({ rpc: adminRpc } as never);
    probeStripeCardHealthMock.mockResolvedValue({
      ok: true,
      configured: true,
      testmode: true,
      message: "ok",
    });
    resolveCardPaymentAdapterMock.mockResolvedValue({
      capture: async () => ({
        status: "captured",
        message: "Stripe capture → captured.",
        providerReference: "pi_test_123",
      }),
    } as never);
    const userRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "22023", message: "card_payment_not_captured" },
    });

    const result = await executeCardPayment({ rpc: userRpc } as never, captureInput(), OPERATOR);

    expect(result.status).toBe("unknown");
    expect(result.status).not.toBe("captured");
    expect(result.sale_confirmed).toBe(false);
    expect(result.message).not.toMatch(/HTTP\/Stripe captured/i);
    expect(userRpc).toHaveBeenCalledWith("process_card_sale", expect.anything());
  });

  it("surfaces inventory_movement_conflict without claiming capture success", async () => {
    vi.stubEnv("CARD_CHECKOUT_ENABLED", "true");
    const adminRpc = vi.fn().mockResolvedValue({ data: { status: "captured" }, error: null });
    createAdminClientMock.mockReturnValue({ rpc: adminRpc } as never);
    probeStripeCardHealthMock.mockResolvedValue({
      ok: true,
      configured: true,
      testmode: true,
      message: "ok",
    });
    resolveCardPaymentAdapterMock.mockResolvedValue({
      capture: async () => ({
        status: "captured",
        message: "Stripe capture → captured.",
        providerReference: "pi_test_123",
      }),
    } as never);
    const userRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23514", message: "inventory_movement_chain_mismatch" },
    });

    const result = await executeCardPayment({ rpc: userRpc } as never, captureInput(), OPERATOR);

    expect(result.status).toBe("unknown");
    expect(result.sale_confirmed).toBe(false);
    expect(result.error).toBe("inventory_movement_conflict");
    expect(result.message).toMatch(/estoque/i);
    expect(result.status).not.toBe("captured");
  });

  it("authorize never reports sale_confirmed and does not look captured", async () => {
    vi.stubEnv("CARD_CHECKOUT_ENABLED", "true");
    createAdminClientMock.mockReturnValue({ rpc: vi.fn() } as never);
    probeStripeCardHealthMock.mockResolvedValue({
      ok: true,
      configured: true,
      testmode: true,
      message: "ok",
    });
    resolveCardPaymentAdapterMock.mockResolvedValue({
      authorize: async () => ({
        status: "authorized",
        message: "Stripe authorize → authorized.",
        providerReference: "pi_test_123",
      }),
    } as never);
    const userRpc = vi.fn().mockResolvedValue({ data: { status: "authorized" }, error: null });

    const result = await executeCardPayment({ rpc: userRpc } as never, authorizeInput(), OPERATOR);
    expect(result.status).toBe("authorized");
    expect(result.sale_confirmed).toBe(false);
    expect(result.status).not.toBe("captured");
  });
});
