import { expect, test } from "@playwright/test";

const STORE_ID = "22222222-2222-4222-8222-222222222201";

test("cadastro, busca, edição, visualização e associação de cliente", async ({ page }) => {
  await page.goto("/pdv");
  await page.getByTestId("store-select").selectOption(STORE_ID);
  await expect(page.getByTestId("product-sku-BEV-001")).toBeVisible();

  await page.getByTestId("open-customer").click();
  await expect(page.getByTestId("customer-dialog")).toBeVisible();

  await page.getByTestId("customer-search").fill("Maria");
  await expect(page.getByTestId("customer-55555555-5555-4555-8555-555555555502")).toBeVisible();
  await expect(page.getByTestId("customer-55555555-5555-4555-8555-555555555501")).toHaveCount(0);

  await page.getByTestId("customer-new").click();
  await expect(page.getByTestId("customer-form")).toBeVisible();
  await page.getByTestId("customer-form-name").fill("Carlos Oliveira");
  await page.getByTestId("customer-form-document").fill("39053344705");
  await page.getByTestId("customer-form-save").click();
  await expect(page.getByTestId("customer-form-error")).toContainText(/documento/i);

  await page.getByTestId("customer-form-document").fill("11144477735");
  await page.getByTestId("customer-form-phone").fill("11977776666");
  await page.getByTestId("customer-form-email").fill("carlos@example.invalid");
  await page.getByTestId("customer-form-save").click();

  await expect(page.getByTestId("customer-dialog")).toHaveCount(0);
  await expect(page.getByTestId("open-customer")).toContainText("Carlos Oliveira");

  await page.getByTestId("open-customer").click();
  await expect(page.getByTestId("customer-dialog")).toBeVisible();
  await page.getByTestId("customer-search").fill("Carlos");
  const created = page
    .locator('button[data-testid^="customer-"]')
    .filter({ hasText: "Carlos Oliveira" })
    .first();
  await expect(created).toBeVisible();
  const createdTestId = await created.getAttribute("data-testid");
  expect(createdTestId).toMatch(/^customer-[0-9a-f-]{36}$/i);
  const createdId = createdTestId!.replace("customer-", "");

  await page.getByTestId(`customer-view-${createdId}`).click();
  await expect(page.getByTestId("customer-detail")).toBeVisible();
  await expect(page.getByTestId("customer-detail")).toContainText("Carlos Oliveira");
  await expect(page.getByTestId("customer-detail")).toContainText("Histórico de vendas");
  await page.getByText("← Voltar").click();

  await page.getByTestId(`customer-edit-${createdId}`).click();
  await page.getByTestId("customer-form-name").fill("Carlos Oliveira Editado");
  await page.getByTestId("customer-form-save").click();
  await expect(page.getByTestId("open-customer")).toContainText("Carlos Oliveira Editado");
});

test("associação de cliente não altera total da venda", async ({ page }) => {
  await page.goto("/pdv");
  await page.getByTestId("store-select").selectOption(STORE_ID);
  await expect(page.getByTestId("product-sku-BEV-001")).toBeVisible();
  await page.getByTestId("product-sku-BEV-001").click();
  await expect(page.getByTestId("cart-line-BEV-001")).toBeVisible();
  const totalBefore = await page.getByTestId("sale-total").innerText();

  await page.getByTestId("open-customer").click();
  await expect(page.getByTestId("customer-dialog")).toBeVisible();
  await page.getByTestId("customer-55555555-5555-4555-8555-555555555502").click();
  await expect(page.getByTestId("open-customer")).toContainText("Maria Silva");
  await expect(page.getByTestId("sale-total")).toHaveText(totalBefore);
});
