import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assessClientRefundEligibility,
  presentClientRefundPayments,
  type ClientCheckoutPayment,
  type ClientRefundActor,
} from "@/lib/domain/client-refund-eligibility";
import { createOwnedRefundRequest } from "@/lib/server/client-refund-requests";
import type { RefundRequestStore } from "@/lib/server/refund-requests";
import {
  CLIENT_REFUND_BUTTON_LABEL,
  CLIENT_REFUND_CONFIRMATION,
  CLIENT_REFUND_OPEN_STATUS,
  CLIENT_REFUND_SUCCESS,
  ClientRefundRequestPanel,
} from "@/components/account/client-refund-request-panel";
import { SubscriptionAccessView } from "@/components/auth/subscription-access-view";
import { REFUND_GMAIL_REQUIRED_MESSAGE } from "@/lib/domain/refund-gmail-access";
import { refundRequestBrowserAllowed } from "@/lib/security/refund-request-origin";
import {
  assessRefundWindowFromInstant,
  refundWindowContainsInstant,
  saoPauloDateFromInstant,
  REFUND_WINDOW_MS,
} from "@/lib/domain/refund-request";

const actor: ClientRefundActor = {
  userId: "22222222-2222-4222-8222-222222222222",
  email: "client@example.com",
  orgId: "33333333-3333-4333-8333-333333333333",
};

function payment(overrides: Partial<ClientCheckoutPayment> = {}): ClientCheckoutPayment {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    payerEmail: "client@example.com",
    mpPaymentId: "123456789",
    mpPaymentStatus: "approved",
    mpPaymentPaidAt: "2026-10-06T15:00:00.000Z",
    onboardingUserId: actor.userId,
    onboardingOrganizationId: actor.orgId,
    ...overrides,
  };
}

function store(insert = vi.fn(async () => ({ error: null }))): RefundRequestStore & { insert: ReturnType<typeof vi.fn> } {
  return {
    findByMutationId: vi.fn(async () => null),
    findById: vi.fn(async () => null),
    insert,
    findCheckout: vi.fn(async () => null),
    updateIfStatus: vi.fn(async () => null),
    listRecent: vi.fn(async () => []),
  };
}

