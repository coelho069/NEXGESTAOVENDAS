import { test, expect } from "@playwright/test";

test("home page renders marketing landing", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /Controle suas vendas, estoque e resultados em um só lugar/i,
    })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Entrar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Começar agora" }).first()).toBeVisible();
});

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Entrar no PDV" })).toBeVisible();
});
