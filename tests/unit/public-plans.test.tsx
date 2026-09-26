import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { getAssinaturasWhatsAppUrl, ASSINATURAS_WHATSAPP_ENV } from "@/lib/assinaturas/whatsapp";
import { comparePublicPlans } from "@/lib/domain/public-plans";
import { loadPublicPlans } from "@/lib/server/public-plans-query";
import { PlansSalesPage } from "@/components/marketing/plans-sales-page";

const PLAN_ID = "33333333-3333-4333-8333-333333333333";

const samplePlan = {
  id: PLAN_ID,
  name: "Essencial",
  description: "PDV para uma loja.",
  amount: "99.90",
  currency: "BRL",
  billingInterval: "monthly" as const,
  stripeEnabled: false,
};

const threeTierPlans = [
  { ...samplePlan, id: "11111111-1111-4111-8111-111111111111", name: "Essencial", amount: "49.90" },
  {
    ...samplePlan,
    id: "22222222-2222-4222-8222-222222222222",
    name: "Profissional",
    amount: "99.90",
    description: "Plano intermediário.",
  },
  { ...samplePlan, id: "44444444-4444-4444-8444-444444444444", name: "Enterprise", amount: "199.90" },
];

describe("public plans migration", () => {
  it("grants anon read of active plans only", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260917180000_public_active_plans_read.sql"),
      "utf8"
    );
    expect(sql).toContain("GRANT SELECT ON TABLE public.plans TO anon");
    expect(sql).toContain("plans_select_public_active");
    expect(sql).toContain("is_active IS TRUE");
    expect(sql).not.toContain("subscriptions");
  });
});

describe("loadPublicPlans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns active plans without admin fields", async () => {
    createClient.mockResolvedValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(async () => ({
              data: [
                {
                  id: PLAN_ID,
                  name: "Essencial",
                  description: "PDV para uma loja.",
                  amount: 99.9,
                  currency: "BRL",
                  billing_interval: "monthly",
                },
              ],
              error: null,
            })),
          })),
        })),
      })),
    });

    await expect(loadPublicPlans()).resolves.toEqual({
      data: [samplePlan],
      error: null,
    });
  });

  it("returns empty list when no active plans", async () => {
    createClient.mockResolvedValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(async () => ({ data: [], error: null })),
          })),
        })),
      })),
    });

    await expect(loadPublicPlans()).resolves.toEqual({ data: [], error: null });
  });

  it("fails closed on query errors", async () => {
    createClient.mockResolvedValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(async () => ({ data: null, error: { message: "denied" } })),
          })),
        })),
      })),
    });

    await expect(loadPublicPlans()).resolves.toEqual({
      data: null,
      error: "public_plans_unavailable",
    });
  });
});

describe("comparePublicPlans", () => {
  it("sorts plan names in pt-BR locale", () => {
    expect(
      comparePublicPlans({ name: "Básico" }, { name: "Premium" })
    ).toBeLessThan(0);
  });
});

describe("getAssinaturasWhatsAppUrl", () => {
  const original = process.env[ASSINATURAS_WHATSAPP_ENV];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ASSINATURAS_WHATSAPP_ENV];
    } else {
      process.env[ASSINATURAS_WHATSAPP_ENV] = original;
    }
  });

  it("returns null when env is unset", () => {
    delete process.env[ASSINATURAS_WHATSAPP_ENV];
    expect(getAssinaturasWhatsAppUrl()).toBeNull();
  });

  it("returns null for invalid URLs", () => {
    process.env[ASSINATURAS_WHATSAPP_ENV] = "http://wa.me/5511999999999";
    expect(getAssinaturasWhatsAppUrl()).toBeNull();
  });

  it("builds plan-specific WhatsApp links", () => {
    process.env[ASSINATURAS_WHATSAPP_ENV] = "https://wa.me/5511999999999";
    const url = getAssinaturasWhatsAppUrl("Essencial");
    expect(url).toContain("https://wa.me/5511999999999");
    expect(url).toContain("text=");
    expect(decodeURIComponent(url!)).toMatch(/Essencial/);
  });
});