const ownedInput = {
  actor,
  checkout: payment(),
  hasOpenRequest: false,
  clientMutationId: "44444444-4444-4444-8444-444444444444",
  mpPaymentId: "123456789",
  reason: "arrependimento" as const,
  notes: "",
  intensiveUseDeclared: false,
  now: new Date("2026-10-08T15:00:00.000Z"),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("client refund ownership", () => {
  it("accepts the linked user inside the seven-day window and refuses everyone else", () => {
    const now = new Date("2026-10-08T15:00:00.000Z");
    expect(
      assessClientRefundEligibility({
        actor,
        payment: payment(),
        now,
        openRequest: false,
      }).eligible
    ).toBe(true);

    const stranger = assessClientRefundEligibility({
      actor: { ...actor, userId: "55555555-5555-4555-8555-555555555555" },
      payment: payment(),
      now,
      openRequest: false,
    });
    expect(stranger).toEqual({ eligible: false, reason: "not_owner" });

    const emailOnly = assessClientRefundEligibility({
      actor,
      payment: payment({ onboardingUserId: null }),
      now,
      openRequest: false,
    });
    expect(emailOnly.eligible).toBe(true);

    const otherUserSameEmail = assessClientRefundEligibility({
      actor,
      payment: payment({ onboardingUserId: "55555555-5555-4555-8555-555555555555" }),
      now,
      openRequest: false,
    });
    expect(otherUserSameEmail).toEqual({ eligible: false, reason: "not_owner" });
  });

  it("refuses an old payment, an open request, and declared intensive use", () => {
    expect(
      assessClientRefundEligibility({
        actor,
        payment: payment({ mpPaymentPaidAt: "2026-09-01T15:00:00.000Z" }),
        now: new Date("2026-10-08T15:00:00.000Z"),
        openRequest: false,
      })
    ).toEqual({ eligible: false, reason: "outside_window" });

    expect(
      assessClientRefundEligibility({
        actor,
        payment: payment(),
        now: new Date("2026-10-08T15:00:00.000Z"),
        openRequest: true,
      })
    ).toEqual({ eligible: false, reason: "open_request" });

    expect(
      assessClientRefundEligibility({
        actor,
        payment: payment(),
        now: new Date("2026-10-08T15:00:00.000Z"),
        openRequest: false,
        intensiveUseDeclared: true,
      })
    ).toEqual({ eligible: false, reason: "intensive_use" });
  });

  it("lists only the actor's paid checkouts", () => {
    const views = presentClientRefundPayments({
      actor,
      now: new Date("2026-10-08T15:00:00.000Z"),
      checkouts: [
        payment(),
        payment({
          id: "66666666-6666-4666-8666-666666666666",
          mpPaymentId: "999999999",
          onboardingUserId: "55555555-5555-4555-8555-555555555555",
          payerEmail: "other@example.com",
        }),
        payment({
          id: "77777777-7777-4777-8777-777777777777",
          mpPaymentId: "888888888",
          mpPaymentStatus: "pending",
        }),
      ],
      requests: [],
    });
    expect(views.map((view) => view.mpPaymentId)).toEqual(["123456789"]);
    expect(views[0]?.eligible).toBe(true);
  });

  it("collapses two checkout rows that share payment 181533292037", () => {
    const views = presentClientRefundPayments({
      actor,
      now: new Date("2026-10-08T15:00:00.000Z"),
      checkouts: [
        payment({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          mpPaymentId: "181533292037",
        }),
        payment({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          mpPaymentId: "181533292037",
          mpPaymentPaidAt: "2026-10-05T15:00:00.000Z",
        }),
        payment({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          mpPaymentId: "181540452257",
        }),
      ],
      requests: [],
    });
    expect(views.map((item) => item.mpPaymentId)).toEqual(["181533292037", "181540452257"]);
  });

  it("inserts an analysis request and does not record a sent refund", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const memory = store(insert);
    memory.findByMutationId = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "88888888-8888-4888-8888-888888888888",
        status: "submitted",
      });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await createOwnedRefundRequest(memory, ownedInput);
    expect(result).toMatchObject({ ok: true, replayed: false });
    expect(insert).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "mercadopago",
        provider_refund_status: "not_sent",
        status: "submitted",
        payer_email: "client@example.com",
        mp_payment_id: "123456789",
        requester_user_id: "22222222-2222-4222-8222-222222222222",
        window_assessment: "within_window",
        reason: "arrependimento",
        notes: "",
      })
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("does not insert when the payment belongs to someone else", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const result = await createOwnedRefundRequest(store(insert), {
      ...ownedInput,
      checkout: payment({ onboardingUserId: "55555555-5555-4555-8555-555555555555" }),
    });
    expect(result).toEqual({ ok: false, error: "payment_not_owned", status: 403 });
    expect(insert).not.toHaveBeenCalled();
  });

  it("keeps provider refund calls out of the client request path", () => {
    const source = [
      "src/app/api/refund-requests/route.ts",
      "src/lib/server/client-refund-requests.ts",
      "src/lib/domain/client-refund-eligibility.ts",
      "src/components/account/client-refund-request-panel.tsx",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");
    expect(source).not.toContain("api.mercadopago.com");
    expect(source).not.toContain("refunds.create");
    expect(source).not.toContain("stripe.refunds");
    expect(source).not.toContain("dispatchMercadoPagoRefund");
  });
});

const allowedDecision = {
  allowed: true,
  showAdminValidationAlert: false,
  effectiveState: "active" as const,
  reason: "ok" as const,
  recordedStatus: "active" as const,
};

function renderClientScreen(payments: Parameters<typeof SubscriptionAccessView>[0]["refundPayments"]) {
  return render(
    <SubscriptionAccessView decision={allowedDecision} role="client" refundPayments={payments}>
      <div data-testid="pdv-shell">PDV</div>
    </SubscriptionAccessView>
  );
}

