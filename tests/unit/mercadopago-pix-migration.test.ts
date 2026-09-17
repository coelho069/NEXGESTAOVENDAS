import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260917230000_mercadopago_pix_provider_ref.sql"),
  "utf8"
);

describe("Mercado Pago PIX provider_ref migration contract", () => {
  it("extends pix_payment_intents without new tables", () => {
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.is_valid_pix_provider_ref");
    expect(MIGRATION).toContain("^pi_[A-Za-z0-9]+$");
    expect(MIGRATION).toContain("^ORD[A-Z0-9]+$");
    expect(MIGRATION).not.toContain("CREATE TABLE");
  });

  it("reuses register / apply / process_pix_sale RPCs", () => {
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.register_pix_payment_intent");
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.apply_pix_provider_status");
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.process_pix_sale");
    expect(MIGRATION).toContain("NOT public.is_valid_pix_provider_ref(v_provider_ref)");
  });
});
