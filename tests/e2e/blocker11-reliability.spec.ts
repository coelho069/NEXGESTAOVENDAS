import { expect, test } from "@playwright/test";

test("liveness is always available and echoes correlation id", async ({ request }) => {
  const response = await request.get("/health/liveness", {
    headers: { "x-correlation-id": "b11-live-correlation-001" },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["x-correlation-id"]).toBe("b11-live-correlation-001");
  expect(response.headers()["x-request-id"]).toBe("b11-live-correlation-001");
  await expect(response.json()).resolves.toMatchObject({
    status: "ok",
    service: "nexgestaovendas",
  });
});

test("readiness reports dependency state without leaking secrets", async ({ request }) => {
  const response = await request.get("/health/readiness", {
    headers: { "x-correlation-id": "b11-ready-correlation-001" },
  });
  // Fixtures e2e clears Supabase env, so readiness should be not_ready/503.
  expect([200, 503]).toContain(response.status());
  const body = await response.json();
  expect(body.service).toBe("nexgestaovendas");
  expect(body.checks).toBeTruthy();
  expect(JSON.stringify(body)).not.toContain("SERVICE_ROLE");
  expect(JSON.stringify(body)).not.toContain("password");
  expect(response.headers()["x-correlation-id"]).toBe("b11-ready-correlation-001");
});

test("mutating API responses keep correlation id on rejection paths", async ({ request }) => {
  const response = await request.post("/api/sales/process", {
    headers: {
      Origin: "https://evil.example.test",
      "Sec-Fetch-Site": "cross-site",
      "x-correlation-id": "b11-csrf-correlation-001",
    },
    data: {},
  });
  expect(response.status()).toBe(403);
  expect(response.headers()["x-correlation-id"]).toBe("b11-csrf-correlation-001");
});
