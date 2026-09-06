import { expect, test } from "@playwright/test";

const STORE_ID = "22222222-2222-4222-8222-222222222201";

async function openCashCheckout(page: import("@playwright/test").Page) {
  await page.goto("/pdv");
  await page.getByTestId("store-select").selectOption(STORE_ID);
  await expect(page.getByTestId("product-sku-BEV-001")).toBeVisible();
  await page.getByTestId("pdv-search-input").fill("BEV-001");
  await page.getByTestId("pdv-search-input").press("Enter");
  await expect(page.getByTestId("cart-line-BEV-001")).toBeVisible();
  await page.getByTestId("open-payment").click();
  await page.getByTestId("checkout-cash").click();
  await expect(page.getByTestId("receipt")).toBeVisible();
}

test("B: venda sem emissão confirmada não apresenta fiscal como emitido", async ({ page }) => {
  await openCashCheckout(page);

  const fiscalStatus = page.getByTestId("receipt-fiscal-status");
  await expect(fiscalStatus).toBeVisible();
  await expect(fiscalStatus).not.toContainText("emitido");
  await expect(fiscalStatus).toContainText(/pendente|não configurado|desconhecido/);
  await expect(page.getByTestId("receipt-commercial-disclaimer")).toContainText(
    /comprovante comercial|não constitui/i
  );
  await expect(page.getByTestId("receipt-fiscal-qr")).toContainText(/indisponível/i);
});

test("F: rota de emissão fiscal rejeita usuário não autenticado", async ({ request }) => {
  const response = await request.post("/api/fiscal/issue", {
    data: {
      store_id: STORE_ID,
      sale_id: "22222222-2222-4222-8222-222222222299",
    },
  });

  expect([401, 503]).toContain(response.status());
  await expect(response.json()).resolves.toEqual(
    response.status() === 401
      ? { error: "Unauthorized" }
      : { error: "auth_not_configured" }
  );
});

test("worker fiscal sem segredo configurado não executa integração", async ({ request }) => {
  const response = await request.post("/api/fiscal/outbox/process", {
    data: { limit: 1 },
  });

  expect([401, 503]).toContain(response.status());
  await expect(response.json()).resolves.toEqual(
    response.status() === 401
      ? { error: "Unauthorized" }
      : { error: "fiscal_worker_not_configured" }
  );
});
