import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefundRequestRow } from "@/lib/server/refund-requests";
import type { ClientRefundPaymentView } from "@/lib/domain/client-refund-eligibility";
import { SubscriptionAccessView } from "@/components/auth/subscription-access-view";

vi.mock("@/lib/server/admin-refund-request-actions", () => ({
  reviewRefundRequestAction: vi.fn(),
}));
vi.mock("@/lib/server/refund-phase21-audit-action", () => ({
  runPhase21AuditAction: vi.fn(),
}));

import { AdminRefundRequestsScreen } from "@/components/admin/admin-refund-requests-screen";

const PAYMENT_A = "181533292037";
const PAYMENT_B = "181540452257";
const OPTION = "[data-testid='client-refund-payment-option']";
const PANEL = "[data-testid='client-refund-panel']";
const SLOT = "[data-testid='client-refund-slot']";

const allowedDecision = {
  allowed: true,
  showAdminValidationAlert: false,
  effectiveState: "active" as const,
  reason: "ok" as const,
  recordedStatus: "active" as const,
};

function payment(mpPaymentId: string): ClientRefundPaymentView {
  return {
    mpPaymentId,
    paidOn: "2026-10-06",
    eligible: true,
    blockReason: null,
    latestStatus: null,
  };
}

function optionId(mpPaymentId: string) {
  return `#client-refund-option-${mpPaymentId}`;
}

function count(selector: string) {
  return document.querySelectorAll(selector).length;
}

function snapshot(label: string) {
  const counts = {
    options: count(OPTION),
    option181533292037: count(optionId(PAYMENT_A)),
    option181540452257: count(optionId(PAYMENT_B)),
    panels: count(PANEL),
    slots: count(SLOT),
  };
  process.stdout.write(`[TEST_TRACE] ${label} ${JSON.stringify(counts)}\n`);
  return counts;
}

function renderAllowed(payments: ClientRefundPaymentView[]) {
  return render(
    <SubscriptionAccessView
      decision={allowedDecision}
      role="client"
      refundAccess="allowed"
      refundPayments={payments}
    >
      <div data-testid="pdv-shell">PDV</div>
    </SubscriptionAccessView>
  );
}

afterEach(() => {
  cleanup();
});

describe("client refund payment option instance count", () => {
  it("counts one DOM node for 181533292037 inside a single allowed SubscriptionAccessView", () => {
    renderAllowed([payment(PAYMENT_A), payment(PAYMENT_B)]);
    const counts = snapshot("one-subscription-access-view");

    expect(counts.option181533292037).toBe(1);
    expect(counts.option181540452257).toBe(1);
    expect(counts.options).toBe(2);
    expect(counts.panels).toBe(1);
    expect(counts.slots).toBe(1);

    const ids = [...document.querySelectorAll(OPTION)].map((node) => node.getAttribute("data-payment-id"));
    expect(ids).toEqual([PAYMENT_A, PAYMENT_B]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("requires one option button per distinct payment id", () => {
    renderAllowed([payment(PAYMENT_A), payment(PAYMENT_B)]);
    const counts = snapshot("two-distinct-payments");
    const options = [...document.querySelectorAll(OPTION)];

    expect(options).toHaveLength(2);
    for (const id of [PAYMENT_A, PAYMENT_B]) {
      const matches = options.filter((node) => node.getAttribute("data-payment-id") === id);
      expect(matches).toHaveLength(1);
      expect(count(optionId(id))).toBe(1);
      expect(matches[0]?.id).toBe(`client-refund-option-${id}`);
    }
    expect(counts.options).toBe(2);
    expect(counts.panels).toBe(1);
    expect(counts.slots).toBe(1);
  });

  it("still counts one option when the same payment is repeated inside one view", () => {
    renderAllowed([payment(PAYMENT_A), payment(PAYMENT_A), payment(PAYMENT_B)]);
    const counts = snapshot("duplicate-rows-one-view");

    expect(counts.option181533292037).toBe(1);
    expect(counts.option181540452257).toBe(1);
    expect(counts.options).toBe(2);
    expect(counts.panels).toBe(1);
    expect(counts.slots).toBe(1);
  });

  it("counts two option nodes when two SubscriptionAccessView instances are mounted", () => {
    render(
      <>
        <SubscriptionAccessView
          decision={allowedDecision}
          role="client"
          refundAccess="allowed"
          refundPayments={[payment(PAYMENT_A), payment(PAYMENT_B)]}
        >
          <div>primeiro</div>
        </SubscriptionAccessView>
        <SubscriptionAccessView
          decision={allowedDecision}
          role="client"
          refundAccess="allowed"
          refundPayments={[payment(PAYMENT_A), payment(PAYMENT_B)]}
        >
          <div>segundo</div>
        </SubscriptionAccessView>
      </>
    );
    const counts = snapshot("two-subscription-access-views");

    expect(counts.option181533292037).toBe(2);
    expect(counts.option181540452257).toBe(2);
    expect(counts.options).toBe(4);
    expect(counts.panels).toBe(2);
    expect(counts.slots).toBe(2);
  });

  it("does not emit client-refund-payment-option from AdminRefundRequestsScreen", () => {
    const row: RefundRequestRow = {
      id: "22222222-2222-4222-8222-222222222222",
      client_mutation_id: "11111111-1111-4111-8111-111111111111",
      mp_payment_id: PAYMENT_A,
      payer_email: "cliente@example.com",
      reason: "arrependimento",
      notes: "",
      intensive_use_declared: false,
      paid_on: "2026-10-06",
      window_assessment: "within_window",
      status: "submitted",
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

    render(<AdminRefundRequestsScreen error={null} data={[row]} />);
    const counts = snapshot("admin-refund-requests-screen");

    expect(document.body.textContent).toContain(PAYMENT_A);
    expect(counts.options).toBe(0);
    expect(counts.option181533292037).toBe(0);
    expect(counts.panels).toBe(0);
    expect(counts.slots).toBe(0);
    expect(document.querySelector("[data-testid='client-refund-payment-option']")).toBeNull();
  });
});
