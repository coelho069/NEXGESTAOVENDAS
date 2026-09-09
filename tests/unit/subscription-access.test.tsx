import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SubscriptionAccessView } from "@/components/auth/subscription-access-view";
import {
  gateTenantSubscriptionAccess,
  isSubscriptionSchemaMissingError,
  outcomeFromSubscriptionLookup,
  resolveSubscriptionCheck,
  subscriptionBlockTitle,
} from "@/lib/domain/subscription-access";

afterEach(() => {
  cleanup();
});

describe("subscription query classification", () => {
  it("treats missing public.subscriptions schema cache as unavailable, not none", () => {
    const outcome = outcomeFromSubscriptionLookup({
      data: null,
      error: {
        code: "PGRST205",
        message: "Could not find the table 'public.subscriptions' in the schema cache",
      },
    });
    expect(outcome).toEqual({
      kind: "unavailable",
      detail: expect.stringContaining("schema_missing"),
    });

    const check = resolveSubscriptionCheck(outcome);
    expect(check.effectiveState).toBe("unavailable");
    expect(check.reason).toBe("unavailable");
    expect(check.recordedStatus).toBeNull();
    expect(check.effectiveState).not.toBe("none");
  });

  it("treats undefined_table / to_regclass-style errors as unavailable", () => {
    expect(
      isSubscriptionSchemaMissingError({
        code: "42P01",
        message: 'relation "public.plans" does not exist',
      })
    ).toBe(true);

    const check = resolveSubscriptionCheck(
      outcomeFromSubscriptionLookup({
        data: null,
        error: { code: "42P01", message: 'relation "subscriptions" does not exist' },
      })
    );
    expect(check.effectiveState).toBe("unavailable");
    expect(check.reason).toBe("unavailable");
  });

  it("does not convert a successful empty lookup into unavailable", () => {
    const check = resolveSubscriptionCheck(
      outcomeFromSubscriptionLookup({ data: [], error: null })
    );
    expect(check.effectiveState).toBe("none");
    expect(check.reason).toBe("none");
    expect(check.recordedStatus).toBe("none");
  });
});

describe("gateTenantSubscriptionAccess", () => {
  it("fail-opens only the unavailable path and keeps it distinct from none", () => {
    const decision = gateTenantSubscriptionAccess(
      resolveSubscriptionCheck({ kind: "unavailable", detail: "schema_missing" })
    );
    expect(decision.allowed).toBe(true);
    expect(decision.showAdminValidationAlert).toBe(true);
    expect(decision.effectiveState).toBe("unavailable");
    expect(decision.reason).toBe("unavailable");
    expect(decision.effectiveState).not.toBe("none");
  });

  it("blocks real none / expired / canceled when the schema answered", () => {
    for (const recorded of ["none", "expired", "canceled", "cancelled"] as const) {
      const decision = gateTenantSubscriptionAccess(
        resolveSubscriptionCheck({ kind: "success", recordedStatus: recorded === "none" ? null : recorded })
      );
      if (recorded === "none") {
        expect(decision).toMatchObject({
          allowed: false,
          showAdminValidationAlert: false,
          effectiveState: "none",
          reason: "none",
        });
        continue;
      }
      const expected = recorded === "cancelled" ? "canceled" : recorded;
      expect(decision).toMatchObject({
        allowed: false,
        showAdminValidationAlert: false,
        effectiveState: expected,
        reason: expected,
      });
    }
  });

  it("allows recorded active / trialing / past_due without an admin validation alert", () => {
    for (const recorded of ["active", "trialing", "past_due"] as const) {
      const decision = gateTenantSubscriptionAccess(
        resolveSubscriptionCheck({ kind: "success", recordedStatus: recorded })
      );
      expect(decision).toMatchObject({
        allowed: true,
        showAdminValidationAlert: false,
        effectiveState: "active",
        reason: "ok",
        recordedStatus: recorded,
      });
    }
  });
});

describe("SubscriptionAccessView", () => {
  it("renders PDV children on unavailable and surfaces the admin validation alert", () => {
    const decision = gateTenantSubscriptionAccess(
      resolveSubscriptionCheck({ kind: "unavailable", detail: "schema_missing" })
    );
    render(
      <SubscriptionAccessView decision={decision} role="admin">
        <div data-testid="pdv-shell">PDV</div>
      </SubscriptionAccessView>
    );

    expect(screen.getByTestId("subscription-access-allowed")).toBeInTheDocument();
    expect(screen.getByTestId("pdv-shell")).toHaveTextContent("PDV");
    expect(screen.getByTestId("subscription-validation-unavailable-alert")).toHaveTextContent(
      "Não foi possível validar a assinatura"
    );
    expect(screen.queryByTestId("subscription-blocked")).not.toBeInTheDocument();
  });

  it("hides the validation alert from cashier while still fail-opening", () => {
    const decision = gateTenantSubscriptionAccess(
      resolveSubscriptionCheck({ kind: "unavailable", detail: "schema_missing" })
    );
    render(
      <SubscriptionAccessView decision={decision} role="cashier">
        <div data-testid="pdv-shell">PDV</div>
      </SubscriptionAccessView>
    );

    expect(screen.getByTestId("pdv-shell")).toBeInTheDocument();
    expect(screen.queryByTestId("subscription-validation-unavailable-alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("subscription-blocked")).not.toBeInTheDocument();
  });

  it("keeps a blocking card for real expired / canceled / none", () => {
    for (const recorded of ["expired", "canceled", null] as const) {
      const decision = gateTenantSubscriptionAccess(
        resolveSubscriptionCheck({ kind: "success", recordedStatus: recorded })
      );
      const { unmount } = render(
        <SubscriptionAccessView decision={decision} role="cashier">
          <div data-testid="pdv-shell">PDV</div>
        </SubscriptionAccessView>
      );
      expect(screen.getByTestId("subscription-blocked")).toHaveAttribute(
        "data-effective-state",
        decision.effectiveState
      );
      expect(screen.getByTestId("subscription-blocked")).toHaveTextContent(
        subscriptionBlockTitle(decision.effectiveState)
      );
      expect(screen.queryByTestId("pdv-shell")).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe("subscription gate source lock", () => {
  it("does not map unavailable onto a blocking none state", () => {
    const domain = readFileSync(resolve(process.cwd(), "src/lib/domain/subscription-access.ts"), "utf8");
    expect(domain).toContain('effectiveState: "unavailable"');
    expect(domain).toContain("Fail-open only for infrastructural `unavailable`");
    expect(domain).not.toMatch(/unavailable[\s\S]{0,80}effectiveState:\s*"none"/);
  });
});
