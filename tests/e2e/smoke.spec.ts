import { test, expect } from "@playwright/test";

// A raiz `/` serve a landing de conversão.
test("home renders the NexGestão landing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("PDV profissional");
  await expect(page.getByRole("link", { name: "Entrar na Conta" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Começar agora" })).toBeVisible();
});

test("plans page renders at /planos", async ({ page }) => {
  await page.goto("/planos");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Venda mais. Controle seu estoque"
  );
  await expect(
    page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Entrar" })
  ).toBeVisible();
});

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Entrar no PDV" })).toBeVisible();
});