describe("client refund button on the PDV shell", () => {
  it("renders Solicitar reembolso for an eligible payment and posts only after confirmation", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, id: "88888888-8888-4888-8888-888888888888", status: "submitted" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    for (const width of [390, 1280]) {
      window.innerWidth = width;
      cleanup();
      fetchMock.mockClear();
      renderClientScreen([
        {
          mpPaymentId: "123456789",
          paidOn: "2026-10-06",
          eligible: true,
          blockReason: null,
          latestStatus: null,
        },
      ]);
      const button = screen.getByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL });
      expect(button.className).not.toMatch(/\bhidden\b/);
      expect(screen.getByTestId("pdv-shell")).toBeTruthy();
      expect(button).toHaveProperty("disabled", true);
      fireEvent.click(button);
      expect(fetchMock).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("checkbox", { name: CLIENT_REFUND_CONFIRMATION }));
      fireEvent.click(screen.getByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL }));
      expect(await screen.findByText(CLIENT_REFUND_SUCCESS)).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/refund-requests",
        expect.objectContaining({ method: "POST" })
      );
      const call = fetchMock.mock.calls.at(-1) as unknown as [string, { body?: string }] | undefined;
      const body = JSON.parse(String(call?.[1].body));
      expect(body).toMatchObject({
        mp_payment_id: "123456789",
        reason: "arrependimento",
        confirmed: true,
      });
      expect(body.payer_email).toBeUndefined();
      expect(screen.queryByText("Receber reembolso")).toBeNull();
      expect(screen.queryByText("Refund imediato")).toBeNull();
      expect(screen.queryByText("Garantia de devolução")).toBeNull();
    }
    vi.unstubAllGlobals();
  });

  it("keeps the refund panel mounted on the PDV when a later list update is empty", () => {
    const payments = [view("181540452257", true)];
    const screenTree = (
      next: Parameters<typeof SubscriptionAccessView>[0]["refundPayments"]
    ) => (
      <SubscriptionAccessView decision={allowedDecision} role="client" refundPayments={next}>
        <div data-testid="pdv-shell">PDV</div>
      </SubscriptionAccessView>
    );
    const { rerender } = render(screenTree(payments));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "não sumir" } });
    expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);

    rerender(screenTree([]));
    expect(screen.getByTestId("client-refund-slot")).toBeTruthy();
    expect(screen.getByTestId("pdv-shell")).toBeTruthy();
    expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
    expect(screen.getByTestId("client-refund-form").getAttribute("data-payment-id")).toBe("181540452257");
    expect(screen.getByRole("textbox")).toHaveValue("não sumir");
    expect(screen.getAllByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL })).toHaveLength(1);
  });

  it("shows no button when the client has no eligible payment", () => {
    renderClientScreen([]);
    expect(screen.queryByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL })).toBeNull();
    expect(screen.getByTestId("pdv-shell")).toBeTruthy();
    expect(screen.queryByTestId("client-refund-slot")).toBeNull();
  });

  it("shows five payment choices and one form on the PDV shell", () => {
    for (const width of [390, 1280]) {
      window.innerWidth = width;
      cleanup();
      renderClientScreen(
        Array.from({ length: 5 }, (_, index) => ({
          mpPaymentId: String(200000 + index),
          paidOn: "2026-10-06",
          eligible: true,
          blockReason: null,
          latestStatus: null,
        }))
      );
      expect(screen.getByTestId("pdv-shell")).toBeTruthy();
      expect(screen.getAllByTestId("client-refund-payment-option")).toHaveLength(5);
      expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
      expect(screen.getByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL }).className).not.toMatch(/\bhidden\b/);
    }
  });

  it("shows the open-request status instead of another button", () => {
    renderClientScreen([
      {
        mpPaymentId: "123456789",
        paidOn: "2026-10-06",
        eligible: false,
        blockReason: "open_request",
        latestStatus: "submitted",
      },
    ]);
    expect(screen.getByText(CLIENT_REFUND_OPEN_STATUS)).toBeTruthy();
    expect(screen.queryByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL })).toBeNull();
    expect(screen.queryByTestId("client-refund-form")).toBeNull();
  });
});

