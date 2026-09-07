import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260907220000_stripe_pix_payment.sql"),
  "utf8"
);

describe("Stripe PIX payment migration contract", () => {
  it("does not rewrite cash RPCs or invent refund_cash", () => {
    expect(MIGRATION).not.toContain("CREATE OR REPLACE FUNCTION public.process_sale(");
    expect(MIGRATION).not.toContain("CREATE OR REPLACE FUNCTION public.process_sale_with_cash(");
    expect(MIGRATION).not.toMatch(/INSERT INTO public\.cash_movements/);
    expect(MIGRATION).toContain("Never invent refund_cash for PIX");
    expect(MIGRATION).toContain("pending_external");
    expect(MIGRATION).toContain("invented_refund_cash");
  });

  it("uses sibling tables and confirms sale only after captured", () => {
    expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS public.pix_payment_intents");
    expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS public.pix_provider_events");
    expect(MIGRATION).not.toContain("card_payment_intents");
    expect(MIGRATION).toContain("provider_ref text NOT NULL CHECK (provider_ref ~ '^pi_[A-Za-z0-9]+$')");
    expect(MIGRATION).toContain("IF v_intent.status <> 'captured' THEN");
    expect(MIGRATION).toContain("RAISE EXCEPTION 'pix_payment_not_captured'");
    expect(MIGRATION).toContain("'pix'");
    expect(MIGRATION).toContain("GRANT EXECUTE ON FUNCTION public.process_pix_sale(jsonb) TO authenticated");
    expect(MIGRATION).toContain(
      "GRANT EXECUTE ON FUNCTION public.apply_pix_provider_event(jsonb) TO service_role"
    );
  });

  it("records webhook events idempotently by event.id", () => {
    expect(MIGRATION).toContain("event_id text PRIMARY KEY");
    expect(MIGRATION).toContain("'replay', true");
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.apply_pix_provider_event");
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.complete_pix_refund");
    expect(MIGRATION).toContain("AND payment_method = 'pix'");
  });
});
