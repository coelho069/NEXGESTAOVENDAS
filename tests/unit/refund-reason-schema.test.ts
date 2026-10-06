import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { REFUND_REQUEST_REASONS } from "@/lib/domain/refund-request";
import { createOwnedRefundRequest } from "@/lib/server/client-refund-requests";
import type { RefundRequestStore } from "@/lib/server/refund-requests";
import { createOwnedRefundRequestSchema, createRefundRequestSchema } from "@/lib/validation/schemas";

const DOMAIN_REASONS = [
  "arrependimento",
  "cobranca_indevida",
  "cobranca_duplicada",
  "falha_no_servico",
  "problema_tecnico",
  "outro",
] as const;

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261006160000_refund_request_reason_domain.sql"),
  "utf8"
);

function body(reason: string, notes = "") {
  return {
    client_mutation_id: "44444444-4444-4444-8444-444444444444",
    mp_payment_id: "123456789",
    reason,
    notes,
    confirmed: true as const,
  };
}

describe("refund reason schema alignment", () => {
  it("uses the same six reasons in the domain, the API schema, and the migration", () => {
    expect([...REFUND_REQUEST_REASONS]).toEqual([...DOMAIN_REASONS]);
    for (const reason of DOMAIN_REASONS) {
      const notes = reason === "outro" ? "texto" : "";
      expect(createOwnedRefundRequestSchema.safeParse(body(reason, notes)).success).toBe(true);
      expect(
        createRefundRequestSchema.safeParse({
          client_mutation_id: body(reason).client_mutation_id,
          payer_email: "client@example.com",
          mp_payment_id: "123456789",
          reason,
          notes,
          intensive_use_declared: false,
        }).success
      ).toBe(true);
      expect(migration).toContain(`'${reason}'`);
    }
    expect(migration).toContain("SET reason = 'arrependimento'");
    expect(migration).toContain("WHERE reason = 'desistencia'");
    expect(migration).toContain("refund_requests_reason_legacy_unmapped");
    expect(migration).not.toContain("motivo=");
    expect(migration).not.toMatch(/SET reason = 'outro'/);
    expect(migration).not.toMatch(/ALTER TABLE public\.(subscriptions|checkout_sessions|payments)\b/);
  });

  it("rejects legacy and unknown reasons before insert", () => {
    for (const reason of ["desistencia", "nao_utilizou", "fraude", ""]) {
      expect(createOwnedRefundRequestSchema.safeParse(body(reason)).success).toBe(false);
    }
  });

  it("stores each domain reason unchanged", async () => {
    for (const reason of DOMAIN_REASONS) {
      const insert = vi.fn(async () => ({ error: null }));
      const store: RefundRequestStore = {
        findByMutationId: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: "88888888-8888-4888-8888-888888888888", status: "submitted" }),
        findById: vi.fn(async () => null),
        insert,
        findCheckout: vi.fn(async () => null),
        updateIfStatus: vi.fn(async () => null),
        listRecent: vi.fn(async () => []),
      };
      const notes = reason === "outro" ? "observação" : "";
      const result = await createOwnedRefundRequest(store, {
        actor: {
          userId: "22222222-2222-4222-8222-222222222222",
          email: "client@example.com",
          orgId: "33333333-3333-4333-8333-333333333333",
        },
        checkout: {
          id: "11111111-1111-4111-8111-111111111111",
          payerEmail: "client@example.com",
          mpPaymentId: "123456789",
          mpPaymentStatus: "approved",
          mpPaymentPaidAt: "2026-10-06T15:00:00.000Z",
          onboardingUserId: "22222222-2222-4222-8222-222222222222",
          onboardingOrganizationId: "33333333-3333-4333-8333-333333333333",
        },
        hasOpenRequest: false,
        clientMutationId: "44444444-4444-4444-8444-444444444444",
        mpPaymentId: "123456789",
        reason,
        notes,
        intensiveUseDeclared: false,
        now: new Date("2026-10-08T15:00:00.000Z"),
      });
      expect(result.ok).toBe(true);
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          reason,
          notes,
          provider_refund_status: "not_sent",
        })
      );
    }
  });
});
