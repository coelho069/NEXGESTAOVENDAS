import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260906220000_stripe_card_payment.sql"),
  "utf8"
);

describe("Stripe card payment migration contract", () => {
  it("does not rewrite cash RPCs or invent refund_cash", () => {
    expect(MIGRATION).not.toContain("CREATE OR REPLACE FUNCTION public.process_sale(");
    expect(MIGRATION).not.toContain("CREATE OR REPLACE FUNCTION public.process_sale_with_cash(");
    expect(MIGRATION).not.toMatch(/INSERT INTO public\.cash_movements/);
    expect(MIGRATION).toContain("Never insert refund_cash");
    expect(MIGRATION).toContain("pending_external");
  });

  it("stores provider_ref as PaymentIntent id and confirms sale only after captured", () => {
    expect(MIGRATION).toContain("provider_ref text NOT NULL CHECK (provider_ref ~ '^pi_[A-Za-z0-9]+$')");
    expect(MIGRATION).toContain("IF v_intent.status <> 'captured' THEN");
    expect(MIGRATION).toContain("RAISE EXCEPTION 'card_payment_not_captured'");
    expect(MIGRATION).toContain("external_reference");
    expect(MIGRATION).toContain("'card'");
    expect(MIGRATION).toContain("GRANT EXECUTE ON FUNCTION public.process_card_sale(jsonb) TO authenticated");
    expect(MIGRATION).toContain(
      "GRANT EXECUTE ON FUNCTION public.apply_card_provider_event(jsonb) TO service_role"
    );
  });

  it("records webhook events idempotently by event.id", () => {
    expect(MIGRATION).toContain("event_id text PRIMARY KEY");
    expect(MIGRATION).toContain("'replay', true");
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.apply_card_provider_event");
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.complete_card_refund");
  });
});
