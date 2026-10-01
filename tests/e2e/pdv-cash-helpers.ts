import { expect, type Page } from "@playwright/test";

function visible(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true });
}

/** Opens payment sheet, selects Dinheiro, skips change — completes cash checkout. */
export async function payCashNoChange(page: Page) {
  // Se o sheet já está aberto (ex.: teste de tablet), o overlay interceptaria
  // o clique em open-payment. Só abrimos quando o sheet ainda não existe.
  const sheetAlreadyOpen = await page
    .getByTestId("pdv-payment-sheet")
    .isVisible()
    .catch(() => false);
  if (!sheetAlreadyOpen) {
    const openPayment = page.getByTestId("open-payment");
    if (await openPayment.isVisible()) {
      await openPayment.click();
    }
  }
  await expect(page.getByTestId("pdv-payment-sheet")).toBeVisible();
  await visible(page, "checkout-cash").click();
  await visible(page, "cash-change-no").click();
}

/** Opens payment sheet, selects Dinheiro with change from received amount. */
export async function payCashWithChange(page: Page, received: string) {
  await page.getByTestId("open-payment").click();
  await expect(page.getByTestId("pdv-payment-sheet")).toBeVisible();
  await visible(page, "checkout-cash").click();
  await visible(page, "cash-change-yes").click();
  await page.getByTestId("cash-received-input").fill(received);
  await expect(page.getByTestId("cash-change-amount")).toContainText("Troco");
  await visible(page, "cash-change-confirm").click();
}
