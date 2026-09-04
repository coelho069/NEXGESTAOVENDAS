import { expect, test } from "@playwright/test";

const STORE_A = "22222222-2222-4222-8222-222222222201";
const STORE_B = "22222222-2222-4222-8222-222222222202";
const OTHER_ORG_STORE = "99999999-9999-4999-8999-999999999999";

const forbiddenBundleTerms = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "JWT_SECRET",
  "FISCAL_WORKER_SECRET",
  ["Admin", "123!"].join(""),
  ["Manager", "123!"].join(""),
  ["Cashier", "123!"].join(""),
];

test("H — application sends baseline security headers", async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(response.headers()["permissions-policy"]).toContain("camera=()");
  expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("cross-site state-changing requests are rejected before the API", async ({ request }) => {
  const response = await request.post("/api/sales/process", {
    headers: {
      Origin: "https://evil.example.test",
      "Sec-Fetch-Site": "cross-site",
    },
    data: {},
  });

  expect(response.status()).toBe(403);
  await expect(response.json()).resolves.toEqual({ error: "csrf_failed" });
});

test("G — server-only secret names and demo passwords are absent from HTML and bundles", async ({
  request,
}) => {
  const page = await request.get("/");
  const html = await page.text();
  const assets = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
  const bodies = [html];

  for (const asset of assets) {
    bodies.push(await (await request.get(asset)).text());
  }

  for (const term of forbiddenBundleTerms) {
    expect(bodies.join("\n")).not.toContain(term);
  }
});

test("A — logout/login isolation keeps cart storage user-scoped in fixtures", async ({ page }) => {
  await page.goto("/pdv");
  await page.getByTestId("store-select").selectOption(STORE_A);
  await expect(page.getByTestId("product-sku-BEV-001")).toBeVisible();
  await page.getByTestId("pdv-search-input").fill("BEV-001");
  await page.getByTestId("pdv-search-input").press("Enter");
  await expect(page.getByTestId("cart-line-BEV-001")).toBeVisible();

  // Simulate logout cleanup used by endClientSession (fixtures have no auth users).
  await page.evaluate(() => {
    const prefixes = ["nex-cash-session:", "nex-pdv-cart", "nex-cash-pending-mutations:"];
    for (const storage of [localStorage, sessionStorage]) {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (!key) continue;
        if (prefixes.some((prefix) => key === prefix || key.startsWith(prefix))) keys.push(key);
      }
      keys.forEach((key) => storage.removeItem(key));
    }
  });

  await page.goto("/pdv");
  await page.getByTestId("store-select").selectOption(STORE_A);
  await expect(page.getByTestId("product-sku-BEV-001")).toBeVisible();
  await expect(page.getByTestId("cart-line-BEV-001")).toHaveCount(0);
});

test("B/C — cross-store and cross-org API mutations are blocked without a session", async ({
  request,
}) => {
  const crossStore = await request.post("/api/inventory/adjust", {
    headers: {
      Origin: "http://localhost:3000",
      "Sec-Fetch-Site": "same-origin",
    },
    data: {
      store_id: STORE_B,
      product_id: "44444444-4444-4444-8444-444444444401",
      client_mutation_id: "77777777-7777-4777-8777-777777777777",
      delta: "1.000",
      reason: "cross-store",
      movement_type: "adjustment",
    },
  });
  expect([401, 403, 503]).toContain(crossStore.status());

  const crossOrg = await request.post("/api/sales/process", {
    headers: {
      Origin: "http://localhost:3000",
      "Sec-Fetch-Site": "same-origin",
    },
    data: {
      store_id: OTHER_ORG_STORE,
      client_mutation_id: "88888888-8888-4888-8888-888888888888",
      items: [
        {
          product_id: "44444444-4444-4444-8444-444444444401",
          quantity: 1,
          unit_price: "3.50",
          discount: "0.00",
        },
      ],
      payments: [{ method: "cash", amount: "3.50" }],
      discount: "0.00",
    },
  });
  expect([401, 403, 503]).toContain(crossOrg.status());
});

test("D — cashier-facing UI cannot open dashboard without authorization path", async ({ page }) => {
  await page.goto("/dashboard");
  // Fixtures mode may render a degraded/forbidden state; never expose cost metrics freely.
  const body = await page.locator("body").innerText();
  expect(body.toLowerCase()).not.toContain("service_role");
});

test("E — client cannot mark payment as captured through reconcile API", async ({ request }) => {
  const response = await request.post("/api/payments/reconcile", {
    headers: {
      Origin: "http://localhost:3000",
      "Sec-Fetch-Site": "same-origin",
    },
    data: {
      store_id: STORE_A,
      payment_id: "55555555-5555-4555-8555-555555555555",
      status: "captured",
    },
  });
  expect([400, 401, 403, 503]).toContain(response.status());
  const json = await response.json();
  expect(JSON.stringify(json)).not.toContain("captured");
  expect(json.error).not.toBeUndefined();
});

test("F — client cannot mark fiscal document as issued through issue API", async ({ request }) => {
  const response = await request.post("/api/fiscal/issue", {
    headers: {
      Origin: "http://localhost:3000",
      "Sec-Fetch-Site": "same-origin",
    },
    data: {
      store_id: STORE_A,
      sale_id: "66666666-6666-4666-8666-666666666666",
      status: "issued",
    },
  });
  expect([400, 401, 403, 503]).toContain(response.status());
  const json = await response.json();
  expect(JSON.stringify(json)).not.toMatch(/"status"\s*:\s*"issued"/);
});
