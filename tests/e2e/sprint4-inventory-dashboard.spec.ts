import { test, expect } from "@playwright/test";

test("inventário lista produtos e relata erros de CSV", async ({ page }) => {
  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventário" })).toBeVisible();
  await expect(page.getByTestId("inventory-table")).toBeVisible();
  await expect(page.getByTestId("inventory-table")).toContainText("BEV-001");
  await expect(page.getByTestId("inventory-readonly")).toBeVisible();

  await page.getByTestId("inventory-role").selectOption("manager");
  await expect(page.getByTestId("inventory-adjust")).toBeVisible();
  await page.getByTestId("inventory-csv").fill("sku,delta,reason,movement_type\nBEV-001,0,compra,restock\n");
  await page.getByTestId("inventory-csv-submit").click();
  await expect(page.getByTestId("inventory-csv-errors")).toContainText("Delta");
});

test("dashboard degradado bloqueia caixa e mostra métricas para gerente", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByTestId("dashboard-degraded")).toBeVisible();
  await expect(page.getByTestId("permission-denied")).toBeVisible();
  await expect(page.getByTestId("dashboard-store")).toBeVisible();
  await expect(page.getByTestId("dashboard-from")).toBeVisible();

  await page.getByTestId("dashboard-role").selectOption("manager");
  await expect(page.getByTestId("dashboard-metrics")).toBeVisible();
  await expect(page.getByTestId("permission-denied")).toHaveCount(0);
});
