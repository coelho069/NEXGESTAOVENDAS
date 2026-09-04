import { expect, test } from "@playwright/test";

const STORE_ID = "22222222-2222-4222-8222-222222222201";

async function selectStore(page: import("@playwright/test").Page) {
  await page.goto("/pdv");
  await page.getByTestId("store-select").selectOption(STORE_ID);
  await expect(page.getByTestId("product-sku-BEV-001")).toBeVisible();
}

async function addSku(page: import("@playwright/test").Page, sku: string) {
  await page.getByTestId("pdv-search-input").fill(sku);
  await page.getByTestId("pdv-search-input").press("Enter");
  await expect(page.getByTestId(`cart-line-${sku}`)).toBeVisible();
}

test("suspende, recupera após reload e conclui o checkout", async ({ page }) => {
  await selectStore(page);
  await addSku(page, "BEV-001");
  await page.getByTestId("suspend-sale").click();
  await expect(page.getByTestId("store-context-message")).toContainText("suspensa");
  await expect(page.getByTestId("cart-empty")).toBeVisible();

  await page.reload();
  await page.getByTestId("store-select").selectOption(STORE_ID);
  await page.getByTestId("open-suspended-sales").click();
  await expect(page.getByTestId("suspended-sales-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "Recuperar venda" })).toBeVisible();
  await page.getByRole("button", { name: "Recuperar venda" }).click();

  await expect(page.getByTestId("cart-line-BEV-001")).toBeVisible();
  await expect(page.getByTestId("store-context-message")).toContainText("recuperada");
  await page.getByTestId("open-payment").click();
  await page.getByTestId("pdv-payment-sheet").getByTestId("checkout-cash").click();
  await expect(page.getByTestId("receipt")).toBeVisible();
});

test("não sobrescreve carrinho sem confirmação ao recuperar", async ({ page }) => {
  await selectStore(page);
  await addSku(page, "BEV-001");
  await page.getByTestId("suspend-sale").click();
  await addSku(page, "BEV-002");
  await page.getByTestId("open-suspended-sales").click();
  await page.getByRole("button", { name: "Recuperar venda" }).click();
  await expect(page.getByTestId("confirm-recover-suspended-sale")).toBeVisible();
  await expect(page.getByTestId("cart-line-BEV-002")).toBeVisible();
  await page.getByTestId("confirm-recover-suspended-sale").click();
  await expect(page.getByTestId("cart-line-BEV-001")).toBeVisible();
  await expect(page.getByTestId("cart-line-BEV-002")).toHaveCount(0);
});

test("bloqueia suspensão offline e preserva o carrinho", async ({ page, context }) => {
  await selectStore(page);
  await addSku(page, "BEV-001");
  await context.setOffline(true);
  await expect(page.getByTestId("suspend-sale")).toBeDisabled();
  await expect(page.getByTestId("suspend-offline-message")).toContainText("exige conexão");
  await expect(page.getByTestId("cart-line-BEV-001")).toBeVisible();
});
