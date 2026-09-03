import { test, expect, type Page } from "@playwright/test";

function visible(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true });
}

async function selectStore(page: Page) {
  await page.getByTestId("store-select").selectOption("22222222-2222-4222-8222-222222222201");
  await expect(page.getByTestId("product-sku-BEV-001")).toBeVisible();
  await expect(page.getByTestId("projected-stock-BEV-001").first()).toContainText("Estoque projetado");
}

async function addSku(page: Page, sku: string) {
  await page.getByTestId("pdv-search-input").fill(sku);
  await page.getByTestId("pdv-search-input").press("Enter");
  await expect(page.getByTestId(`cart-line-${sku}`)).toBeVisible();
}

async function payCash(page: Page) {
  const openPayment = page.getByTestId("open-payment");
  if (await openPayment.isVisible()) {
    await openPayment.click();
  }
  await visible(page, "checkout-cash").click();
}

test("SKU -> quantidade -> desconto -> pagamento -> recibo", async ({ page }) => {
  await page.goto("/pdv");
  await selectStore(page);
  await addSku(page, "BEV-001");
  await page.getByTestId("cart-inc-BEV-001").click();
  await expect(page.getByTestId("cart-qty-BEV-001")).toHaveValue("2");

  await page.getByTestId("open-customer").click();
  await page.getByTestId("customer-55555555-5555-4555-8555-555555555502").click();

  await page.keyboard.press("F6");
  await page.getByTestId("discount-input").fill("0.30");
  await page.getByTestId("discount-apply").click();

  await payCash(page);

  await expect(page.getByTestId("receipt")).toBeVisible();
  await expect(page.getByTestId("receipt-sync-status")).toContainText(/Sincronização:/);
  await expect(page.getByTestId("receipt-sync-status")).toContainText(/pending|synced|pending_sync/);
});

test("pagamento falho permanece rascunho local", async ({ page }) => {
  await page.goto("/pdv");
  await selectStore(page);
  await addSku(page, "BEV-001");
  const openPayment = page.getByTestId("open-payment");
  if (await openPayment.isVisible()) {
    await openPayment.click();
  }
  await visible(page, "checkout-card").click();
  await expect(page.getByTestId("sale-draft-banner")).toBeVisible();
  await expect(page.getByTestId("cart-line-BEV-001")).toBeVisible();
  await expect(page.getByTestId("receipt")).toHaveCount(0);
});

test("checkout offline gera recibo com status de sincronização", async ({ page, context }) => {
  await page.goto("/pdv");
  await selectStore(page);
  await addSku(page, "BEV-002");
  await context.setOffline(true);
  await payCash(page);
  await expect(page.getByTestId("receipt")).toBeVisible();
  await expect(page.getByTestId("receipt-sync-status")).toContainText("pending");
});

test("scanner HID adiciona item sem limpar o carrinho", async ({ page }) => {
  await page.goto("/pdv");
  await selectStore(page);
  await page.getByTestId("product-sku-BEV-002").click();
  await expect(page.getByTestId("cart-line-BEV-002")).toBeVisible();

  await page.locator("body").click();
  await page.keyboard.type("7891000100011", { delay: 12 });
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("cart-line-BEV-001")).toBeVisible();
  await expect(page.getByTestId("cart-line-BEV-002")).toBeVisible();
});

test("tablet abre pagamento em sheet", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/pdv");
  await selectStore(page);
  await addSku(page, "PAD-001");
  await page.getByTestId("open-payment").click();
  await expect(page.getByTestId("pdv-payment-sheet")).toBeVisible();
  await page.getByTestId("pdv-payment-sheet").getByTestId("checkout-cash").click();
  await expect(page.getByTestId("receipt")).toBeVisible();
});