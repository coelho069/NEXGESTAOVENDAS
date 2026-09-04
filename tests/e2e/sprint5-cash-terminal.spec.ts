import { expect, test } from "@playwright/test";

const STORE_ID = "22222222-2222-4222-8222-222222222201";

test("caixa fixture registra movimentação, fecha com conferência e pode abrir nova sessão", async ({ page }) => {
  await page.goto("/pdv");
  await page.getByTestId("store-select").selectOption(STORE_ID);

  await expect(page.getByTestId("cash-status")).toHaveText("ABERTO");
  await expect(page.getByTestId("cash-expected")).toContainText("R$ 0,00");

  await page.getByTestId("cash-movement-amount").fill("10.00");
  await page.getByTestId("cash-movement-reason").fill("Suprimento E2E");
  await page.getByTestId("cash-record-movement").click();
  await expect(page.getByTestId("cash-expected")).toContainText("R$ 10,00");

  await page.getByTestId("cash-counted-amount").fill("10.00");
  await page.getByTestId("cash-close").click();
  await expect(page.getByTestId("cash-status")).toHaveText("FECHADO");
  await expect(page.getByTestId("cash-difference")).toContainText("R$ 0,00");

  await page.getByTestId("cash-opening-amount").fill("20.00");
  await page.getByTestId("cash-open").click();
  await expect(page.getByTestId("cash-status")).toHaveText("ABERTO");
  await expect(page.getByTestId("cash-expected")).toContainText("R$ 20,00");
});
