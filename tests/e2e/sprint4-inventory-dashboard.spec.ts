import { test, expect } from "@playwright/test";

test("inventário lista produtos e mantém caixa em modo somente leitura", async ({ page }) => {
  await page.goto("/inventory?store=22222222-2222-4222-8222-222222222201");
  await expect(page.getByRole("heading", { name: "Inventário" })).toBeVisible();
  await expect(page.getByTestId("inventory-table")).toBeVisible();
  await expect(page.getByTestId("inventory-table")).toContainText("BEV-001");
  await expect(page.getByTestId("inventory-readonly")).toBeVisible();

  await expect(page.getByTestId("inventory-role")).toContainText("Caixa");
  await expect(page.getByTestId("inventory-adjust")).toHaveCount(0);
  await expect(page.getByTestId("inventory-csv")).toHaveCount(0);
});

test("dashboard degradado bloqueia caixa e mantém o papel server-side", async ({ page }) => {
  await page.goto("/dashboard?store=22222222-2222-4222-8222-222222222201");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByTestId("dashboard-degraded")).toBeVisible();
  await expect(page.getByTestId("permission-denied")).toBeVisible();
  await expect(page.getByTestId("dashboard-store")).toBeVisible();
  await expect(page.getByTestId("dashboard-from")).toBeVisible();

  await expect(page.getByTestId("dashboard-role")).toContainText("Caixa");
  await expect(page.getByTestId("dashboard-metrics")).toHaveCount(0);
});
