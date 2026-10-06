import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefundRequestRow } from "@/lib/server/refund-requests";

vi.mock("@/lib/server/admin-refund-request-actions", () => ({
  reviewRefundRequestAction: vi.fn(),
}));
vi.mock("@/lib/server/refund-phase21-audit-action", () => ({
  runPhase21AuditAction: vi.fn(),
}));

import { AdminRefundRequestsScreen } from "@/components/admin/admin-refund-requests-screen";

afterEach(() => {
  cleanup();
});

function row(status: RefundRequestRow["status"], id: string): RefundRequestRow {
  return {
    id,
    client_mutation_id: "11111111-1111-4111-8111-111111111111",
    mp_payment_id: "123456789",
    payer_email: "cliente@example.com",
    reason: "arrependimento",
    notes: "",
    intensive_use_declared: false,
    paid_on: "2026-10-06",
    window_assessment: "within_window",
    status,
    request_fingerprint: "fingerprint",
    resolution_note: null,
    reviewed_by: null,
    reviewed_at: null,
    checkout_session_id: null,
    payer_email_matches_checkout: true,
    provider: "mercadopago",
    provider_refund_status: "not_sent",
    created_at: "2026-10-06T15:45:26.000Z",
    updated_at: "2026-10-06T15:45:26.000Z",
  };
}

describe("admin refund request queue", () => {
  it("does not present a closed decision as a failed Mercado Pago refund", () => {
    render(
      <AdminRefundRequestsScreen
        error={null}
        data={[
          row("submitted", "22222222-2222-4222-8222-222222222222"),
          row("approved", "33333333-3333-4333-8333-333333333333"),
          row("rejected", "44444444-4444-4444-8444-444444444444"),
          row("withdrawn", "55555555-5555-4555-8555-555555555555"),
        ]}
      />
    );

    expect(screen.queryByText("Estorno Mercado Pago: não enviado")).toBeNull();
    expect(screen.getByRole("button", { name: "Analisar" })).toBeTruthy();
    expect(screen.getByText("Decisão registrada. O estorno não é enviado ao Mercado Pago nesta etapa.")).toBeTruthy();
    expect(screen.getByText("Pedido recusado. Nenhum valor foi estornado.")).toBeTruthy();
    expect(screen.getByText("Pedido retirado.")).toBeTruthy();
    expect(screen.queryByTestId("account-balance-notice")).toBeNull();
  });

  it("shows the Mercado Pago account balance warning", () => {
    render(
      <AdminRefundRequestsScreen
        error={null}
        data={[row("approved", "33333333-3333-4333-8333-333333333333")]}
        balanceNotice="Aviso de saldo da conta Mercado Pago: R$ 5,00 em estorno aprovado ainda não foi enviado. A conta precisa ter saldo disponível; sem saldo, o Mercado Pago recusa o estorno."
      />
    );
    expect(screen.getByTestId("account-balance-notice").textContent).toContain("Aviso de saldo da conta Mercado Pago");
    expect(screen.getByTestId("account-balance-notice").textContent).toContain("R$ 5,00");
  });
});

const APPROVED_ID = "33333333-3333-4333-8333-333333333333";