describe("refund request browser origin", () => {
  function call(headers: Record<string, string>) {
    return refundRequestBrowserAllowed(
      new Request("https://nexgestaovendas.com.br/api/refund-requests", { method: "POST", headers })
    );
  }

  it("accepts a same-origin browser and rejects cross-site or missing origin", () => {
    expect(call({ origin: "https://nexgestaovendas.com.br", "sec-fetch-site": "same-origin" })).toBe(true);
    expect(call({ origin: "https://evil.example", "sec-fetch-site": "cross-site" })).toBe(false);
    expect(call({ "sec-fetch-site": "same-origin" })).toBe(false);
    expect(call({ origin: "https://nexgestaovendas.com.br", "sec-fetch-site": "cross-site" })).toBe(false);
    expect(call({ origin: "https://nexgestaovendas.com.br" })).toBe(true);
    expect(call({})).toBe(false);
  });
});

describe("seven-day window from the payment instant", () => {
  const day = REFUND_WINDOW_MS;

  it("keeps 23:00 America/Sao_Paulo on that local date and ignores the UTC slice", () => {
    const paidAt = new Date("2026-10-06T23:00:00-03:00");
    expect(saoPauloDateFromInstant(paidAt.toISOString())).toBe("2026-10-06");
    expect(paidAt.toISOString().slice(0, 10)).toBe("2026-10-07");
    expect(refundWindowContainsInstant(paidAt, new Date(paidAt.getTime() + day - 1000))).toBe(true);
    expect(refundWindowContainsInstant(paidAt, new Date(paidAt.getTime() + day))).toBe(true);
    expect(refundWindowContainsInstant(paidAt, new Date(paidAt.getTime() + day + 1000))).toBe(false);
    expect(assessRefundWindowFromInstant(paidAt, new Date(paidAt.getTime() + day + 1000))).toBe("outside_window");
  });

  it("starts the window at 00:00 UTC itself, not at the UTC calendar date", () => {
    const paidAt = new Date("2026-10-07T00:00:00.000Z");
    expect(saoPauloDateFromInstant(paidAt.toISOString())).toBe("2026-10-06");
    expect(paidAt.toISOString().slice(0, 10)).toBe("2026-10-07");
    expect(refundWindowContainsInstant(paidAt, new Date(paidAt.getTime() + day))).toBe(true);
    expect(refundWindowContainsInstant(paidAt, new Date(paidAt.getTime() + day + 1000))).toBe(false);
  });
});

function view(
  id: string,
  eligible: boolean,
  blockReason: "open_request" | null = eligible ? null : "open_request"
) {
  return {
    mpPaymentId: id,
    paidOn: "2026-10-06",
    eligible,
    blockReason,
    latestStatus: eligible ? null : ("submitted" as const),
  };
}