describe("PlansSalesPage", () => {
  const original = process.env[ASSINATURAS_WHATSAPP_ENV];

  afterEach(() => {
    cleanup();
    if (original === undefined) {
      delete process.env[ASSINATURAS_WHATSAPP_ENV];
    } else {
      process.env[ASSINATURAS_WHATSAPP_ENV] = original;
    }
  });

  it("renders active plans and header links for visitors", () => {
    delete process.env[ASSINATURAS_WHATSAPP_ENV];

    render(<PlansSalesPage plans={[samplePlan]} loadError={null} isAuthenticated={false} />);

    expect(
      screen.getByRole("heading", {
        name: /Venda mais\. Controle seu estoque\. Gerencie sua loja em um só lugar\./i,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /O Nex Gestão Vendas reúne PDV, estoque, clientes e gestão em uma plataforma/i
      )
    ).toBeInTheDocument();
    // Tier labels: o card usa o rótulo do tier; o nome também aparece na
    // seção "Compare os planos" — por isso getAllByRole.
    expect(
      screen.getAllByRole("heading", { name: "Essencial" }).length
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/R\$\s*99[.,]90/)).toBeInTheDocument();
    expect(screen.getByText(/\/ mensal/)).toBeInTheDocument();
    // Sem env de WhatsApp e checkoutEnabled=false (default): botão vira "Em breve".
    expect(screen.getAllByText("Em breve").length).toBeGreaterThan(0);
    // Header desktop expõe "Entrar" (o menu mobile só renderiza quando aberto).
    expect(screen.getAllByRole("link", { name: "Entrar" })[0]).toHaveAttribute("href", "/login");
    // Visitante: o "Abrir PDV" do header aponta para /login; o do hero para /pdv.
    const pdvLinks = screen.getAllByRole("link", { name: "Abrir PDV" });
    expect(pdvLinks.some((link) => link.getAttribute("href") === "/pdv")).toBe(true);
    expect(screen.getByText(/Caixa lento/i)).toBeInTheDocument();
    expect(screen.getByText(/Informações espalhadas/i)).toBeInTheDocument();
    expect(screen.getByText("Atalhos de caixa")).toBeInTheDocument();
    expect(screen.getByText("Funcionamento offline")).toBeInTheDocument();
    expect(screen.getAllByText(/Escolha o plano ideal/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Compare os planos/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Perguntas frequentes/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Pronto para organizar sua operação\?/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Nex Gestão Vendas").length).toBeGreaterThan(0);
  });

  it("shows WhatsApp CTA when env is configured", () => {
    process.env[ASSINATURAS_WHATSAPP_ENV] = "https://wa.me/5511999999999";

    render(<PlansSalesPage plans={[samplePlan]} loadError={null} isAuthenticated={false} />);

    expect(screen.getByRole("link", { name: /Chamar no WhatsApp/i })).toHaveAttribute(
      "href",
      expect.stringContaining("https://wa.me/5511999999999")
    );
    expect(
      screen.getByText(/Prefere falar com a gente\?/i)
    ).toBeInTheDocument();
  });

  it("anchors the middle-priced plan as Profissional with Mais popular badge", () => {
    delete process.env[ASSINATURAS_WHATSAPP_ENV];

    render(<PlansSalesPage plans={threeTierPlans} loadError={null} isAuthenticated={false} />);

    // Nomes vêm do banco (Essencial/Profissional/Enterprise) — sem rótulos divergentes.
    expect(
      screen.getAllByRole("heading", { name: "Essencial" }).length
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getAllByRole("heading", { name: "Profissional" }).length
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getAllByRole("heading", { name: "Enterprise" }).length
    ).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("heading", { name: "Crescimento" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Escala" })).not.toBeInTheDocument();
    expect(screen.getByText("Mais popular")).toBeInTheDocument();
    // O benefício aparece no card do plano e na seção "Compare os planos".
    expect(
      screen.getAllByText(/Hotkeys de caixa \(F12 finalizar\)/i).length
    ).toBeGreaterThanOrEqual(2);
  });

  it("shows empty state without crashing", () => {
    render(<PlansSalesPage plans={[]} loadError={null} isAuthenticated={false} />);

    expect(screen.getByText(/Nenhum plano disponível/i)).toBeInTheDocument();
  });

  it("uses store-scoped PDV href for authenticated users", () => {
    render(
      <PlansSalesPage
        plans={[]}
        loadError={null}
        isAuthenticated={true}
        pdvHref="/pdv?store=store-1"
      />
    );

    // O header e o hero expõem "Abrir PDV"; ambos apontam para a loja do usuário.
    const pdvLinks = screen.getAllByRole("link", { name: "Abrir PDV" });
    expect(pdvLinks.length).toBeGreaterThanOrEqual(2);
    expect(pdvLinks.every((link) => link.getAttribute("href") === "/pdv?store=store-1")).toBe(
      true
    );
  });
});
