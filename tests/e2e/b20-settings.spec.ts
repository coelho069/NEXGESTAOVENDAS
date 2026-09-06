import { expect, test } from "@playwright/test";

const STORE_ID = "22222222-2222-4222-8222-222222222201";

test("gerente salva configurações e operador só visualiza", async ({ page }) => {
  await page.goto(`/pdv?role=manager`);
  await page.getByTestId("store-select").selectOption(STORE_ID);
  await expect(page.getByTestId("product-sku-BEV-001")).toBeVisible();

  await page.getByTestId("sidebar-settings").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await expect(page.getByTestId("settings-integrations")).toContainText("not_configured");
  await expect(page.getByTestId("settings-pix-provider")).toContainText(/not_configured/i);
  await expect(page.getByTestId("settings-discount-limits")).toContainText("caixa");

  await page.getByTestId("settings-trade-name").fill("Mercado Centro QA");
  await page.getByTestId("settings-document").fill("12345678000195");
  await page.getByTestId("settings-receipt-footer").fill("Volte sempre");
  await page.getByTestId("settings-auto-print").check();
  await page.getByTestId("settings-require-customer").check();
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings-saved")).toBeVisible();
  await page.getByTestId("settings-close").click();
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);

  await page.goto(`/pdv?role=cashier`);
  await page.getByTestId("store-select").selectOption(STORE_ID);
  await expect(page.getByTestId("product-sku-BEV-001")).toBeVisible();
  await page.getByTestId("sidebar-settings").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await expect(page.getByTestId("settings-readonly")).toBeVisible();
  await expect(page.getByTestId("settings-save")).toBeDisabled();
  await expect(page.getByTestId("settings-trade-name")).toHaveValue("Mercado Centro QA");
});

test("exigir cliente bloqueia pagamento até associação", async ({ page }) => {
  await page.goto(`/pdv?role=manager`);
  await page.getByTestId("store-select").selectOption(STORE_ID);
  await expect(page.getByTestId("product-sku-BEV-001")).toBeVisible();

  await page.getByTestId("sidebar-settings").click();
  await page.getByTestId("settings-require-customer").check();
  await page.getByTestId("settings-require-cash").uncheck();
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings-saved")).toBeVisible();
  await page.getByTestId("settings-close").click();

  await page.getByTestId("product-sku-BEV-001").click();
  await expect(page.getByTestId("cart-line-BEV-001")).toBeVisible();
  await page.getByTestId("open-payment").click();
  await expect(page.getByTestId("store-context-message")).toContainText(/cliente/i);
  await expect(page.getByTestId("pdv-payment-sheet")).toHaveCount(0);

  await page.getByTestId("open-customer").click();
  await page.getByTestId("customer-55555555-5555-4555-8555-555555555502").click();
  await expect(page.getByTestId("open-customer")).toContainText("Maria Silva");
  await page.getByTestId("open-payment").click();
  await expect(page.getByTestId("pdv-payment-sheet")).toBeVisible();
});