describe("ClientRefundRequestPanel", () => {
  it("shows payment 181540452257 once and a single request form", () => {
    render(
      <ClientRefundRequestPanel
        payments={[
          view("181540452200", true),
          view("181540452257", true),
          view("181540452257", true),
          view("181540452300", true),
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /181540452257/ }));

    expect(screen.getAllByText(/181540452257/)).toHaveLength(1);
    expect(screen.getAllByText("Pago em 2026-10-06")).toHaveLength(3);
    expect(screen.getAllByTestId("client-refund-payment-option")).toHaveLength(3);
    expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getAllByRole("checkbox", { name: CLIENT_REFUND_CONFIRMATION })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /181540452300/ }));

    expect(screen.getAllByText(/181540452257/)).toHaveLength(1);
    expect(screen.getAllByText(/181540452300/)).toHaveLength(1);
    expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
    expect(screen.getByTestId("client-refund-form").getAttribute("data-payment-id")).toBe("181540452300");
    expect(screen.queryByText(/Solicitação para o pagamento/)).toBeNull();
  });

  it("renders payment 181533292037 once when the list contains that payment twice", () => {
    const duplicated = "181533292037";
    const other = "181540452257";

    function options() {
      return screen.queryAllByTestId("client-refund-payment-option");
    }
    function optionPaymentIds() {
      return options().map((option) => option.getAttribute("data-payment-id"));
    }
    function pressedIds() {
      return options()
        .filter((option) => option.getAttribute("aria-pressed") === "true")
        .map((option) => option.getAttribute("data-payment-id"));
    }
    function domIdCount(paymentId: string) {
      return document.querySelectorAll(`#client-refund-option-${paymentId}`).length;
    }

    const { rerender } = render(
      <ClientRefundRequestPanel
        payments={[view(duplicated, true), view(duplicated, true), view(other, true)]}
      />
    );

    expect(options()).toHaveLength(2);
    expect(optionPaymentIds()).toEqual([duplicated, other]);
    expect(new Set(optionPaymentIds()).size).toBe(options().length);
    expect(domIdCount(duplicated)).toBe(1);
    expect(domIdCount(other)).toBe(1);
    expect(pressedIds()).toEqual([duplicated]);
    expect(screen.getAllByText(`Pagamento ${duplicated}`)).toHaveLength(1);
    expect(document.querySelectorAll("[data-testid='client-refund-panel']")).toHaveLength(1);
    expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
    expect(screen.getByTestId("client-refund-form").getAttribute("data-payment-id")).toBe(duplicated);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "nota do pagamento duplicado" } });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(other) }));
    expect(options()).toHaveLength(2);
    expect(domIdCount(duplicated)).toBe(1);
    expect(domIdCount(other)).toBe(1);
    expect(pressedIds()).toEqual([other]);
    expect(screen.getByTestId("client-refund-form").getAttribute("data-payment-id")).toBe(other);
    expect(screen.queryByDisplayValue("nota do pagamento duplicado")).toBeNull();

    rerender(
      <ClientRefundRequestPanel
        payments={[view(duplicated, true), view(other, true), view(duplicated, true), view(other, true)]}
      />
    );
    expect(optionPaymentIds()).toEqual([duplicated, other]);
    expect(domIdCount(duplicated)).toBe(1);
    expect(pressedIds()).toEqual([other]);
    expect(screen.getByTestId("client-refund-form").getAttribute("data-payment-id")).toBe(other);

    rerender(<ClientRefundRequestPanel payments={[]} />);
    expect(options()).toHaveLength(0);
    expect(domIdCount(duplicated)).toBe(0);
    expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
    expect(screen.getByTestId("client-refund-form").getAttribute("data-payment-id")).toBe(other);

    rerender(<ClientRefundRequestPanel payments={[view(duplicated, true), view(duplicated, true)]} />);
    expect(optionPaymentIds()).toEqual([duplicated]);
    expect(domIdCount(duplicated)).toBe(1);
    expect(pressedIds()).toEqual([]);
    expect(screen.getByTestId("client-refund-form").getAttribute("data-payment-id")).toBe(other);

    fireEvent.click(screen.getByRole("button", { name: new RegExp(duplicated) }));
    expect(pressedIds()).toEqual([duplicated]);
    expect(screen.getByTestId("client-refund-form").getAttribute("data-payment-id")).toBe(duplicated);
    expect(screen.getByRole("textbox")).toHaveValue("nota do pagamento duplicado");
    expect(screen.getAllByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL })).toHaveLength(1);
  });

  it("keeps the selected request form mounted through edits, errors and a list refresh", async () => {
    const payments = [view("181540452200", true), view("181540452257", true)];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error: "validation_failed" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<ClientRefundRequestPanel payments={payments} />);
    fireEvent.click(screen.getByRole("button", { name: /181540452257/ }));
    expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
    expect(screen.getByTestId("client-refund-form").getAttribute("data-payment-id")).toBe("181540452257");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cobranca_duplicada" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "observação estável" } });
    fireEvent.click(screen.getByRole("checkbox", { name: CLIENT_REFUND_CONFIRMATION }));
    expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
    expect(screen.getByRole("combobox")).toHaveValue("cobranca_duplicada");
    expect(screen.getByRole("textbox")).toHaveValue("observação estável");
    expect(screen.getByRole("checkbox", { name: CLIENT_REFUND_CONFIRMATION })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL }));
    expect(await screen.findByText("Revise o motivo do pedido.")).toBeTruthy();
    expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
    expect(screen.getByRole("textbox")).toHaveValue("observação estável");

    fireEvent.click(screen.getByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL }));
    expect(await screen.findByText("Não foi possível registrar o pedido agora.")).toBeTruthy();
    expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
    expect(screen.getByTestId("client-refund-detail").getAttribute("data-payment-id")).toBe("181540452257");

    rerender(<ClientRefundRequestPanel payments={[]} />);
    expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
    expect(screen.getByTestId("client-refund-form").getAttribute("data-payment-id")).toBe("181540452257");
    expect(screen.getByRole("textbox")).toHaveValue("observação estável");
    expect(screen.getAllByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL })).toHaveLength(1);

    rerender(<ClientRefundRequestPanel payments={[view("181540452200", true)]} />);
    fireEvent.click(screen.getByRole("button", { name: /181540452200/ }));
    expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
    expect(screen.getByTestId("client-refund-form").getAttribute("data-payment-id")).toBe("181540452200");
    expect(screen.queryByDisplayValue("observação estável")).toBeNull();

    rerender(<ClientRefundRequestPanel payments={payments} />);
    fireEvent.click(screen.getByRole("button", { name: /181540452257/ }));
    expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
    expect(screen.getByRole("textbox")).toHaveValue("observação estável");
    expect(screen.getAllByTestId("client-refund-payment-option")).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("does not render an orphan button by itself", () => {
    const { container } = render(<ClientRefundRequestPanel payments={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("client-refund-form")).toBeNull();
    expect(screen.queryByTestId("client-refund-panel")).toBeNull();
  });

  it("keeps one form for 1, 2 and 5 payments and isolates the selected draft", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, id: "88888888-8888-4888-8888-888888888888", status: "submitted" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    for (const width of [390, 1280]) {
      for (const count of [1, 2, 5]) {
        window.innerWidth = width;
        cleanup();
        fetchMock.mockClear();
        const payments = Array.from({ length: count }, (_, index) => view(String(100000 + index), true));
        render(<ClientRefundRequestPanel payments={payments} />);

        expect(screen.getAllByTestId("client-refund-payment-option")).toHaveLength(count);
        expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
        expect(screen.getByTestId("client-refund-form").getAttribute("data-payment-id")).toBe("100000");
        expect(screen.getAllByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL })).toHaveLength(1);
        expect(screen.getByTestId("client-refund-form").className).not.toMatch(/\bhidden\b/);
        for (const reason of [
          "Arrependimento",
          "Cobrança indevida",
          "Cobrança duplicada",
          "Falha no serviço",
          "Problema técnico",
          "Outro motivo",
        ]) {
          expect(screen.getByRole("option", { name: reason })).toBeTruthy();
        }
      }
    }

    cleanup();
    fetchMock.mockClear();
    render(<ClientRefundRequestPanel payments={[view("100000", true), view("100001", true)]} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cobranca_duplicada" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "nota do primeiro" } });
    fireEvent.click(screen.getByRole("checkbox", { name: CLIENT_REFUND_CONFIRMATION }));

    fireEvent.click(screen.getAllByTestId("client-refund-payment-option")[1]);
    expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
    expect(screen.getByTestId("client-refund-form").getAttribute("data-payment-id")).toBe("100001");
    expect(screen.getByRole("combobox")).toHaveValue("arrependimento");
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: CLIENT_REFUND_CONFIRMATION })).not.toBeChecked();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "nota do segundo" } });

    fireEvent.click(screen.getAllByTestId("client-refund-payment-option")[0]);
    expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
    expect(screen.getByTestId("client-refund-detail").getAttribute("data-payment-id")).toBe("100000");
    expect(screen.getByRole("combobox")).toHaveValue("cobranca_duplicada");
    expect(screen.getByRole("textbox")).toHaveValue("nota do primeiro");
    expect(screen.getByRole("checkbox", { name: CLIENT_REFUND_CONFIRMATION })).toBeChecked();

    for (let turn = 0; turn < 4; turn += 1) {
      fireEvent.click(screen.getAllByTestId("client-refund-payment-option")[turn % 2]);
      expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
    }

    fireEvent.click(screen.getAllByTestId("client-refund-payment-option")[1]);
    fireEvent.click(screen.getByRole("checkbox", { name: CLIENT_REFUND_CONFIRMATION }));
    fireEvent.click(screen.getByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL }));
    expect(await screen.findByText(CLIENT_REFUND_SUCCESS)).toBeTruthy();
    expect(screen.getByText(CLIENT_REFUND_OPEN_STATUS)).toBeTruthy();
    expect(screen.queryByTestId("client-refund-form")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, { body?: string }])[1].body));
    expect(body.mp_payment_id).toBe("100001");
    expect(body.notes).toBe("nota do segundo");
    expect(body.reason).toBe("arrependimento");

    fireEvent.click(screen.getAllByTestId("client-refund-payment-option")[0]);
    expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
    fireEvent.click(screen.getAllByTestId("client-refund-payment-option")[1]);
    expect(screen.queryByTestId("client-refund-form")).toBeNull();
    expect(screen.getByText(CLIENT_REFUND_OPEN_STATUS)).toBeTruthy();

    cleanup();
    render(
      <ClientRefundRequestPanel
        payments={[view("100000", true), view("100001", false), view("100002", true), view("100003", true), view("100004", true)]}
      />
    );
    expect(screen.getAllByTestId("client-refund-payment-option")).toHaveLength(5);
    expect(screen.getAllByTestId("client-refund-form")).toHaveLength(1);
    fireEvent.click(screen.getAllByTestId("client-refund-payment-option")[1]);
    expect(screen.queryByTestId("client-refund-form")).toBeNull();
    expect(screen.getByText(CLIENT_REFUND_OPEN_STATUS)).toBeTruthy();
    expect(screen.queryByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("hides the form for an authenticated non-Gmail account on desktop and mobile", () => {
    for (const width of [390, 1280]) {
      window.innerWidth = width;
      cleanup();
      render(
        <SubscriptionAccessView
          decision={allowedDecision}
          role="client"
          refundAccess="gmail_required"
          refundPayments={[view("100000", true), view("100001", true)]}
        >
          <div data-testid="pdv-shell">PDV</div>
        </SubscriptionAccessView>
      );
      expect(screen.getByText(REFUND_GMAIL_REQUIRED_MESSAGE)).toBeTruthy();
      expect(screen.queryByTestId("client-refund-form")).toBeNull();
      expect(screen.queryByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL })).toBeNull();
      expect(document.querySelectorAll("[data-testid='client-refund-form']")).toHaveLength(0);
    }
  });

  it("replaces the selected form and does not resurrect it from a stale snapshot", async () => {
    const paymentA = "181540452200";
    const paymentB = "181540452257";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error: "validation_failed" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, id: "88888888-8888-4888-8888-888888888888", status: "submitted" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    function forms() {
      return screen.queryAllByTestId("client-refund-form");
    }
    function formIds() {
      return forms().map((form) => form.getAttribute("data-payment-id"));
    }

    const { rerender } = render(
      <ClientRefundRequestPanel payments={[view(paymentA, true), view(paymentB, true)]} />
    );
    expect(document.querySelectorAll("[data-testid='client-refund-panel']")).toHaveLength(1);
    expect(formIds()).toEqual([paymentA]);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "nota A" } });
    expect(formIds()).toEqual([paymentA]);

    fireEvent.click(screen.getByRole("checkbox", { name: CLIENT_REFUND_CONFIRMATION }));
    fireEvent.click(screen.getByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL }));
    expect(await screen.findByText("Revise o motivo do pedido.")).toBeTruthy();
    expect(formIds()).toEqual([paymentA]);

    fireEvent.click(screen.getByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL }));
    expect(await screen.findByText("Não foi possível registrar o pedido agora.")).toBeTruthy();
    expect(formIds()).toEqual([paymentA]);

    rerender(<ClientRefundRequestPanel payments={[view(paymentA, true), view(paymentB, true)]} />);
    expect(formIds()).toEqual([paymentA]);
    expect(document.querySelectorAll("form")).toHaveLength(1);

    rerender(<ClientRefundRequestPanel payments={[]} />);
    expect(formIds()).toEqual([paymentA]);
    expect(screen.getByRole("textbox")).toHaveValue("nota A");

    rerender(<ClientRefundRequestPanel payments={[view(paymentB, true)]} />);
    expect(formIds()).toEqual([paymentA]);
    expect(screen.queryByRole("button", { name: new RegExp(paymentA) })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: new RegExp(paymentB) }));
    expect(formIds()).toEqual([paymentB]);
    expect(screen.queryByDisplayValue("nota A")).toBeNull();
    expect(screen.queryByText("Não foi possível registrar o pedido agora.")).toBeNull();
    expect(screen.queryByText("Revise o motivo do pedido.")).toBeNull();
    expect(document.querySelectorAll("[data-testid='client-refund-panel']")).toHaveLength(1);
    expect(document.querySelectorAll("[data-testid='client-refund-detail']")).toHaveLength(1);

    rerender(<ClientRefundRequestPanel payments={[view(paymentA, true), view(paymentB, true)]} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(paymentA) }));
    expect(formIds()).toEqual([paymentA]);
    expect(screen.getByRole("textbox")).toHaveValue("nota A");
    expect(screen.getByRole("checkbox", { name: CLIENT_REFUND_CONFIRMATION })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL }));
    expect(await screen.findByText(CLIENT_REFUND_SUCCESS)).toBeTruthy();
    expect(forms()).toHaveLength(0);
    expect(screen.getByText(CLIENT_REFUND_OPEN_STATUS)).toBeTruthy();
    expect(document.querySelectorAll("form")).toHaveLength(0);

    rerender(<ClientRefundRequestPanel payments={[view(paymentA, true), view(paymentB, true)]} />);
    expect(forms()).toHaveLength(0);
    expect(screen.getByText(CLIENT_REFUND_SUCCESS)).toBeTruthy();

    rerender(<ClientRefundRequestPanel payments={[]} />);
    expect(forms()).toHaveLength(0);
    expect(screen.queryByText(CLIENT_REFUND_SUCCESS)).toBeTruthy();

    rerender(<ClientRefundRequestPanel payments={[view(paymentA, true)]} />);
    expect(forms()).toHaveLength(0);
    expect(screen.getAllByText(CLIENT_REFUND_SUCCESS)).toHaveLength(1);

    rerender(<ClientRefundRequestPanel payments={[view(paymentA, false), view(paymentB, true)]} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(paymentB) }));
    expect(formIds()).toEqual([paymentB]);
    expect(screen.queryByText(CLIENT_REFUND_SUCCESS)).toBeNull();

    rerender(<ClientRefundRequestPanel payments={[view(paymentB, false)]} />);
    expect(forms()).toHaveLength(0);
    expect(screen.getByText(CLIENT_REFUND_OPEN_STATUS)).toBeTruthy();

    rerender(<ClientRefundRequestPanel payments={[]} />);
    expect(forms()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL })).toBeNull();
    expect(document.querySelectorAll("form")).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it("points an unauthenticated visitor to login without a request form", () => {
    render(<ClientRefundRequestPanel payments={[view("100000", true)]} access="unauthenticated" />);
    expect(screen.getByRole("link", { name: "Entrar" }).getAttribute("href")).toBe("/login");
    expect(screen.queryByTestId("client-refund-form")).toBeNull();
    expect(screen.queryByRole("button", { name: CLIENT_REFUND_BUTTON_LABEL })).toBeNull();
  });
});
