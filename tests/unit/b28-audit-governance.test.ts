import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_INTEGRITY_MODEL,
  AUDIT_OPERATION_COVERAGE,
  AUDIT_PAGE_SIZE_MAX,
  AUDIT_RETENTION_POLICY,
  assertServerDerivedAuditAuthority,
  buildSettingsAuditDiff,
  fromAuditLogRow,
  expandAuditActionFilter,
  normalizeAuditAction,
  normalizeAuditListFilters,
  sanitizeAuditMetadata,
  toAuditPayload,
} from "@/lib/observability/audit";
import { canViewAuditLogs } from "@/lib/domain/rbac";
import { resetRateLimitStateForTests } from "@/lib/security/rate-limit";

const { getAuthedContext, createClient, listAuditEvents, recordAuditEvent } = vi.hoisted(() => ({
  getAuthedContext: vi.fn(),
  createClient: vi.fn(),
  listAuditEvents: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getAuthedContext }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/server/audit", () => ({ listAuditEvents, recordAuditEvent }));

import { GET as auditGet } from "@/app/api/admin/audit/route";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260906120000_b28_audit_governance.sql"),
  "utf8"
);

describe("B28 audit contracts", () => {
  it("RBAC: only manager/admin may view audit logs", () => {
    expect(canViewAuditLogs("admin")).toBe(true);
    expect(canViewAuditLogs("manager")).toBe(true);
    expect(canViewAuditLogs("cashier")).toBe(false);
    expect(canViewAuditLogs(null)).toBe(false);
  });

  it("rejects client authority fields for audit writes", () => {
    expect(
      assertServerDerivedAuditAuthority({
        clientActorUserId: "u1",
      }).ok
    ).toBe(false);
    expect(
      assertServerDerivedAuditAuthority({
        clientOrgId: "o1",
      }).ok
    ).toBe(false);
    expect(
      assertServerDerivedAuditAuthority({
        clientResult: "success",
      }).ok
    ).toBe(false);
    expect(assertServerDerivedAuditAuthority({}).ok).toBe(true);
  });

  it("sanitizes secrets and PII from metadata", () => {
    const cleaned = sanitizeAuditMetadata({
      password: "x",
      api_key: "k",
      cpf: "390.533.447-05",
      phone: "11999999999",
      note: "cliente 390.533.447-05",
      field: "require_customer_on_sale",
      client_mutation_id: "m1",
    });
    expect(cleaned).not.toHaveProperty("password");
    expect(cleaned).not.toHaveProperty("api_key");
    expect(cleaned).not.toHaveProperty("cpf");
    expect(cleaned).not.toHaveProperty("phone");
    expect(cleaned.note).toBe("[redacted_document]");
    expect(cleaned.field).toBe("require_customer_on_sale");
    expect(cleaned.client_mutation_id).toBe("m1");
  });

  it("settings diff redacts sensitive values but keeps field names", () => {
    const diff = buildSettingsAuditDiff(
      { document: "old-doc", auto_print_receipt: false },
      { document: "new-doc", auto_print_receipt: true }
    );
    const doc = diff.find((entry) => entry.field === "document");
    const flag = diff.find((entry) => entry.field === "auto_print_receipt");
    expect(doc).toEqual({ field: "document", changed: true });
    expect(flag).toMatchObject({
      field: "auto_print_receipt",
      changed: true,
      old_safe: false,
      new_safe: true,
    });
  });

  it("toAuditPayload never embeds actor_role/org/user for client spoofing", () => {
    const payload = toAuditPayload({
      storeId: "s1",
      orgId: "should-not-appear",
      actorUserId: "should-not-appear",
      actorRole: "admin",
      action: "settings.updated",
      resourceType: "store_settings",
      resourceId: "s1",
      result: "denied",
      metadata: { password: "nope", field: "x" },
    }) as Record<string, unknown>;
    expect(payload.result).toBe("denied");
    expect(payload).not.toHaveProperty("actor_role");
    expect(payload).not.toHaveProperty("actor_user_id");
    expect(payload).not.toHaveProperty("org_id");
    expect((payload.metadata as Record<string, unknown>).field).toBe("x");
    expect(payload.metadata as Record<string, unknown>).not.toHaveProperty("password");
  });

  it("caps pagination and rejects bad filters", () => {
    const ok = normalizeAuditListFilters({ storeId: "s1", limit: 999, offset: -5 });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.limit).toBe(AUDIT_PAGE_SIZE_MAX);
      expect(ok.value.offset).toBe(0);
    }
    expect(normalizeAuditListFilters({ storeId: "s1", result: "paid" as never }).ok).toBe(false);
    expect(normalizeAuditListFilters({ storeId: "" }).ok).toBe(false);
  });

  it("maps rows without inventing paid/authorized outcomes", () => {
    const event = fromAuditLogRow({
      id: "a1",
      created_at: "2026-09-06T16:00:00.000Z",
      org_id: "o1",
      store_id: "s1",
      user_id: "u1",
      entity_type: "store_settings",
      entity_id: "s1",
      action: "settings.updated",
      payload: {
        result: "denied",
        actor_role: "cashier",
        metadata: { api_key: "x", field: "trade_name" },
      },
    });
    expect(event.result).toBe("denied");
    expect(event.actor_role).toBe("cashier");
    expect(event.metadata).not.toHaveProperty("api_key");
    expect(event.metadata.field).toBe("trade_name");
    expect(JSON.stringify(event)).not.toMatch(/\bpaid\b|\bcaptured\b|\bauthorized\b/i);

    const sale = fromAuditLogRow({
      id: "a2",
      created_at: "2026-09-06T16:00:00.000Z",
      org_id: "o1",
      store_id: "s1",
      user_id: "u1",
      entity_type: "sale",
      entity_id: "sale-1",
      action: "sale.confirmed",
      payload: { result: "success", correlation_id: "c-1" },
    });
    expect(sale.action).toBe("sale.created");
    expect(sale.correlation_id).toBe("c-1");
  });

  it("declares retention as not_defined", () => {
    expect(AUDIT_RETENTION_POLICY).toBe("not_defined");
  });

  it("documents integrity without claiming cryptographic hash chaining", () => {
    expect(AUDIT_INTEGRITY_MODEL.mechanism).toBe("append_only_rls");
    expect(AUDIT_INTEGRITY_MODEL.hashChaining).toBe(false);
  });

  it("maps domain action aliases to the B28 contract", () => {
    expect(normalizeAuditAction("sale.confirmed")).toBe("sale.created");
    expect(normalizeAuditAction("adjust_inventory")).toBe("inventory.adjusted");
    expect(normalizeAuditAction("cash.movement_recorded")).toBe("cash.movement");
    expect(normalizeAuditAction("fiscal.issue.requested")).toBe("fiscal.issue_requested");
    expect(normalizeAuditAction("sale.cancelled")).toBe("sale.cancelled");
    expect(expandAuditActionFilter("sale.created")).toEqual(
      expect.arrayContaining(["sale.created", "sale.confirmed"])
    );
    expect(expandAuditActionFilter("inventory.adjusted")).toEqual(
      expect.arrayContaining(["inventory.adjusted", "adjust_inventory"])
    );
  });

  it("marks missing product operations as not_applicable (no invented coverage)", () => {
    expect(AUDIT_OPERATION_COVERAGE["customer.deleted"].status).toBe("not_applicable");
    expect(AUDIT_OPERATION_COVERAGE["backup.attestation_updated"].status).toBe("not_applicable");
    expect(AUDIT_OPERATION_COVERAGE["sale.cancelled"].status).toBe("covered");
    expect(AUDIT_OPERATION_COVERAGE["settings.updated"].status).toBe("covered");
  });

  it("embeds correlation_id and operation_id in sanitized payloads", () => {
    const payload = toAuditPayload({
      storeId: "s1",
      orgId: "o1",
      actorUserId: "u1",
      actorRole: "manager",
      action: "fiscal.issue_requested",
      resourceType: "fiscal_document",
      resourceId: "d1",
      result: "success",
      correlationId: "corr-12345678",
      operationId: "op-12345678",
      metadata: { route: "fiscal.issue" },
    }) as Record<string, unknown>;
    expect(payload.correlation_id).toBe("corr-12345678");
    expect(payload.operation_id).toBe("op-12345678");
    expect(payload.result).toBe("success");
  });

  it("supports success/failure/rejected/denied results without inventing paid", () => {
    for (const result of ["success", "failure", "rejected", "denied"] as const) {
      const payload = toAuditPayload({
        storeId: "s1",
        orgId: "o1",
        actorUserId: "u1",
        actorRole: "manager",
        action: "settings.updated",
        resourceType: "store_settings",
        resourceId: "s1",
        result,
      }) as Record<string, unknown>;
      expect(payload.result).toBe(result);
    }
  });
});

