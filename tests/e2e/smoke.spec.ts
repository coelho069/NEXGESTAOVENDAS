import { test, expect } from "@playwright/test";

test("home page renders sprint banner", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Nex Gestão Vendas" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Entrar" })).toBeVisible();
});

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Entrar no PDV" })).toBeVisible();
});
