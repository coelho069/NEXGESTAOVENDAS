import { expect, test, type Page } from "@playwright/test";

const STORE_ID = "22222222-2222-4222-8222-222222222201";

function visible(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true });
}

async function selectStore(page: Page) {
  await page.getByTestId("store-select").selectOption(STORE_ID);
  await expect(page.getByTestId("product-sku-BEV-001")).toBeVisible();
}

async function addSku(page: Page, sku: string, times = 1) {
  for (let i = 0; i < times; i += 1) {
    await page.getByTestId("pdv-search-input").fill(sku);
    await page.getByTestId("pdv-search-input").press("Enter");
  }
  await expect(page.getByTestId(`cart-line-${sku}`)).toBeVisible();
}

async function payCashExact(page: Page) {
  await page.getByTestId("open-payment").click();
  await expect(page.getByTestId("pdv-payment-sheet")).toBeVisible();
  await visible(page, "checkout-cash").click();
  await expect(page.getByTestId("receipt")).toBeVisible();
}

async function payCashWithTender(page: Page, received: string) {
  await page.getByTestId("open-payment").click();
  await expect(page.getByTestId("pdv-payment-sheet")).toBeVisible();
  await page.getByTestId("cash-received-input").fill(received);
  await expect(page.getByTestId("cash-change-due")).toContainText("Troco");
  await visible(page, "checkout-cash").click();
  await expect(page.getByTestId("receipt")).toBeVisible();
}

async function openLatestSaleDetail(page: Page) {
  const receipt = page.getByTestId("receipt");
  if (await receipt.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(receipt).toHaveCount(0);
  }
  await page.getByTestId("open-sales-history").click();
  await expect(page.getByTestId("sales-history-panel")).toBeVisible();
  const row = page.locator("[data-testid^=sales-history-row-]").first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByTestId("sales-history-detail")).toBeVisible();
}

test("B18 cancelamento total atualiza histórico e bloqueia nova ação", async ({ page }) => {
  await page.goto("/pdv?role=manager");
  await selectStore(page);

  const stockBefore = await page.getByTestId("projected-stock-BEV-001").first().innerText();
  await addSku(page, "BEV-001");
  await payCashExact(page);
  await expect(page.getByTestId("receipt-sync-status")).toBeVisible();

  await openLatestSaleDetail(page);
  await expect(page.getByTestId("sales-history-detail")).toContainText(/Confirmada|Pendente/);
  await page.getByTestId("sale-history-cancel").click();
  await expect(page.getByTestId("sale-return-dialog")).toBeVisible();
  await page.getByTestId("sale-return-mode-cancel").click();
  await page.getByTestId("sale-return-reason").selectOption("erro_de_venda");
  await page.getByTestId("sale-return-confirm").click();

  await expect(page.getByTestId("sale-return-dialog")).toHaveCount(0);
  await expect(page.getByTestId("sales-history-detail")).toContainText("Cancelada");
  await expect(page.getByTestId("sale-history-returns")).toContainText("CANCELAMENTO");
  await expect(page.getByTestId("sale-history-cancel")).toHaveCount(0);
  await expect(page.getByTestId("sale-history-return")).toHaveCount(0);

  await page.getByTestId("sales-history-panel").getByText("Fechar").click();
  await expect(page.getByTestId("projected-stock-BEV-001").first()).toHaveText(stockBefore);
});

