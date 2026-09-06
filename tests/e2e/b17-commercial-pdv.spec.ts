import { expect, test, type Page } from "@playwright/test";

const STORE_ID = "22222222-2222-4222-8222-222222222201";

function visible(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true });
}

async function selectStore(page: Page) {
  await page.getByTestId("store-select").selectOption(STORE_ID);
  await expect(page.getByTestId("product-sku-BEV-001")).toBeVisible();
}

async function addSku(page: Page, sku: string) {
  await page.getByTestId("pdv-search-input").fill(sku);
  await page.getByTestId("pdv-search-input").press("Enter");
  await expect(page.getByTestId(`cart-line-${sku}`)).toBeVisible();
}

test("troco em dinheiro, impressão e consulta local de vendas", async ({ page }) => {
  await page.goto("/pdv");
  await selectStore(page);
  await addSku(page, "BEV-001");

  await page.getByTestId("open-payment").click();
  await expect(page.getByTestId("pdv-payment-sheet")).toBeVisible();
  await expect(page.getByTestId("cash-change-due")).toContainText("Troco");
  await page.getByTestId("cash-received-input").fill("10.00");
  await expect(page.getByTestId("cash-change-due")).toContainText("R$");
  await expect(page.getByTestId("checkout-pix")).toContainText("não configurado");

  await visible(page, "checkout-cash").click();
  await expect(page.getByTestId("receipt")).toBeVisible();
  await expect(page.getByTestId("receipt-print")).toBeVisible();
  await expect(page.getByTestId("receipt-change-label")).toBeVisible();
  await page.getByTestId("receipt-close").click();
  await expect(page.getByTestId("receipt")).toHaveCount(0);

  await page.getByTestId("open-sales-history").click();
  await expect(page.getByTestId("sales-history-panel")).toBeVisible();
  await expect(page.locator("[data-testid^=sales-history-row-]").first()).toBeVisible();
});

test("pix e cartão permanecem não configurados sem fechar venda", async ({ page }) => {
  await page.goto("/pdv");
  await selectStore(page);
  await addSku(page, "BEV-001");
  await page.getByTestId("open-payment").click();
  await visible(page, "checkout-pix").click();
  await expect(page.getByTestId("sale-draft-banner")).toBeVisible();
  await expect(page.getByTestId("cart-line-BEV-001")).toBeVisible();
});

test("busca de cliente filtra a lista", async ({ page }) => {
  await page.goto("/pdv");
  await selectStore(page);
  await page.getByTestId("open-customer").click();
  await page.getByTestId("customer-search").fill("Maria");
  await expect(page.getByTestId("customer-55555555-5555-4555-8555-555555555502")).toBeVisible();
  await expect(page.getByTestId("customer-55555555-5555-4555-8555-555555555501")).toHaveCount(0);
});
