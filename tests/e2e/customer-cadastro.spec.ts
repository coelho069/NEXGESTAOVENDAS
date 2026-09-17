import { test, expect, type Page } from "@playwright/test";

async function selectStore(page: Page) {
  await page.getByTestId("store-select").selectOption("22222222-2222-4222-8222-222222222201");
}

test("criar cliente no dialog associa na venda e walk-in permanece", async ({ page }) => {
  await page.goto("/pdv");
  await selectStore(page);
  await page.getByTestId("open-customer").click();
  await expect(page.getByTestId("customer-dialog")).toBeVisible();
  await expect(page.getByTestId("customer-walk-in")).toBeVisible();

  await page.getByTestId("customer-search").fill("Maria");
  await expect(page.getByText("Maria Silva")).toBeVisible();
  await expect(page.getByText("Cliente Consumidor")).toHaveCount(0);

  await page.getByTestId("customer-new").click();
  await page.getByTestId("customer-name").fill("Ana Nova");
  await page.getByTestId("customer-document").fill("DOC-ANA");
  await page.getByTestId("customer-save").click();

  await expect(page.getByTestId("customer-dialog")).toHaveCount(0);
  await expect(page.getByTestId("open-customer")).toContainText("Ana Nova");

  await page.getByTestId("open-customer").click();
  await expect(page.getByTestId("customer-walk-in")).toBeVisible();
  await page.getByTestId("customer-walk-in").click();
  await expect(page.getByTestId("open-customer")).toContainText("Não informado");
});

test("rota /clientes lista, cria e edita", async ({ page }) => {
  await page.goto("/clientes");
  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Clientes" })).toBeVisible();
  await expect(page.getByTestId("customers-table")).toContainText("Maria Silva");

  await page.getByTestId("customers-new").click();
  await page.getByTestId("customer-name").fill("Bruno Cliente");
  await page.getByTestId("customer-email").fill("bruno@example.invalid");
  await page.getByTestId("customer-save").click();

  await expect(page.getByTestId("customers-message")).toContainText("Bruno Cliente");
  await expect(page.getByTestId("customers-table")).toContainText("Bruno Cliente");
  await expect(page.getByTestId("customers-table")).toContainText("bruno@example.invalid");

  await page.getByTestId("customers-search").fill("Bruno");
  await page.getByRole("button", { name: "Editar" }).click();
  await page.getByTestId("customer-name").fill("Bruno Cliente Editado");
  await page.getByTestId("customer-save").click();
  await expect(page.getByTestId("customers-table")).toContainText("Bruno Cliente Editado");
});
