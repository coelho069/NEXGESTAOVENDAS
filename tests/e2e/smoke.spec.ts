import { test, expect } from "@playwright/test";

// A raiz `/` serve a landing de conversão (kit deploy/portable/landing).
// A página de planos/assinaturas passou para `/planos`.
test("home renders the NexGestão landing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("O CRM definitivo");
  await expect(page.getByRole("link", { name: "Entrar na Conta" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Testar Gratuitamente por 14 Dias" })
  ).toBeVisible();
});

test("plans page renders at /planos", async ({ page }) => {
  await page.goto("/planos");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Venda mais. Controle seu estoque"
  );
  await expect(page.getByRole("link", { name: "Entrar" })).toBeVisible();
});

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Entrar no PDV" })).toBeVisible();
});
