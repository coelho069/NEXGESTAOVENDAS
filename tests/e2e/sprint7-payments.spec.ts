import { expect, test } from "@playwright/test";

const STORE_ID = "22222222-2222-4222-8222-222222222201";

async function openCart(page: import("@playwright/test").Page) {
  await page.goto("/pdv");
  await page.getByTestId("store-select").selectOption(STORE_ID);
  await expect(page.getByTestId("product-sku-BEV-001")).toBeVisible();
  await page.getByTestId("pdv-search-input").fill("BEV-001");
  await page.getByTestId("pdv-search-input").press("Enter");
  await expect(page.getByTestId("cart-line-BEV-001")).toBeVisible();
  await page.getByTestId("open-payment").click();
}

test("pagamento cash finaliza uma vez mesmo com retry de clique", async ({ page }) => {
  await openCart(page);
  const cash = page.getByTestId("checkout-cash");

  await Promise.allSettled([cash.click(), cash.click()]);
  await expect(page.getByTestId("receipt")).toHaveCount(1);
  await expect(page.getByTestId("receipt-sync-status")).toContainText(/pending|synced/);

  const counts = await page.evaluate(
    () =>
      new Promise<{ sales: number; payments: number }>((resolve, reject) => {
        const request = indexedDB.open("pdv_local_v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(["sales", "payments"], "readonly");
          let sales = 0;
          let payments = 0;
          let completed = 0;
          const finish = () => {
            completed += 1;
            if (completed === 2) {
              db.close();
              resolve({ sales, payments });
            }
          };
          const salesRequest = transaction.objectStore("sales").count();
          salesRequest.onsuccess = () => {
            sales = salesRequest.result;
            finish();
          };
          const paymentsRequest = transaction.objectStore("payments").count();
          paymentsRequest.onsuccess = () => {
            payments = paymentsRequest.result;
            finish();
          };
        };
      })
  );

  expect(counts).toEqual({ sales: 1, payments: 1 });
});

test("adapter card/PIX não configurado mantém o carrinho como rascunho", async ({ page }) => {
  await openCart(page);
  const card = page.getByTestId("checkout-card");
  const pix = page.getByTestId("checkout-pix");
  await expect(card).toBeDisabled();
  await expect(card).toContainText("não configurado");
  await expect(pix).toBeDisabled();
  await expect(pix).toContainText("não configurado");
  await expect(page.getByTestId("checkout-cash")).toBeEnabled();
  await expect(page.getByTestId("cart-line-BEV-001")).toBeVisible();
  await expect(page.getByTestId("receipt")).toHaveCount(0);
});
