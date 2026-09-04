import { expect, test } from "@playwright/test";

const storeId = "22222222-2222-4222-8222-222222222201";

test("dashboard offline does not present local financial totals", async ({ page }) => {
  await page.goto(`/dashboard?store=${storeId}`);
  await expect(page.getByTestId("dashboard-degraded")).toBeVisible();
  await expect(page.getByTestId("dashboard-online-only")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-revenue")).toHaveCount(0);
});

test("report API rejects an empty [start,end) period before querying data", async ({ request }) => {
  const response = await request.get(
    `/api/dashboard/metrics?store_id=${storeId}&from=2026-09-01&to=2026-09-01`
  );
  expect(response.status()).toBe(400);
});

test("export does not authorize an arbitrary store", async ({ request }) => {
  const response = await request.get(
    `/api/dashboard/export?store_id=${storeId}&from=2026-09-01&to=2026-09-02`
  );
  expect(response.status()).toBe(403);
});
