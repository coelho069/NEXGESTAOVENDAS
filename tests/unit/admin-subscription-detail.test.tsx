import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminSubscriptionDetailScreen } from "@/components/admin/admin-subscription-detail";
import type { AdminSubscriptionDetail } from "@/lib/domain/admin-subscriptions";

function detail(overrides: Partial<AdminSubscriptionDetail> = {}): AdminSubscriptionDetail {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    subscriptionId: "sub-1",
    clientName: "Alpha Mercado",
    clientSlug: "alpha",
    planId: "plan-1",
    planName: "Pro",
    status: "active",
    billingInterval: "monthly",
    startedAt: "2026-09-01",
    expiresAt: "2026-10-01",
    amount: "99.90",
    cancelledAt: null,
    subscriptionCreatedAt: "2026-09-01T00:00:00.000Z",
    subscriptionUpdatedAt: "2026-09-01T00:00:00.000Z",
    pdvStatus: "active",
    accessAllowed: true,
    accessReason: "ok",
    accessMessage: "Assinatura permite acesso operacional.",
    lastUpdated: "2026-09-01T00:00:00.000Z",
    currency: "BRL",
    timezone: "America/Sao_Paulo",
    storeCount: 1,
    activeStoreCount: 1,
    teamMemberCount: 1,
    sourceEntity: "subscriptions",
    stores: [],
    contacts: [],
    ...overrides,
  };
}

describe("AdminSubscriptionDetailScreen", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows status, plan, period and gate reason for a subscribed org", () => {
    render(<AdminSubscriptionDetailScreen data={detail()} error={null} plans={[]} />);

    const summary = screen.getByTestId("admin-subscription-summary");

    expect(screen.getByRole("heading", { name: "Alpha Mercado" })).toBeInTheDocument();
    expect(summary).toHaveTextContent("Status");
    expect(summary).toHaveTextContent("Ativa");
    expect(summary).toHaveTextContent("Plano");
    expect(summary).toHaveTextContent("Pro");
    expect(summary).toHaveTextContent("Período");
    expect(summary).toHaveTextContent(/01\/09\/2026.*01\/10\/2026/);
    expect(summary).toHaveTextContent("Motivo do gate");
    expect(summary).toHaveTextContent(/Acesso liberado — assinatura válida/);
    expect(summary).toHaveTextContent("Assinatura permite acesso operacional.");
  });

  it("shows blocked gate reason when subscription is expired", () => {
    render(
      <AdminSubscriptionDetailScreen
        data={detail({
          status: "expired",
          accessAllowed: false,
          accessReason: "expired",
          accessMessage: "Assinatura expirada. Assinatura expirada — PDV bloqueado.",
        })}
        error={null}
        plans={[]}
      />
    );

    const summary = screen.getByTestId("admin-subscription-summary");
    expect(summary).toHaveTextContent("Vencida");
    expect(summary).toHaveTextContent(/Assinatura expirada — PDV bloqueado/);
  });

  it("shows notice when organization has no subscription", () => {
    render(
      <AdminSubscriptionDetailScreen
        data={detail({
          status: "none",
          subscriptionId: null,
          planName: null,
          startedAt: null,
          expiresAt: null,
          accessAllowed: false,
          accessReason: "none",
          accessMessage: "Organização sem assinatura cadastrada.",
        })}
        error={null}
        plans={[]}
      />
    );

    expect(
      screen.getByText("Esta organização ainda não possui uma assinatura cadastrada.")
    ).toBeInTheDocument();
    expect(screen.getByText("Sem plano")).toBeInTheDocument();
    expect(screen.getByText("N/D")).toBeInTheDocument();
  });
});
