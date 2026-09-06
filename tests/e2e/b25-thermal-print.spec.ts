import { expect, test, type Page } from "@playwright/test";

const STORE_ID = "22222222-2222-4222-8222-222222222201";

function visible(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true });
}

async function selectStore(page: Page) {
  await page.getByTestId("store-select").selectOption(STORE_ID);
  await expect(page.getByTestId("product-sku-BEV-001")).toBeVisible();
}

async function stubBrowserPrint(page: Page) {
  await page.addInitScript(() => {
    // Prevent native print dialog from blocking Playwright.
    window.print = () => undefined;
  });
  page.on("frameattached", (frame) => {
    void frame
      .evaluate(() => {
        window.print = () => undefined;
      })
      .catch(() => undefined);
  });
}

async function checkoutCash(page: Page) {
  await page.getByTestId("product-sku-BEV-001").click();
  await expect(page.getByTestId("cart-line-BEV-001")).toBeVisible();
  await page.getByTestId("open-payment").click();
  await expect(page.getByTestId("pdv-payment-sheet")).toBeVisible();
  await page.getByTestId("cash-received-input").fill("20.00");
  await visible(page, "checkout-cash").click();
  await expect(page.getByTestId("receipt")).toBeVisible();
}

test("configura impressão térmica e auto-print sem fingir hardware", async ({ page }) => {
  await stubBrowserPrint(page);
  await page.goto(`/pdv?role=manager`);
  await selectStore(page);

  await page.getByTestId("sidebar-settings").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await expect(page.getByTestId("settings-printer-status")).toBeVisible();
  await expect(page.getByTestId("settings-printer-status")).toContainText(/status/i);

  await page.getByTestId("settings-print-mode").selectOption("browser");
  await page.getByTestId("settings-paper-width").selectOption("58");
  await page.getByTestId("settings-auto-print").check();
  await page.getByTestId("settings-require-customer").uncheck();
  await page.getByTestId("settings-require-cash").uncheck();
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings-saved")).toBeVisible();
  await page.getByTestId("settings-close").click();

  // Cashier can view printer config but not edit
  await page.goto(`/pdv?role=cashier`);
  await selectStore(page);
  await page.getByTestId("sidebar-settings").click();
  await expect(page.getByTestId("settings-readonly")).toBeVisible();
  await expect(page.getByTestId("settings-print-mode")).toHaveValue("browser");
  await expect(page.getByTestId("settings-paper-width")).toHaveValue("58");
  await expect(page.getByTestId("settings-save")).toBeDisabled();
  await page.getByTestId("settings-close").click();

  await checkoutCash(page);
  await expect(page.getByTestId("receipt-paper-width")).toContainText("58mm");
  await expect(page.getByTestId("receipt-print")).toBeVisible();
  await expect(page.getByTestId("receipt-print-status")).toBeVisible();
  await expect(page.getByTestId("receipt-commercial-disclaimer")).toBeVisible();
  await expect(page.getByTestId("receipt-fiscal-qr")).toContainText(/indisponível|indisponivel/i);
});

test("modo escpos permanece not_configured sem bridge", async ({ page }) => {
  await stubBrowserPrint(page);
  await page.goto(`/pdv?role=manager`);
  await selectStore(page);
  await page.getByTestId("sidebar-settings").click();
  await page.getByTestId("settings-print-mode").selectOption("escpos");
  await page.getByTestId("settings-require-customer").uncheck();
  await page.getByTestId("settings-require-cash").uncheck();
  await page.getByTestId("settings-auto-print").uncheck();
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings-saved")).toBeVisible();
  await expect(page.getByTestId("settings-printer-status")).toContainText(/not_configured|não/i);
  await page.getByTestId("settings-close").click();

  await checkoutCash(page);
  await page.getByTestId("receipt-print").click();
  await expect(page.getByTestId("receipt-print-status")).toContainText(
    /não configurada|not_configured|escpos/i
  );
  await expect(page.getByTestId("receipt-print-failure")).toBeVisible();
  await expect(page.getByTestId("receipt-print-retry")).toBeVisible();
  await expect(page.getByTestId("receipt-sync-status")).toBeVisible();
});