function sandboxView(amount = "100.00") {
  return {
    [APPROVED_ID]: {
      snapshot_amount: amount,
      snapshot_currency: "BRL" as const,
      payment_method: "Checkout Pro" as const,
      processing_state: null,
      processing_error_class: null,
      provider_refund_status: "not_sent",
      retryable: false,
    },
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

function sentBody(mock: { mock: { calls: unknown[] } }, index: number) {
  const call = mock.mock.calls[index] as [unknown, { body?: string }] | undefined;
  return JSON.parse(String(call?.[1]?.body ?? "{}")) as Record<string, unknown>;
}

describe("admin sandbox refund screen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderApproved() {
    render(
      <AdminRefundRequestsScreen
        error={null}
        data={[row("approved", APPROVED_ID)]}
        sandboxEnabled
        sandbox={sandboxView()}
      />
    );
  }

  it("shows the derived amount and provider, then refunded only after the mock confirms", async () => {
    let resolveFetch: (value: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    renderApproved();

    expect(screen.getByTestId(`refund-snapshot-amount-${APPROVED_ID}`).textContent).toContain("100");
    expect(screen.getByTestId(`refund-provider-${APPROVED_ID}`).textContent).toContain("Mercado Pago");
    expect(screen.getByTestId(`refund-provider-${APPROVED_ID}`).textContent).toContain("Checkout Pro");
    expect(screen.getByTestId(`refund-status-${APPROVED_ID}`).textContent).toContain("Aprovado");

    fireEvent.click(screen.getByTestId(`refund-confirm-${APPROVED_ID}`));
    expect(await screen.findByTestId(`refund-processing-${APPROVED_ID}`)).toBeTruthy();
    expect(screen.queryByTestId(`refund-result-${APPROVED_ID}`)).toBeNull();
    expect(sentBody(fetchMock, 0)).toEqual({
      id: APPROVED_ID,
      confirm: true,
      retry: false,
    });

    resolveFetch(
      new Response(
        JSON.stringify({
          ok: true,
          status: "refunded",
          provider_refund_status: "completed",
          financial_effect: false,
          retryable: false,
        }),
        { status: 200 }
      )
    );
    expect(await screen.findByTestId(`refund-result-${APPROVED_ID}`)).toBeTruthy();
    expect(screen.getByTestId(`refund-status-${APPROVED_ID}`).textContent).toContain("Reembolsado");
  });

  it("shows a temporary error and a retry, then refunded only on the next confirmation", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        jsonResponse({
          ok: false,
          error: "provider_unavailable",
          status: "processing",
          provider_refund_status: "failed",
          processing_state: "failed",
          financial_effect: false,
          retryable: true,
        })
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          ok: true,
          status: "refunded",
          provider_refund_status: "completed",
          financial_effect: false,
          retryable: false,
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    renderApproved();
    expect(screen.queryByLabelText("Cenário do sandbox")).toBeNull();
    fireEvent.click(screen.getByTestId(`refund-confirm-${APPROVED_ID}`));
    expect(await screen.findByTestId(`refund-error-${APPROVED_ID}`)).toBeTruthy();
    expect(screen.getByTestId(`refund-error-${APPROVED_ID}`).textContent).toContain("temporariamente");
    expect(screen.queryByTestId(`refund-result-${APPROVED_ID}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`refund-retry-${APPROVED_ID}`));
    expect(await screen.findByTestId(`refund-result-${APPROVED_ID}`)).toBeTruthy();
    expect(sentBody(fetchMock, 1)).toEqual({ id: APPROVED_ID, confirm: true, retry: true });
    expect(sentBody(fetchMock, 0)).not.toHaveProperty("scenario");
  });

  it("does not offer an unlimited retry after a permanent error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse({
          ok: false,
          error: "refund_not_allowed",
          status: "processing",
          provider_refund_status: "failed",
          processing_state: "failed",
          financial_effect: false,
          retryable: false,
        })
      )
    );
    renderApproved();
    fireEvent.click(screen.getByTestId(`refund-confirm-${APPROVED_ID}`));
    expect(await screen.findByTestId(`refund-error-${APPROVED_ID}`)).toBeTruthy();
    expect(screen.queryByTestId(`refund-retry-${APPROVED_ID}`)).toBeNull();
    expect(screen.queryByTestId(`refund-result-${APPROVED_ID}`)).toBeNull();
  });

  it("keeps a timeout as an unknown processing state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse({
          ok: false,
          error: "provider_timeout",
          status: "processing",
          provider_refund_status: "processing",
          processing_state: "unknown",
          processing_finished_at: null,
          provider_refund_id: null,
          financial_effect: false,
          retryable: true,
        })
      )
    );
    renderApproved();
    fireEvent.click(screen.getByTestId(`refund-confirm-${APPROVED_ID}`));
    expect((await screen.findAllByText(/desconhecido/)).length).toBeGreaterThan(0);
    expect(screen.getByTestId(`refund-retry-${APPROVED_ID}`)).toBeTruthy();
    expect(screen.queryByTestId(`refund-result-${APPROVED_ID}`)).toBeNull();
    expect(screen.getByTestId(`refund-status-${APPROVED_ID}`).textContent).not.toContain("Reembolsado");
  });

  it("shows one refunded result for a duplicate sandbox response", async () => {
    const fetchMock = vi.fn(() =>
      jsonResponse({
        ok: true,
        status: "refunded",
        provider_refund_status: "completed",
        financial_effect: false,
        replayed: true,
        retryable: false,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    renderApproved();
    fireEvent.click(screen.getByTestId(`refund-confirm-${APPROVED_ID}`));
    expect(await screen.findByTestId(`refund-result-${APPROVED_ID}`)).toBeTruthy();
    expect(screen.getAllByTestId(`refund-result-${APPROVED_ID}`)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody(fetchMock, 0)).not.toHaveProperty("scenario");
  });

  it("does not send a second processing request while one is in flight", async () => {
    let resolveFetch: (value: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    renderApproved();
    fireEvent.click(screen.getByTestId(`refund-confirm-${APPROVED_ID}`));
    expect(await screen.findByTestId(`refund-processing-${APPROVED_ID}`)).toBeTruthy();
    const confirm = screen.getByTestId(`refund-confirm-${APPROVED_ID}`);
    expect(confirm).toHaveProperty("disabled", true);
    fireEvent.click(confirm);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(`refund-result-${APPROVED_ID}`)).toBeNull();
    resolveFetch(
      new Response(
        JSON.stringify({
          ok: true,
          status: "refunded",
          provider_refund_status: "completed",
          financial_effect: false,
          retryable: false,
        }),
        { status: 200 }
      )
    );
    expect(await screen.findByTestId(`refund-result-${APPROVED_ID}`)).toBeTruthy();
    expect(screen.getAllByTestId(`refund-result-${APPROVED_ID}`)).toHaveLength(1);
  });
});