describe("B28 migration governance", () => {
  it("keeps audit_logs append-only for app roles", () => {
    expect(MIGRATION).toMatch(/REVOKE INSERT, UPDATE, DELETE ON TABLE public\.audit_logs/);
    expect(MIGRATION).toContain("record_audit_event");
    expect(MIGRATION).toContain("list_audit_events");
    expect(MIGRATION).toContain("user_can_view_reports");
    expect(MIGRATION).toContain("user_store_role");
    expect(MIGRATION).toMatch(/p_payload \? 'org_id'/);
    expect(MIGRATION).toMatch(/p_payload \? 'actor_user_id'/);
    expect(MIGRATION).toContain("security.access_denied");
    expect(MIGRATION).toContain("settings.updated");
    expect(MIGRATION).toContain("idx_audit_logs_entity_created");
    expect(MIGRATION).toContain("v_actions");
    expect(MIGRATION).toContain("sale.confirmed");
    expect(MIGRATION).not.toContain("TRUNCATE");
  });

  it("does not allow generic writer to invent sale.created events", () => {
    expect(MIGRATION).toContain("'security.access_denied'");
    const writerWhitelist = MIGRATION.match(
      /IF v_action NOT IN \(([\s\S]*?)\) THEN\s*\n\s*RAISE EXCEPTION 'invalid_audit_payload'/
    );
    expect(writerWhitelist?.[1] ?? "").not.toMatch(/sale\.created/);
    expect(writerWhitelist?.[1] ?? "").toContain("security.access_denied");
    expect(MIGRATION).toMatch(/IF v_action NOT IN/);
  });

  it("gates privileged governance writes to manager/admin and rejects authority spoof fields", () => {
    expect(MIGRATION).toMatch(/settings\.updated[\s\S]*user_can_view_reports/);
    expect(MIGRATION).toContain("security.access_denied' AND v_result IS DISTINCT FROM 'denied'");
    expect(MIGRATION).toContain("octet_length");
    expect(MIGRATION).toMatch(/p_payload \? 'occurred_at'/);
    expect(MIGRATION).toMatch(/p_payload \? 'result'/);
    expect(MIGRATION).toMatch(/p_payload \? 'actor_role'/);
  });

  it("customer audit writes avoid document/email/phone PII", () => {
    expect(MIGRATION).toContain("has_document");
    expect(MIGRATION).toContain("'result', 'success'");
    expect(MIGRATION).toMatch(/metadata',\s*jsonb_build_object\([\s\S]*customer_id/);
    expect(MIGRATION).not.toMatch(
      /jsonb_build_object\(\s*'name',\s*v_existing\.name,\s*'document',\s*v_existing\.document/
    );
  });
});

describe("B28 /api/admin/audit", () => {
  beforeEach(() => {
    resetRateLimitStateForTests();
    getAuthedContext.mockReset();
    createClient.mockReset();
    listAuditEvents.mockReset();
    recordAuditEvent.mockReset();
    recordAuditEvent.mockResolvedValue({ ok: true, id: "x", mode: "best_effort" });
  });

  it("rejects anonymous callers", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    });
    const response = await auditGet(new Request("http://localhost/api/admin/audit?store_id=s1"));
    expect(response.status).toBe(401);
  });

  it("rejects org_id query spoofing", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    });
    const response = await auditGet(
      new Request("http://localhost/api/admin/audit?store_id=00000000-0000-4000-8000-000000000001&org_id=evil")
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_scope" });
  });

  it("rejects organization_id query spoofing", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    });
    const response = await auditGet(
      new Request(
        "http://localhost/api/admin/audit?store_id=00000000-0000-4000-8000-000000000001&organization_id=evil"
      )
    );
    expect(response.status).toBe(400);
  });

  it("treats actor_user_id as filter only and keeps session actor for audit.listed", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    });
    getAuthedContext.mockResolvedValue({
      userId: "u1",
      role: "manager",
      orgId: "o1",
      storeId: "00000000-0000-4000-8000-000000000001",
      storeName: "Loja",
      stores: [],
    });
    listAuditEvents.mockResolvedValue({
      ok: true,
      events: [],
      total: 0,
      limit: 25,
      offset: 0,
    });
    const response = await auditGet(
      new Request(
        "http://localhost/api/admin/audit?store_id=00000000-0000-4000-8000-000000000001&actor_user_id=other-user"
      )
    );
    expect(response.status).toBe(200);
    expect(listAuditEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: "00000000-0000-4000-8000-000000000001",
        actorUserId: "other-user",
      })
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "audit.listed",
        actorUserId: "u1",
        result: "success",
      })
    );
  });

  it("forbids cross-store listing when session store mismatches query", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    });
    getAuthedContext.mockResolvedValue({
      userId: "u1",
      role: "manager",
      orgId: "o1",
      storeId: "00000000-0000-4000-8000-000000000099",
      storeName: "Outra",
      stores: [],
    });
    const response = await auditGet(
      new Request(
        "http://localhost/api/admin/audit?store_id=00000000-0000-4000-8000-000000000001"
      )
    );
    expect(response.status).toBe(403);
    expect(listAuditEvents).not.toHaveBeenCalled();
  });

  it("denies cashier and records security.access_denied", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    });
    getAuthedContext.mockResolvedValue({
      userId: "u1",
      role: "cashier",
      orgId: "o1",
      storeId: "00000000-0000-4000-8000-000000000001",
      storeName: "Loja",
      stores: [],
    });
    const response = await auditGet(
      new Request(
        "http://localhost/api/admin/audit?store_id=00000000-0000-4000-8000-000000000001"
      )
    );
    expect(response.status).toBe(403);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "security.access_denied",
        result: "denied",
      })
    );
  });

  it("lists events for manager without leaking secrets", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    });
    getAuthedContext.mockResolvedValue({
      userId: "u1",
      role: "manager",
      orgId: "o1",
      storeId: "00000000-0000-4000-8000-000000000001",
      storeName: "Loja",
      stores: [],
    });
    listAuditEvents.mockResolvedValue({
      ok: true,
      events: [
        {
          id: "a1",
          occurred_at: "2026-09-06T16:00:00.000Z",
          organization_id: "o1",
          store_id: "00000000-0000-4000-8000-000000000001",
          actor_user_id: "u1",
          actor_role: "manager",
          action: "settings.updated",
          resource_type: "store_settings",
          resource_id: "00000000-0000-4000-8000-000000000001",
          operation_id: null,
          correlation_id: "c1",
          result: "success",
          metadata: { fields: ["auto_print_receipt"] },
        },
      ],
      total: 1,
      limit: 25,
      offset: 0,
    });
    const response = await auditGet(
      new Request(
        "http://localhost/api/admin/audit?store_id=00000000-0000-4000-8000-000000000001&limit=25"
      )
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.retention_policy).toBe("not_defined");
    expect(body.events[0].result).toBe("success");
    expect(body.events[0].metadata.fields).toContain("auto_print_receipt");
    expect(JSON.stringify(body)).not.toMatch(/SERVICE_ROLE|password|api_key|eyJ/i);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "audit.listed", result: "success" })
    );
  });
});
