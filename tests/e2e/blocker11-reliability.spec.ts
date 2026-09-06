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

test("B27 operational /api/health is honest and secret-free", async ({ request }) => {
  const response = await request.get("/api/health", {
    headers: { "x-correlation-id": "b27-ops-health-001" },
  });
  expect([200, 503]).toContain(response.status());
  expect(response.headers()["x-correlation-id"]).toBe("b27-ops-health-001");
  const body = await response.json();
  expect(body.liveness).toBe("ok");
  expect(body.service).toBe("nexgestaovendas");
  expect(Array.isArray(body.components)).toBeTruthy();
  const fiscal = body.components.find((c: { name: string }) => c.name === "fiscal");
  const payments = body.components.find((c: { name: string }) => c.name === "payments");
  const backup = body.components.find((c: { name: string }) => c.name === "backup");
  expect(fiscal?.state).toBe("not_configured");
  expect(payments?.state).toBe("not_configured");
  expect(backup?.state).toBe("external_dependency");
  expect(body.alerts?.notifier?.status).toBe("not_configured");
  expect(body.alerts?.dispatch?.status).toBe("not_configured");
  const raw = JSON.stringify(body);
  expect(raw).not.toContain("SERVICE_ROLE");
  expect(raw).not.toContain("password");
  expect(raw).not.toMatch(/print_succeeded|authorized|captured/i);
});
