import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedContext } from "@/lib/auth/session";
import { storeIdSchema } from "@/lib/validation/schemas";
import {
  MANUAL_PAYMENT_METHODS,
  normalizeAcceptedPaymentMethods,
} from "@/lib/domain/store-payment-methods";

const bodySchema = z
  .object({
    store_id: storeIdSchema,
    accepted_payment_methods: z.array(z.enum(MANUAL_PAYMENT_METHODS)).min(1).max(4),
  })
  .strict();

type RpcClient = {
  rpc: (
    fn: string,
    args: { p_payload: Record<string, unknown> }
  ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

export async function POST(request: Request) {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_settings_payment_methods" }, { status: 400 });
  }

  const auth = await getAuthedContext(parsed.data.store_id);
  if (!auth?.orgId || (auth.role !== "admin" && auth.role !== "manager")) {
    return NextResponse.json({ error: "forbidden_settings" }, { status: 403 });
  }

  const { data, error } = await (supabase as unknown as RpcClient).rpc("set_store_payment_methods", {
    p_payload: {
      store_id: parsed.data.store_id,
      accepted_payment_methods: parsed.data.accepted_payment_methods,
    },
  });
  if (error) {
    const forbidden = error.code === "42501";
    return NextResponse.json(
      { error: forbidden ? "forbidden_settings" : "settings_save_failed" },
      { status: forbidden ? 403 : 400 }
    );
  }
  const row = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return NextResponse.json({
    store_id: parsed.data.store_id,
    accepted_payment_methods: normalizeAcceptedPaymentMethods(row.accepted_payment_methods),
  });
}
