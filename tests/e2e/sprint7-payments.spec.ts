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

test("adapter card não configurado mantém o carrinho como rascunho", async ({ page }) => {
  await openCart(page);
  await page.getByTestId("checkout-credit-card").click();
  await expect(page.getByTestId("sale-draft-banner")).toContainText(/não configurado/i);
  await expect(page.getByTestId("cart-line-BEV-001")).toBeVisible();
  await expect(page.getByTestId("receipt")).toHaveCount(0);
});

test("crédito, débito e TEF não configurados mantêm rascunho sem outbox", async ({ page }) => {
  await openCart(page);
  for (const testId of ["checkout-credit-card", "checkout-debit-card", "checkout-tef"] as const) {
    await expect(page.getByTestId(testId)).toContainText(/não configurado/i);
    await page.getByTestId(testId).click();
    await expect(page.getByTestId("sale-draft-banner")).toContainText(/não configurado|crédito|débito|TEF|Cartão/i);
    await expect(page.getByTestId("cart-line-BEV-001")).toBeVisible();
    await expect(page.getByTestId("receipt")).toHaveCount(0);
    await page.getByTestId("open-payment").click();
  }

  const counts = await page.evaluate(
    () =>
      new Promise<{ sales: number; payments: number; outbox: number }>((resolve, reject) => {
        const request = indexedDB.open("pdv_local_v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const names = ["sales", "payments", "outbox"] as const;
          const transaction = db.transaction([...names], "readonly");
          const result = { sales: 0, payments: 0, outbox: 0 };
          let completed = 0;
          const finish = () => {
            completed += 1;
            if (completed === names.length) {
              db.close();
              resolve(result);
            }
          };
          for (const name of names) {
            const req = transaction.objectStore(name).count();
            req.onsuccess = () => {
              result[name] = req.result;
              finish();
            };
          }
        };
      })
  );
  expect(counts).toEqual({ sales: 0, payments: 0, outbox: 0 });
});

test("PIX não configurado mantém rascunho e não grava outbox pago", async ({ page }) => {
  await openCart(page);
  await expect(page.getByTestId("checkout-pix")).toContainText(/não configurado/i);
  await page.getByTestId("checkout-pix").click();
  await expect(page.getByTestId("sale-draft-banner")).toContainText(/não configurado|PIX/i);
  await expect(page.getByTestId("cart-line-BEV-001")).toBeVisible();
  await expect(page.getByTestId("receipt")).toHaveCount(0);

  const counts = await page.evaluate(
    () =>
      new Promise<{ sales: number; payments: number; outbox: number }>((resolve, reject) => {
        const request = indexedDB.open("pdv_local_v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const names = ["sales", "payments", "outbox"] as const;
          const transaction = db.transaction([...names], "readonly");
          const result = { sales: 0, payments: 0, outbox: 0 };
          let completed = 0;
          const finish = () => {
            completed += 1;
            if (completed === names.length) {
              db.close();
              resolve(result);
            }
          };
          for (const name of names) {
            const req = transaction.objectStore(name).count();
            req.onsuccess = () => {
              result[name] = req.result;
              finish();
            };
          }
        };
      })
  );
  expect(counts).toEqual({ sales: 0, payments: 0, outbox: 0 });
});

test("PIX offline fica indisponível e não finaliza venda", async ({ page, context }) => {
  await openCart(page);
  await context.setOffline(true);
  await expect(page.getByTestId("checkout-pix")).toContainText(/indisponível offline/i);
  await page.getByTestId("checkout-pix").click();
  await expect(page.getByTestId("sale-draft-banner")).toContainText(/offline|PIX|indisponível/i);
  await expect(page.getByTestId("receipt")).toHaveCount(0);
  await expect(page.getByTestId("cart-line-BEV-001")).toBeVisible();
  await context.setOffline(false);
});

test("crédito, débito e TEF offline ficam indisponíveis e não finalizam", async ({ page, context }) => {
  await openCart(page);
  await context.setOffline(true);
  for (const testId of ["checkout-credit-card", "checkout-debit-card", "checkout-tef"] as const) {
    await expect(page.getByTestId(testId)).toContainText(/indisponível offline/i);
    await page.getByTestId(testId).click();
    await expect(page.getByTestId("sale-draft-banner")).toContainText(/offline|indisponível|crédito|débito|TEF|Cartão/i);
    await expect(page.getByTestId("receipt")).toHaveCount(0);
    await expect(page.getByTestId("cart-line-BEV-001")).toBeVisible();
    await page.getByTestId("open-payment").click();
  }
  await context.setOffline(false);
});