test("B18 devolução parcial, excesso bloqueado e devolução total", async ({ page }) => {
  await page.goto("/pdv");
  await selectStore(page);

  const stockBefore = await page.getByTestId("projected-stock-BEV-001").first().innerText();
  await addSku(page, "BEV-001");
  await page.getByTestId("cart-inc-BEV-001").click();
  await page.getByTestId("cart-inc-BEV-001").click();
  await page.getByTestId("cart-inc-BEV-001").click();
  await page.getByTestId("cart-inc-BEV-001").click();
  await expect(page.getByTestId("cart-qty-BEV-001")).toHaveValue("5");
  await payCashExact(page);

  await openLatestSaleDetail(page);
  await page.getByTestId("sale-history-return").click();
  await expect(page.getByTestId("sale-return-dialog")).toBeVisible();

  const qtyInput = page.locator('[data-testid^="sale-return-qty-"]').first();
  await qtyInput.fill("2");
  await expect(page.getByTestId("sale-return-preview-total")).not.toHaveText("—");
  await page.getByTestId("sale-return-reason").selectOption("cliente_desistiu");
  await page.getByTestId("sale-return-confirm").click();

  await expect(page.getByTestId("sales-history-detail")).toContainText("Estorno parcial");
  await expect(page.getByTestId("sales-history-detail")).toContainText("devolvível 3");
  await expect(page.getByTestId("sale-history-returns")).toContainText("DEVOLUÇÃO");

  await page.getByTestId("sale-history-return").click();
  await expect(page.getByTestId("sale-return-dialog")).toBeVisible();
  await page.locator('[data-testid^="sale-return-qty-"]').first().fill("4");
  await expect(page.getByTestId("sale-return-preview-total")).toHaveText("—");
  await expect(page.getByTestId("sale-return-confirm")).toBeDisabled();
  await page.getByTestId("sale-return-dialog").getByText("Voltar").click();

  await page.getByTestId("sale-history-return").click();
  await page.locator('[data-testid^="sale-return-qty-"]').first().fill("3");
  await page.getByTestId("sale-return-reason").selectOption("produto_incorreto");
  await expect(page.getByTestId("sale-return-confirm")).toBeEnabled();
  await page.getByTestId("sale-return-confirm").click();

  await expect(page.getByTestId("sales-history-detail")).toContainText("Estornada");
  await expect(page.getByTestId("sale-history-return")).toHaveCount(0);
  await expect(page.getByTestId("sale-history-cancel")).toHaveCount(0);

  await page.getByTestId("sales-history-panel").getByText("Fechar").click();
  await expect(page.getByTestId("projected-stock-BEV-001").first()).toHaveText(stockBefore);
});

// Cash-tender / change UX lives in later WIP (not this surgical B18 hotfix).
test.skip("B18 venda cash com troco, caixa e estorno no saldo", async ({ page }) => {
  await page.goto("/pdv?role=manager");
  await selectStore(page);

  await expect(page.getByTestId("cash-status")).toHaveText("ABERTO");
  await expect(page.getByTestId("cash-expected")).toContainText(/R\$\s*0,00/);

  await addSku(page, "BEV-001");
  await page.getByTestId("open-payment").click();
  await page.getByTestId("cash-received-input").fill("10.00");
  await expect(page.getByTestId("cash-change-due")).toContainText(/Troco:\s*R\$/);
  await visible(page, "checkout-cash").click();
  await expect(page.getByTestId("receipt")).toBeVisible();
  await expect(page.getByTestId("receipt-change-label")).toBeVisible();
  await page.getByTestId("receipt-close").click();
  await expect(page.getByTestId("receipt")).toHaveCount(0);

  await expect(page.getByTestId("cash-expected")).toContainText(/R\$\s*3,50/);

  await openLatestSaleDetail(page);
  await page.getByTestId("sale-history-cancel").click();
  await page.getByTestId("sale-return-mode-cancel").click();
  await page.getByTestId("sale-return-reason").selectOption("cliente_desistiu");
  await page.getByTestId("sale-return-confirm").click();
  await expect(page.getByTestId("sales-history-detail")).toContainText("Cancelada");
  await page.getByTestId("sales-history-panel").getByText("Fechar").click();

  await expect(page.getByTestId("cash-expected")).toContainText(/R\$\s*0,00/);
});

// Depends on cash-received-input / receipt change labels from later WIP.
test.skip("B18 desconto autorizado e pagamento cash sem alterar amount pelo troco", async ({ page }) => {
  await page.goto("/pdv");
  await selectStore(page);
  await addSku(page, "BEV-001");
  await page.getByTestId("cart-inc-BEV-001").click();
  await expect(page.getByTestId("cart-qty-BEV-001")).toHaveValue("2");

  await page.keyboard.press("F6");
  await page.getByTestId("discount-input").fill("0.30");
  await page.getByTestId("discount-apply").click();

  await payCashWithTender(page, "10.00");
  await expect(page.getByTestId("receipt")).toBeVisible();
  await expect(page.getByTestId("receipt-change-label")).toBeVisible();
  await expect(page.getByTestId("receipt-sync-status")).toContainText(/Sincronização:/);
});
